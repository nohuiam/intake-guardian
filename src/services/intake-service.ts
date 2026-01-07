/**
 * Intake Service
 *
 * Orchestrates the intake workflow:
 * 1. Receive content/file
 * 2. Call BBB for redundancy analysis
 * 3. Apply decision engine
 * 4. Record decision
 * 5. Handle admission/override
 */

import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { readFileSync, statSync, existsSync } from 'fs';
import { extname, resolve, normalize } from 'path';
import { getDatabase } from '../database/schema.js';

// Security: Allowed base directories for file operations
// Files outside these directories will be rejected
const ALLOWED_BASE_PATHS = [
  '/Users/macbook/Documents/claude_home',
  '/tmp/intake-guardian'
];

/**
 * Validate file path is safe (no traversal, within allowed directories)
 * @throws Error if path is unsafe
 */
function validateFilePath(filePath: string): string {
  // Normalize and resolve to absolute path
  const normalizedPath = normalize(resolve(filePath));

  // Check for path traversal attempts in the original input
  if (filePath.includes('..') || filePath.includes('\0')) {
    throw new Error('Invalid file path: path traversal detected');
  }

  // Verify path is within allowed directories
  const isAllowed = ALLOWED_BASE_PATHS.some(basePath =>
    normalizedPath.startsWith(basePath + '/') || normalizedPath === basePath
  );

  if (!isAllowed) {
    throw new Error('Access denied: file path outside allowed directories');
  }

  return normalizedPath;
}

/**
 * Safely parse JSON with fallback
 */
function safeJsonParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    console.error('[IntakeService] Failed to parse JSON, using fallback');
    return fallback;
  }
}

import { analyzeContent, analyzeFile } from './bbb-client.js';
import { makeDecision, getThresholdRanges, validateThresholds } from './decision-engine.js';
import type {
  CheckContentInput,
  CheckContentOutput,
  CheckFileInput,
  CheckFileOutput,
  AdmitContentInput,
  AdmitContentOutput,
  GetHistoryInput,
  GetHistoryOutput,
  ConfigureThresholdsInput,
  ConfigureThresholdsOutput,
  IntakeDecision,
  AdmittedContent,
  ThresholdConfig
} from '../types.js';

export class IntakeService {
  private db = getDatabase();

  /**
   * Check raw content for admission eligibility
   */
  async checkContent(input: CheckContentInput): Promise<CheckContentOutput> {
    // Generate content hash
    const contentHash = createHash('sha256').update(input.content).digest('hex').substring(0, 32);

    // Check if already processed
    const existing = this.db.getDecisionByHash(contentHash);
    if (existing) {
      return {
        decision: existing.decision as CheckContentOutput['decision'],
        redundancy_score: existing.redundancy_score,
        similar_items: safeJsonParse<string[]>(existing.similar_items, []),
        reason: 'Content was previously checked',
        can_override: existing.decision !== 'auto_admit',
        content_hash: contentHash
      };
    }

    // Get redundancy analysis from BBB
    const analysis = await analyzeContent({
      content: input.content,
      content_type: input.content_type
    });

    // Apply decision engine
    const thresholds = this.db.getThresholds();
    const result = makeDecision(analysis.score, thresholds);

    // Record decision
    const decision: IntakeDecision = {
      id: uuidv4(),
      content_hash: contentHash,
      content_type: input.content_type || null,
      file_path: null,
      redundancy_score: analysis.score,
      decision: result.decision,
      similar_items: JSON.stringify(analysis.similar_items),
      override: 0,
      override_reason: null,
      destination: null,
      created_at: Date.now()
    };
    this.db.insertDecision(decision);

    return {
      decision: result.decision,
      redundancy_score: analysis.score,
      similar_items: analysis.similar_items,
      reason: result.reason,
      can_override: result.can_override,
      content_hash: contentHash
    };
  }

  /**
   * Check file for admission eligibility
   */
  async checkFile(input: CheckFileInput): Promise<CheckFileOutput> {
    // Security: Validate and sanitize file path
    const safePath = validateFilePath(input.file_path);

    // Verify file exists
    if (!existsSync(safePath)) {
      throw new Error('File not found');  // Don't leak path in error
    }

    // Read file and generate hash
    const content = readFileSync(safePath);
    const contentHash = createHash('sha256').update(content).digest('hex').substring(0, 32);

    // Get file info
    const stats = statSync(safePath);
    const fileInfo = {
      size: stats.size,
      type: extname(safePath).slice(1) || 'unknown',
      hash: contentHash
    };

    // Check if already processed
    const existing = this.db.getDecisionByHash(contentHash);
    if (existing) {
      const similarItems = safeJsonParse<string[]>(existing.similar_items, []);
      return {
        decision: existing.decision as CheckFileOutput['decision'],
        redundancy_score: existing.redundancy_score,
        similar_files: similarItems.map((id: string) => ({ path: id, similarity: existing.redundancy_score })),
        file_info: fileInfo,
        reason: 'File was previously checked',
        can_override: existing.decision !== 'auto_admit',
        content_hash: contentHash
      };
    }

    // Get redundancy analysis from BBB
    const analysis = await analyzeFile(safePath);

    // Apply decision engine
    const thresholds = this.db.getThresholds();
    const result = makeDecision(analysis.score, thresholds);

    // Record decision
    const decision: IntakeDecision = {
      id: uuidv4(),
      content_hash: contentHash,
      content_type: fileInfo.type,
      file_path: safePath,  // Store sanitized path
      redundancy_score: analysis.score,
      decision: result.decision,
      similar_items: JSON.stringify(analysis.similar_items),
      override: 0,
      override_reason: null,
      destination: null,
      created_at: Date.now()
    };
    this.db.insertDecision(decision);

    // Transform similar items to file format
    const similarFiles = analysis.similar_items.map(item => ({
      path: item,
      similarity: analysis.score
    }));

    return {
      decision: result.decision,
      redundancy_score: analysis.score,
      similar_files: similarFiles,
      file_info: analysis.file_info || fileInfo,
      reason: result.reason,
      can_override: result.can_override,
      content_hash: contentHash
    };
  }

  /**
   * Admit content or override a rejection
   */
  async admitContent(input: AdmitContentInput): Promise<AdmitContentOutput> {
    // Get the decision for this content
    const decision = this.db.getDecisionByHash(input.content_hash);
    if (!decision) {
      throw new Error(`No decision found for content hash: ${input.content_hash}`);
    }

    // Check if already admitted
    if (this.db.isAdmitted(input.content_hash)) {
      const existing = this.db.getAdmittedByHash(input.content_hash);
      return {
        admitted: true,
        admission_id: existing!.id,
        timestamp: new Date(existing!.admitted_at).toISOString(),
        destination: existing!.destination || 'default'
      };
    }

    // Check if override is needed
    if (decision.decision === 'auto_reject' || decision.decision === 'review_required') {
      if (!input.override) {
        throw new Error(`Content requires override. Decision was: ${decision.decision}`);
      }
      if (!input.override_reason) {
        throw new Error('Override reason is required for rejected/review-required content');
      }
    }

    // Determine destination
    const destination = input.destination || 'default';

    // Create admission record
    const admissionId = uuidv4();
    const admittedContent: AdmittedContent = {
      id: admissionId,
      decision_id: decision.id,
      content_hash: input.content_hash,
      destination,
      admitted_at: Date.now()
    };
    this.db.insertAdmittedContent(admittedContent);

    return {
      admitted: true,
      admission_id: admissionId,
      timestamp: new Date(admittedContent.admitted_at).toISOString(),
      destination
    };
  }

  /**
   * Get intake history
   */
  getHistory(input: GetHistoryInput): GetHistoryOutput {
    const limit = input.limit || 50;
    const since = input.since ? new Date(input.since).getTime() : undefined;

    const decisions = this.db.listDecisions(limit, input.decision_filter, since);
    const total = this.db.countDecisions();

    const entries = decisions.map(d => ({
      id: d.id,
      content_hash: d.content_hash,
      decision: d.decision as GetHistoryOutput['entries'][0]['decision'],
      redundancy_score: d.redundancy_score,
      override: d.override === 1,
      timestamp: new Date(d.created_at).toISOString()
    }));

    return { entries, total };
  }

  /**
   * Configure thresholds
   */
  configureThresholds(input: ConfigureThresholdsInput): ConfigureThresholdsOutput {
    const currentThresholds = this.db.getThresholds();

    const newThresholds: ThresholdConfig = {
      autoAdmitMax: input.auto_admit_max ?? currentThresholds.autoAdmitMax,
      reviewRecommendedMax: input.review_recommended_max ?? currentThresholds.reviewRecommendedMax,
      reviewRequiredMax: input.review_required_max ?? currentThresholds.reviewRequiredMax
    };

    // Validate
    const validation = validateThresholds(newThresholds);
    if (!validation.valid) {
      throw new Error(`Invalid thresholds: ${validation.errors.join(', ')}`);
    }

    // Check if anything changed
    const updated = (
      newThresholds.autoAdmitMax !== currentThresholds.autoAdmitMax ||
      newThresholds.reviewRecommendedMax !== currentThresholds.reviewRecommendedMax ||
      newThresholds.reviewRequiredMax !== currentThresholds.reviewRequiredMax
    );

    if (updated) {
      this.db.setThresholds(newThresholds);
    }

    return {
      thresholds: getThresholdRanges(newThresholds),
      updated
    };
  }

  /**
   * Get current thresholds
   */
  getThresholds(): ConfigureThresholdsOutput {
    const thresholds = this.db.getThresholds();
    return {
      thresholds: getThresholdRanges(thresholds),
      updated: false
    };
  }

  /**
   * Get stats
   */
  getStats() {
    return this.db.getStats();
  }
}

// Singleton instance
let serviceInstance: IntakeService | null = null;

export function getIntakeService(): IntakeService {
  if (!serviceInstance) {
    serviceInstance = new IntakeService();
  }
  return serviceInstance;
}
