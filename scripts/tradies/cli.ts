/**
 * `pnpm tradie <command>` — the operator surface for a Tradies delivery.
 *
 * Six commands, in the order a real client moves through them. Each one is a
 * step an operator would otherwise have to remember, and nothing here conceals
 * a business or creative decision: the commands assemble, validate, derive and
 * report, and every judgement they surface is left to a person.
 *
 *     start      a blank delivery workspace for a client who has said yes
 *     check      what is present, what is missing, and who has to close it
 *     recommend  a creative configuration proposed from what is known
 *     shotlist   the exact photographs still missing, and what each would prove
 *     compose    intake + research + media → one validated client definition
 *     p1         generate the P1 experience source from that definition
 *
 * `check` is the one to run when unsure. It is read-only and safe at any point.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import {
  parseDefinitionInput,
  validateWebsiteProfileContent,
  validateWebsiteV2Model,
} from "../../apps/managed-web/src/generation/index";
import { generateExperienceStarter } from "../../packages/experience-starter/src/index";

import {
  RECORD_FILES,
  REFUSALS,
  TradiesRefusal,
  assertRecord,
  refuse,
  validateRecord,
} from "./intake-contracts.mjs";
import {
  composeDefinition,
  deriveShotList,
  readinessReport,
  recommendCreativeConfiguration,
} from "./delivery-core.mjs";
import { scaffoldWorkspace } from "./scaffold.mjs";
import { starterBriefTemplate, unansweredCopy } from "./brief-template.mjs";
import { deliveryPackage } from "./fixtures/northgate-roofing.mjs";

type Records = Record<string, Record<string, unknown> | undefined>;

const COMMANDS = [
  "start",
  "check",
  "recommend",
  "shotlist",
  "compose",
  "p1",
  "demo",
] as const;

const [command, ...rest] = process.argv.slice(2);
const flags = parseFlags(rest);

try {
  await main();
} catch (error) {
  if (error instanceof TradiesRefusal) {
    const meaning: string | undefined = REFUSALS[error.code as keyof typeof REFUSALS];
    process.stderr.write(
      `\nREFUSED: ${error.code}\n${meaning === undefined ? "" : `${meaning}\n`}\n${error.message}\n\nNothing was written.\n`,
    );
    process.exitCode = 1;
  } else {
    throw error;
  }
}

async function main(): Promise<void> {
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return;
  }
  if (!(COMMANDS as readonly string[]).includes(command)) {
    throw refuse("CONTRACT_INVALID", `Unknown command "${command}".\n\n${usage()}`);
  }
  switch (command) {
    case "start":
      return start();
    case "demo":
      return demo();
    case "check":
      return check();
    case "recommend":
      return recommend();
    case "shotlist":
      return shotlist();
    case "compose":
      return compose();
    case "p1":
      return p1();
    default:
      return;
  }
}

/* ------------------------------------------------------------------------ */

async function start(): Promise<void> {
  const clientId = required("client");
  const businessName = flags.name ?? clientId;
  const into = resolve(required("into"));
  await assertEmpty(into);
  for (const file of scaffoldWorkspace(clientId, businessName)) {
    await writeInto(join(into, file.path), file.contents);
  }
  heading(`Delivery workspace for ${businessName}`);
  step(`written to ${into}`);
  step("read README.md first — it says who answers which file");
  step(`then: pnpm tradie check --workspace ${into}`);
}

/** Materialises the second-context fixture, for a dry run against real commands. */
async function demo(): Promise<void> {
  const into = resolve(required("into"));
  await assertEmpty(into);
  for (const [kind, file] of Object.entries(RECORD_FILES)) {
    const record = (deliveryPackage as Record<string, unknown>)[camel(kind)];
    if (record === undefined) continue;
    await writeInto(join(into, file), `${JSON.stringify(record, null, 2)}\n`);
  }
  heading("Northgate Roofing & Metal — synthetic delivery package");
  step(`written to ${into}`);
  step("a fictional business, used to exercise the workflow end to end");
  step(`next: pnpm tradie check --workspace ${into}`);
}

async function check(): Promise<void> {
  const workspace = resolve(required("workspace"));
  const { records, invalid } = await loadRecords(workspace);

  heading("Records");
  for (const [kind, file] of Object.entries(RECORD_FILES)) {
    const problems = invalid[kind];
    if (records[camel(kind)] === undefined && problems === undefined) {
      step(`—  ${file.padEnd(30)} not present`);
      continue;
    }
    if (problems !== undefined) {
      step(`✗  ${file.padEnd(30)} ${problems.length} problem(s)`);
      for (const problem of problems.slice(0, 8)) step(`     ${problem}`);
      if (problems.length > 8) step(`     …and ${problems.length - 8} more`);
      continue;
    }
    step(`✓  ${file.padEnd(30)} valid`);
  }

  if (Object.keys(invalid).length > 0) {
    process.exitCode = 1;
    heading("Fix the records above before reading the gap report.");
    return;
  }

  const report = readinessReport(records as never);
  const byOwner = new Map<string, string[]>();
  for (const item of report.gaps) {
    byOwner.set(item.owner, [...(byOwner.get(item.owner) ?? []), `${item.code} — ${item.detail}`]);
  }
  for (const [owner, items] of [...byOwner].sort()) {
    heading(`${owner} owes ${items.length}`);
    for (const item of items) step(item);
  }
  if (report.gaps.length === 0) heading("No gaps.");

  heading(
    report.p1Ready
      ? "INPUTS READY — the Factory has what it needs."
      : `NOT READY — ${report.blocking.length} blocking gap(s).`,
  );
  if (report.p1Ready) {
    step(`next: pnpm tradie compose --workspace ${workspace}`);
  } else {
    for (const item of report.blocking) step(`blocking: ${item.code}`);
    process.exitCode = 1;
  }
}

async function recommend(): Promise<void> {
  const workspace = resolve(required("workspace"));
  const { records } = await loadRecords(workspace, ["creative-configuration"]);
  const draft = recommendCreativeConfiguration(records as never);
  const target = join(workspace, RECORD_FILES["creative-configuration"]);
  await assertAbsentFile(target);
  await writeInto(target, `${JSON.stringify(draft, null, 2)}\n`);

  heading("Creative configuration — draft");
  step(`written to ${relative(process.cwd(), target)}`);
  for (const [key, value] of Object.entries(draft.rationale)) {
    step(`${key}: ${String(value)}`);
  }
  heading("This is a proposal, not a decision.");
  step("edit it, then set derivedBy and take it to the client");
  step("the client approves representation and direction — never pixels");
}

async function shotlist(): Promise<void> {
  const workspace = resolve(required("workspace"));
  const { records } = await loadRecords(workspace);
  const list = deriveShotList(records as never);
  const target = join(workspace, "shot-list.md");
  await writeInto(target, renderShotList(list));

  heading(`Shot list — ${list.requirements.length} requirement(s), ${list.totalFrames} frame(s)`);
  for (const requirement of list.requirements.slice(0, 12)) {
    step(`${requirement.count} × ${requirement.subject}`);
  }
  if (list.requirements.length > 12) {
    step(`…and ${list.requirements.length - 12} more`);
  }
  step(`written to ${relative(process.cwd(), target)}`);
  heading("Send this to the client as a list of jobs, not as feedback.");
}

async function compose(): Promise<void> {
  const workspace = resolve(required("workspace"));
  const { records } = await loadRecords(workspace);
  const report = readinessReport(records as never);
  if (!report.p1Ready) {
    throw refuse(
      "CONTRACT_INVALID",
      `Inputs are not ready. ${report.blocking.length} blocking gap(s):\n  ${report.blocking
        .map((item) => `${item.code} — ${item.detail}`)
        .join("\n  ")}`,
      { blocking: report.blocking },
    );
  }

  const composed = composeDefinition(records as never);
  const build = join(workspace, "build");

  /*
   * The Factory's own validators decide whether this definition is real, not
   * this command. A composed definition that reaches disk has already passed
   * the same checks `assemble:client` will run, so a defect surfaces here — one
   * command after the mistake — rather than at assembly.
   *
   * The one thing that cannot exist yet is the experience manifest, because the
   * source has not been generated. The route IDs the page graph names *are* the
   * route IDs that manifest will declare, so the cross-validation runs against
   * them and is the same check.
   */
  try {
    parseDefinitionInput(composed.definition);
  } catch (error) {
    throw refuse(
      "CONTRACT_INVALID",
      `The composed definition is not the shape the Factory accepts:\n  ${(error as Error).message}`,
    );
  }
  const profileValidation = validateWebsiteProfileContent(composed.definition.profile);
  if (!profileValidation.success) {
    throw refuse("CONTRACT_INVALID", issueList("profile", profileValidation.issues));
  }
  const modelValidation = validateWebsiteV2Model({
    schemaVersion: 2,
    pageGraph: composed.definition.pageGraph,
    projects: composed.definition.projects,
    clientExperienceManifest: manifestFor(composed.definition),
    profile: profileValidation.data,
  });
  if (!modelValidation.success) {
    throw refuse("CONTRACT_INVALID", issueList("definition", modelValidation.issues));
  }

  await writeInto(
    join(build, "client-website.json"),
    `${JSON.stringify(composed.definition, null, 2)}\n`,
  );
  await writeInto(
    join(workspace, "truth-ledger.json"),
    `${JSON.stringify(composed.truthLedger, null, 2)}\n`,
  );
  const briefPath = join(workspace, "starter-brief.json");
  const briefExists = await exists(briefPath);
  if (!briefExists) {
    await writeInto(
      briefPath,
      `${JSON.stringify(
        starterBriefTemplate(
          records["creativeConfiguration"] as never,
          composed.definition as never,
          records["mediaInventory"] as never,
        ),
        null,
        2,
      )}\n`,
    );
  }

  heading("Composed");
  step(`${composed.definition.pageGraph.pages.length} pages`);
  step(`${composed.definition.profile.sections.length} profile sections`);
  step(`${composed.definition.projects.projects.length} published project(s)`);
  step(`${composed.definition.assets.length} published asset(s)`);
  step(`${composed.truthLedger.entries.length} truth-ledger entries`);
  step(`definition → ${relative(process.cwd(), join(build, "client-website.json"))}`);
  step(`ledger     → ${relative(process.cwd(), join(workspace, "truth-ledger.json"))}`);
  step(
    briefExists
      ? "starter-brief.json already existed and was left alone"
      : `brief      → ${relative(process.cwd(), briefPath)} (copy fields marked TODO)`,
  );

  if (composed.warnings.length > 0) {
    heading(`${composed.warnings.length} thing(s) worth knowing`);
    for (const warning of composed.warnings) step(warning);
  }
  heading("Next");
  step("copy the client's approved image files into build/public/assets/");
  step("answer the TODO copy fields in starter-brief.json");
  step(`then: pnpm tradie p1 --workspace ${workspace}`);
}

async function p1(): Promise<void> {
  const workspace = resolve(required("workspace"));
  const build = join(workspace, "build");
  const definition = JSON.parse(
    await readFile(join(build, "client-website.json"), "utf8"),
  ) as unknown;
  const brief = JSON.parse(
    await readFile(join(workspace, "starter-brief.json"), "utf8"),
  ) as Record<string, unknown>;

  const unanswered = unansweredCopy(brief);
  if (unanswered.length > 0) {
    throw refuse(
      "CONTRACT_INVALID",
      `starter-brief.json still carries ${unanswered.length} unanswered copy field(s). A TODO is not copy, and a site must not ship one:\n  ${unanswered.join("\n  ")}`,
      { unanswered },
    );
  }

  const output = join(build, "experience");
  await assertEmpty(output);
  const generated = generateExperienceStarter({ definition, brief });
  for (const entry of generated.files) {
    await writeInto(join(output, ...entry.path.split("/")), entry.contents);
  }

  heading("P1 experience source");
  step(`${generated.files.length} files, ${generated.totalLines} lines`);
  step(`routes: ${generated.routeIds.join(", ")}`);
  step(`source hash ${generated.sourceHash.slice(0, 12)}`);
  step(`written to ${relative(process.cwd(), output)}`);
  heading("Next");
  step("assemble:client to build the artifact, then preview it");
  step("premium path from here: creative:prepare → creative:launch → creative:verify");
}

/* ------------------------------------------------------------------------ */

async function loadRecords(
  workspace: string,
  optional: readonly string[] = [],
): Promise<{ records: Records; invalid: Record<string, readonly string[]> }> {
  const records: Records = {};
  const invalid: Record<string, readonly string[]> = {};
  for (const [kind, file] of Object.entries(RECORD_FILES)) {
    const path = join(workspace, file);
    if (!(await exists(path))) {
      if (optional.includes(kind)) continue;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      invalid[kind] = [`is not valid JSON: ${(error as Error).message}`];
      continue;
    }
    const problems = validateRecord(kind, parsed);
    if (problems.length > 0) {
      invalid[kind] = problems;
      continue;
    }
    records[camel(kind)] = assertRecord(kind, parsed) as Record<string, unknown>;
  }
  return { records, invalid };
}

function renderShotList(list: {
  readonly clientId: string;
  readonly derivedFrom: Readonly<Record<string, unknown>>;
  readonly requirements: readonly {
    readonly code: string;
    readonly count: number;
    readonly subject: string;
    readonly framing: string;
    readonly substantiates: string;
  }[];
  readonly totalFrames: number;
}): string {
  const lines = [
    `# Photographs still needed — ${list.clientId}`,
    "",
    `${list.requirements.length} requirement(s), ${list.totalFrames} frame(s) in total.`,
    "",
    "Each item below is a job someone can execute. None of it is feedback on the",
    "photographs already supplied, and none of it asks anyone to judge what is good.",
    "",
    `Derived from ${Object.entries(list.derivedFrom)
      .map(([key, value]) => `${key} ${String(value)}`)
      .join(", ")}.`,
    "",
  ];
  for (const requirement of list.requirements) {
    lines.push(
      `## ${requirement.count} × ${requirement.subject}`,
      "",
      `**Framing.** ${requirement.framing}`,
      "",
      `**Why.** ${requirement.substantiates}`,
      "",
    );
  }
  return `${lines.join("\n")}`;
}

function parseFlags(argv: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (!token.startsWith("--")) {
      throw refuse("CONTRACT_INVALID", `Unexpected argument "${token}". Named flags only.`);
    }
    const equals = token.indexOf("=");
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    const inline = equals === -1 ? undefined : token.slice(equals + 1);
    const value = inline ?? argv[index + 1];
    if (inline === undefined) index += 1;
    if (value === undefined || value.startsWith("--")) {
      throw refuse("CONTRACT_INVALID", `--${name} needs a value.`);
    }
    values[name] = value;
  }
  return values;
}

function required(name: string): string {
  const value = flags[name];
  if (value === undefined || value.trim() === "") {
    throw refuse("CONTRACT_INVALID", `--${name} is required.\n\n${usage()}`);
  }
  return value;
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function assertEmpty(directory: string): Promise<void> {
  try {
    const entries = await readdir(directory);
    if (entries.length > 0) {
      throw refuse(
        "CONTRACT_INVALID",
        `"${directory}" already holds files. Nothing is ever overwritten; move it or choose another path.`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

async function assertAbsentFile(path: string): Promise<void> {
  if (await exists(path)) {
    throw refuse(
      "CONTRACT_INVALID",
      `"${path}" already exists. A recommendation never overwrites a decision somebody made.`,
    );
  }
}

async function writeInto(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

/**
 * The manifest the P1 generator will emit for this page graph.
 *
 * Route coverage has to match the page graph exactly, and it is the page graph
 * that names the routes — so this is a derivation rather than a guess, and it
 * lets the whole v2 cross-validation run one command earlier than assembly.
 */
function manifestFor(definition: {
  readonly configuration: { readonly clientId: string };
  readonly pageGraph: { readonly pages: readonly { readonly experienceRouteId: string }[] };
}) {
  return {
    schemaVersion: 1,
    kind: "AUTHORED_CLIENT_EXPERIENCE",
    experienceId: definition.configuration.clientId,
    experienceVersion: "1.0.0",
    entrypoint: "index.tsx",
    designDnaPath: "design-dna.json",
    routeIds: [
      ...new Set(definition.pageGraph.pages.map(({ experienceRouteId }) => experienceRouteId)),
    ],
    signatureIds: [],
    publicDependencies: [],
    runtime: {
      clientJavaScript: "COMPONENT_SCOPED",
      motion: "NATIVE",
      reducedMotion: "REQUIRED",
    },
  };
}

function issueList(
  label: string,
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[],
): string {
  return `The composed ${label} is not valid:\n  ${issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n  ")}`;
}

function camel(kind: string): string {
  return kind.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function heading(message: string): void {
  process.stdout.write(`\n${message}\n`);
}

function step(message: string): void {
  process.stdout.write(`  ${message}\n`);
}

function usage(): string {
  return `Tradies delivery — one client, six commands.

  pnpm tradie start     --client <id> --into <dir> [--name "Business Name"]
  pnpm tradie check     --workspace <dir>
  pnpm tradie recommend --workspace <dir>
  pnpm tradie shotlist  --workspace <dir>
  pnpm tradie compose   --workspace <dir>
  pnpm tradie p1        --workspace <dir>
  pnpm tradie demo      --into <dir>

Run \`check\` whenever you are unsure what to do next. It is read-only.
`;
}
