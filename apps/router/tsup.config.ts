import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node24",
  platform: "node",
  bundle: true,
  noExternal: [/^@siela\//],
  external: ["bun"],
  sourcemap: true,
  clean: true,
  splitting: false,
  dts: false,
  outDir: "dist",
});
