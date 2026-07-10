import { z } from 'zod';
import { batchRemoveItems, BatchRemoveItemsParams } from '../primitives/batchRemoveItems.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

export const schema = z.object({
  items: z.array(z.object({
    id: z.string().optional().describe("The ID of the task or project to remove"),
    name: z.string().optional().describe("The name of the task or project to remove (as fallback if ID not provided)"),
    itemType: z.enum(['task', 'project']).describe("Type of item to remove ('task' or 'project')")
  })).describe("Array of items (tasks or projects) to remove")
});

export async function handler(args: z.infer<typeof schema>, extra: RequestHandlerExtra) {
  try {
    // Validate that each item has at least an ID or name
    for (const item of args.items) {
      if (!item.id && !item.name) {
        return {
          content: [{
            type: "text" as const,
            text: "Each item must have either id or name provided to remove it."
          }],
          isError: true
        };
      }
    }
    
    // Call the batchRemoveItems function
    const result = await batchRemoveItems(args.items as BatchRemoveItemsParams[]);
    
    // Catastrophic failure: nothing was processed (e.g. the whole call threw).
    if (result.results.length === 0) {
      return {
        content: [{
          type: "text" as const,
          text: `Failed to process batch removal: ${result.error || 'unknown error'}`
        }],
        isError: true
      };
    }

    const successCount = result.results.filter(r => r.success).length;
    const failureCount = result.results.filter(r => !r.success).length;

    let message = `✅ Removed ${successCount} of ${result.results.length} items.`;
    if (failureCount > 0) {
      message += ` ⚠️ ${failureCount} failed.`;
    }

    // Always list per-item outcomes so a partial or total failure keeps its reasons.
    const details = result.results.map((item, index) => {
      const itemType = args.items[index]?.itemType ?? 'item';
      if (item.success) {
        return `- ✅ ${itemType}: "${item.name}"`;
      }
      const identifier = args.items[index]?.id || args.items[index]?.name || '(unknown)';
      return `- ❌ ${itemType}: ${identifier} - Error: ${item.error}`;
    }).join('\n');

    return {
      content: [{
        type: "text" as const,
        text: `${message}\n\n${details}`
      }],
      // Flag as an error only when nothing succeeded; partial success stays
      // non-error but the ⚠️ count + per-item details make failures visible.
      isError: successCount === 0
    };
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`Tool execution error: ${error.message}`);
    return {
      content: [{
        type: "text" as const,
        text: `Error processing batch removal: ${error.message}`
      }],
      isError: true
    };
  }
} 