import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

export default defineConfig({
  root: repositoryRoot,
  resolve: {
    alias: {
      "@melbourne-local-growth-ops/asset-pipeline": fileURLToPath(
        new URL("../../../packages/asset-pipeline/src/index.ts", import.meta.url),
      ),
      "@melbourne-local-growth-ops/contact-form": fileURLToPath(
        new URL(
          "../../../packages/website-modules/contact-form/src/index.ts",
          import.meta.url,
        ),
      ),
      "@melbourne-local-growth-ops/contracts": fileURLToPath(
        new URL("../../../packages/contracts/src/index.ts", import.meta.url),
      ),
      "@melbourne-local-growth-ops/deployment": fileURLToPath(
        new URL("../../../packages/deployment/src/index.ts", import.meta.url),
      ),
      "@melbourne-local-growth-ops/resend": fileURLToPath(
        new URL(
          "../../../packages/integrations/resend/src/index.ts",
          import.meta.url,
        ),
      ),
      "@melbourne-local-growth-ops/site-core": fileURLToPath(
        new URL("../../../packages/site-core/src/index.ts", import.meta.url),
      ),
      "@melbourne-local-growth-ops/templates": fileURLToPath(
        new URL("../../../packages/templates/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/site-core/**/*.test.ts?(x)"],
    testTimeout: 30_000,
  },
});
