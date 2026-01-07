/**
 * Type definitions for Intake Guardian
 */

// Decision types
export type Decision = 'auto_admit' | 'review_recommended' | 'review_required' | 'auto_reject';

// Threshold configuration
export interface ThresholdConfig {
  autoAdmitMax: number;          // Default: 30
  reviewRecommendedMax: number;  // Default: 70
  reviewRequiredMax: number;     // Default: 85
  // 86-100 = auto_reject (implicit)
}

// Check content input/output
export interface CheckContentInput {
  content: string;
  content_type?: string;
  metadata?: Record<string, unknown>;
}

export interface CheckContentOutput {
  decision: Decision;
  redundancy_score: number;
  similar_items: string[];
  reason: string;
  can_override: boolean;
  content_hash: string;
}

// Check file input/output
export interface CheckFileInput {
  file_path: string;
}

export interface CheckFileOutput {
  decision: Decision;
  redundancy_score: number;
  similar_files: Array<{ path: string; similarity: number }>;
  file_info: { size: number; type: string; hash: string };
  reason: string;
  can_override: boolean;
  content_hash: string;
}

// Admit content input/output
export interface AdmitContentInput {
  content_hash: string;
  override?: boolean;
  override_reason?: string;
  destination?: string;
}

export interface AdmitContentOutput {
  admitted: boolean;
  admission_id: string;
  timestamp: string;
  destination: string;
}

// History input/output
export interface GetHistoryInput {
  limit?: number;
  decision_filter?: Decision;
  since?: string;
}

export interface HistoryEntry {
  id: string;
  content_hash: string;
  decision: Decision;
  redundancy_score: number;
  override: boolean;
  timestamp: string;
}

export interface GetHistoryOutput {
  entries: HistoryEntry[];
  total: number;
}

// Configure thresholds input/output
export interface ConfigureThresholdsInput {
  auto_admit_max?: number;
  review_recommended_max?: number;
  review_required_max?: number;
}

export interface ConfigureThresholdsOutput {
  thresholds: {
    auto_admit: { min: number; max: number };
    review_recommended: { min: number; max: number };
    review_required: { min: number; max: number };
    auto_reject: { min: number; max: number };
  };
  updated: boolean;
}

// BBB response
export interface BBBAnalysisResponse {
  score: number;
  similar_items: string[];
}

// Database types
export interface IntakeDecision {
  id: string;
  content_hash: string;
  content_type: string | null;
  file_path: string | null;
  redundancy_score: number;
  decision: string;
  similar_items: string | null;  // JSON array
  override: number;
  override_reason: string | null;
  destination: string | null;
  created_at: number;
}

export interface AdmittedContent {
  id: string;
  decision_id: string;
  content_hash: string;
  destination: string | null;
  admitted_at: number;
}

export interface ConfigEntry {
  key: string;
  value: string;
  updated_at: number;
}
