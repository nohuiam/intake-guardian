/**
 * HTTP REST API Server
 *
 * Port: 8023
 * Provides REST endpoints for Intake Guardian.
 */

import express, { Request, Response, NextFunction } from 'express';
import { Server } from 'http';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getIntakeService } from '../services/intake-service.js';
import { getDatabase } from '../database/schema.js';
import { checkHealth as checkBBBHealth } from '../services/bbb-client.js';
import { TOOLS, TOOL_HANDLERS } from '../index.js';

// SECURITY: API key for HTTP authentication
const API_KEY = process.env.INTAKE_API_KEY;

// Extend Express Request for request ID tracing
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

// In-memory rate limiting (Linus audit compliance)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 100;

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
    this.app.use(express.json({ limit: '1mb' }));

    // CORS headers
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }
      next();
    });

    // Request ID tracing middleware (Linus audit compliance)
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const requestId = (req.headers['x-request-id'] as string) || randomUUID();
      req.requestId = requestId;
      res.setHeader('X-Request-ID', requestId);
      next();
    });

    // Rate limiting middleware (Linus audit compliance)
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const clientIp = req.ip || 'unknown';
      const now = Date.now();
      const entry = rateLimitMap.get(clientIp);

      if (!entry || now > entry.resetTime) {
        rateLimitMap.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        next();
        return;
      }

      if (entry.count >= RATE_LIMIT_MAX) {
        res.status(429).json({ error: 'Too many requests', retryAfter: Math.ceil((entry.resetTime - now) / 1000) });
        return;
      }

      entry.count++;
      next();
    });

    // SECURITY: API key authentication for all /api/* routes
    this.app.use('/api', (req: Request, res: Response, next: NextFunction) => {
      // Skip auth if no API key is configured (development mode)
      if (!API_KEY) {
        console.error('[HTTP] WARNING: No INTAKE_API_KEY set - authentication disabled');
        next();
        return;
      }

      const providedKey = req.headers['x-api-key'] as string;
      if (!providedKey || providedKey !== API_KEY) {
        res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
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

    // Readiness check (Linus audit compliance - checks DB + BBB connectivity)
    this.app.get('/health/ready', async (req: Request, res: Response) => {
      try {
        const db = getDatabase();
        const stats = db.getStats();
        const bbbHealthy = await checkBBBHealth();

        const ready = stats !== undefined && bbbHealthy;
        res.status(ready ? 200 : 503).json({
          ready,
          server: 'intake-guardian',
          checks: {
            database: stats !== undefined,
            bbb_connection: bbbHealthy
          }
        });
      } catch (error) {
        res.status(503).json({
          ready: false,
          server: 'intake-guardian',
          checks: {
            database: false,
            bbb_connection: false
          },
          error: 'Service not ready'
        });
      }
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

    // GET /api/tools - List all MCP tools (for bop-gateway)
    this.app.get('/api/tools', (req: Request, res: Response) => {
      const toolList = TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema
      }));
      res.json({ tools: toolList, count: toolList.length });
    });

    // POST /api/tools/:toolName - Execute tool via HTTP (for bop-gateway)
    this.app.post('/api/tools/:toolName', async (req: Request, res: Response) => {
      const { toolName } = req.params;
      const args = req.body.arguments || req.body;

      const handler = TOOL_HANDLERS[toolName];
      if (!handler) {
        res.status(404).json({ success: false, error: `Tool '${toolName}' not found` });
        return;
      }

      try {
        const result = await handler(args);
        res.json({ success: true, result });
      } catch (error) {
        res.status(500).json({ success: false, error: sanitizeError(error) });
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
