/**
 * WebSocket Server
 *
 * Port: 9023
 * Provides real-time event broadcasting for intake operations.
 */

import { WebSocketServer, WebSocket } from 'ws';

export type EventType =
  | 'content_checked'
  | 'content_admitted'
  | 'content_rejected'
  | 'threshold_updated'
  | 'error';

export interface WebSocketEvent {
  type: EventType;
  data: unknown;
  timestamp: string;
}

export class WebSocketService {
  private wss: WebSocketServer | null = null;
  private port: number;
  private clients: Set<WebSocket> = new Set();

  constructor(port: number) {
    this.port = port;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port });

        this.wss.on('connection', (ws: WebSocket) => {
          this.clients.add(ws);
          console.error(`[intake-guardian] WebSocket client connected (${this.clients.size} total)`);

          // Send welcome message
          this.sendTo(ws, {
            type: 'content_checked',
            data: { message: 'Connected to Intake Guardian WebSocket' },
            timestamp: new Date().toISOString()
          });

          ws.on('close', () => {
            this.clients.delete(ws);
            console.error(`[intake-guardian] WebSocket client disconnected (${this.clients.size} remaining)`);
          });

          ws.on('error', (error) => {
            console.error('[intake-guardian] WebSocket client error:', error.message);
            this.clients.delete(ws);
          });

          // Handle incoming messages
          ws.on('message', (message: Buffer) => {
            try {
              const data = JSON.parse(message.toString());
              this.handleMessage(ws, data);
            } catch {
              this.sendTo(ws, {
                type: 'error',
                data: { error: 'Invalid message format' },
                timestamp: new Date().toISOString()
              });
            }
          });
        });

        this.wss.on('listening', () => {
          console.error(`[intake-guardian] WebSocket server listening on port ${this.port}`);
          resolve();
        });

        this.wss.on('error', (error) => {
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleMessage(ws: WebSocket, message: { type: string; data?: unknown }): void {
    switch (message.type) {
      case 'ping':
        this.sendTo(ws, {
          type: 'content_checked',
          data: { pong: true },
          timestamp: new Date().toISOString()
        });
        break;

      default:
        this.sendTo(ws, {
          type: 'error',
          data: { error: `Unknown message type: ${message.type}` },
          timestamp: new Date().toISOString()
        });
    }
  }

  private sendTo(ws: WebSocket, event: WebSocketEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  /**
   * Broadcast event to all connected clients
   */
  broadcast(type: EventType, data: unknown): void {
    const event: WebSocketEvent = {
      type,
      data,
      timestamp: new Date().toISOString()
    };

    const message = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  /**
   * Emit content checked event
   */
  emitContentChecked(contentHash: string, decision: string): void {
    this.broadcast('content_checked', { content_hash: contentHash, decision });
  }

  /**
   * Emit content admitted event
   */
  emitContentAdmitted(contentHash: string, admissionId: string): void {
    this.broadcast('content_admitted', { content_hash: contentHash, admission_id: admissionId });
  }

  /**
   * Emit content rejected event
   */
  emitContentRejected(contentHash: string, reason: string): void {
    this.broadcast('content_rejected', { content_hash: contentHash, reason });
  }

  /**
   * Emit threshold updated event
   */
  emitThresholdUpdated(thresholds: unknown): void {
    this.broadcast('threshold_updated', thresholds);
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wss) {
        for (const client of this.clients) {
          client.close();
        }
        this.clients.clear();

        this.wss.close(() => {
          console.error('[intake-guardian] WebSocket server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
