import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.spec.ts"],
    globals: false,
    environment: "node",
    // Integration tests share one database and reset state per file: run files one after another.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
    globalSetup: ["./test/global-setup.ts"],
  },
  // SWC emits decorator metadata, which NestJS dependency injection needs (esbuild does not).
  plugins: [swc.vite({ module: { type: "es6" } })],
});
