import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "line",
  outputDir: "test-results",
  use: {
    baseURL: "http://127.0.0.1:3010",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 375, height: 812 },
      },
    },
    {
      name: "tablet-chromium",
      use: {
        ...devices["Desktop Chrome"],
        hasTouch: true,
        viewport: { width: 768, height: 1024 },
      },
    },
  ],
  webServer: [
    productionServer(".", 3010),
    productionServer("/tmp/proportion-web01b-e2e/contractor-reference/source", 3011),
    productionServer("/tmp/proportion-web01b-e2e/contractor-field-guide/source", 3012),
    productionServer("/tmp/proportion-web01b-e2e/restaurant/source", 3013),
    productionServer("/tmp/proportion-web01b-e2e/retailer/source", 3014),
  ],
});

function productionServer(directory: string, port: number) {
  return {
    command: `pnpm --dir ${directory} exec next start -p ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  };
}
