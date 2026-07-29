import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://www.googletagmanager.com/gtag/js**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "",
    }),
  );
});

test("submits a mocked lead and emits page, booking, and successful-lead events without PII", async ({
  page,
}) => {
  let submittedBody = "";
  await page.route("**/api/contact", async (route) => {
    submittedBody = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.goto("/");

  await page.evaluate(() => {
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest(".booking-cta")) {
          event.preventDefault();
        }
      },
      { capture: true },
    );
  });
  await page.getByRole("link", { name: "Request a service time" }).click();

  await page.getByLabel("Name").fill("Dana Smith");
  await page.getByLabel("Email").fill("dana@example.com");
  await page.getByLabel("Phone").fill("+61 400 000 000");
  await page.getByLabel("How can we help?").fill("Please call me.");
  await page.getByRole("button", { name: "Send enquiry" }).click();

  await expect(page.getByRole("status")).toHaveText(
    "Thanks. Your enquiry has been sent.",
  );
  expect(submittedBody).toContain("dana@example.com");

  const analytics = await analyticsCalls(page);
  expect(analytics).toEqual(
    expect.arrayContaining([
      expect.arrayContaining(["event", "page_view"]),
      ["event", "booking_cta_clicked"],
      ["event", "generate_lead"],
    ]),
  );
  expect(JSON.stringify(analytics)).not.toContain("dana@example.com");
  expect(JSON.stringify(analytics)).not.toContain("Please call me.");
  expect(JSON.stringify(analytics)).not.toContain("submissionId");
});

test("shows a safe failure and emits no lead conversion", async ({ page }) => {
  await page.route("**/api/contact", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        code: "SERVICE_UNAVAILABLE",
        providerReference: "must-not-render",
      }),
    }),
  );
  await page.goto("/");
  await page.getByLabel("Name").fill("Dana Smith");
  await page.getByLabel("Email").fill("dana@example.com");
  await page.getByLabel("Phone").fill("+61 400 000 000");
  await page.getByLabel("How can we help?").fill("Private lead content");
  await page.getByRole("button", { name: "Send enquiry" }).click();

  await expect(page.getByRole("status")).toHaveText(
    "We could not send your enquiry. Please try again.",
  );
  await expect(page.getByText("must-not-render")).toHaveCount(0);
  await expect(page.getByText("SERVICE_UNAVAILABLE")).toHaveCount(0);

  const analytics = await analyticsCalls(page);
  expect(analytics.some((call) => call[1] === "generate_lead")).toBe(false);
  expect(JSON.stringify(analytics)).not.toContain("dana@example.com");
  expect(JSON.stringify(analytics)).not.toContain("Private lead content");
});

async function analyticsCalls(page: Page) {
  return page.evaluate(() =>
    (window.dataLayer ?? []).map((entry) =>
      Array.from(entry as ArrayLike<unknown>),
    ),
  );
}
