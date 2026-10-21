import type { CounterService } from "./counters.js";

export class PrivacyService {
  constructor(private readonly counters: CounterService) {}

  async deleteUserData(guildId: string, userId: string): Promise<void> {
    await this.counters.deleteUserData(guildId, userId);
  }
}
