/**
 * BBB Client
 *
 * HTTP client for Bonzai Bloat Buster (BBB) integration.
 * Gets redundancy scores for content admission decisions.
 */

import type { BBBAnalysisResponse } from '../types.js';

const BBB_URL = 'http://localhost:8008';

export interface BBBAnalyzeOptions {
  content?: string;
  file_path?: string;
  content_type?: string;
}

/**
 * Analyze content for redundancy using BBB
 */
export async function analyzeContent(options: BBBAnalyzeOptions): Promise<BBBAnalysisResponse> {
  try {
    const response = await fetch(`${BBB_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: options.content,
        file_path: options.file_path,
        content_type: options.content_type
      })
    });

    if (!response.ok) {
      // If BBB is not available, return a default score
      console.error(`[BBB Client] BBB returned status ${response.status}`);
      return getDefaultResponse();
    }

    const data = await response.json() as Record<string, unknown>;

    // Normalize response
    return {
      score: (data.redundancy_score as number) ?? (data.score as number) ?? 0,
      similar_items: (data.similar_items as string[]) ?? (data.duplicates as string[]) ?? []
    };
  } catch (error) {
    // BBB not available - fallback to default (admit new content)
    console.error(`[BBB Client] Error connecting to BBB: ${(error as Error).message}`);
    return getDefaultResponse();
  }
}

/**
 * Analyze file for redundancy using BBB
 */
export async function analyzeFile(filePath: string): Promise<BBBAnalysisResponse & { file_info?: { size: number; type: string; hash: string } }> {
  try {
    const response = await fetch(`${BBB_URL}/api/analyze-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath })
    });

    if (!response.ok) {
      console.error(`[BBB Client] BBB returned status ${response.status}`);
      return getDefaultResponse();
    }

    const data = await response.json() as Record<string, unknown>;

    return {
      score: (data.redundancy_score as number) ?? (data.score as number) ?? 0,
      similar_items: (data.similar_items as string[]) ?? (data.duplicates as string[]) ?? [],
      file_info: data.file_info as { size: number; type: string; hash: string } | undefined
    };
  } catch (error) {
    console.error(`[BBB Client] Error connecting to BBB: ${(error as Error).message}`);
    return getDefaultResponse();
  }
}

/**
 * Check if BBB is healthy
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${BBB_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get default response when BBB is unavailable
 * SECURITY: Fail-closed - require review when redundancy check is unavailable
 */
function getDefaultResponse(): BBBAnalysisResponse {
  // SECURITY FIX: When BBB is unavailable, require review (fail-closed)
  // Score of 50 triggers 'review_recommended' with default thresholds (30/70/85)
  // This prevents auto-admission of potentially redundant content when
  // the redundancy checker is unavailable (could be DoS attack)
  return {
    score: 50,  // Forces review_recommended decision
    similar_items: ['BBB_UNAVAILABLE']  // Flag that BBB check was skipped
  };
}
