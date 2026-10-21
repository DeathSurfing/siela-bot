export class CooldownManager {
  private readonly timestamps = new Map<string, number>();

  remaining(key: string, durationMs: number): number {
    const last = this.timestamps.get(key);
    if (!last) return 0;
    return Math.max(0, durationMs - (Date.now() - last));
  }

  use(key: string): void {
    this.timestamps.set(key, Date.now());
  }

  clear(): void {
    this.timestamps.clear();
  }
}
