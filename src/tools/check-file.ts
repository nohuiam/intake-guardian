/**
 * Tool: check_file
 *
 * Check file for admission eligibility.
 */

import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getIntakeService } from '../services/intake-service.js';

export const CHECK_FILE_SCHEMA = z.object({
  file_path: z.string().describe('Path to the file to check')
});

export type CheckFileInput = z.infer<typeof CHECK_FILE_SCHEMA>;

export const CHECK_FILE_TOOL: Tool = {
  name: 'check_file',
  description: 'Check file for admission eligibility. Analyzes file content for redundancy and returns decision based on configured thresholds.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to the file to check for admission'
      }
    },
    required: ['file_path']
  }
};

export async function handleCheckFile(args: unknown): Promise<unknown> {
  const input = CHECK_FILE_SCHEMA.parse(args);
  const service = getIntakeService();
  return service.checkFile(input);
}
