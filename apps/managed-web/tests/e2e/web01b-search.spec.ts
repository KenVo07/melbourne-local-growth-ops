import { expect, test } from "@playwright/test";

const enabledSite = "http://127.0.0.1:3012";

test.beforeEach(async ({ page }) => {
  await page.route("https://www.googletagmanager.com/gtag/js**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
});

test("Foundation Search OFF ships no output markup import or request", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.locator("[data-foundation-search]")).toHaveCount(0);
  await expect(page.locator('script[src*="pagefind"], link[href*="pagefind"]'))
    .toHaveCount(0);
  expect(requests.filter((url) => url.includes("/pagefind/"))).toEqual([]);
  await expect(page.getByRole("navigation", { name: "Section navigation" }))
    .toBeVisible();
});

test("enabled search is lazy, keyboard operable, dismissible and lands on a visible anchor", async ({
  page,
}) => {
  const requests: string[] = [];
  const runtimeErrors: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto(enabledSite, { waitUntil: "networkidle" });

  expect(requests.filter((url) => url.includes("/pagefind/"))).toEqual([
    `${enabledSite}/pagefind/foundation-search.js`,
  ]);
  const trigger = page.getByRole("button", { name: "Search this website" });
  const dialog = page.getByRole("dialog", { name: /Search / });
  const dialogElement = page.locator("[data-foundation-search-dialog]");
  const query = page.getByRole("searchbox", {
    name: "Search public website content",
  });

  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(query).toBeFocused();
  await query.fill("");
  await query.press("Enter");
  await expect(dialog.getByRole("status")).toHaveText(
    "No matching public website sections were found.",
  );

  await query.fill("common questions");
  await query.press("Enter");
  await expect(dialog.getByRole("status")).toContainText(/results? found/);
  const result = dialog.getByRole("link", { name: "Frequently Asked Questions" });
  await expect(result).toHaveAttribute("href", "/#faq");
  await result.click();
  await expect(dialogElement).not.toHaveAttribute("open", "");
  await expect(page.locator("#faq")).toBeVisible();
  await expect(page.locator("#faq")).toBeFocused();

  await trigger.click();
  await expect(query).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialogElement).not.toHaveAttribute("open", "");
  await expect(trigger).toBeFocused();

  const pagefindRequests = requests.filter((url) => url.includes("/pagefind/"));
  expect(pagefindRequests.some((url) => url.endsWith("/pagefind/pagefind.js")))
    .toBe(true);
  expect(pagefindRequests.some((url) => url.includes("/fragment/"))).toBe(true);
  expect(runtimeErrors).toEqual([]);
});

test("search failure is readable and normal navigation remains available", async ({
  page,
}) => {
  await page.route("**/pagefind/pagefind.js", (route) => route.abort());
  await page.goto(enabledSite);

  const trigger = page.getByRole("button", { name: "Search this website" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: /Search / });
  const query = page.getByRole("searchbox", {
    name: "Search public website content",
  });
  await query.fill("electrical");
  await query.press("Enter");
  await expect(dialog.getByRole("status")).toHaveText(
    "Search is temporarily unavailable. Use the section navigation instead.",
  );

  await dialog.getByRole("button", { name: "Close search" }).click();
  const servicesLink = page.getByRole("navigation", { name: "Section navigation" })
    .getByRole("link", { name: "Illustrative Services & Proposed Coverage" });
  await expect(servicesLink).toHaveAttribute("href", "#services");
  await servicesLink.click();
  await expect(page).toHaveURL(/#services$/);
  await expect(page.locator("#services")).toBeVisible();
});
