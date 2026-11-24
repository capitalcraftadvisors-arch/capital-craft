// Unit tests: `npm test` (= vitest run).
//
// Plain Node — no browser, no DOM, no network. Tests sit next to the code they
// test as src/**/*.test.ts and cover pure helpers (lib/...). The "@" alias is
// the same one tsconfig.json uses ("@/lib/x" → src/lib/x).

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
