export class CooldownManager {
  private readonly timestamps = new Map<string, number>();

  remaining(key: string, durationMs: number): number {
    const last = this.timestamps.get(key);
    if (!last) return 0;
    const remaining = Math.max(0, durationMs - (Date.now() - last));
    if (remaining === 0) this.timestamps.delete(key);
    return remaining;
  }

  use(key: string): void {
    this.timestamps.set(key, Date.now());
  }

  clear(): void {
    this.timestamps.clear();
  }
}
