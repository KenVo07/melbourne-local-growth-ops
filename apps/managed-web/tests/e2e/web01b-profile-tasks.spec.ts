import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

const sites = {
  reference: "http://127.0.0.1:3011",
  fieldGuide: "http://127.0.0.1:3012",
  restaurant: "http://127.0.0.1:3013",
  retailer: "http://127.0.0.1:3014",
  stress: "http://127.0.0.1:3015",
} as const;

const evidenceRoot = "/tmp/proportion-web01b-e2e";

test.beforeEach(async ({ page }) => {
  await page.route("https://www.googletagmanager.com/gtag/js**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
});

test("production fixtures and descriptors name one exact candidate SHA", async () => {
  const candidateSha = (await readFile(`${evidenceRoot}/candidate-sha.txt`, "utf8")).trim();
  expect(candidateSha).toMatch(/^[0-9a-f]{40}$/);

  for (const fixture of [
    "contractor-reference",
    "contractor-field-guide",
    "contractor-stress",
    "restaurant",
    "retailer",
  ]) {
    const descriptor = JSON.parse(
      await readFile(`${evidenceRoot}/${fixture}/client-artifact.json`, "utf8"),
    ) as { factoryRevision?: string };
    expect(descriptor.factoryRevision).toBe(candidateSha);
  }
});

test("two Contractor experiences materially recompose the same semantic task", async ({
  page,
}, testInfo) => {
  await page.goto(sites.reference);
  const reference = await experienceEvidence(page);
  await expect(page.getByRole("heading", { name: "Illustrative Services & Proposed Coverage" }))
    .toBeVisible();
  await expect(page.getByRole("heading", { name: "Illustrative Service Process" }))
    .toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Phone contact unavailable" }))
    .toContainText("Add a client-verified business number before launch");
  await expect(page.getByRole("button", { name: "Send enquiry" })).toBeVisible();
  if (testInfo.project.name === "desktop-chromium") {
    await page.screenshot({
      path: `${evidenceRoot}/contractor-reference-desktop.png`,
      fullPage: true,
    });
  }

  await page.goto(sites.fieldGuide);
  const fieldGuide = await experienceEvidence(page);
  await expect(page.locator('[data-signature-id="service-area-proof"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Illustrative Services & Proposed Coverage" }))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "Send enquiry" })).toBeVisible();
  if (testInfo.project.name === "desktop-chromium") {
    await page.screenshot({
      path: `${evidenceRoot}/contractor-field-guide-desktop.png`,
      fullPage: true,
    });
  }

  expect(reference.sectionIds.sort()).toEqual(fieldGuide.sectionIds.sort());
  expect(reference).toMatchObject({
    profile: "CONTRACTOR",
    heroLayout: "split",
    displayFamily: "serif",
    surfaceTreatment: "cards",
  });
  expect(fieldGuide).toMatchObject({
    profile: "CONTRACTOR",
    heroLayout: "media_first",
    displayFamily: "sans",
    surfaceTreatment: "banded",
  });
  expect(reference.firstHeroChild).toBe("DIV");
  expect(fieldGuide.firstHeroChild).toBe("FIGURE");
});

test("Restaurant menu, details, hours, location and truthful next steps are complete with search OFF", async ({
  page,
}) => {
  const pagefindRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/pagefind/")) pagefindRequests.push(request.url());
  });
  await page.goto(sites.restaurant, { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "Menu", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Opening hours" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Find us" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Call the fictional demo line" }))
    .toHaveAttribute("href", /^tel:/);
  await expect(page.getByRole("status").filter({ hasText: "Reserve a table" }))
    .toContainText("Online reservations are not configured");
  await expect(page.getByRole("status").filter({ hasText: "Order takeaway online" }))
    .toContainText("Please call or visit in person");
  await expect(page.locator(".foundation-search-trigger")).toHaveCount(0);
  expect(pagefindRequests).toEqual([]);
});

test("Retail discovery, suitability, policy and truthful purchase alternatives are complete with search OFF", async ({
  page,
}) => {
  await page.goto(sites.retailer);

  await expect(page.getByRole("heading", { name: "Shop by category" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Featured products" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Returns, pickup & other policies" }))
    .toBeVisible();
  await expect(page.getByRole("link", { name: "Call the fictional demo store" }))
    .toHaveAttribute("href", /^tel:/);
  await expect(page.getByRole("status").filter({ hasText: "Buy online" }))
    .toContainText("Visit in-store or call to buy products");
  await expect(page.getByRole("status").filter({ hasText: "Order for pickup" }))
    .toContainText("Call ahead to arrange in-store pickup");
  await expect(page.locator(".foundation-search-trigger")).toHaveCount(0);
});

test("both explicit Contractor variants preserve lead-form validation and delivery", async ({
  page,
}) => {
  await page.goto(sites.reference);
  await page.getByRole("button", { name: "Send enquiry" }).click();
  await expect(page.getByLabel("Name")).toBeFocused();
  await expect(page.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");

  await page.route("**/api/contact", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true }),
  }));
  await page.goto(sites.fieldGuide);
  await page.getByLabel("Name").fill("Sam Visitor");
  await page.getByLabel("Email").fill("sam@example.com");
  await page.getByLabel("Phone").fill("+61 400 000 000");
  await page.getByLabel("How can we help?").fill("A bounded variant enquiry.");
  await page.getByRole("button", { name: "Send enquiry" }).click();
  await expect(page.locator(".lead-form-status")).toHaveText(
    "Thanks. Your enquiry has been sent.",
  );
});

test("touch profiles expose usable search and navigation targets", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "desktop-chromium", "Touch evidence runs in touch projects.");
  await page.goto(sites.fieldGuide);

  const searchTrigger = page.getByRole("button", { name: "Search this website" });
  const searchBox = page.getByRole("searchbox", {
    name: "Search public website content",
  });
  const triggerBox = await searchTrigger.boundingBox();
  expect(triggerBox?.width).toBeGreaterThanOrEqual(44);
  expect(triggerBox?.height).toBeGreaterThanOrEqual(44);
  await searchTrigger.tap();
  await expect(searchBox).toBeFocused();
  await page.getByRole("button", { name: "Close search" }).tap();
  await expect(searchTrigger).toBeFocused();

  const servicesLink = page.getByRole("navigation", { name: "Section navigation" })
    .getByRole("link", { name: "Illustrative Services & Proposed Coverage" });
  const linkBox = await servicesLink.boundingBox();
  expect(linkBox?.height).toBeGreaterThanOrEqual(44);
  await servicesLink.tap();
  await expect(page).toHaveURL(/#services$/);
  await expect(page.locator("#services")).toBeVisible();
});

test("320px keyboard and reduced-motion baseline keeps every control reachable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(sites.stress);

  await expect(page.getByText("Stress service 18:", { exact: false })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Phone and emergency" }))
    .toContainText("No verified phone number or emergency service is configured");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#primary-content")).toBeFocused();

  const layout = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const unreachable = [...document.querySelectorAll<HTMLElement>(
      "a, button, input, textarea, summary",
    )].filter((element) => {
      if (element.closest('[aria-hidden="true"]') !== null) return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && (box.left < -1 || box.right > viewportWidth + 1);
    }).map((element) => element.textContent?.trim() || element.tagName);
    const clippedText = [...document.querySelectorAll<HTMLElement>(
      "h1, h2, h3, p, li, label, button, a",
    )].filter((element) => {
      const style = getComputedStyle(element);
      return element.scrollWidth > element.clientWidth + 1 &&
        style.overflowX !== "visible";
    }).map((element) => element.textContent?.trim() || element.tagName);
    const motionDurations = [...document.querySelectorAll<HTMLElement>("[data-motion] *")]
      .flatMap((element) => getComputedStyle(element).animationDuration.split(","))
      .map((duration) => duration.endsWith("ms")
        ? Number.parseFloat(duration) / 1_000
        : Number.parseFloat(duration));
    return {
      clientWidth: viewportWidth,
      scrollWidth: document.documentElement.scrollWidth,
      unreachable,
      clippedText,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      maximumAnimationSeconds: Math.max(0, ...motionDurations),
    };
  });

  expect(layout.scrollWidth).toBe(layout.clientWidth);
  expect(layout.unreachable).toEqual([]);
  expect(layout.clippedText).toEqual([]);
  expect(layout.reducedMotion).toBe(true);
  expect(layout.maximumAnimationSeconds).toBeLessThanOrEqual(0.00001);
  if (testInfo.project.name === "desktop-chromium") {
    await page.screenshot({
      path: `${evidenceRoot}/contractor-stress-320.png`,
      fullPage: false,
    });
  }
});

async function experienceEvidence(page: Page) {
  return page.locator(".managed-site").evaluate((site) => ({
    profile: site.getAttribute("data-profile"),
    heroLayout: site.getAttribute("data-hero-layout"),
    displayFamily: site.getAttribute("data-display-family"),
    surfaceTreatment: site.getAttribute("data-surface-treatment"),
    firstHeroChild: site.querySelector(".site-hero")?.firstElementChild?.tagName,
    sectionIds: [...site.querySelectorAll<HTMLElement>(".profile-section")]
      .map((section) => section.dataset.sectionId ?? ""),
  }));
}
