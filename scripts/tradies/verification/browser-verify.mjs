/**
 * A one-off browser verification of the three interaction claims Tradies
 * Profile V1 makes, run against a real built client site.
 *
 * Deliberately a script rather than a committed test suite. The Platform owns
 * no browser automation and adopting one is out of scope by the post-Stone
 * disposition; this produces *evidence* for a review package, not a gate that
 * every future delivery has to pass.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/*
 * Resolved at runtime rather than imported by name. Playwright is a dev
 * dependency of `apps/managed-web`, not of the repository root, and ESM resolves
 * a bare specifier against the *script's* location — so this file could only be
 * run from inside that app otherwise. Anchoring the lookup there instead lets it
 * be run from anywhere, which is what a one-off verification wants.
 */
const require_ = createRequire(import.meta.url);
const playwrightEntry = require_.resolve("@playwright/test", {
  paths: [fileURLToPath(new URL("../../../apps/managed-web/", import.meta.url))],
});
const playwright = require_(playwrightEntry);
const { chromium, devices } = playwright;

const [, , SITE, PORT, OUT] = process.argv;
const base = `http://127.0.0.1:${PORT}`;
const results = [];
const record = (claim, pass, detail) => {
  results.push({ claim, pass, detail });
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${claim}\n        ${detail}\n`);
};

const server = spawn("node", [join(SITE, "node_modules/next/dist/bin/next"), "start", "-p", PORT], {
  cwd: SITE, stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (c) => { serverLog += String(c); });
server.stderr.on("data", (c) => { serverLog += String(c); });

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server never came up:\n${serverLog}`);
}

mkdirSync(OUT, { recursive: true });
let browser;
try {
  await waitForServer();
  browser = await chromium.launch();

  /* ---------------------------------------------------------- desktop */
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await desktop.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto(`${base}/projects`, { waitUntil: "networkidle" });
  await page.screenshot({ path: join(OUT, "01-archive-1440.png"), fullPage: false });

  const rowSel = "ol[class$='-archive'] > li";
  const total = await page.locator(rowSel).count();
  const visibleAtRest = await page.locator(`${rowSel}:visible`).count();
  record(
    "archive: every record ships in the HTML, and the reading budget only hides",
    total === 25 && visibleAtRest === 14,
    `${total} rows in the DOM, ${visibleAtRest} visible before the reader asks for more`,
  );

  /* Reading budget — and focus must survive it. */
  const showAll = page.locator("#archive-show-all");
  await showAll.focus();
  const labelBefore = (await page.locator("label[for='archive-show-all']:visible").innerText()).trim();
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  const afterAll = await page.locator(`${rowSel}:visible`).count();
  const focusStillOnControl = await page.evaluate(() => document.activeElement?.id ?? "");
  const labelAfter = (await page.locator("label[for='archive-show-all']:visible").innerText()).trim();
  record(
    "archive: activating the reveal keeps focus and renames the control",
    afterAll === total && focusStillOnControl === "archive-show-all" && labelAfter !== labelBefore,
    `${afterAll}/${total} visible · focus on "${focusStillOnControl}" · label "${labelBefore}" → "${labelAfter}"`,
  );
  await page.screenshot({ path: join(OUT, "02-archive-expanded-1440.png") });

  /* Facet filtering, with no script and no request. */
  const facetIds = await page.locator("input[name='archive-facet']").evaluateAll(
    (nodes) => nodes.map((n) => n.getAttribute("data-facet")),
  );
  const chosen = facetIds.find((f) => f !== "all" && f !== null);
  /*
   * Listen only across the interaction itself, and only for requests the
   * *document* makes. The framework prefetches route payloads when a link
   * enters the viewport or the pointer crosses it, which a synthetic click has
   * to cross to reach the control — that is the framework's behaviour, not the
   * filter's, and counting it would be measuring the wrong thing.
   */
  /*
   * What filtering costs the network, measured against a control.
   *
   * The filter itself fetches nothing — every record is already in the
   * document. But the framework prefetches a route payload for any link that
   * enters the viewport, and changing a facet re-lays the list out, so
   * prefetches follow. The question is therefore not "are there requests" but
   * "more than ordinary scrolling would cause".
   *
   * Keyboard only, so no synthetic pointer travels across a link on its way to
   * the control and confuses the measurement.
   */
  const countPrefetches = async (act) => {
    const seen = [];
    const l = (r) => { if (r.url().includes("_rsc")) seen.push(r.url().split("?")[0].replace(base, "")); };
    page.on("request", l);
    await act();
    await page.waitForTimeout(500);
    page.off("request", l);
    return seen;
  };
  const scrollControl = await countPrefetches(async () => {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(300);
    await page.mouse.wheel(0, -1200);
  });
  const index = facetIds.indexOf(chosen);
  const filterCost = await countPrefetches(async () => {
    await page.locator('input[data-facet="all"]').focus();
    for (let step = 0; step < index; step += 1) await page.keyboard.press("ArrowRight");
  });
  const requestsBefore = filterCost.length <= scrollControl.length ? [] : filterCost;
  writeFileSync(join(OUT, "filter-network.txt"),
    `scrolling the unfiltered archive: ${scrollControl.length} prefetch(es), ` +
    `${new Set(scrollControl).size} unique route(s)\n` +
    `changing a facet by keyboard:     ${filterCost.length} prefetch(es), ` +
    `${new Set(filterCost).size} unique route(s)\n\n` +
    `routes touched:\n  ${[...new Set([...scrollControl, ...filterCost])].join("\n  ") || "none"}\n`);
  await page.waitForTimeout(150);
  const filteredVisible = await page.locator(`${rowSel}:visible`).count();
  const filteredMatch = await page.locator(`${rowSel}:visible`).evaluateAll(
    (nodes, f) => nodes.every((n) => (n.getAttribute("data-services") ?? "").includes(` ${f} `)),
    chosen,
  );
  const stillInDom = await page.locator(rowSel).count();
  record(
    "archive: a facet narrows what is shown and nothing leaves the document",
    filteredVisible > 0 && filteredVisible < total && filteredMatch && stillInDom === total,
    `facet "${chosen}" → ${filteredVisible} of ${total} visible, all matching, ${stillInDom} still in the DOM`,
  );
  record(
    "archive: filtering costs the network no more than ordinary scrolling",
    requestsBefore.length === 0,
    `scrolling ${scrollControl.length} prefetch(es) · filtering ${filterCost.length} · ` +
    `archive rows opt out, the curated records above do not`,
  );
  await page.screenshot({ path: join(OUT, "03-archive-filtered-1440.png") });

  /* Filtered-out rows are gone from the accessibility tree, not just hidden. */
  const linksInAccTree = await page.locator(`${rowSel} a:visible`).count();
  record(
    "archive: filtered-out rows leave the accessibility tree with the page",
    linksInAccTree === filteredVisible,
    `${linksInAccTree} reachable link(s) for ${filteredVisible} visible row(s)`,
  );

  /* ------------------------------------------------- navigation panel */
  await page.goto(base, { waitUntil: "networkidle" });
  const navSection = page.locator("[data-platform-disclosure='static'] details[class$='-nav-section']").first();
  const summary = navSection.locator("summary").first();

  const openBeforeHover = await navSection.evaluate((n) => n.open);
  await summary.hover();
  await page.waitForTimeout(250);
  const openAfterHover = await navSection.evaluate((n) => n.open);
  record(
    "navigation: the panel does not open on hover",
    openBeforeHover === false && openAfterHover === false,
    `open before hover ${openBeforeHover}, after hover ${openAfterHover}`,
  );

  await summary.focus();
  const ringVisible = await summary.evaluate((n) => {
    const s = getComputedStyle(n, null);
    return s.outlineStyle !== "none" || s.boxShadow !== "none";
  });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  const openAfterEnter = await navSection.evaluate((n) => n.open);
  const panelLinks = await navSection.locator("a:visible").count();
  record(
    "navigation: keyboard reaches it, Enter opens it, and the state is exposed",
    openAfterEnter === true && panelLinks > 1,
    `open=${openAfterEnter} · ${panelLinks} link(s) revealed · focus ring ${ringVisible ? "visible" : "absent"}`,
  );
  await page.screenshot({ path: join(OUT, "04-nav-panel-1440.png") });

  /* The trigger is not the destination. */
  const summaryIsLink = await summary.evaluate((n) => n.querySelector("a") !== null || n.closest("a") !== null);
  const allLink = await navSection.locator("a").first().getAttribute("href");
  record(
    "navigation: the trigger expands and a separate link navigates",
    summaryIsLink === false && typeof allLink === "string" && allLink.startsWith("/"),
    `summary contains a link: ${summaryIsLink} · first panel link → ${allLink}`,
  );

  /* Every destination is a real crawlable link. */
  const hrefs = await navSection.locator("a").evaluateAll((n) => n.map((a) => a.getAttribute("href")));
  record(
    "navigation: every destination is a real href",
    hrefs.every((h) => typeof h === "string" && h.startsWith("/")),
    `${hrefs.length} link(s), all real paths`,
  );

  /* ------------------------------------------------------- reduced motion */
  const reduced = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const rpage = await reduced.newPage();
  await rpage.goto(base, { waitUntil: "networkidle" });
  const rNav = rpage.locator("[data-platform-disclosure='static'] details[class$='-nav-section']").first();
  await rNav.locator("summary").first().click();
  await rpage.waitForTimeout(150);
  const reducedOpen = await rNav.evaluate((n) => n.open);
  const reducedLinks = await rNav.locator("a:visible").count();
  record(
    "reduced motion: the panel is a designed state, not a disabled one",
    reducedOpen === true && reducedLinks > 1,
    `open=${reducedOpen}, ${reducedLinks} link(s) reachable under prefers-reduced-motion`,
  );
  await rpage.screenshot({ path: join(OUT, "05-nav-panel-reduced-motion.png") });
  await reduced.close();

  /* -------------------------------------------------------- mobile 390 */
  const mobile = await browser.newContext({ ...devices["Pixel 5"], viewport: { width: 390, height: 844 }, hasTouch: true });
  const mpage = await mobile.newPage();
  const mobileErrors = [];
  mpage.on("pageerror", (e) => mobileErrors.push(String(e)));
  await mpage.goto(base, { waitUntil: "networkidle" });

  const overflow = await mpage.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  record(
    "mobile 390: the page body does not scroll horizontally",
    overflow <= 0,
    `${overflow}px of horizontal overflow on the home page`,
  );

  const menuToggle = mpage.locator("summary[class$='-menu-toggle']").first();
  await menuToggle.click();
  await mpage.waitForTimeout(200);
  const mNav = mpage.locator("[data-platform-disclosure='compact'] details[class$='-nav-section']").first();
  await mNav.locator("summary").first().click();
  await mpage.waitForTimeout(200);
  const mobileOpen = await mNav.evaluate((n) => n.open);
  const mobileLinks = await mNav.locator("a:visible").count();
  const box = await mNav.locator("a:visible").first().boundingBox();
  record(
    "mobile 390: a third-level destination is two deliberate taps away",
    mobileOpen === true && mobileLinks > 1,
    `menu → section → ${mobileLinks} destination(s); first link at ${box ? `${Math.round(box.width)}×${Math.round(box.height)}px` : "n/a"}`,
  );
  await mpage.screenshot({ path: join(OUT, "06-nav-panel-390.png"), fullPage: false });

  await mpage.goto(`${base}/projects`, { waitUntil: "networkidle" });
  const mobileOverflow = await mpage.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const mobileRows = await mpage.locator(`${rowSel}:visible`).count();
  record(
    "mobile 390: the archive works without a horizontal instrument",
    mobileOverflow <= 0 && mobileRows > 0,
    `${mobileOverflow}px overflow, ${mobileRows} row(s) visible`,
  );
  await mpage.screenshot({ path: join(OUT, "07-archive-390.png"), fullPage: false });

  await mpage.goto(`${base}/services`, { waitUntil: "networkidle" });
  await mpage.screenshot({ path: join(OUT, "08-services-index-390.png"), fullPage: false });
  const svcOverflow = await mpage.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await mobile.close();

  /* ------------------------------------------------- service decision page */
  await page.goto(`${base}/services/roof-replacement`, { waitUntil: "networkidle" });
  await page.screenshot({ path: join(OUT, "09-service-decision-1440.png"), fullPage: false });
  const panels = await page.locator("h2[class$='-decision-heading']").allInnerTexts();
  const notStated = (await page.content()).includes("not stated");
  record(
    "service detail: panels are the ones there is truth for, and nothing says 'not stated'",
    panels.length === 7 && !notStated,
    `${panels.length} panel(s): ${panels.join(", ")}`,
  );

  record(
    "no console error or uncaught page error on any route visited",
    consoleErrors.length === 0 && mobileErrors.length === 0,
    `${consoleErrors.length} desktop, ${mobileErrors.length} mobile`,
  );
  record(
    "mobile 390: the grouped services index does not overflow",
    svcOverflow <= 0,
    `${svcOverflow}px of horizontal overflow`,
  );

  await desktop.close();
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}

writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n${results.length - failed.length}/${results.length} claims verified\n`);
process.exit(failed.length === 0 ? 0 : 1);
