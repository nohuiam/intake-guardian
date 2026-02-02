/**
 * InterLock Module Exports
 * Uses @bop/interlock shared package for socket management.
 */

// Re-export shared package types
export type { Signal, PeerInfo, SocketStats, RemoteInfo } from '@bop/interlock';
export { SignalTypes as SharedSignalTypes, getSignalName as getSharedSignalName } from '@bop/interlock';

// Local exports
export { InterLockSocket, type InterLockConfig } from './socket.js';
export { encode, decode, SIGNAL_TYPES, getSignalName, type DecodedMessage, type SignalType } from './protocol.js';
export { SignalHandlers, type SignalHandler } from './handlers.js';
export { Tumbler } from './tumbler.js';
