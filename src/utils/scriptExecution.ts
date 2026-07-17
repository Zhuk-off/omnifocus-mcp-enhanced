import { execFile, ChildProcess } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync } from 'fs';
import { sanitizeForJson } from './sanitize.js';

/** Options accepted by all script-execution entry points. */
export interface ExecOptions {
  /** Client-side cancellation (MCP request abort). Kills the osascript child. */
  signal?: AbortSignal;
}

// Hard backstop so a stuck OmniFocus (modal automation-permission prompt, sync
// conflict, beachball) can't hang a tool handler — and a whole batch — forever.
// Generous by default: dump/large reads plus a cold first call can take tens of
// seconds, so a short timeout would abort legitimate work. Configurable via env.
const OSASCRIPT_TIMEOUT_MS = Number(process.env.OMNIFOCUS_MCP_OSASCRIPT_TIMEOUT_MS) || 120000;
// 64MB accommodates large database dumps and base64-encoded attachments
// (base64 inflates ~33%, so this allows attachments up to ~48MB).
const OSASCRIPT_MAX_BUFFER = Number(process.env.OMNIFOCUS_MCP_OSASCRIPT_MAX_BUFFER) || 64 * 1024 * 1024;

// Stable marker so batch handlers can detect a timeout and fail fast instead of
// re-hitting the same modal dialog for every remaining item.
export const OSASCRIPT_TIMEOUT_MARKER = 'osascript timed out';
// Stable marker for client-initiated cancellation (MCP request abort / Claude
// timeout). Batch handlers use it to stop spawning further work.
export const OSASCRIPT_CANCELLED_MARKER = 'osascript cancelled by client';

// Live osascript children. Killed en masse when this process shuts down —
// otherwise a Claude restart orphans in-flight osascript processes, which keep
// sending Apple Events to OmniFocus with nobody left to enforce the timeout.
const liveChildren = new Set<ChildProcess>();

function killAllChildren(): void {
  for (const child of liveChildren) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already dead — fine.
    }
  }
  liveChildren.clear();
}

// stdin closing means the MCP client (Claude) is gone: reap children and exit
// instead of letting pending osascript promises keep an ownerless server alive.
let shutdownHooksInstalled = false;
export function installShutdownHooks(): void {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  process.once('SIGTERM', () => { killAllChildren(); process.exit(0); });
  process.once('SIGINT', () => { killAllChildren(); process.exit(0); });
  process.once('SIGHUP', () => { killAllChildren(); process.exit(0); });
  process.on('exit', killAllChildren);
  process.stdin.on('end', () => { killAllChildren(); process.exit(0); });
  process.stdin.on('close', () => { killAllChildren(); process.exit(0); });
}

// Serialize osascript executions. OmniFocus handles Apple Events on its main
// thread anyway, so concurrency buys nothing — but a burst of parallel tool
// calls (Claude sends several per turn) stacking scan-heavy events is exactly
// how "OmniFocus stops answering until relaunch" episodes start.
let osascriptQueue: Promise<unknown> = Promise.resolve();

/**
 * Run osascript with a hard timeout (SIGKILL — osascript can ignore SIGTERM
 * while blocked on a synchronous Apple Event) and a large output buffer.
 * Uses execFile (no shell), so the temp path needs no quoting and survives
 * spaces/metacharacters in a custom TMPDIR. Translates timeout/overflow kills
 * into explanatory errors. Calls are serialized process-wide, and an aborted
 * request is skipped (if still queued) or killed (if running).
 */
async function runOsascript(args: string[], options?: ExecOptions): Promise<{ stdout: string; stderr: string }> {
  installShutdownHooks();
  const signal = options?.signal;

  const run = async (): Promise<{ stdout: string; stderr: string }> => {
    if (signal?.aborted) {
      throw new Error(`${OSASCRIPT_CANCELLED_MARKER} before start — the request was aborted while queued.`);
    }
    try {
      return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = execFile('osascript', args, {
          timeout: OSASCRIPT_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          maxBuffer: OSASCRIPT_MAX_BUFFER,
          ...(signal ? { signal } : {}),
        }, (error, stdout, stderr) => {
          liveChildren.delete(child);
          if (error) reject(error);
          else resolve({ stdout, stderr });
        });
        liveChildren.add(child);
      });
    } catch (err: any) {
      if (err && (err.code === 'ABORT_ERR' || err.name === 'AbortError' || signal?.aborted)) {
        throw new Error(
          `${OSASCRIPT_CANCELLED_MARKER} — the MCP client aborted the request; the osascript process was killed.`
        );
      }
      if (err && err.killed && (err.signal === 'SIGKILL' || err.signal === 'SIGTERM')) {
        throw new Error(
          `${OSASCRIPT_TIMEOUT_MARKER} after ${OSASCRIPT_TIMEOUT_MS}ms — OmniFocus may be showing a ` +
          `dialog (e.g. an automation-permission prompt) or syncing. Check OmniFocus, then retry.`
        );
      }
      if (err && (err.code === 'ERR_CHILD_PROCESS_STDOUT_MAXBUFFER' || /maxBuffer/.test(err.message || ''))) {
        throw new Error(
          `osascript output exceeded ${Math.round(OSASCRIPT_MAX_BUFFER / (1024 * 1024))}MB — the requested ` +
          `data (attachment or database dump) is too large. Narrow the request, or raise ` +
          `OMNIFOCUS_MCP_OSASCRIPT_MAX_BUFFER.`
        );
      }
      throw err;
    }
  };

  // Chain onto the queue; keep the queue alive even when this run rejects.
  const result = osascriptQueue.then(run, run);
  osascriptQueue = result.catch(() => undefined);
  return result;
}

/**
 * Safely execute AppleScript by writing to a temp file
 * This avoids shell escaping issues with quotes and special characters
 */
export async function executeAppleScript(script: string, options?: ExecOptions): Promise<string> {
  // Unique temp name: concurrent tool calls must never share a file (a shared
  // path lets one call's script overwrite another's before osascript reads it).
  const tempFile = join(tmpdir(), `applescript_${randomUUID()}.scpt`);

  try {
    // Write the script to a temporary file
    writeFileSync(tempFile, script);

    // Execute using osascript with the file path (no shell involved)
    const { stdout, stderr } = await runOsascript([tempFile], options);

    if (stderr) {
      console.error("AppleScript stderr:", stderr);
    }

    return stdout.trim();
  } finally {
    // Clean up the temporary file
    try {
      unlinkSync(tempFile);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// Helper function to execute OmniFocus scripts
export async function executeJXA(script: string, options?: ExecOptions): Promise<any[]> {
  // Unique temp name (see executeAppleScript) so concurrent calls don't collide.
  const tempFile = join(tmpdir(), `jxa_script_${randomUUID()}.js`);

  try {
    // Write the script to the temporary file
    writeFileSync(tempFile, script);

    // Execute the script using osascript
    const { stdout, stderr } = await runOsascript(['-l', 'JavaScript', tempFile], options);

    if (stderr) {
      console.error("Script stderr output:", stderr);
    }

    // Parse the output as JSON and sanitize isolated surrogates
    try {
      const result = JSON.parse(stdout);
      return sanitizeForJson(result) as any[];
    } catch (e) {
      console.error("Failed to parse script output as JSON:", e);

      // If this contains a "Found X tasks" message, treat it as a successful non-JSON response
      if (stdout.includes("Found") && stdout.includes("tasks")) {
        return [];
      }

      return [];
    }
  } catch (error) {
    console.error("Failed to execute JXA script:", error);
    throw error;
  } finally {
    // Clean up even when execAsync throws (timeout / maxBuffer), else temp files leak.
    try {
      unlinkSync(tempFile);
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// Function to execute scripts in OmniFocus using the URL scheme
// Update src/utils/scriptExecution.ts
export async function executeOmniFocusScript(scriptPath: string, args?: any, options?: ExecOptions): Promise<any> {
  try {
    // Get the actual script path (existing code remains the same)
    let actualPath;
    if (scriptPath.startsWith('@')) {
      const scriptName = scriptPath.substring(1);
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      
      const distPath = join(__dirname, '..', 'utils', 'omnifocusScripts', scriptName);
      const srcPath = join(__dirname, '..', '..', 'src', 'utils', 'omnifocusScripts', scriptName);
      
      if (existsSync(distPath)) {
        actualPath = distPath;
      } else if (existsSync(srcPath)) {
        actualPath = srcPath;
      } else {
        actualPath = join(__dirname, '..', 'omnifocusScripts', scriptName);
      }
    } else {
      actualPath = scriptPath;
    }
    
    // Read the script file
    let scriptContent = readFileSync(actualPath, 'utf8');
    
    // If arguments are provided, inject them into the script
    if (args && Object.keys(args).length > 0) {
      const argsJson = JSON.stringify(args);
      // Inject parameters at the beginning of the script
      const parameterInjection = `
    // Injected parameters
    const injectedArgs = ${argsJson};
    const perspectiveName = injectedArgs.perspectiveName || null;
    const perspectiveId = injectedArgs.perspectiveId || null;
    const hideCompleted = injectedArgs.hideCompleted !== undefined ? injectedArgs.hideCompleted : true;
    const limit = injectedArgs.limit || 100;
    const includeBuiltIn = injectedArgs.includeBuiltIn !== undefined ? injectedArgs.includeBuiltIn : false;
    const includeSidebar = injectedArgs.includeSidebar !== undefined ? injectedArgs.includeSidebar : true;
    const format = injectedArgs.format || "detailed";
    const tagName = injectedArgs.tagName || null;
    const exactMatch = injectedArgs.exactMatch !== undefined ? injectedArgs.exactMatch : false;
    `;
      
      // Replace any hardcoded parameters in the script with injected ones
      scriptContent = scriptContent.replace(
        /let perspectiveName = "今日工作安排"; \/\/ Hardcode for testing/,
        'let perspectiveName = injectedArgs.perspectiveName || null;'
      );
      scriptContent = scriptContent.replace(
        /let perspectiveName = null;/,
        'let perspectiveName = injectedArgs.perspectiveName || null;'
      );
      scriptContent = scriptContent.replace(
        /let perspectiveId = null;/,
        'let perspectiveId = injectedArgs.perspectiveId || null;'
      );
      scriptContent = scriptContent.replace(
        /let hideCompleted = true;/,
        'let hideCompleted = injectedArgs.hideCompleted !== undefined ? injectedArgs.hideCompleted : true;'
      );
      scriptContent = scriptContent.replace(
        /let limit = 100;/,
        'let limit = injectedArgs.limit || 100;'
      );
      scriptContent = scriptContent.replace(
        /let includeBuiltIn = false;/,
        'let includeBuiltIn = injectedArgs.includeBuiltIn !== undefined ? injectedArgs.includeBuiltIn : false;'
      );
      scriptContent = scriptContent.replace(
        /let includeSidebar = true;/,
        'let includeSidebar = injectedArgs.includeSidebar !== undefined ? injectedArgs.includeSidebar : true;'
      );
      scriptContent = scriptContent.replace(
        /let format = "detailed";/,
        'let format = injectedArgs.format || "detailed";'
      );
      
      // Inject the parameters at the beginning of the function
      scriptContent = scriptContent.replace(
        '(() => {',
        `(() => {
    ${parameterInjection}`
      );
    }
    
    // Create a temporary file for our JXA wrapper script.
    // Unique temp name (see executeAppleScript) so concurrent calls don't collide.
    const tempFile = join(tmpdir(), `jxa_wrapper_${randomUUID()}.js`);

    // Create a JXA script that will execute our OmniJS script in OmniFocus
    // Use JSON.stringify to safely embed the script content — avoids escaping issues
    // with template literals (backticks, ${...}) in OmniJS scripts like omnifocusDump.js
    const jxaScript = `
    function run() {
      try {
        const app = Application('OmniFocus');
        app.includeStandardAdditions = true;

        // Run the OmniJS script in OmniFocus and capture the output
        const result = app.evaluateJavascript(${JSON.stringify(scriptContent)});

        // Return the result
        return result;
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    }
    `;

    let stdout: string;
    let stderr: string;
    try {
      // Write the JXA script to the temporary file
      writeFileSync(tempFile, jxaScript);

      // Execute the JXA script using osascript
      ({ stdout, stderr } = await runOsascript(['-l', 'JavaScript', tempFile], options));
    } finally {
      // Clean up even when execAsync throws (timeout / maxBuffer), else temp files leak.
      try {
        unlinkSync(tempFile);
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    if (stderr) {
      console.error("Script stderr output:", stderr);
    }

    // Parse the output as JSON and sanitize isolated surrogates
    try {
      return sanitizeForJson(JSON.parse(stdout));
    } catch (parseError) {
      console.error("Error parsing script output:", parseError);
      return stdout;
    }
  } catch (error) {
    console.error("Failed to execute OmniFocus script:", error);
    throw error;
  }
}
    