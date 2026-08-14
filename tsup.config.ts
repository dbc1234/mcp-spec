import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  target: "node20",
  // Declarations come from `tsc --emitDeclarationOnly` (see the build script):
  // tsup's bundled rollup-plugin-dts breaks on newer TypeScript releases.
  dts: false,
  clean: true,
  splitting: false,
  sourcemap: true,
});
