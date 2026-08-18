/**
 * The shared command shell for `creative:prepare`, `creative:launch` and
 * `creative:verify`.
 *
 * It exists so the three commands agree about three things an operator relies
 * on: flags are explicit and unknown ones are refused rather than ignored, a
 * refusal prints its code and the corrective action rather than a stack trace,
 * and every command exits non-zero when it refuses.
 *
 * The intended operator is a Digital Experience specialist who does not write
 * source. A message here should name the client, the file and the next action —
 * the same bar `creative:validate` already sets.
 */
import { REFUSALS, PremiumRefusal, refuse } from "./premium-contracts.mjs";

export interface FlagSpec {
  readonly name: string;
  readonly required: boolean;
  readonly value: string;
  readonly description: string;
}

export interface CommandSpec {
  readonly command: string;
  readonly summary: string;
  readonly flags: readonly FlagSpec[];
  /** Prose printed under the usage block. */
  readonly notes: readonly string[];
}

/**
 * Parses `--name value` pairs only.
 *
 * No positional arguments, no abbreviations and no fuzzy client lookup: the
 * commands take explicit paths so an operator can never discover that a run
 * bound itself to a client they did not name.
 */
export function parseFlags(
  spec: CommandSpec,
  argv: readonly string[],
): Record<string, string> {
  const known = new Map(spec.flags.map((flag) => [flag.name, flag]));
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      values.help = "true";
      continue;
    }
    if (!token.startsWith("--")) {
      throw refuse(
        "ARGUMENTS_INVALID",
        `Unexpected argument "${token}". ${spec.command} takes named flags only.\n\n${usage(spec)}`,
        { argument: token },
      );
    }
    const [name, inlineValue] = splitFlag(token);
    if (!known.has(name)) {
      throw refuse(
        "ARGUMENTS_INVALID",
        `Unknown flag "${name}".\n\n${usage(spec)}`,
        { flag: name },
      );
    }
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;
    if (value === undefined || value.startsWith("--")) {
      throw refuse(
        "ARGUMENTS_INVALID",
        `${name} needs a value.\n\n${usage(spec)}`,
        { flag: name },
      );
    }
    if (values[name.slice(2)] !== undefined) {
      throw refuse("ARGUMENTS_INVALID", `${name} was given twice.`, { flag: name });
    }
    values[name.slice(2)] = value;
  }

  if (values.help === "true") return values;

  const missing = spec.flags
    .filter((flag) => flag.required && values[flag.name.slice(2)] === undefined)
    .map((flag) => flag.name);
  if (missing.length > 0) {
    throw refuse(
      "ARGUMENTS_INVALID",
      `${spec.command} needs ${missing.join(" and ")}.\n\n${usage(spec)}`,
      { missing },
    );
  }
  return values;
}

function splitFlag(token: string): [string, string | undefined] {
  const equals = token.indexOf("=");
  if (equals === -1) return [token, undefined];
  return [token.slice(0, equals), token.slice(equals + 1)];
}

export function usage(spec: CommandSpec): string {
  const lines = [`usage: pnpm ${spec.command} \\`];
  const ordered = [...spec.flags].sort((left, right) =>
    left.required === right.required ? 0 : left.required ? -1 : 1,
  );
  for (const [index, flag] of ordered.entries()) {
    const rendered = flag.required
      ? `  ${flag.name} ${flag.value}`
      : `  [${flag.name} ${flag.value}]`;
    lines.push(index === ordered.length - 1 ? rendered : `${rendered} \\`);
  }
  lines.push("");
  for (const flag of ordered) {
    lines.push(`  ${flag.name.padEnd(22)}${flag.description}`);
  }
  if (spec.notes.length > 0) {
    lines.push("");
    for (const note of spec.notes) lines.push(note);
  }
  return lines.join("\n");
}

/**
 * Runs a command body, turning a refusal into an operator-readable failure.
 *
 * An unexpected error keeps its stack, because that is a defect in this tooling
 * rather than something the operator did; a refusal is a decision the bridge
 * made, and it prints as one.
 */
export async function runCommandMain(
  spec: CommandSpec,
  body: (flags: Record<string, string>) => Promise<void>,
): Promise<void> {
  let flags: Record<string, string>;
  try {
    flags = parseFlags(spec, process.argv.slice(2));
  } catch (error) {
    reportRefusal(error);
    process.exitCode = 1;
    return;
  }
  if (flags.help === "true") {
    process.stdout.write(`${spec.summary}\n\n${usage(spec)}\n`);
    return;
  }
  try {
    await body(flags);
  } catch (error) {
    if (error instanceof PremiumRefusal) {
      reportRefusal(error);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

export function reportRefusal(error: unknown): void {
  if (!(error instanceof PremiumRefusal)) {
    process.stderr.write(`${String(error)}\n`);
    return;
  }
  const meaning = REFUSALS[error.code as keyof typeof REFUSALS] ?? "";
  process.stderr.write(
    `\nREFUSED: ${error.code}\n${meaning === "" ? "" : `${meaning}\n`}\n${error.message}\n\nNothing was written.\n`,
  );
}

/** One line per step, so a long command reads as progress rather than a hang. */
export function step(message: string): void {
  process.stdout.write(`  ${message}\n`);
}

export function heading(message: string): void {
  process.stdout.write(`\n${message}\n`);
}
