/**
 * InterLock Protocol
 *
 * BaNano-style message encoding/decoding for UDP mesh communication.
 */

export const SIGNAL_TYPES = {
  // Core signals (ecosystem aligned)
  DOCK_REQUEST: 0x01,
  DOCK_APPROVE: 0x02,
  DOCK_REJECT: 0x03,
  HEARTBEAT: 0x04,
  DISCONNECT: 0x05,

  // Legacy aliases for compatibility
  DISCOVERY: 0x01,  // Alias for DOCK_REQUEST
  SHUTDOWN: 0x05,   // Alias for DISCONNECT

  // Health signals (moved to avoid conflicts)
  HEALTH_CHECK: 0x06,
  HEALTH_RESPONSE: 0x07,

  // Intake signals
  CONTENT_CHECKED: 0x10,
  CONTENT_ADMITTED: 0x20,
  CONTENT_REJECTED: 0x21,

  // Error signals
  ERROR: 0xF0,
  ERROR_CRITICAL: 0xFF
} as const;

export type SignalType = (typeof SIGNAL_TYPES)[keyof typeof SIGNAL_TYPES];

export interface DecodedMessage {
  type: number;
  serverId: string;
  data: unknown;
  timestamp: number;
}

export function getSignalName(type: number): string {
  for (const [name, value] of Object.entries(SIGNAL_TYPES)) {
    if (value === type) {
      return name;
    }
  }
  return `UNKNOWN_0x${type.toString(16).toUpperCase()}`;
}

export function encode(message: {
  type: number;
  serverId: string;
  data?: unknown;
}): Buffer {
  const payload = {
    t: message.type,
    s: message.serverId,
    d: message.data || {},
    ts: Date.now()
  };
  return Buffer.from(JSON.stringify(payload), 'utf-8');
}

/**
 * Decode binary BaNano format (12-byte header + JSON)
 */
function decodeBinary(buffer: Buffer): DecodedMessage | null {
  if (buffer.length < 12) return null;

  try {
    const signalType = buffer.readUInt16BE(0);
    const payloadLength = buffer.readUInt32BE(4);
    const timestamp = buffer.readUInt32BE(8);

    // Validate signal type in valid range
    if (signalType === 0 || signalType > 0xFF) return null;
    if (payloadLength > buffer.length - 12) return null;

    const payloadStr = buffer.slice(12, 12 + payloadLength).toString('utf8');
    const payload = JSON.parse(payloadStr);

    return {
      type: signalType,
      serverId: payload.sender || payload.serverId || 'unknown',
      data: payload,
      timestamp: timestamp * 1000 // Convert to milliseconds
    };
  } catch {
    return null;
  }
}

/**
 * Decode text format {t, s, d, ts}
 */
function decodeText(buffer: Buffer): DecodedMessage | null {
  try {
    const str = buffer.toString('utf-8');
    if (!str.startsWith('{')) return null;

    const payload = JSON.parse(str);

    // Text format A: {t, s, d, ts}
    if ('t' in payload && 's' in payload) {
      return {
        type: payload.t,
        serverId: payload.s,
        data: payload.d,
        timestamp: payload.ts
      };
    }

    // Text format B: {type, source, payload, timestamp}
    if ('type' in payload && 'source' in payload) {
      return {
        type: typeof payload.type === 'number' ? payload.type : 0,
        serverId: payload.source,
        data: payload.payload,
        timestamp: payload.timestamp
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function decode(buffer: Buffer): DecodedMessage | null {
  // Try binary format first
  const binaryResult = decodeBinary(buffer);
  if (binaryResult) return binaryResult;

  // Fall back to text formats
  return decodeText(buffer);
}
