import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectClientExperienceSource,
} from "../../apps/managed-web/src/generation/client-experience-source-policy";

/**
 * The operator surface, exercised the way an operator meets it.
 *
 * These run the real commands in a real directory, because the thing being
 * tested is not the pure functions — those have their own tests — but whether a
 * person who knows nothing can follow the printed next step from an empty
 * directory to generated source.
 */

const repositoryRoot = resolve(import.meta.dirname, "../..");
const tsxBin = join(repositoryRoot, "node_modules/.bin/tsx");

interface Outcome {
  readonly exitCode: number;
  readonly output: string;
}

async function tradie(...argv: readonly string[]): Promise<Outcome> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(tsxBin, [join("scripts/tradies/cli.ts"), ...argv], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ exitCode: code ?? -1, output }));
  });
}

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "tradies-"));
}

interface StarterBriefShape {
  /** `contactChecklist` is a list, so the values are not all strings. */
  copy: Record<string, unknown>;
  media: Record<string, unknown>;
}

/**
 * Answers the placeholders a real operator would write, so a test can reach the
 * step after the refusal without asserting anything about the prose.
 */
function answerCopy(brief: StarterBriefShape): StarterBriefShape {
  for (const [field, value] of Object.entries(brief.copy)) {
    if (typeof value === "string" && value.startsWith("TODO — ")) {
      brief.copy[field] = `Answered copy for ${field}.`;
    }
  }
  const provenance = brief.media["provenanceCaption"];
  if (typeof provenance === "string" && provenance.startsWith("TODO — ")) {
    brief.media["provenanceCaption"] = "Photographs supplied by the business.";
  }
  return brief;
}

test("a clean-room operator can go from nothing to generated source", async (t) => {
  const root = await workspace();
  const dir = join(root, "client");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const started = await tradie("demo", "--into", dir);
  assert.equal(started.exitCode, 0, started.output);

  const checked = await tradie("check", "--workspace", dir);
  assert.equal(checked.exitCode, 0, checked.output);
  assert.match(checked.output, /INPUTS READY/);
  /* Every gap the operator is shown says who has to close it. */
  assert.match(checked.output, /AGENCY owes/);
  /* And the printed next step is the command that actually follows. */
  assert.match(checked.output, /next: pnpm tradie compose/);

  const shots = await tradie("shotlist", "--workspace", dir);
  assert.equal(shots.exitCode, 0, shots.output);
  const shotList = await readFile(join(dir, "shot-list.md"), "utf8");
  assert.match(shotList, /Framing\./);
  assert.match(shotList, /Why\./);
  assert.doesNotMatch(shotList, /better photos/i);

  const composed = await tradie("compose", "--workspace", dir);
  assert.equal(composed.exitCode, 0, composed.output);
  assert.match(composed.output, /then: pnpm tradie p1/);

  const definition = JSON.parse(
    await readFile(join(dir, "build", "client-website.json"), "utf8"),
  ) as { readonly schemaVersion: number; readonly pageGraph: { readonly pages: readonly unknown[] } };
  assert.equal(definition.schemaVersion, 2);
  assert.ok(definition.pageGraph.pages.length > 30);

  const ledger = JSON.parse(await readFile(join(dir, "truth-ledger.json"), "utf8")) as {
    readonly entries: readonly { readonly truthClass: string }[];
  };
  assert.ok(ledger.entries.length > 20);

  /* The brief still carries TODOs, so p1 must refuse. */
  const refused = await tradie("p1", "--workspace", dir);
  assert.equal(refused.exitCode, 1, refused.output);
  assert.match(refused.output, /A TODO is not copy/);
  assert.match(refused.output, /Nothing was written\./);

  const briefPath = join(dir, "starter-brief.json");
  const brief = answerCopy(
    JSON.parse(await readFile(briefPath, "utf8")) as StarterBriefShape,
  );
  await writeFile(briefPath, JSON.stringify(brief, null, 2));

  const generated = await tradie("p1", "--workspace", dir);
  assert.equal(generated.exitCode, 0, generated.output);
  assert.match(generated.output, /P1 experience source/);
});

test("generated high-cardinality source satisfies the client experience source policy", async (t) => {
  const root = await workspace();
  const dir = join(root, "client");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  assert.equal((await tradie("demo", "--into", dir)).exitCode, 0);
  assert.equal((await tradie("compose", "--workspace", dir)).exitCode, 0);
  const briefPath = join(dir, "starter-brief.json");
  const brief = answerCopy(
    JSON.parse(await readFile(briefPath, "utf8")) as StarterBriefShape,
  );
  await writeFile(briefPath, JSON.stringify(brief, null, 2));
  assert.equal((await tradie("p1", "--workspace", dir)).exitCode, 0);

  /*
   * The archive's filter was first emitted inside a raw <form>, which this
   * policy refuses so route and markup validation cannot be bypassed. It was
   * caught by building the second context rather than by reasoning about it,
   * which is exactly why the check now runs on every generated tree.
   */
  const manifest = JSON.parse(
    await readFile(join(dir, "build", "experience", "manifest.json"), "utf8"),
  ) as never;
  const inspected = await inspectClientExperienceSource({
    inputDirectory: join(dir, "build"),
    manifest,
    approvedPublicDependencies: [],
  });
  assert.ok(inspected.files.length > 10);
  assert.ok(
    inspected.files.some(({ path }: { path: string }) => path === "routes/ProjectsRoutes.tsx"),
    "the archive route is part of what was inspected",
  );
});

test("nothing is ever written over", async (t) => {
  const root = await workspace();
  const dir = join(root, "client");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  assert.equal((await tradie("demo", "--into", dir)).exitCode, 0);
  const second = await tradie("demo", "--into", dir);
  assert.equal(second.exitCode, 1, second.output);
  assert.match(second.output, /already holds files/);

  const recommended = await tradie("recommend", "--workspace", dir);
  assert.equal(recommended.exitCode, 1, recommended.output);
  assert.match(
    recommended.output,
    /never overwrites a decision somebody made/,
    "the demo already carries an approved configuration",
  );
});

test("an unusable workspace is refused with the problem named", async (t) => {
  const root = await workspace();
  const dir = join(root, "client");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  assert.equal((await tradie("start", "--client", "test-client", "--into", dir)).exitCode, 0);

  const checked = await tradie("check", "--workspace", dir);
  assert.equal(checked.exitCode, 1, checked.output);
  assert.match(checked.output, /problem\(s\)/);
  assert.match(checked.output, /Fix the records above/);

  const composed = await tradie("compose", "--workspace", dir);
  assert.equal(composed.exitCode, 1, composed.output);
  assert.match(composed.output, /Nothing was written\./);
});

test("the scaffold tells the operator who answers each file", async (t) => {
  const root = await workspace();
  const dir = join(root, "client");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  assert.equal(
    (await tradie("start", "--client", "test-client", "--into", dir, "--name", "Test Roofing")).exitCode,
    0,
  );
  const readme = await readFile(join(dir, "README.md"), "utf8");
  assert.match(readme, /Who answers it/);
  assert.match(readme, /The client is never asked/);
  assert.match(readme, /which photographs are good/);
});
