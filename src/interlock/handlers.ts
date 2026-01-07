/**
 * Signal Handlers
 */

import dgram from 'dgram';
import { getSignalName, type DecodedMessage } from './protocol.js';

export type SignalHandler = (message: DecodedMessage, rinfo: dgram.RemoteInfo) => void;

export class SignalHandlers {
  private handlers: Map<number, SignalHandler[]> = new Map();
  private defaultHandler: SignalHandler | null = null;

  on(type: number, handler: SignalHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
  }

  setDefault(handler: SignalHandler): void {
    this.defaultHandler = handler;
  }

  route(message: DecodedMessage, rinfo: dgram.RemoteInfo): void {
    const handlers = this.handlers.get(message.type);
    if (handlers && handlers.length > 0) {
      for (const handler of handlers) {
        try {
          handler(message, rinfo);
        } catch (error) {
          console.error(`[InterLock] Handler error for ${getSignalName(message.type)}:`, (error as Error).message);
        }
      }
    } else if (this.defaultHandler) {
      try {
        this.defaultHandler(message, rinfo);
      } catch (error) {
        console.error('[InterLock] Default handler error:', (error as Error).message);
      }
    }
  }

  off(type: number): void {
    this.handlers.delete(type);
  }

  clear(): void {
    this.handlers.clear();
    this.defaultHandler = null;
  }
}
