#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { appendFile } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { installShutdownHooks } from './utils/scriptExecution.js';

// Import tool definitions
import * as dumpDatabaseTool from './tools/definitions/dumpDatabase.js';
import * as addOmniFocusTaskTool from './tools/definitions/addOmniFocusTask.js';
import * as addProjectTool from './tools/definitions/addProject.js';
import * as removeItemTool from './tools/definitions/removeItem.js';
import * as editItemTool from './tools/definitions/editItem.js';
import * as moveTaskTool from './tools/definitions/moveTask.js';
import * as batchAddItemsTool from './tools/definitions/batchAddItems.js';
import * as batchRemoveItemsTool from './tools/definitions/batchRemoveItems.js';
import * as getTaskByIdTool from './tools/definitions/getTaskById.js';
import * as readTaskAttachmentTool from './tools/definitions/readTaskAttachment.js';
import * as getTodayCompletedTasksTool from './tools/definitions/getTodayCompletedTasks.js';
// Import perspective tools
import * as getInboxTasksTool from './tools/definitions/getInboxTasks.js';
import * as getFlaggedTasksTool from './tools/definitions/getFlaggedTasks.js';
import * as getForecastTasksTool from './tools/definitions/getForecastTasks.js';
import * as getTasksByTagTool from './tools/definitions/getTasksByTag.js';
// Import ultimate filter tool
import * as filterTasksTool from './tools/definitions/filterTasks.js';
// Import custom perspective tools
import * as listCustomPerspectivesTool from './tools/definitions/listCustomPerspectives.js';
import * as getCustomPerspectiveTasksTool from './tools/definitions/getCustomPerspectiveTasks.js';

// Create an MCP server
const server = new McpServer({
  name: "OmniFocus MCP",
  version: "1.6.9"
});

// ---------------------------------------------------------------------------
// Call log: one JSONL line per tool call (start/end/error with duration) in a
// file OUTSIDE Claude's own logs. Purpose: when "the MCP hangs" is reported,
// this file settles in one look WHERE it hung — no `start` line means the call
// never reached this server (the problem is in the client/bridge); a `start`
// without `end` pinpoints the stuck tool. Set OMNIFOCUS_MCP_CALL_LOG to a custom
// path, or to "off"/"0" to disable.
const callLogSetting = process.env.OMNIFOCUS_MCP_CALL_LOG;
const CALL_LOG_PATH = callLogSetting === '0' || callLogSetting === 'off'
  ? null
  : (callLogSetting || join(homedir(), 'Library', 'Logs', 'omnifocus-mcp-enhanced-calls.log'));

function logCall(entry: Record<string, unknown>): void {
  if (!CALL_LOG_PATH) return;
  // Fire-and-forget: diagnostics must never block or fail a tool call.
  appendFile(CALL_LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, ...entry }) + '\n', () => {});
}

type ToolHandler = (args: any, extra: any) => Promise<any>;

// Register a tool with call logging wrapped around its handler.
function tool(name: string, description: string, shape: any, handler: ToolHandler): void {
  server.tool(name, description, shape, (async (args: any, extra: any) => {
    const startedAt = Date.now();
    logCall({ tool: name, event: 'start' });
    try {
      const result = await handler(args, extra);
      logCall({ tool: name, event: 'end', ms: Date.now() - startedAt, ok: !(result && result.isError) });
      return result;
    } catch (err: any) {
      logCall({ tool: name, event: 'error', ms: Date.now() - startedAt, err: String(err?.message || err) });
      throw err;
    }
  }) as ToolHandler);
}

// Register tools
tool(
  "dump_database",
  "Gets the current state of your OmniFocus database",
  dumpDatabaseTool.schema.shape,
  dumpDatabaseTool.handler
);

tool(
  "add_omnifocus_task",
  "Add a new task to OmniFocus",
  addOmniFocusTaskTool.schema.shape,
  addOmniFocusTaskTool.handler
);

tool(
  "add_project",
  "Add a new project to OmniFocus",
  addProjectTool.schema.shape,
  addProjectTool.handler
);

tool(
  "remove_item",
  "Remove a task or project from OmniFocus",
  removeItemTool.schema.shape,
  removeItemTool.handler
);

tool(
  "edit_item",
  "Edit a task or project in OmniFocus",
  editItemTool.schema.shape,
  editItemTool.handler
);

tool(
  "move_task",
  "Move an existing task to a project, parent task, or inbox",
  moveTaskTool.schema.shape,
  moveTaskTool.handler
);

tool(
  "batch_add_items",
  "Add multiple tasks or projects to OmniFocus in a single operation",
  batchAddItemsTool.schema.shape,
  batchAddItemsTool.handler
);

tool(
  "batch_remove_items",
  "Remove multiple tasks or projects from OmniFocus in a single operation",
  batchRemoveItemsTool.schema.shape,
  batchRemoveItemsTool.handler
);


tool(
  "get_task_by_id",
  "Get information about a specific task by ID or name",
  getTaskByIdTool.schema.shape,
  getTaskByIdTool.handler
);

tool(
  "read_task_attachment",
  "Read a task attachment reported by get_task_by_id. Images are returned as MCP image content when possible.",
  readTaskAttachmentTool.schema.shape,
  readTaskAttachmentTool.handler
);

tool(
  "get_today_completed_tasks",
  "Get tasks completed today - view today's accomplishments",
  getTodayCompletedTasksTool.schema.shape,
  getTodayCompletedTasksTool.handler
);

// Register perspective tools
tool(
  "get_inbox_tasks",
  "Get tasks from OmniFocus inbox perspective",
  getInboxTasksTool.schema.shape,
  getInboxTasksTool.handler
);

tool(
  "get_flagged_tasks", 
  "Get flagged tasks from OmniFocus with optional project filtering",
  getFlaggedTasksTool.schema.shape,
  getFlaggedTasksTool.handler
);

tool(
  "get_forecast_tasks",
  "Get tasks from OmniFocus forecast perspective (due/deferred tasks in date range)", 
  getForecastTasksTool.schema.shape,
  getForecastTasksTool.handler
);

tool(
  "get_tasks_by_tag",
  "Get tasks filtered by OmniFocus tags (labels like @home, @work, @urgent). Use this for tag-based filtering, NOT for custom perspective names. Tags are labels assigned to individual tasks.",
  getTasksByTagTool.schema.shape, 
  getTasksByTagTool.handler
);

// Ultimate filter tool - The most powerful task perspective engine
tool(
  "filter_tasks",
  "Advanced task filtering with unlimited perspective combinations - status, dates, projects, tags, search, and more",
  filterTasksTool.schema.shape,
  filterTasksTool.handler
);

// Custom perspective tools
tool(
  "list_custom_perspectives",
  "List all custom perspectives defined in OmniFocus",
  listCustomPerspectivesTool.schema.shape,
  listCustomPerspectivesTool.handler
);

tool(
  "get_custom_perspective_tasks",
  "Get tasks from a specific OmniFocus custom perspective by name. Use this when user refers to perspective names like '今日工作安排', '今日复盘', '本周项目' etc. - these are custom views created in OmniFocus, NOT tags. Supports hierarchical tree display of task relationships.",
  getCustomPerspectiveTasksTool.schema.shape,
  getCustomPerspectiveTasksTool.handler
);

// Reap in-flight osascript children if this process is terminated or the MCP
// client closes stdin — orphaned osascript processes otherwise keep sending
// Apple Events to OmniFocus with nobody left to enforce their timeout.
installShutdownHooks();

// Start the MCP server
const transport = new StdioServerTransport();

// Use await with server.connect to ensure proper connection
(async function() {
  try {
    await server.connect(transport);
    logCall({ event: 'server_start' });
  } catch (err) {
    logCall({ event: 'server_start_failed', err: String(err) });
    console.error(`Failed to start MCP server: ${err}`);
  }
})();

// For a cleaner shutdown if the process is terminated
