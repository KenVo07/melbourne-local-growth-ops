import { resolve } from "node:path";

import clientWebsiteInput from "../client/client-website.json";
import { generateClientWebsiteSnapshot } from "./generation/generate-client-website";
import type { ManagedWebsiteRuntime } from "./runtime-types";

const applicationRoot = process.cwd().endsWith("apps\\managed-web") ||
    process.cwd().endsWith("apps/managed-web")
  ? process.cwd()
  : resolve(process.cwd(), "apps", "managed-web");

export const clientWebsite: ManagedWebsiteRuntime = generateClientWebsiteSnapshot(
  clientWebsiteInput,
  resolve(applicationRoot, "public"),
);
