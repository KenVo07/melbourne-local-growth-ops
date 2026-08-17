import { resolve } from "node:path";

import clientWebsiteInput from "../client/client-website.json";
import authoredManifest from "./client-experience/authored/manifest.json";
import { generateClientWebsiteSnapshot } from "./generation/generate-client-website";
import type { ManagedWebsiteRuntime } from "./runtime-types";

const applicationRoot = process.cwd().endsWith("apps\\managed-web") ||
    process.cwd().endsWith("apps/managed-web")
  ? process.cwd()
  : resolve(process.cwd(), "apps", "managed-web");

/**
 * The authored experience manifest travels with the authored source slot, so
 * the definition only ever carries the fixed `experience/manifest.json`
 * reference and never a path the generator has to resolve. A legacy client's
 * slot holds `null`, which the generator rejects if the definition claims to be
 * authored.
 */
export const clientWebsite: ManagedWebsiteRuntime = generateClientWebsiteSnapshot(
  clientWebsiteInput,
  resolve(applicationRoot, "public"),
  authoredManifest === null
    ? {}
    : { clientExperienceManifest: authoredManifest },
);
