/**
 * Tool: configure_thresholds
 *
 * Set admission thresholds.
 */

import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getIntakeService } from '../services/intake-service.js';

export const CONFIGURE_THRESHOLDS_SCHEMA = z.object({
  auto_admit_max: z.number().min(0).max(100).optional().describe('Max score for auto-admit (default: 30)'),
  review_recommended_max: z.number().min(0).max(100).optional().describe('Max score for review-recommended (default: 70)'),
  review_required_max: z.number().min(0).max(100).optional().describe('Max score for review-required (default: 85)')
});

export type ConfigureThresholdsInput = z.infer<typeof CONFIGURE_THRESHOLDS_SCHEMA>;

export const CONFIGURE_THRESHOLDS_TOOL: Tool = {
  name: 'configure_thresholds',
  description: 'Configure admission thresholds. Scores above review_required_max are auto-rejected.',
  inputSchema: {
    type: 'object',
    properties: {
      auto_admit_max: {
        type: 'number',
        description: 'Max redundancy score for auto-admit (0-30 default)',
        minimum: 0,
        maximum: 100
      },
      review_recommended_max: {
        type: 'number',
        description: 'Max redundancy score for review-recommended (31-70 default)',
        minimum: 0,
        maximum: 100
      },
      review_required_max: {
        type: 'number',
        description: 'Max redundancy score for review-required (71-85 default). Scores above this are auto-rejected.',
        minimum: 0,
        maximum: 100
      }
    }
  }
};

export async function handleConfigureThresholds(args: unknown): Promise<unknown> {
  const input = CONFIGURE_THRESHOLDS_SCHEMA.parse(args || {});

  // If no input, just return current thresholds
  if (!input.auto_admit_max && !input.review_recommended_max && !input.review_required_max) {
    const service = getIntakeService();
    return service.getThresholds();
  }

  const service = getIntakeService();
  return service.configureThresholds(input);
}
