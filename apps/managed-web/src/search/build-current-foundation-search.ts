import { resolve } from "node:path";

import { clientWebsite } from "../client-website";
import { buildFoundationSearchIndex } from "./build-foundation-search";

const applicationRoot = process.cwd();
const result = await buildFoundationSearchIndex(
  clientWebsite.foundationSearch,
  resolve(applicationRoot, "public", "pagefind"),
);

console.log(
  `Foundation Search ${result.enabled ? "enabled" : "disabled"}: ${result.recordCount} public records; output ${result.outputDirectory}`,
);
