/**
 * HTTP REST API Server
 *
 * Port: 8023
 * Provides REST endpoints for Intake Guardian.
 */

import express, { Request, Response, NextFunction } from 'express';
import { Server } from 'http';
import { z } from 'zod';
import { getIntakeService } from '../services/intake-service.js';
import { getDatabase } from '../database/schema.js';
import { checkHealth as checkBBBHealth } from '../services/bbb-client.js';

// Input validation schemas (matching tool schemas)
const CheckInputSchema = z.object({
  content: z.string().optional(),
  content_type: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  file_path: z.string().optional()
}).refine(data => data.content || data.file_path, {
  message: 'Either content or file_path is required'
});

const AdmitInputSchema = z.object({
  content_hash: z.string().min(1),
  override: z.boolean().optional(),
  override_reason: z.string().optional(),
  destination: z.string().optional()
});

const ConfigInputSchema = z.object({
  auto_admit_max: z.number().min(0).max(100).optional(),
  review_recommended_max: z.number().min(0).max(100).optional(),
  review_required_max: z.number().min(0).max(100).optional()
});

/**
 * Sanitize error messages to prevent information disclosure
 */
function sanitizeError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return 'Invalid input: ' + error.errors.map(e => e.message).join(', ');
  }
  const message = error instanceof Error ? error.message : 'Unknown error';

  // Remove sensitive information from error messages
  const sensitivePatterns = [
    /\/Users\/[^/]+/g,  // User paths
    /\/home\/[^/]+/g,   // Linux home paths
    /at\s+.+:\d+:\d+/g, // Stack trace lines
    /SQLITE_/g,         // SQLite error codes
    /ENOENT:|EACCES:/g  // System error codes
  ];

  let sanitized = message;
  for (const pattern of sensitivePatterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  return sanitized;
}

export class HttpServer {
  private app: express.Application;
  private server: Server | null = null;
  private port: number;

  constructor(port: number) {
    this.port = port;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());

    // CORS headers
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', async (req: Request, res: Response) => {
      const db = getDatabase();
      const stats = db.getStats();
      const bbbHealthy = await checkBBBHealth();

      res.json({
        status: 'healthy',
        server: 'intake-guardian',
        port: this.port,
        bbb_connected: bbbHealthy,
        stats
      });
    });

    // Stats
    this.app.get('/stats', (req: Request, res: Response) => {
      try {
        const service = getIntakeService();
        res.json(service.getStats());
      } catch (error) {
        res.status(500).json({ error: sanitizeError(error) });
      }
    });

    // Check content/file
    this.app.post('/api/check', async (req: Request, res: Response) => {
      try {
        // Validate input with Zod
        const input = CheckInputSchema.parse(req.body);
        const service = getIntakeService();

        if (input.file_path) {
          const result = await service.checkFile({ file_path: input.file_path });
          res.json(result);
        } else if (input.content) {
          const result = await service.checkContent({
            content: input.content,
            content_type: input.content_type,
            metadata: input.metadata
          });
          res.json(result);
        }
      } catch (error) {
        res.status(400).json({ error: sanitizeError(error) });
      }
    });

    // Admit content
    this.app.post('/api/admit', async (req: Request, res: Response) => {
      try {
        // Validate input with Zod
        const input = AdmitInputSchema.parse(req.body);
        const service = getIntakeService();
        const result = await service.admitContent(input);
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: sanitizeError(error) });
      }
    });

    // Get history
    this.app.get('/api/history', (req: Request, res: Response) => {
      try {
        const service = getIntakeService();
        // Validate query params
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
        if (limit !== undefined && (isNaN(limit) || limit < 1 || limit > 200)) {
          res.status(400).json({ error: 'limit must be a number between 1 and 200' });
          return;
        }

        const validDecisions = ['auto_admit', 'review_recommended', 'review_required', 'auto_reject'];
        const decisionFilter = req.query.decision_filter as string | undefined;
        if (decisionFilter && !validDecisions.includes(decisionFilter)) {
          res.status(400).json({ error: 'Invalid decision_filter value' });
          return;
        }

        const result = service.getHistory({
          limit,
          decision_filter: decisionFilter as any,
          since: req.query.since as string
        });
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: sanitizeError(error) });
      }
    });

    // Get config
    this.app.get('/api/config', (req: Request, res: Response) => {
      try {
        const service = getIntakeService();
        res.json(service.getThresholds());
      } catch (error) {
        res.status(500).json({ error: sanitizeError(error) });
      }
    });

    // Update config
    this.app.put('/api/config', (req: Request, res: Response) => {
      try {
        // Validate input with Zod
        const input = ConfigInputSchema.parse(req.body);
        const service = getIntakeService();
        const result = service.configureThresholds(input);
        res.json(result);
      } catch (error) {
        res.status(400).json({ error: sanitizeError(error) });
      }
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          console.error(`[intake-guardian] HTTP server listening on port ${this.port}`);
          resolve();
        });

        this.server.on('error', (err) => {
          reject(err);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.error('[intake-guardian] HTTP server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
