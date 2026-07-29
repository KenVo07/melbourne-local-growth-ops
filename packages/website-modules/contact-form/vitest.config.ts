import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolvePath = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));

/**
 * Package unit tests plus the repository-level contact-form integration
 * tests. The integration directory is owned by this stream but is not a
 * workspace project, so it runs from here rather than by adding a shared
 * workspace entry.
 *
 * Aliases let the integration tests import package-root specifiers from
 * outside a package directory without deep-importing another package's
 * internals or requiring a build step first.
 */
export default defineConfig({
  test: {
    include: [
      "src/**/*.test.ts",
      "../../../tests/integration/contact-form/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@melbourne-local-growth-ops/contact-form": resolvePath("./src/index.ts"),
      "@melbourne-local-growth-ops/resend": resolvePath(
        "../../integrations/resend/src/index.ts",
      ),
    },
  },
});
