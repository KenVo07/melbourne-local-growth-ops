/**
 * The generator refuses to write over authored source.
 *
 * This is a one-line guard in `cli.ts` (`assertAbsent`) and the most valuable
 * line in the package, so it gets a test of its own rather than living inside a
 * generation test that would still pass without it.
 *
 * Why it is worth a file: a client-local shell script called `rebuild.sh` used to
 * delete `<client>-input/experience/` and then invoke this CLI. Deleting first
 * satisfies the guard, so the guard held and the work was lost anyway — once, for
 * real, on an uncommitted parity slice that had to be recovered from a patch. The
 * Platform's job is to make the destructive path require an explicit deletion by
 * whoever wants it. If this refusal is ever softened into a warning, or an
 * `--overwrite` flag is added to make a caller's life easier, that is the defect
 * this test exists to fail on.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { quietBrief, testDefinition } from "./fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "cli.ts");
const temporary: string[] = [];

afterAll(async () => {
  await Promise.all(temporary.map((path) => rm(path, { recursive: true, force: true })));
});

async function buildInput(): Promise<{ input: string; brief: string }> {
  const root = await mkdtemp(join(tmpdir(), "starter-refusal-"));
  temporary.push(root);
  const input = join(root, "client-input");
  await mkdir(join(input, "public"), { recursive: true });
  await writeFile(
    join(input, "client-website.json"),
    JSON.stringify(testDefinition, null, 2),
    "utf8",
  );
  const brief = join(root, "starter-brief.json");
  await writeFile(brief, JSON.stringify(quietBrief, null, 2), "utf8");
  return { input, brief };
}

function run(input: string, brief: string) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", cli, "--input", input, "--brief", brief],
    { encoding: "utf8" },
  );
}

describe("generation over existing source", () => {
  it("generates into an absent experience/ directory", async () => {
    const { input, brief } = await buildInput();
    const result = run(input, brief);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).success).toBe(true);
  });

  it("refuses a second run rather than overwriting what the first produced", async () => {
    const { input, brief } = await buildInput();
    expect(run(input, brief).status).toBe(0);

    const second = run(input, brief);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toMatch(/Refusing to generate over existing source/);
  });

  it("refuses authored source it did not write, naming the directory", async () => {
    const { input, brief } = await buildInput();
    const authored = join(input, "experience");
    await mkdir(authored, { recursive: true });
    /* One hand-authored file is enough: the refusal is about the directory not
     * being empty, not about recognising what is in it. */
    await writeFile(
      join(authored, "AuthoredHero.tsx"),
      "export const AuthoredHero = () => null;\n",
      "utf8",
    );

    const result = run(input, brief);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(authored);
    expect(result.stderr).toMatch(/Move or delete it first/);
  });

  it("accepts an empty directory, which carries no authored work to lose", async () => {
    const { input, brief } = await buildInput();
    await mkdir(join(input, "experience"), { recursive: true });
    expect(run(input, brief).status).toBe(0);
  });
});
