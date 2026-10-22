import type { CounterService } from "./counters.js";
import type { EconomyService } from "./economy.js";

export class PrivacyService {
  constructor(
    private readonly counters: CounterService,
    private readonly economy: EconomyService | null = null,
  ) {}

  async deleteUserData(guildId: string, userId: string): Promise<void> {
    await this.counters.deleteUserData(guildId, userId);
    if (this.economy) await this.economy.deleteUserData(guildId, userId);
  }
}
