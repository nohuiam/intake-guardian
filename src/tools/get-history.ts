/**
 * Tool: get_intake_history
 *
 * Get intake decisions history for auditing.
 */

import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getIntakeService } from '../services/intake-service.js';

export const GET_HISTORY_SCHEMA = z.object({
  limit: z.number().min(1).max(200).optional().default(50).describe('Maximum number of entries'),
  decision_filter: z.enum(['auto_admit', 'review_recommended', 'review_required', 'auto_reject']).optional().describe('Filter by decision type'),
  since: z.string().optional().describe('ISO timestamp - only get entries after this time')
});

export type GetHistoryInput = z.infer<typeof GET_HISTORY_SCHEMA>;

export const GET_HISTORY_TOOL: Tool = {
  name: 'get_intake_history',
  description: 'Get intake decisions history for auditing. Filter by decision type or time range.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of entries to return (default: 50, max: 200)',
        minimum: 1,
        maximum: 200,
        default: 50
      },
      decision_filter: {
        type: 'string',
        enum: ['auto_admit', 'review_recommended', 'review_required', 'auto_reject'],
        description: 'Filter by decision type'
      },
      since: {
        type: 'string',
        description: 'ISO timestamp - only get entries after this time'
      }
    }
  }
};

export async function handleGetHistory(args: unknown): Promise<unknown> {
  const input = GET_HISTORY_SCHEMA.parse(args || {});
  const service = getIntakeService();
  return service.getHistory(input);
}
