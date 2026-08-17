import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = process.argv[2];
const base = "http://localhost:3010";
mkdirSync(out, { recursive: true });

const routes = [
  ["home", "/"],
  ["services", "/services"],
  ["service-detail", "/services/rewiring"],
  ["register", "/projects"],
  ["record-1", "/projects/northcote-terrace"],
  ["record-2", "/projects/brunswick-workshop"],
  ["record-3", "/projects/kew-lighting"],
  ["about", "/about"],
  ["contact", "/contact"],
  ["notfound", "/no-such-page"],
];

const viewports = [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
];

const browser = await chromium.launch();
const overflow = [];
for (const [vpName, viewport] of viewports) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  for (const [name, path] of routes) {
    await page.goto(base + path, { waitUntil: "networkidle" });
    // next/image lazy-loads below the fold, and a full-page screenshot does not
    // scroll, so plates further down the record captured as empty frames. Scroll
    // the whole page first, then wait for every image to actually decode.
    await page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForFunction(() =>
      [...document.images].every((image) => image.complete && image.naturalWidth > 0),
    );
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `${out}/${vpName}-${name}.png`,
      fullPage: true,
    });
    const wide = await page.evaluate(
      (w) => document.documentElement.scrollWidth > w,
      viewport.width,
    );
    if (wide) {
      const culprits = await page.evaluate((w) =>
        [...document.querySelectorAll("*")]
          .filter((el) => el.getBoundingClientRect().right > w + 1)
          .slice(0, 5)
          .map(
            (el) =>
              `${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 60)} right=${Math.round(el.getBoundingClientRect().right)}`,
          ),
      viewport.width);
      overflow.push(`${vpName}/${name}: ${culprits.join(" | ")}`);
    }
  }
  await page.close();
}
await browser.close();
console.log(overflow.length ? "OVERFLOW:\n" + overflow.join("\n") : "no horizontal overflow at 1440 or 390");
