/**
 * InterLock UDP Socket
 *
 * Port: 3023
 * Handles UDP mesh communication for Intake Guardian.
 * Updated to use @bop/interlock shared package.
 */

import dgram from 'dgram';
import { InterlockSocket as SharedSocket } from '@bop/interlock';
import type { InterlockConfig as SharedConfig, Signal, RemoteInfo } from '@bop/interlock';
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
  private sharedSocket: SharedSocket | null = null;
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
    // Transform peers to shared package format
    const peersConfig: Record<string, { host: string; port: number }> = {};
    for (const peer of this.config.peers) {
      peersConfig[peer.name] = { host: peer.host || '127.0.0.1', port: peer.port };
    }

    const sharedConfig: SharedConfig = {
      port: this.config.port,
      serverId: this.config.serverId,
      peers: peersConfig,
      heartbeat: {
        interval: 30000,
        timeout: 90000
      }
    };

    this.sharedSocket = new SharedSocket(sharedConfig);

    // Listen for signals from shared socket
    this.sharedSocket.on('signal', (signal: Signal, rinfo: RemoteInfo) => {
      // Convert to local DecodedMessage format
      const decoded: DecodedMessage = {
        type: signal.type,
        serverId: signal.data.serverId as string,
        timestamp: signal.timestamp,
        data: signal.data
      };

      // Check whitelist
      if (!this.tumbler.isAllowed(decoded.type)) {
        return;
      }

      // Route to handlers
      this.handlers.route(decoded, rinfo as dgram.RemoteInfo);
    });

    await this.sharedSocket.start();
    console.error(`[InterLock] Listening on port ${this.config.port}`);
    this.isRunning = true;
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
  async send(peerName: string, type: number, data?: unknown): Promise<void> {
    if (!this.sharedSocket) return;

    try {
      await this.sharedSocket.sendTo(peerName, {
        type,
        data: {
          serverId: this.config.serverId,
          ...(data as Record<string, unknown> || {})
        }
      });
    } catch (err) {
      console.error(`[InterLock] Send error to ${peerName}:`, (err as Error).message);
    }
  }

  /**
   * Broadcast a signal to all peers
   */
  async broadcast(type: number, data?: unknown): Promise<void> {
    if (!this.sharedSocket) return;

    await this.sharedSocket.broadcast({
      type,
      data: {
        serverId: this.config.serverId,
        ...(data as Record<string, unknown> || {})
      }
    });
  }

  /**
   * Send heartbeat to all peers (handled by shared socket automatically)
   */
  sendHeartbeat(): void {
    // Heartbeat is now handled automatically by the shared socket
    // This method kept for backward compatibility
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
   * Get socket statistics from shared package
   */
  getSocketStats() {
    return this.sharedSocket?.getStats() || null;
  }

  /**
   * Get server ID
   */
  getServerId(): string {
    return this.config.serverId;
  }

  async stop(): Promise<void> {
    if (this.sharedSocket) {
      this.handlers.clear();
      await this.sharedSocket.stop();
      console.error('[InterLock] Socket closed');
      this.isRunning = false;
    }
  }
}
