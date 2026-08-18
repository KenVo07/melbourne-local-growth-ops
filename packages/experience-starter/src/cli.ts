import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { generateExperienceStarter } from "./generate.js";

/**
 * Generates a client-local `experience/` source tree into a client build
 * package, so the ordinary `assemble:client` path can then consume it unchanged.
 *
 * Usage:
 *   generate:starter --input <build-package> --brief <starter-brief.json>
 *
 * `--input` is the directory that already holds `client-website.json` and
 * `public/`. The tree is written to `<input>/experience`, which must not exist:
 * the generator will not overwrite source somebody may have edited.
 */
const values = parseArguments(process.argv.slice(2));
const inputDirectory = resolve(values.input);
const briefPath = resolve(values.brief);
const outputDirectory = join(inputDirectory, "experience");

await assertAbsent(outputDirectory);

const definition = JSON.parse(
  await readFile(join(inputDirectory, "client-website.json"), "utf8"),
) as unknown;
const brief = JSON.parse(await readFile(briefPath, "utf8")) as unknown;

const generated = generateExperienceStarter({ definition, brief });

for (const entry of generated.files) {
  const destination = join(outputDirectory, ...entry.path.split("/"));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, entry.contents);
}

process.stdout.write(
  `${JSON.stringify(
    {
      success: true,
      experienceId: generated.design.brief.experienceId,
      outputDirectory,
      sourceHash: generated.sourceHash,
      routeIds: generated.routeIds,
      totalLines: generated.totalLines,
      /*
       * Why this client got the interactions it got. An operator reading the
       * report can see that the questions folded because there were five of
       * them and the brief permits folding — not because the Factory has an
       * opinion about FAQs.
       */
      interaction: {
        language: generated.design.interaction.source,
        contactFaq: generated.interactions.contactFaq,
        serviceQuestions: generated.interactions.serviceQuestions,
        projectMedia: generated.interactions.projectMedia,
      },
      files: generated.files.map(({ path, lines, sha256 }) => ({
        path,
        lines,
        sha256,
      })),
      groundContrast: generated.design.colour.contrastReport,
    },
    null,
    2,
  )}\n`,
);

async function assertAbsent(directory: string): Promise<void> {
  try {
    const entries = await readdir(directory);
    if (entries.length > 0) {
      throw new TypeError(
        `Refusing to generate over existing source at "${directory}". Move or delete it first.`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function parseArguments(input: readonly string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < input.length; index += 2) {
    const name = input[index];
    const value = input[index + 1];
    if (name === undefined || value === undefined || !name.startsWith("--")) {
      throw new TypeError(
        "Usage: --input <build-package-directory> --brief <starter-brief.json>",
      );
    }
    values.set(name.slice(2), value);
  }
  const inputDirectory = values.get("input");
  const brief = values.get("brief");
  if (inputDirectory === undefined || brief === undefined) {
    throw new TypeError(
      "Usage: --input <build-package-directory> --brief <starter-brief.json>",
    );
  }
  return { input: inputDirectory, brief };
}
