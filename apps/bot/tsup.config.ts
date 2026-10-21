import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "scripts/migrate": "src/scripts/migrate.ts",
  },
  format: ["esm"],
  target: "node24",
  platform: "node",
  bundle: true,
  noExternal: [/^@siela\//],
  sourcemap: true,
  clean: true,
  splitting: false,
  dts: false,
  outDir: "dist",
});
