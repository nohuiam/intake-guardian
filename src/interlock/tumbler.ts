/**
 * Tumbler - Signal Whitelist Filter
 */

export class Tumbler {
  private allowedSignals: Set<number>;
  private stats = { allowed: 0, blocked: 0, byType: new Map<number, number>() };

  constructor(allowedSignals: string[]) {
    this.allowedSignals = new Set();
    for (const signal of allowedSignals) {
      if (signal.startsWith('0x')) {
        this.allowedSignals.add(parseInt(signal, 16));
      } else {
        this.allowedSignals.add(parseInt(signal, 10));
      }
    }
  }

  isAllowed(type: number): boolean {
    if (this.allowedSignals.size === 0) {
      this.stats.allowed++;
      return true;
    }
    if (this.allowedSignals.has(type)) {
      this.stats.allowed++;
      this.stats.byType.set(type, (this.stats.byType.get(type) || 0) + 1);
      return true;
    }
    this.stats.blocked++;
    return false;
  }

  getStats(): { allowed: number; blocked: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const [type, count] of this.stats.byType) {
      byType[`0x${type.toString(16).toUpperCase()}`] = count;
    }
    return { allowed: this.stats.allowed, blocked: this.stats.blocked, byType };
  }
}
