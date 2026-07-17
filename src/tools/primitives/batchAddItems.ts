import { addOmniFocusTask, AddOmniFocusTaskParams } from './addOmniFocusTask.js';
import { addProject, AddProjectParams } from './addProject.js';
import { OSASCRIPT_TIMEOUT_MARKER, OSASCRIPT_CANCELLED_MARKER, type ExecOptions } from '../../utils/scriptExecution.js';

// Total wall-clock budget for one batch call. Claude's remote-tools bridge
// gives a tool call 180s; a batch that silently runs past that keeps hammering
// OmniFocus with Apple Events for a client that already gave up — which is how
// "OmniFocus/MCP stopped answering" episodes stack up. Stay under it and report
// the remainder honestly instead.
export const BATCH_DEADLINE_MS = Number(process.env.OMNIFOCUS_MCP_BATCH_DEADLINE_MS) || 150000;

/**
 * Shared batch stop-check: returns a skip reason when the batch must not start
 * its next item (client cancelled, or the time budget is exhausted).
 */
export function batchStopReason(startedAt: number, signal?: AbortSignal): string | undefined {
  if (signal?.aborted) {
    return 'Skipped: the client cancelled the request before this item started.';
  }
  if (Date.now() - startedAt > BATCH_DEADLINE_MS) {
    return `Skipped: batch time budget (${Math.round(BATCH_DEADLINE_MS / 1000)}s) exhausted — ` +
      `re-run with the remaining items (smaller batches, or raise OMNIFOCUS_MCP_BATCH_DEADLINE_MS).`;
  }
  return undefined;
}

// Define the parameters for the batch operation
export type BatchAddItemsParams = {
  type: 'task' | 'project';
  name: string;
  note?: string;
  dueDate?: string;
  deferDate?: string;
  plannedDate?: string;
  flagged?: boolean;
  estimatedMinutes?: number;
  tags?: string[];
  projectName?: string; // For tasks
  parentTaskId?: string; // For subtasks
  parentTaskName?: string; // For subtasks (alternative to ID)
  folderName?: string; // For projects
  sequential?: boolean; // For projects
};

// Define the result type for individual operations
type ItemResult = {
  success: boolean;
  id?: string;
  error?: string;
};

// Define the result type for the batch operation
type BatchResult = {
  success: boolean;
  results: ItemResult[];
  error?: string;
};

function validateBatchItem(item: BatchAddItemsParams, index: number): string | undefined {
  if (item.type !== 'task') {
    return undefined;
  }

  if (item.parentTaskId && item.parentTaskName) {
    return `Item ${index + 1} ("${item.name}"): Use only one parent reference. Provide parentTaskId or parentTaskName, not both.`;
  }

  if ((item.parentTaskId || item.parentTaskName) && item.projectName) {
    return `Item ${index + 1} ("${item.name}"): Do not provide projectName when parentTaskId or parentTaskName is set. Subtasks inherit project from their parent.`;
  }

  return undefined;
}

/**
 * Add multiple items (tasks or projects) to OmniFocus
 */
export async function batchAddItems(items: BatchAddItemsParams[], options?: ExecOptions): Promise<BatchResult> {
  try {
    // Results array to track individual operation outcomes
    const results: ItemResult[] = [];
    const startedAt = Date.now();

    // Process each item in sequence
    for (const [index, item] of items.entries()) {
      // Stop spawning work for a client that cancelled, and stay inside the
      // batch time budget (see BATCH_DEADLINE_MS) instead of running invisibly
      // past the MCP client's own timeout.
      const stopReason = batchStopReason(startedAt, options?.signal);
      if (stopReason) {
        for (let i = index; i < items.length; i++) {
          results.push({ success: false, error: stopReason });
        }
        break;
      }

      try {
        const validationError = validateBatchItem(item, index);
        if (validationError) {
          results.push({
            success: false,
            error: validationError
          });
          continue;
        }

        if (item.type === 'task') {
          // Extract task-specific params
          const taskParams: AddOmniFocusTaskParams = {
            name: item.name,
            note: item.note,
            dueDate: item.dueDate,
            deferDate: item.deferDate,
            plannedDate: item.plannedDate,
            flagged: item.flagged,
            estimatedMinutes: item.estimatedMinutes,
            tags: item.tags,
            projectName: item.projectName,
            parentTaskId: item.parentTaskId,
            parentTaskName: item.parentTaskName
          };
          
          // Add task
          const taskResult = await addOmniFocusTask(taskParams, options);
          results.push({
            success: taskResult.success,
            id: taskResult.taskId,
            error: taskResult.error
          });
        } else if (item.type === 'project') {
          // Extract project-specific params
          const projectParams: AddProjectParams = {
            name: item.name,
            note: item.note,
            dueDate: item.dueDate,
            deferDate: item.deferDate,
            plannedDate: item.plannedDate,
            flagged: item.flagged,
            estimatedMinutes: item.estimatedMinutes,
            tags: item.tags,
            folderName: item.folderName,
            sequential: item.sequential
          };
          
          // Add project
          const projectResult = await addProject(projectParams, options);
          results.push({
            success: projectResult.success,
            id: projectResult.projectId,
            error: projectResult.error
          });
        } else {
          // Invalid type
          results.push({
            success: false,
            error: `Invalid item type: ${(item as any).type}`
          });
        }
      } catch (itemError: any) {
        // Handle individual item errors
        results.push({
          success: false,
          error: itemError.message || "Unknown error processing item"
        });
      }

      // Fail fast on a timeout or cancellation: osascript was killed because
      // OmniFocus is stuck (modal dialog / sync) or the client gave up. Retrying
      // every remaining item would just re-hit the same block, so stop and mark
      // the rest as skipped.
      const last = results[results.length - 1];
      if (last && !last.success &&
          (last.error?.includes(OSASCRIPT_TIMEOUT_MARKER) || last.error?.includes(OSASCRIPT_CANCELLED_MARKER))) {
        for (let i = index + 1; i < items.length; i++) {
          results.push({
            success: false,
            error: `Skipped: aborted after a prior item timed out (OmniFocus may be showing a dialog or syncing).`
          });
        }
        break;
      }
    }

    // Determine overall success (true if at least one item was added successfully)
    const overallSuccess = results.some(result => result.success);

    return {
      success: overallSuccess,
      results: results
    };
  } catch (error: any) {
    console.error("Error in batchAddItems:", error);
    return {
      success: false,
      results: [],
      error: error.message || "Unknown error in batchAddItems"
    };
  }
} 
