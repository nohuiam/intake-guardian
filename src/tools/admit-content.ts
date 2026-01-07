/**
 * Tool: admit_content
 *
 * Admit content or override a rejection.
 */

import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getIntakeService } from '../services/intake-service.js';

export const ADMIT_CONTENT_SCHEMA = z.object({
  content_hash: z.string().describe('Content hash from check_content or check_file'),
  override: z.boolean().optional().describe('Force admission despite rejection'),
  override_reason: z.string().optional().describe('Required if override is true'),
  destination: z.string().optional().describe('Where to route admitted content')
});

export type AdmitContentInput = z.infer<typeof ADMIT_CONTENT_SCHEMA>;

export const ADMIT_CONTENT_TOOL: Tool = {
  name: 'admit_content',
  description: 'Admit content or override a rejection. Use content_hash from check_content or check_file. Override requires a reason.',
  inputSchema: {
    type: 'object',
    properties: {
      content_hash: {
        type: 'string',
        description: 'Content hash from previous check_content or check_file call'
      },
      override: {
        type: 'boolean',
        description: 'Set to true to force admission despite rejection'
      },
      override_reason: {
        type: 'string',
        description: 'Reason for override (required if override is true)'
      },
      destination: {
        type: 'string',
        description: 'Where to route the admitted content'
      }
    },
    required: ['content_hash']
  }
};

export async function handleAdmitContent(args: unknown): Promise<unknown> {
  const input = ADMIT_CONTENT_SCHEMA.parse(args);
  const service = getIntakeService();
  return service.admitContent(input);
}
