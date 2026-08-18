import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const AXE = readFileSync("/tmp/claude-1000/-home-khoa-Projects-web01b-implementation-proportion-web-platform/7dc3ac07-aac4-4ae4-acff-a528bb28709a/scratchpad/node_modules/axe-core/axe.min.js","utf8");
const b = await chromium.launch();
for (const [label, url] of [["A3_BASELINE","http://127.0.0.1:3062/"],["WEB01C","http://127.0.0.1:3060/"]]) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(url, { waitUntil: "networkidle" });
  await p.addScriptTag({ content: AXE });
  const r = await p.evaluate(async () => await window.axe.run(document, { runOnly: { type:"tag", values:["wcag2a","wcag2aa","wcag21a","wcag21aa"] }}));
  console.log(`\n=== ${label} ===`);
  for (const v of r.violations) {
    console.log(v.id, v.impact, v.nodes.length);
    for (const n of v.nodes.slice(0,3)) console.log("   ", n.target.join(" "), "|", (n.failureSummary||"").split("\n").slice(0,3).join(" / "));
  }
  if (r.violations.length === 0) console.log("0 violations");
  await p.close();
}
await b.close();
