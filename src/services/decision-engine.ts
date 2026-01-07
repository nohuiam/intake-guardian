/**
 * Decision Engine
 *
 * Implements GNC-004 threshold-based admission decisions.
 *
 * Default thresholds:
 * - 0-30%: Auto-admit (low redundancy, new content)
 * - 31-70%: Review recommended (moderate similarity)
 * - 71-85%: Review required (high similarity)
 * - 86-100%: Auto-reject (near duplicate)
 */

import type { Decision, ThresholdConfig } from '../types.js';

export interface DecisionResult {
  decision: Decision;
  can_override: boolean;
  reason: string;
}

/**
 * Make admission decision based on redundancy score
 */
export function makeDecision(redundancyScore: number, config: ThresholdConfig): DecisionResult {
  // Clamp score to 0-100
  const score = Math.max(0, Math.min(100, redundancyScore));

  if (score <= config.autoAdmitMax) {
    return {
      decision: 'auto_admit',
      can_override: false,
      reason: `Low redundancy (${score}%) - content is unique enough for automatic admission`
    };
  }

  if (score <= config.reviewRecommendedMax) {
    return {
      decision: 'review_recommended',
      can_override: true,
      reason: `Moderate redundancy (${score}%) - review recommended before admission`
    };
  }

  if (score <= config.reviewRequiredMax) {
    return {
      decision: 'review_required',
      can_override: true,
      reason: `High redundancy (${score}%) - human review required before admission`
    };
  }

  return {
    decision: 'auto_reject',
    can_override: true,
    reason: `Very high redundancy (${score}%) - content is nearly identical to existing items`
  };
}

/**
 * Get threshold ranges for display
 */
export function getThresholdRanges(config: ThresholdConfig): {
  auto_admit: { min: number; max: number };
  review_recommended: { min: number; max: number };
  review_required: { min: number; max: number };
  auto_reject: { min: number; max: number };
} {
  return {
    auto_admit: { min: 0, max: config.autoAdmitMax },
    review_recommended: { min: config.autoAdmitMax + 1, max: config.reviewRecommendedMax },
    review_required: { min: config.reviewRecommendedMax + 1, max: config.reviewRequiredMax },
    auto_reject: { min: config.reviewRequiredMax + 1, max: 100 }
  };
}

/**
 * Validate threshold configuration
 */
export function validateThresholds(config: Partial<ThresholdConfig>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  const autoAdmitMax = config.autoAdmitMax ?? 30;
  const reviewRecommendedMax = config.reviewRecommendedMax ?? 70;
  const reviewRequiredMax = config.reviewRequiredMax ?? 85;

  if (autoAdmitMax < 0 || autoAdmitMax > 100) {
    errors.push('auto_admit_max must be between 0 and 100');
  }

  if (reviewRecommendedMax < 0 || reviewRecommendedMax > 100) {
    errors.push('review_recommended_max must be between 0 and 100');
  }

  if (reviewRequiredMax < 0 || reviewRequiredMax > 100) {
    errors.push('review_required_max must be between 0 and 100');
  }

  if (autoAdmitMax >= reviewRecommendedMax) {
    errors.push('auto_admit_max must be less than review_recommended_max');
  }

  if (reviewRecommendedMax >= reviewRequiredMax) {
    errors.push('review_recommended_max must be less than review_required_max');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
