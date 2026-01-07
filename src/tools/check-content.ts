/**
 * Tool: check_content
 *
 * Check raw content for admission eligibility.
 */

import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getIntakeService } from '../services/intake-service.js';

export const CHECK_CONTENT_SCHEMA = z.object({
  content: z.string().describe('The content to check'),
  content_type: z.string().optional().describe('Type of content (e.g., markdown, json, text)'),
  metadata: z.record(z.unknown()).optional().describe('Optional metadata about the content')
});

export type CheckContentInput = z.infer<typeof CHECK_CONTENT_SCHEMA>;

export const CHECK_CONTENT_TOOL: Tool = {
  name: 'check_content',
  description: 'Check raw content for admission eligibility. Uses BBB for redundancy analysis and returns decision based on configured thresholds.',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The content to check for admission'
      },
      content_type: {
        type: 'string',
        description: 'Type of content (e.g., markdown, json, text)'
      },
      metadata: {
        type: 'object',
        description: 'Optional metadata about the content'
      }
    },
    required: ['content']
  }
};

export async function handleCheckContent(args: unknown): Promise<unknown> {
  const input = CHECK_CONTENT_SCHEMA.parse(args);
  const service = getIntakeService();
  return service.checkContent(input);
}
