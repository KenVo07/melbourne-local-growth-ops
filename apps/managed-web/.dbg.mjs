import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
p.on("console", (m) => console.log("CONSOLE", m.type(), m.text()));
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await p.goto("http://127.0.0.1:3060/contact", { waitUntil: "networkidle" });
const s = p.locator(".sl-detail-summary").first();
await s.scrollIntoViewIfNeeded();
console.log("hydrated data-disclosure:", await p.locator(".sl-detail").first().getAttribute("data-disclosure"));
console.log("OPEN_MS in chunk?", await p.evaluate(() => performance.getEntriesByType("resource").filter(r=>r.name.includes(".js")).length));
const frames = await p.evaluate(async () => {
  const el = document.querySelector(".sl-detail");
  const sum = el.querySelector(".sl-detail-summary");
  const out = [];
  const t0 = performance.now();
  sum.click();
  while (performance.now() - t0 < 700) {
    out.push([Math.round(performance.now()-t0), Math.round(el.getBoundingClientRect().height*10)/10, el.dataset.disclosure, getComputedStyle(el.querySelector(".sl-detail-body")).opacity]);
    await new Promise(r => requestAnimationFrame(r));
  }
  return out;
});
console.log(frames.slice(0, 30).map(f=>f.join(" ")).join("\n"));
console.log("...");
console.log("animations API:", await p.evaluate(() => typeof document.querySelector(".sl-detail").animate));
await b.close();
