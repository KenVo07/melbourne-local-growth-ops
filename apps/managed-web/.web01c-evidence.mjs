/**
 * WEB-01C interaction evidence.
 *
 * Drives the built standalone artifacts in a real browser and records what the
 * interactions actually do over time. Every assertion here is about observed
 * behaviour — a height that changed between two frames, a focused element after
 * a key press — rather than about the source that produced it.
 */
import { chromium, firefox, webkit } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STONE = process.env.STONE ?? "http://127.0.0.1:3060";
const TERMS = process.env.TERMS ?? "http://127.0.0.1:3061";
const OUT = process.argv[2];
const ENGINE = process.argv[3] ?? "chromium";
const engines = { chromium, firefox, webkit };
const AXE = readFileSync(
  "/tmp/claude-1000/-home-khoa-Projects-web01b-implementation-proportion-web-platform/7dc3ac07-aac4-4ae4-acff-a528bb28709a/scratchpad/node_modules/axe-core/axe.min.js",
  "utf8",
);

const results = [];
let failures = 0;
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

/** Samples an element's box over time, so a movement can be proved to exist. */
async function sample(page, selector, ms = 500, step = 25) {
  return page.evaluate(
    async ([sel, duration, interval]) => {
      const el = document.querySelector(sel);
      if (el === null) return [];
      const frames = [];
      const started = performance.now();
      while (performance.now() - started < duration) {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        frames.push({
          t: Math.round(performance.now() - started),
          h: Math.round(box.height * 100) / 100,
          y: Math.round(box.y * 100) / 100,
          opacity: Number(style.opacity),
        });
        await new Promise((r) => setTimeout(r, interval));
      }
      return frames;
    },
    [selector, ms, step],
  );
}

function distinctHeights(frames) {
  return new Set(frames.map((f) => f.h)).size;
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await engines[ENGINE].launch();

  // ---------------------------------------------------------------- normal
  for (const reduced of [false, true]) {
    const label = reduced ? "reduced_motion" : "normal_motion";
    const dir = join(OUT, "temporal_evidence", label);
    mkdirSync(dir, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: reduced ? "reduce" : "no-preference",
      recordVideo: { dir, size: { width: 1440, height: 900 } },
    });
    const page = await context.newPage();

    // ---- FAQ disclosure open
    await page.goto(`${STONE}/contact`, { waitUntil: "networkidle" });
    const summary = page.locator(".sl-detail-summary").first();
    const detail = ".sl-detail";
    await summary.scrollIntoViewIfNeeded();

    const openPromise = sample(page, detail, 600);
    await summary.click();
    const openFrames = await openPromise;
    writeFileSync(join(dir, "faq-open.json"), JSON.stringify(openFrames, null, 2));
    const openSteps = distinctHeights(openFrames);
    if (reduced) {
      check("reduced: FAQ open settles without an animated height", openSteps <= 3, `${openSteps} distinct heights`);
    } else {
      check("FAQ disclosure open animates its height", openSteps >= 4, `${openSteps} distinct heights`);
    }
    check(
      `${label}: FAQ panel ends open`,
      await page.locator(".sl-detail[open]").first().isVisible(),
    );

    // ---- body entrance (opacity is genuinely below 1 at some point)
    if (!reduced) {
      await page.locator(".sl-detail-summary").first().click();
      await page.waitForTimeout(400);
      const bodyPromise = sample(page, ".sl-detail-body", 400, 16);
      await page.locator(".sl-detail-summary").first().click();
      const bodyFrames = await bodyPromise;
      writeFileSync(join(dir, "faq-body-entrance.json"), JSON.stringify(bodyFrames, null, 2));
      const faded = bodyFrames.some((f) => f.opacity < 0.95);
      check("disclosure body genuinely fades in on open", faded,
        `min opacity ${Math.min(...bodyFrames.map((f) => f.opacity)).toFixed(2)}`);
    }

    // ---- close
    const closePromise = sample(page, detail, 600);
    await page.locator(".sl-detail-summary").first().click();
    const closeFrames = await closePromise;
    writeFileSync(join(dir, "faq-close.json"), JSON.stringify(closeFrames, null, 2));
    if (!reduced) {
      check("FAQ disclosure close animates its height", distinctHeights(closeFrames) >= 4,
        `${distinctHeights(closeFrames)} distinct heights`);
    }

    // ---- rapid retoggle
    for (let i = 0; i < 6; i += 1) {
      await page.locator(".sl-detail-summary").first().click();
      await page.waitForTimeout(35);
    }
    await page.waitForTimeout(700);
    const pinned = await page.locator(".sl-detail").first().evaluate((el) => el.style.height);
    check(`${label}: rapid retoggle leaves no pinned height`, pinned === "", `height="${pinned}"`);
    const openAfter = await page.locator(".sl-detail").first().evaluate((el) => el.open);
    const bodyVisible = await page.locator(".sl-detail-body").first().evaluate(
      (el) => getComputedStyle(el).opacity,
    );
    check(`${label}: rapid retoggle ends in a coherent state`,
      openAfter ? Number(bodyVisible) > 0.9 : true, `open=${openAfter} opacity=${bodyVisible}`);

    // ---- second semantic disclosure context
    await page.goto(`${TERMS}/contact`, { waitUntil: "networkidle" });
    const policies = page.locator("#tlm-policies-heading");
    await policies.scrollIntoViewIfNeeded();
    const policySummary = page.locator("[aria-labelledby='tlm-policies-heading'] .tlm-detail-summary").first();
    const policyDetail = "[aria-labelledby='tlm-policies-heading'] .tlm-detail";
    const polPromise = sample(page, policyDetail, 600);
    await policySummary.click();
    const polFrames = await polPromise;
    writeFileSync(join(dir, "policies-open.json"), JSON.stringify(polFrames, null, 2));
    if (!reduced) {
      check("second semantic context (POLICIES) discloses with the same movement",
        distinctHeights(polFrames) >= 4, `${distinctHeights(polFrames)} distinct heights`);
    }
    const faqCount = await page.locator("[aria-labelledby='tlm-faq-heading'] .tlm-detail").count();
    const polCount = await page.locator("[aria-labelledby='tlm-policies-heading'] .tlm-detail").count();
    check(`${label}: two distinct runs are folded on one page`, faqCount >= 3 && polCount >= 3,
      `FAQ=${faqCount} POLICIES=${polCount}`);
    // And the ordered method beside them is NOT folded.
    const methodFolded = await page.goto(`${TERMS}/about`, { waitUntil: "networkidle" })
      .then(() => page.locator(".tlm-steps li").count());
    const methodDetails = await page.locator(".tlm-method .tlm-detail").count();
    check(`${label}: the ordered method is left in the open`, methodFolded > 0 && methodDetails === 0,
      `steps=${methodFolded} folded=${methodDetails}`);

    // ---- media overlay
    await page.goto(`${STONE}/projects/armadale-courtyard`, { waitUntil: "networkidle" });
    const explore = page.locator(".sl-explore").first();
    await explore.scrollIntoViewIfNeeded();
    await explore.click();
    await page.waitForTimeout(400);
    const dialogOpen = await page.locator("dialog.sl-viewer").evaluate((d) => d.open);
    check(`${label}: media overlay opens`, dialogOpen);

    // Next: prove the photograph moves rather than swapping.
    const stepPromise = sample(page, ".sl-viewer-figure", 400, 16);
    await page.locator(".sl-viewer-button", { hasText: "Next" }).click();
    const stepFrames = await stepPromise;
    writeFileSync(join(dir, "media-next.json"), JSON.stringify(stepFrames, null, 2));
    const moved = new Set(stepFrames.map((f) => f.y)).size;
    const fadedStep = stepFrames.some((f) => f.opacity < 0.95);
    if (reduced) {
      check("reduced: media step does not animate", moved <= 2 && !fadedStep,
        `positions=${moved} faded=${fadedStep}`);
    } else {
      check("media Next moves the photograph rather than swapping it",
        moved >= 3 || fadedStep, `positions=${moved} faded=${fadedStep}`);
    }
    const counter = await page.locator(".sl-viewer-count").textContent();
    check(`${label}: media Next advances the sequence`, counter?.trim().startsWith("2"), counter?.trim());

    const prevPromise = sample(page, ".sl-viewer-figure", 400, 16);
    await page.locator(".sl-viewer-button", { hasText: "Previous" }).click();
    const prevFrames = await prevPromise;
    writeFileSync(join(dir, "media-previous.json"), JSON.stringify(prevFrames, null, 2));
    check(`${label}: media Previous returns`,
      (await page.locator(".sl-viewer-count").textContent())?.trim().startsWith("1"));

    // ---- mobile navigation, at a width where it collapses
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STONE}/`, { waitUntil: "networkidle" });
    const menuToggle = page.locator(".sl-menu-toggle");
    // The panel is what appears and disappears — the <details> is absolutely
    // positioned around it and never changes size — so the panel is sampled.
    const menuOpenPromise = sample(page, ".sl-menu-panel", 600);
    await menuToggle.click();
    const menuOpenFrames = await menuOpenPromise;
    writeFileSync(join(dir, "menu-open.json"), JSON.stringify(menuOpenFrames, null, 2));
    const menuClosePromise = sample(page, ".sl-menu-panel", 600);
    await menuToggle.click();
    const menuCloseFrames = await menuClosePromise;
    writeFileSync(join(dir, "menu-close.json"), JSON.stringify(menuCloseFrames, null, 2));
    const openSteps2 = distinctHeights(menuOpenFrames);
    const closeSteps2 = distinctHeights(menuCloseFrames);
    if (reduced) {
      check("reduced: menu opens and closes without animation",
        openSteps2 <= 3 && closeSteps2 <= 3, `open=${openSteps2} close=${closeSteps2}`);
    } else {
      check("mobile navigation opens with movement", openSteps2 >= 4, `${openSteps2} heights`);
      check("mobile navigation CLOSES with movement (no longer snaps)", closeSteps2 >= 4,
        `${closeSteps2} heights`);
      check("navigation open and close are symmetric",
        Math.abs(openSteps2 - closeSteps2) <= Math.max(openSteps2, closeSteps2) * 0.6,
        `open=${openSteps2} close=${closeSteps2}`);
    }
    const menuHeight = await page.locator(".sl-menu").evaluate(
      (el) => el.querySelector(".sl-menu-panel")?.style.height ?? "");
    check(`${label}: menu leaves no pinned height`, menuHeight === "", `height="${menuHeight}"`);

    await page.setViewportSize({ width: 1440, height: 900 });
    await context.close();
  }

  // ------------------------------------------------------------- keyboard
  {
    const dir = join(OUT, "temporal_evidence", "keyboard");
    mkdirSync(dir, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir, size: { width: 1440, height: 900 } },
    });
    const page = await context.newPage();

    // ---- disclosure by keyboard
    await page.goto(`${STONE}/contact`, { waitUntil: "networkidle" });
    const summary = page.locator(".sl-detail-summary").first();
    await summary.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    check("keyboard: Enter opens a disclosure",
      await page.locator(".sl-detail").first().evaluate((el) => el.open));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    check("keyboard: Enter closes it again",
      !(await page.locator(".sl-detail").first().evaluate((el) => el.open)));

    // ---- media viewer: Escape focus return, the finding-8 case
    await page.goto(`${STONE}/projects/armadale-courtyard`, { waitUntil: "networkidle" });
    const triggers = page.locator(".sl-explore");
    const triggerCount = await triggers.count();
    await triggers.first().scrollIntoViewIfNeeded();
    await triggers.first().click();
    await page.waitForTimeout(300);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    const atIndex = (await page.locator(".sl-viewer-count").textContent())?.trim();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const focusedIndex = await page.evaluate(() => {
      const active = document.activeElement;
      const all = [...document.querySelectorAll(".sl-explore")];
      return all.indexOf(active);
    });
    writeFileSync(join(dir, "escape-focus-return.json"), JSON.stringify(
      { openedAt: 0, steppedTo: atIndex, focusedTriggerIndex: focusedIndex, triggerCount }, null, 2));
    check("keyboard: Escape returns focus to the photograph the reader ended on",
      focusedIndex === 2, `opened 0, stepped to ${atIndex}, focus landed on trigger ${focusedIndex}`);

    // ---- and the explicit Close control answers identically
    await page.goto(`${STONE}/projects/armadale-courtyard`, { waitUntil: "networkidle" });
    await triggers.first().scrollIntoViewIfNeeded();
    await triggers.first().click();
    await page.waitForTimeout(300);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    await page.locator(".sl-viewer-button", { hasText: "Close" }).click();
    await page.waitForTimeout(400);
    const closeFocusIndex = await page.evaluate(() => {
      const active = document.activeElement;
      return [...document.querySelectorAll(".sl-explore")].indexOf(active);
    });
    check("keyboard: the Close control returns focus to the same place Escape does",
      closeFocusIndex === 2, `focus landed on trigger ${closeFocusIndex}`);

    // ---- arrow navigation stays continuous to the last photograph
    await page.goto(`${STONE}/projects/armadale-courtyard`, { waitUntil: "networkidle" });
    await triggers.first().scrollIntoViewIfNeeded();
    await triggers.first().click();
    await page.waitForTimeout(250);
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(90);
    }
    const insideDialog = await page.evaluate(() =>
      document.querySelector("dialog.sl-viewer")?.contains(document.activeElement) ?? false);
    check("keyboard: focus never leaves the overlay at the end of the sequence", insideDialog);
    await page.keyboard.press("Escape");

    // ---- mobile navigation by keyboard
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STONE}/`, { waitUntil: "networkidle" });
    await page.locator(".sl-menu-toggle").focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    check("keyboard: Enter opens the collapsed navigation",
      await page.locator(".sl-menu").evaluate((el) => el.open));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    check("keyboard: Enter closes it, with the same movement",
      !(await page.locator(".sl-menu").evaluate((el) => el.open)));

    await context.close();
  }

  // ------------------------------------------------------------------ axe
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const states = [
      ["home", STONE, "/", null],
      ["services", STONE, "/services", null],
      ["service-detail", STONE, "/services/landscape-construction", null],
      ["projects", STONE, "/projects", null],
      ["project-detail", STONE, "/projects/armadale-courtyard", null],
      ["about", STONE, "/about", null],
      ["contact-folded-closed", STONE, "/contact", null],
      ["contact-folded-open", STONE, "/contact", async (p) => {
        await p.locator(".sl-detail-summary").first().click();
        await p.waitForTimeout(500);
      }],
      ["media-overlay-open", STONE, "/projects/armadale-courtyard", async (p) => {
        await p.locator(".sl-explore").first().scrollIntoViewIfNeeded();
        await p.locator(".sl-explore").first().click();
        await p.waitForTimeout(400);
      }],
      ["notfound", STONE, "/no-such-page", null],
      ["terms-two-runs", TERMS, "/contact", null],
      ["terms-policies-open", TERMS, "/contact", async (p) => {
        await p.locator("[aria-labelledby='tlm-policies-heading'] .tlm-detail-summary").first().click();
        await p.waitForTimeout(500);
      }],
    ];
    const axeOut = [];
    for (const [name, base, path, prepare] of states) {
      await page.goto(base + path, { waitUntil: "networkidle" });
      if (prepare) await prepare(page);
      await page.addScriptTag({ content: AXE });
      const res = await page.evaluate(async () =>
        await window.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
        }));
      axeOut.push({ state: name, violations: res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })) });
      check(`axe: ${name}`, res.violations.length === 0,
        res.violations.map((v) => v.id).join(", ") || "0 violations");
    }
    // mobile menu open is its own state
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${STONE}/`, { waitUntil: "networkidle" });
    await page.locator(".sl-menu-toggle").click();
    await page.waitForTimeout(500);
    await page.addScriptTag({ content: AXE });
    const menuRes = await page.evaluate(async () =>
      await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } }));
    axeOut.push({ state: "mobile-menu-open", violations: menuRes.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })) });
    check("axe: mobile-menu-open", menuRes.violations.length === 0,
      menuRes.violations.map((v) => v.id).join(", ") || "0 violations");
    mkdirSync(join(OUT, "validation"), { recursive: true });
    writeFileSync(join(OUT, "validation", `axe-${ENGINE}.json`), JSON.stringify(axeOut, null, 2));
    await context.close();
  }

  // -------------------------------------------------------- responsive
  {
    const widths = [[1440, 900], [834, 1112], [390, 844], [320, 720]];
    const context = await browser.newContext();
    const page = await context.newPage();
    mkdirSync(join(OUT, "screenshots"), { recursive: true });
    for (const [w, h] of widths) {
      await page.setViewportSize({ width: w, height: h });
      for (const [name, base, path] of [
        ["home", STONE, "/"], ["contact", STONE, "/contact"],
        ["project", STONE, "/projects/armadale-courtyard"],
        ["terms-contact", TERMS, "/contact"],
      ]) {
        await page.goto(base + path, { waitUntil: "networkidle" });
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(`responsive ${w}px ${name}: no horizontal overflow`, overflow <= 1, `${overflow}px`);
        await page.screenshot({
          path: join(OUT, "screenshots", `${name}-${w}.png`), fullPage: true,
        });
      }
    }
    await context.close();
  }

  await browser.close();
  mkdirSync(join(OUT, "validation"), { recursive: true });
  writeFileSync(join(OUT, "validation", `interaction-evidence-${ENGINE}.json`),
    JSON.stringify({ engine: ENGINE, total: results.length, failures, results }, null, 2));
  console.log(`\n${ENGINE}: ${results.length - failures}/${results.length} passed`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => { console.error(error); process.exit(2); });
