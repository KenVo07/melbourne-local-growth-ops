import type {
  ClientHandoffManifest,
  HandoffConnectorSelection,
  OptionalDataRestorePlan,
  RequiredEnvironmentVariable,
} from "./handoff-types.js";

function environmentTable(
  variables: readonly RequiredEnvironmentVariable[],
): string {
  if (variables.length === 0) {
    return "This delivered repository requires no custom environment variables.\n";
  }
  return [
    "| Name | Required | Owner | Purpose |",
    "| --- | --- | --- | --- |",
    ...variables.map((variable) =>
      `| \`${variable.name}\` | ${variable.required ? "Yes" : "No"} | Client | ${variable.description} |`
    ),
    "",
    "Copy `.env.example` to `.env.local` and obtain values directly from the client-owned provider. Never commit values.",
    "",
  ].join("\n");
}

function contactFormSetup(
  connectors: readonly HandoffConnectorSelection[],
): string {
  const email = connectors.filter(({ type }) => type === "EMAIL_DELIVERY");
  if (email.length === 0) {
    return "No email-delivery connector is enabled. If a contact form is added later, configure a client-owned provider and document every required environment variable before deployment.";
  }
  return [
    "The delivered site uses these portable email-delivery connectors:",
    "",
    ...email.map(({ connectorId, version }) =>
      `- \`${connectorId}\`, adapter version \`${version}\``
    ),
    "",
    "Create or transfer the provider account to the client, verify client-owned sending identities and recipients, then populate the documented environment variables in the client hosting account. Replace the adapter through its local vendored boundary if the provider changes.",
  ].join("\n");
}

function restoreSteps(plan: OptionalDataRestorePlan): string {
  if (plan.status === "NOT_APPLICABLE") {
    return "No optional persistent infrastructure is configured, so there is no application-data restore step. Recover from this repository and the last known valid deployment.";
  }
  return [
    "Persistent features require the following client-owned restore procedures:",
    "",
    ...plan.resources.flatMap((resource) => [
      `### ${resource.kind}: ${resource.provider}`,
      "",
      `- Backup: ${resource.backupProcedure}`,
      `- Restore: ${resource.restoreProcedure}`,
      `- Verify: ${resource.verificationProcedure}`,
      "",
    ]),
  ].join("\n");
}

export function handoffReadme(manifest: ClientHandoffManifest): string {
  return `# ${manifest.repositoryName}

This is the self-contained client-owned source repository for client
\`${manifest.clientId}\`, deployment \`${manifest.deploymentId}\`. It does not
require the private Website Factory repository, a private package registry,
workspace links, agency credentials, or agency-owned runtime services.

## Install

Use Node.js 24.18.0 and pnpm 11.9.0:

\`\`\`sh
pnpm install --frozen-lockfile --ignore-scripts
\`\`\`

Review any dependency build-script requirement before allowing it. The
committed lockfile must remain unchanged during a clean install.

## Development

\`\`\`sh
pnpm dev
\`\`\`

## Typecheck, tests, and integrity

\`\`\`sh
pnpm typecheck
pnpm test
pnpm verify:handoff
\`\`\`

## Build

\`\`\`sh
pnpm build
\`\`\`

## Deployment

Deploy the production build from this repository to the client-owned hosting
account. Configure only the environment variable names documented below and
obtain their values directly from the owning provider. Do not reuse agency
project resources or credentials.

## Environment setup

${environmentTable(manifest.requiredEnvironmentVariables)}
## Domain ownership

All configured domains are client-owned. Domain attachment at a hosting
provider and DNS-provider mutation are separate operations. Transfer or change
DNS only through the domain owner's approved process.

## Analytics ownership

Analytics is client-owned. Transfer administrative access to the client and
verify the deployed site points only to the client's property.

## Contact-form provider setup

${contactFormSetup(manifest.connectors)}

## Rollback

Use the hosting provider's rollback capability to select a previously observed
valid deployment for this client repository. Validate domains and environment
configuration afterward. Do not mutate DNS as part of an application rollback.

## Recovery

If source is lost, restore this repository from the transferred copy, run
\`pnpm verify:handoff\`, install with the frozen lockfile, then run typecheck,
tests, and the production build before redeployment.

For hosting-account transfer, domain transfer, analytics transfer, or
contact-form provider replacement, follow the handoff checklist and the
recovery runbook delivered with the operational handoff.

${restoreSteps(manifest.optionalDataRestorePlan)}

## Provenance

- Application version: \`${manifest.buildProvenance.applicationVersion}\`
- Build ID: \`${manifest.buildProvenance.buildId}\`
- Source revision: \`${manifest.buildProvenance.sourceRevision}\`
- Build observed at: \`${manifest.buildProvenance.generatedAt}\`
- Exported at: \`${manifest.exportedAt}\`
`;
}

export function handoffChecklist(manifest: ClientHandoffManifest): string {
  return `# Client handoff checklist

- [ ] Repository is in a client-owned account.
- [ ] \`pnpm verify:handoff\` passes after transfer.
- [ ] Frozen install, typecheck, tests, and production build pass cleanly.
- [ ] Hosting project is client-owned and contains only this client.
- [ ] Required environment variable names are documented without values.
- [ ] Environment values were supplied directly by their client-owned provider.
- [ ] Domains and DNS account ownership are confirmed with the client.
- [ ] Analytics property ownership and administrative access are client-owned.
- [ ] Contact-form sending identity, recipients, and provider ownership are verified.
- [ ] Last known valid deployment and rollback procedure are recorded.
- [ ] Optional-data plan status is \`${manifest.optionalDataRestorePlan.status}\`.
- [ ] Agency repository access, credentials, caches, and build output are absent.
`;
}

export function environmentExample(
  variables: readonly RequiredEnvironmentVariable[],
): string {
  return variables.map(({ name }) => `${name}=\n`).join("");
}

export function portableVerifierSource(): string {
  return `import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const root = process.cwd();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifestBytes = await readFile(join(root, "handoff-manifest.json"));
const expectedManifestDigest = (await readFile(
  join(root, "handoff-manifest.sha256"),
  "utf8",
)).trim();
if (digest(manifestBytes) !== expectedManifestDigest) {
  throw new Error("Handoff manifest integrity check failed");
}
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const expected = new Map(
  manifest.includedFiles.map((file) => [file.path, file.sha256]),
);
for (const [path, expectedDigest] of expected) {
  if (digest(await readFile(join(root, ...path.split("/")))) !== expectedDigest) {
    throw new Error(\`Handoff file integrity check failed: \${path}\`);
  }
}
const ignoredRoots = new Set([".git", "build", "node_modules"]);
async function walk(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (directory === root && ignoredRoots.has(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await walk(absolute));
    else if (entry.isFile()) found.push(relative(root, absolute).split(sep).join("/"));
    else throw new Error("Unsupported handoff filesystem entry");
  }
  return found;
}
const allowed = new Set([
  ...expected.keys(),
  "handoff-manifest.json",
  "handoff-manifest.sha256",
]);
for (const path of await walk(root)) {
  if (!allowed.has(path)) {
    throw new Error(\`Unexpected file in handoff repository: \${path}\`);
  }
}
console.log("Handoff integrity verification passed");
`;
}
