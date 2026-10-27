// Test-only stub for the `bun` module (vitest runs on Node).
export class RedisClient {
  constructor(..._args: unknown[]) {
    throw new Error("bun RedisClient stub: not available under vitest");
  }
}
