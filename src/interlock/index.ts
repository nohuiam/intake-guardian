/**
 * InterLock Module Exports
 */

export { InterLockSocket, type InterLockConfig } from './socket.js';
export { encode, decode, SIGNAL_TYPES, getSignalName, type DecodedMessage, type SignalType } from './protocol.js';
export { SignalHandlers, type SignalHandler } from './handlers.js';
export { Tumbler } from './tumbler.js';
