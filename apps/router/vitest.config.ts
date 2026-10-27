import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      bun: new URL("./src/bunStub.ts", import.meta.url).pathname,
    },
  },
});
