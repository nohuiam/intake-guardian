/**
 * Database Schema for Intake Guardian
 *
 * Tables:
 * - intake_decisions: History of all intake decisions
 * - admitted_content: Registry of admitted content
 * - config: Configuration storage (thresholds)
 */

import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';
import type { IntakeDecision, AdmittedContent, ConfigEntry, ThresholdConfig } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default thresholds from GNC-004
const DEFAULT_THRESHOLDS: ThresholdConfig = {
  autoAdmitMax: 30,
  reviewRecommendedMax: 70,
  reviewRequiredMax: 85
};

export class DatabaseManager {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const finalPath = dbPath || join(__dirname, '..', '..', 'data', 'intake-guardian.db');

    // Ensure data directory exists
    const dbDir = dirname(finalPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(finalPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('cache_size = 2000');
    this.initializeSchema();
    this.initializeDefaults();
  }

  private initializeSchema(): void {
    const schema = `
      -- Intake decisions history
      CREATE TABLE IF NOT EXISTS intake_decisions (
        id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        content_type TEXT,
        file_path TEXT,
        redundancy_score REAL NOT NULL,
        decision TEXT NOT NULL,
        similar_items TEXT,
        override INTEGER DEFAULT 0,
        override_reason TEXT,
        destination TEXT,
        created_at INTEGER NOT NULL
      );

      -- Admitted content registry
      CREATE TABLE IF NOT EXISTS admitted_content (
        id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        destination TEXT,
        admitted_at INTEGER NOT NULL,
        FOREIGN KEY (decision_id) REFERENCES intake_decisions(id)
      );

      -- Configuration
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_decisions_hash ON intake_decisions(content_hash);
      CREATE INDEX IF NOT EXISTS idx_decisions_date ON intake_decisions(created_at);
      CREATE INDEX IF NOT EXISTS idx_decisions_decision ON intake_decisions(decision);
      CREATE INDEX IF NOT EXISTS idx_admitted_hash ON admitted_content(content_hash);
    `;

    this.db.exec(schema);
  }

  private initializeDefaults(): void {
    // Initialize default thresholds if not set
    const existing = this.getConfig('thresholds');
    if (!existing) {
      this.setConfig('thresholds', JSON.stringify(DEFAULT_THRESHOLDS));
    }
  }

  // Decision operations
  insertDecision(decision: IntakeDecision): void {
    const stmt = this.db.prepare(`
      INSERT INTO intake_decisions (
        id, content_hash, content_type, file_path, redundancy_score,
        decision, similar_items, override, override_reason, destination, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      decision.id,
      decision.content_hash,
      decision.content_type,
      decision.file_path,
      decision.redundancy_score,
      decision.decision,
      decision.similar_items,
      decision.override,
      decision.override_reason,
      decision.destination,
      decision.created_at
    );
  }

  getDecision(id: string): IntakeDecision | undefined {
    const stmt = this.db.prepare('SELECT * FROM intake_decisions WHERE id = ?');
    return stmt.get(id) as IntakeDecision | undefined;
  }

  getDecisionByHash(contentHash: string): IntakeDecision | undefined {
    const stmt = this.db.prepare('SELECT * FROM intake_decisions WHERE content_hash = ? ORDER BY created_at DESC LIMIT 1');
    return stmt.get(contentHash) as IntakeDecision | undefined;
  }

  listDecisions(limit: number = 50, decisionFilter?: string, since?: number): IntakeDecision[] {
    let query = 'SELECT * FROM intake_decisions WHERE 1=1';
    const params: (string | number)[] = [];

    if (decisionFilter) {
      query += ' AND decision = ?';
      params.push(decisionFilter);
    }

    if (since) {
      query += ' AND created_at >= ?';
      params.push(since);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as IntakeDecision[];
  }

  countDecisions(): number {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM intake_decisions').get() as { count: number };
    return result.count;
  }

  // Admitted content operations
  insertAdmittedContent(content: AdmittedContent): void {
    const stmt = this.db.prepare(`
      INSERT INTO admitted_content (id, decision_id, content_hash, destination, admitted_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(content.id, content.decision_id, content.content_hash, content.destination, content.admitted_at);
  }

  getAdmittedByHash(contentHash: string): AdmittedContent | undefined {
    const stmt = this.db.prepare('SELECT * FROM admitted_content WHERE content_hash = ?');
    return stmt.get(contentHash) as AdmittedContent | undefined;
  }

  isAdmitted(contentHash: string): boolean {
    const result = this.getAdmittedByHash(contentHash);
    return result !== undefined;
  }

  // Config operations
  getConfig(key: string): string | undefined {
    const stmt = this.db.prepare('SELECT value FROM config WHERE key = ?');
    const result = stmt.get(key) as { value: string } | undefined;
    return result?.value;
  }

  setConfig(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
    `);
    const now = Date.now();
    stmt.run(key, value, now, value, now);
  }

  getThresholds(): ThresholdConfig {
    const value = this.getConfig('thresholds');
    if (value) {
      try {
        const parsed = JSON.parse(value);
        // Validate structure before returning
        if (typeof parsed.autoAdmitMax === 'number' &&
            typeof parsed.reviewRecommendedMax === 'number' &&
            typeof parsed.reviewRequiredMax === 'number') {
          return parsed;
        }
      } catch {
        console.error('[Database] Failed to parse thresholds config, using defaults');
      }
    }
    return DEFAULT_THRESHOLDS;
  }

  setThresholds(config: ThresholdConfig): void {
    this.setConfig('thresholds', JSON.stringify(config));
  }

  // Stats
  getStats(): {
    total_decisions: number;
    admitted_count: number;
    by_decision: Record<string, number>;
  } {
    const totalDecisions = this.countDecisions();
    const admittedCount = (this.db.prepare('SELECT COUNT(*) as count FROM admitted_content').get() as { count: number }).count;

    const byDecision: Record<string, number> = {};
    const decisions = this.db.prepare('SELECT decision, COUNT(*) as count FROM intake_decisions GROUP BY decision').all() as Array<{ decision: string; count: number }>;
    for (const d of decisions) {
      byDecision[d.decision] = d.count;
    }

    return {
      total_decisions: totalDecisions,
      admitted_count: admittedCount,
      by_decision: byDecision
    };
  }

  close(): void {
    this.db.close();
  }
}

// Singleton instance
let dbInstance: DatabaseManager | null = null;

export function getDatabase(): DatabaseManager {
  if (!dbInstance) {
    dbInstance = new DatabaseManager();
  }
  return dbInstance;
}
