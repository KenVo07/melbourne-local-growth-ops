import { expect, test, type Page } from "@playwright/test";

const sites = {
  reference: "http://127.0.0.1:3011",
  fieldGuide: "http://127.0.0.1:3012",
  restaurant: "http://127.0.0.1:3013",
  retailer: "http://127.0.0.1:3014",
} as const;

test.beforeEach(async ({ page }) => {
  await page.route("https://www.googletagmanager.com/gtag/js**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
});

test("two Contractor experiences materially recompose the same semantic task", async ({
  page,
}) => {
  await page.goto(sites.reference);
  const reference = await experienceEvidence(page);
  await expect(page.getByRole("heading", { name: "Illustrative Services & Proposed Coverage" }))
    .toBeVisible();
  await expect(page.getByRole("heading", { name: "Illustrative Service Process" }))
    .toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Phone contact unavailable" }))
    .toContainText("Add a client-verified business number before launch");
  await expect(page.getByRole("button", { name: "Send enquiry" })).toBeVisible();

  await page.goto(sites.fieldGuide);
  const fieldGuide = await experienceEvidence(page);
  await expect(page.locator('[data-signature-id="service-area-proof"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Illustrative Services & Proposed Coverage" }))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "Send enquiry" })).toBeVisible();

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

test("320px keyboard and reduced-motion baseline keeps every control reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(sites.fieldGuide);

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
    const motionDurations = [...document.querySelectorAll<HTMLElement>("[data-motion] *")]
      .flatMap((element) => getComputedStyle(element).animationDuration.split(","))
      .map((duration) => duration.endsWith("ms")
        ? Number.parseFloat(duration) / 1_000
        : Number.parseFloat(duration));
    return {
      clientWidth: viewportWidth,
      scrollWidth: document.documentElement.scrollWidth,
      unreachable,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      maximumAnimationSeconds: Math.max(0, ...motionDurations),
    };
  });

  expect(layout.scrollWidth).toBe(layout.clientWidth);
  expect(layout.unreachable).toEqual([]);
  expect(layout.reducedMotion).toBe(true);
  expect(layout.maximumAnimationSeconds).toBeLessThanOrEqual(0.00001);
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
