import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

const sites = {
  reference: "http://127.0.0.1:3011",
  fieldGuide: "http://127.0.0.1:3012",
  stress: "http://127.0.0.1:3015",
} as const;

test.beforeEach(async ({ page }) => {
  await page.route("https://www.googletagmanager.com/gtag/js**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
  await page.addInitScript(() => {
    const evidence = { layoutShift: 0, longTasks: [] as number[] };
    Object.assign(window, { __web01bPerformance: evidence });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          hadRecentInput?: boolean;
          value?: number;
        };
        if (shift.hadRecentInput !== true) evidence.layoutShift += shift.value ?? 0;
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      evidence.longTasks.push(...list.getEntries().map(({ duration }) => duration));
    }).observe({ type: "longtask", buffered: true });
  });
});

test("Design DNA and the static Signature add no client chunk", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Bundle comparison runs once.");
  await page.goto(sites.reference, { waitUntil: "networkidle" });
  const referenceScripts = await clientScriptPaths(page);
  await page.goto(sites.stress, { waitUntil: "networkidle" });
  const signatureScripts = await clientScriptPaths(page);

  expect(referenceScripts.filter((path) => path.includes("pagefind"))).toEqual([]);
  expect(signatureScripts.filter((path) => path.includes("pagefind"))).toEqual([]);
  expect(signatureScripts).toEqual(referenceScripts);
});

test("constrained CPU and network preserve responsive search with bounded runtime signals", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "CDP evidence runs once.");
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: 200_000,
    uploadThroughput: 100_000,
  });
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  try {
    await page.goto(sites.fieldGuide, { waitUntil: "networkidle" });
    const trigger = page.getByRole("button", { name: "Search this website" });
    await trigger.click();
    const query = page.getByRole("searchbox", {
      name: "Search public website content",
    });
    await query.fill("verification checklist");
    await query.press("Enter");
    await expect(page.getByRole("dialog").getByRole("link", {
      name: "Proposed Verification Checklist",
    })).toBeVisible();

    const runtime = await page.evaluate(() => {
      const resources = performance.getEntriesByType("resource")
        .map((entry) => entry as PerformanceResourceTiming);
      const hero = document.querySelector<HTMLImageElement>(
        '[data-asset-slot="hero"] img',
      );
      const evidence = (window as Window & {
        __web01bPerformance?: { layoutShift: number; longTasks: number[] };
      }).__web01bPerformance ?? { layoutShift: 0, longTasks: [] };
      return {
        javascript: resources
          .filter(({ name, initiatorType }) =>
            initiatorType === "script" || name.endsWith(".js"))
          .map(({ name, transferSize }) => ({ name, transferSize })),
        pagefindRequests: resources.filter(({ name }) => name.includes("/pagefind/"))
          .map(({ name }) => name),
        layoutShift: evidence.layoutShift,
        longTasks: evidence.longTasks,
        hero: hero === null ? null : {
          currentSrc: hero.currentSrc,
          naturalWidth: hero.naturalWidth,
          naturalHeight: hero.naturalHeight,
          renderedWidth: hero.getBoundingClientRect().width,
          sizes: hero.sizes,
          fetchPriority: hero.fetchPriority,
          preloaded: [...document.querySelectorAll<HTMLLinkElement>(
            'link[rel="preload"][as="image"]',
          )].length === 1,
        },
        viewport: {
          width: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        },
      };
    });
    const candidateSha = (await readFile(
      "/tmp/proportion-web01b-e2e/candidate-sha.txt",
      "utf8",
    )).trim();
    await testInfo.attach("web01b-runtime-evidence.json", {
      body: Buffer.from(JSON.stringify({
        candidateSha,
        conditions: {
          cpuThrottlingRate: 4,
          latencyMs: 150,
          downloadBytesPerSecond: 200_000,
          uploadBytesPerSecond: 100_000,
        },
        ...runtime,
      }, null, 2)),
      contentType: "application/json",
    });

    expect(runtime.viewport.scrollWidth).toBe(runtime.viewport.width);
    expect(runtime.hero).not.toBeNull();
    expect(runtime.hero?.naturalWidth).toBeGreaterThan(0);
    expect(runtime.hero?.naturalHeight).toBeGreaterThan(0);
    expect(runtime.hero?.sizes).not.toBe("");
    expect(
      runtime.hero?.fetchPriority === "high" || runtime.hero?.preloaded === true,
    ).toBe(true);
    expect(runtime.pagefindRequests.some((url) => url.endsWith("/pagefind/pagefind.js")))
      .toBe(true);
    expect(runtime.layoutShift).toBeLessThanOrEqual(0.1);
    expect(Math.max(0, ...runtime.longTasks)).toBeLessThanOrEqual(500);
  } finally {
    await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await session.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await session.detach();
  }
});

async function clientScriptPaths(page: Page): Promise<string[]> {
  return page.evaluate(() => performance.getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".js") && !name.includes("googletagmanager"))
    .map((name) => new URL(name).pathname)
    .sort());
}
