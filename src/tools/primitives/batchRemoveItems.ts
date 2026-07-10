import { removeItem, RemoveItemParams } from './removeItem.js';
import { OSASCRIPT_TIMEOUT_MARKER } from '../../utils/scriptExecution.js';

// Define the parameters for the batch removal operation
export type BatchRemoveItemsParams = RemoveItemParams;

// Define the result type for individual operations
type ItemResult = {
  success: boolean;
  id?: string;
  name?: string;
  error?: string;
};

// Define the result type for the batch operation
type BatchResult = {
  success: boolean;
  results: ItemResult[];
  error?: string;
};

/**
 * Remove multiple items (tasks or projects) from OmniFocus
 */
export async function batchRemoveItems(items: BatchRemoveItemsParams[]): Promise<BatchResult> {
  try {
    // Results array to track individual operation outcomes
    const results: ItemResult[] = [];
    
    // Process each item in sequence
    for (const [index, item] of items.entries()) {
      try {
        // Remove item
        const itemResult = await removeItem(item);
        results.push({
          success: itemResult.success,
          id: itemResult.id,
          name: itemResult.name,
          error: itemResult.error
        });
      } catch (itemError: any) {
        // Handle individual item errors
        results.push({
          success: false,
          error: itemError.message || "Unknown error processing item"
        });
      }

      // Fail fast on a timeout (see batchAddItems): a stuck OmniFocus would time
      // out every remaining item, so stop and mark the rest as skipped.
      const last = results[results.length - 1];
      if (last && !last.success && last.error?.includes(OSASCRIPT_TIMEOUT_MARKER)) {
        for (let i = index + 1; i < items.length; i++) {
          results.push({
            success: false,
            error: `Skipped: aborted after a prior item timed out (OmniFocus may be showing a dialog or syncing).`
          });
        }
        break;
      }
    }
    
    // Determine overall success (true if at least one item was removed successfully)
    const overallSuccess = results.some(result => result.success);
    
    return {
      success: overallSuccess,
      results: results
    };
  } catch (error: any) {
    console.error("Error in batchRemoveItems:", error);
    return {
      success: false,
      results: [],
      error: error.message || "Unknown error in batchRemoveItems"
    };
  }
} 