/**
 * InterLock UDP Socket
 *
 * Port: 3023
 * Handles UDP mesh communication for Intake Guardian.
 */

import dgram from 'dgram';
import { encode, decode, SIGNAL_TYPES, getSignalName, type DecodedMessage } from './protocol.js';
import { SignalHandlers } from './handlers.js';
import { Tumbler } from './tumbler.js';

export interface InterLockConfig {
  port: number;
  serverId: string;
  allowedSignals: string[];
  peers: Array<{ name: string; port: number; host?: string }>;
}

export class InterLockSocket {
  private socket: dgram.Socket | null = null;
  private config: InterLockConfig;
  private handlers: SignalHandlers;
  private tumbler: Tumbler;
  private isRunning = false;

  constructor(config: InterLockConfig) {
    this.config = config;
    this.handlers = new SignalHandlers();
    this.tumbler = new Tumbler(config.allowedSignals);
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket('udp4');

      this.socket.on('error', (err) => {
        console.error('[InterLock] Socket error:', err.message);
        if (!this.isRunning) {
          reject(err);
        }
      });

      this.socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo);
      });

      this.socket.on('listening', () => {
        const addr = this.socket!.address();
        console.error(`[InterLock] Listening on port ${addr.port}`);
        this.isRunning = true;
        resolve();
      });

      this.socket.bind(this.config.port);
    });
  }

  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    const decoded = decode(msg);
    if (!decoded) {
      console.error(`[InterLock] Failed to decode message from ${rinfo.address}:${rinfo.port}`);
      return;
    }

    // Check whitelist
    if (!this.tumbler.isAllowed(decoded.type)) {
      return;
    }

    // Route to handlers
    this.handlers.route(decoded, rinfo);
  }

  /**
   * Register a handler for a signal type
   */
  on(type: number, handler: (message: DecodedMessage, rinfo: dgram.RemoteInfo) => void): void {
    this.handlers.on(type, handler);
  }

  /**
   * Set default handler for unhandled signals
   */
  setDefaultHandler(handler: (message: DecodedMessage, rinfo: dgram.RemoteInfo) => void): void {
    this.handlers.setDefault(handler);
  }

  /**
   * Send a signal to a specific peer
   */
  send(peerName: string, type: number, data?: unknown): void {
    const peer = this.config.peers.find(p => p.name === peerName);
    if (!peer) {
      console.error(`[InterLock] Unknown peer: ${peerName}`);
      return;
    }

    const message = encode({
      type,
      serverId: this.config.serverId,
      data
    });

    this.socket?.send(message, peer.port, peer.host || 'localhost', (err) => {
      if (err) {
        console.error(`[InterLock] Send error to ${peerName}:`, err.message);
      }
    });
  }

  /**
   * Broadcast a signal to all peers
   */
  broadcast(type: number, data?: unknown): void {
    for (const peer of this.config.peers) {
      this.send(peer.name, type, data);
    }
  }

  /**
   * Send heartbeat to all peers
   */
  sendHeartbeat(): void {
    this.broadcast(SIGNAL_TYPES.HEARTBEAT, {
      server: this.config.serverId,
      timestamp: Date.now()
    });
  }

  /**
   * Send content checked signal
   */
  sendContentChecked(contentHash: string, decision: string, redundancyScore: number): void {
    this.broadcast(SIGNAL_TYPES.CONTENT_CHECKED, {
      content_hash: contentHash,
      decision,
      redundancy_score: redundancyScore
    });
  }

  /**
   * Send content admitted signal
   */
  sendContentAdmitted(contentHash: string, admissionId: string): void {
    this.broadcast(SIGNAL_TYPES.CONTENT_ADMITTED, {
      content_hash: contentHash,
      admission_id: admissionId
    });
  }

  /**
   * Send content rejected signal
   */
  sendContentRejected(contentHash: string, reason: string): void {
    this.broadcast(SIGNAL_TYPES.CONTENT_REJECTED, {
      content_hash: contentHash,
      reason
    });
  }

  /**
   * Get filter stats
   */
  getStats(): { allowed: number; blocked: number; byType: Record<string, number> } {
    return this.tumbler.getStats();
  }

  /**
   * Get server ID
   */
  getServerId(): string {
    return this.config.serverId;
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket) {
        this.handlers.clear();
        this.socket.close(() => {
          console.error('[InterLock] Socket closed');
          this.isRunning = false;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
