import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assembleClientSourceArtifact,
  verifyClientSourceArtifact,
} from "./index";

const arguments_ = parseArguments(process.argv.slice(2));
const inputDirectory = resolve(arguments_.input);
const definition = JSON.parse(
  await readFile(resolve(inputDirectory, "client-website.json"), "utf8"),
) as unknown;
const artifact = await assembleClientSourceArtifact({
  definition,
  publicDirectory: resolve(inputDirectory, "public"),
  outputDirectory: resolve(arguments_.output),
  factoryRevision: arguments_.factoryRevision,
});
await verifyClientSourceArtifact(artifact.sourceDirectory);

process.stdout.write(
  `${JSON.stringify({
    success: true,
    artifactId: artifact.descriptor.artifactId,
    clientId: artifact.descriptor.clientId,
    repositoryName: artifact.descriptor.repositoryName,
    sourceDirectory: artifact.sourceDirectory,
    buildOutput: "TEMPORARY_ONLY",
  })}\n`,
);

function parseArguments(input: readonly string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < input.length; index += 2) {
    const name = input[index];
    const value = input[index + 1];
    if (
      name === undefined ||
      value === undefined ||
      !name.startsWith("--")
    ) {
      throw new TypeError(
        "Usage: --input <directory> --output <empty-directory> --factory-revision <revision>",
      );
    }
    values.set(name.slice(2), value);
  }
  const inputDirectory = values.get("input");
  const outputDirectory = values.get("output");
  const factoryRevision = values.get("factory-revision");
  if (
    inputDirectory === undefined ||
    outputDirectory === undefined ||
    factoryRevision === undefined ||
    factoryRevision.trim() === ""
  ) {
    throw new TypeError(
      "Usage: --input <directory> --output <empty-directory> --factory-revision <revision>",
    );
  }
  return {
    input: inputDirectory,
    output: outputDirectory,
    factoryRevision,
  };
}
