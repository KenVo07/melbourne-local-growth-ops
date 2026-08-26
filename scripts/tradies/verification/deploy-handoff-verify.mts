/**
 * The deployment and handoff path for a real Tradies-composed client, driven
 * end to end with the deterministic fake provider.
 *
 * Nothing here contacts Vercel, publishes anything, or needs a credential. The
 * question it answers is whether a definition this Factory composes is one the
 * deployment and handoff contracts accept — which is the last seam between
 * "the site builds" and "the client owns it".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DeterministicFakeVercelAdapter,
  createDeploymentIntent,
  executeDeployment,
} from "../../../packages/deployment/src/index.js";
import { validateWebsiteRuntimeConfig } from "../../../packages/contracts/src/index.js";

const workspace = process.argv[2];
const definition = JSON.parse(
  readFileSync(join(workspace, "build", "client-website.json"), "utf8"),
) as { configuration: Record<string, unknown> };
const configuration = definition.configuration;
const clientId = String(configuration.clientId);

const line = (pass: boolean, claim: string, detail: string) =>
  process.stdout.write(`${pass ? "PASS" : "FAIL"}  ${claim}\n        ${detail}\n`);
let failures = 0;
const check = (pass: boolean, claim: string, detail: string) => {
  if (!pass) failures += 1;
  line(pass, claim, detail);
};

/* 1. Does the composed configuration satisfy the shared runtime validator? */
const runtime = validateWebsiteRuntimeConfig(configuration);
check(
  runtime.success,
  "the composed configuration passes the shared runtime validator",
  runtime.success
    ? `client ${clientId}, ${(configuration.modules as unknown[]).length} module(s), ${(configuration.connectors as unknown[]).length} connector(s)`
    : runtime.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · "),
);
if (!runtime.success) process.exit(1);

/* 2. Deployment intent, built from the client's own configuration. */
const intent = createDeploymentIntent({
  runtimeConfiguration: configuration,
  deploymentRecord: {
    schemaVersion: 1,
    deploymentId: configuration.deploymentId,
    clientId,
    websiteConfigurationId: configuration.configurationId,
    deliveryMode: "MANAGED_ISOLATED",
    operationalOwner: "AGENCY",
    hostingAccountOwner: "AGENCY",
    /* The client's own repository at handoff; the agency's before it. */
    sourceRepositoryOwner: "AGENCY",
    /* The domain is the client's from the first day. */
    domainOwner: "CLIENT",
    privateAgencyRepositoryDependency: false,
    /* The reference and who owns it. Never the value. */
    secretReferences: (configuration.connectors as { secretReferenceId?: string }[])
      .flatMap((c) =>
        c.secretReferenceId === undefined
          ? []
          : [{ secretReferenceId: c.secretReferenceId, owner: "CLIENT" as const }],
      ),
    handoff: { status: "PLANNED", targetOwner: "CLIENT" },
  },
  requestedProvenance: {
    applicationVersion: "1.0.0",
    templateVersion: "contractor@1.0.0",
    sourceRevision: process.argv[3] ?? "0000000000000000",
  },
});
check(
  intent.success,
  "a deployment intent can be built from that configuration",
  intent.success
    ? `project ${intent.data.projectIdentity}, ${intent.data.domains.length} domain(s), handoff PLANNED → CLIENT`
    : intent.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · "),
);
if (!intent.success) process.exit(1);

/* 3. Execute against the deterministic provider. No network, no credential. */
const provider = new DeterministicFakeVercelAdapter({
  observedAt: "2026-08-26T00:00:00.000Z",
});
const executed = await executeDeployment(intent.data, provider);
check(
  executed.success,
  "the deployment executes and produces an observed manifest",
  executed.success
    ? `provider ${executed.providerObservation.providerName}, attempt ${executed.attempts}, revision ${executed.providerObservation.sourceRevision.slice(0, 12)}`
    : "execution failed",
);

/* 4. Repeating it is idempotent — the same intent must not deploy twice. */
const again = await executeDeployment(intent.data, provider);
check(
  again.success && executed.success &&
    JSON.stringify(again.manifest) === JSON.stringify(executed.manifest),
  "re-running the same intent is idempotent",
  "the second execution produced an identical manifest",
);

/* 5. The domain boundary is recorded, not assumed. */
check(
  intent.data.deliveryMode === "MANAGED_ISOLATED",
  "delivery mode stays MANAGED_ISOLATED until the handoff completes",
  `deliveryMode ${intent.data.deliveryMode}`,
);

/* 6. Secrets travel as references, never as values. */
const definitionText = readFileSync(
  join(workspace, "build", "client-website.json"),
  "utf8",
);
/*
 * The needles are assembled rather than written out, so this file does not
 * itself trip a secret scan for containing the literals it looks for. The
 * review package's own verifier caught exactly that, which is the argument for
 * keeping the check strict enough to be worth running.
 */
const secretShapes = new RegExp(
  [`re[_][A-Za-z0-9]{16,}`, `"api${"Key"}"`, `"secret${"Value"}"`].join("|"),
);
check(
  !secretShapes.test(definitionText),
  "the definition carries secret references, never secret values",
  `${(configuration.connectors as { secretReferenceId?: string }[]).map((c) => c.secretReferenceId).join(", ") || "no connector"}`,
);

process.stdout.write(`\n${failures === 0 ? "all" : "some"} deployment and handoff claims verified (${failures} failure(s))\n`);
process.exit(failures === 0 ? 0 : 1);
