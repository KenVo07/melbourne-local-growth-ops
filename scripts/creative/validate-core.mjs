/**
 * The pure validation engine for creative delivery artifacts.
 *
 * Kept free of filesystem and process access so both the CLI and the self-test
 * can drive it directly, and so a rule can be exercised on an in-memory fixture
 * without writing a delivery to disk.
 */
import {
  ARTIFACTS,
  EVIDENCE_CLASS,
  FACTORY_CANDIDATE_MIN_CLIENTS,
  NON_HUMAN_DECIDERS,
  NON_SUBSTANTIATING,
  PROMOTION_DECISIONS,
  PROVENANCE_CLASSES,
  REQUIRED_SLICE_COVERAGE,
} from "./artifact-model.mjs";

/**
 * Front-matter is a deliberately small YAML subset: `key: value`, and `key:`
 * followed by indented `- item` lines. Nothing nested, no anchors, no flow
 * syntax. Small enough to parse without a dependency and small enough that an
 * operator cannot get it subtly wrong.
 */
export function parseFrontMatter(text) {
  if (!text.startsWith("---")) {
    return { frontMatter: null, body: text };
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { frontMatter: null, body: text };

  const block = text.slice(text.indexOf("\n") + 1, end);
  const body = text.slice(end + 4);
  const frontMatter = {};
  let currentListKey = null;

  for (const rawLine of block.split("\n")) {
    if (rawLine.trim() === "" || rawLine.trimStart().startsWith("#")) continue;

    const listItem = /^\s+-\s*(.*)$/.exec(rawLine);
    if (listItem !== null && currentListKey !== null) {
      frontMatter[currentListKey].push(unquote(listItem[1].trim()));
      continue;
    }

    const pair = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(rawLine);
    if (pair === null) continue;
    const [, key, rawValue] = pair;
    /*
     * ` #` starts a comment, as in YAML proper. Scaffolded files carry their
     * enum hints and link hints that way, so an unanswered field reads as empty
     * rather than as the hint text -- which otherwise surfaces to the operator
     * as `"status" is "# DRAFT | READY..."`, blaming them for the template.
     */
    const value = rawValue.replace(/(^|\s)#.*$/, "").trim();
    if (value === "") {
      frontMatter[key] = [];
      currentListKey = key;
    } else {
      frontMatter[key] = unquote(value);
      currentListKey = null;
    }
  }
  return { frontMatter, body };
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Returns the text under a `## Heading`, or null when the heading is absent. */
export function sectionBody(body, heading) {
  const pattern = new RegExp(
    `^#{2,3}\\s+${heading.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
    "im",
  );
  const match = pattern.exec(body);
  if (match === null) return null;
  const start = match.index + match[0].length;
  const next = /^#{2,3}\s+/m.exec(body.slice(start));
  return (next === null ? body.slice(start) : body.slice(start, start + next.index)).trim();
}

/** Parses a GitHub-style Markdown table into row objects keyed by header. */
export function parseTable(text) {
  if (text === null) return [];
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));
  if (lines.length < 2) return [];

  const cells = (line) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

  const headers = cells(lines[0]);
  return lines
    .slice(2)
    .map((line) => cells(line))
    .filter((row) => row.some((cell) => cell !== "" && !/^-+$/.test(cell)))
    .map((row) =>
      Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
    );
}

/**
 * Removes everything a template supplies for free -- HTML-comment guidance and
 * empty table scaffolding -- so a section is judged on what the operator wrote.
 */
export function stripScaffolding(content) {
  return content
    .replaceAll(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((line) => !/^\s*\|[\s|:-]*\|\s*$/.test(line))
    .join("\n")
    .replaceAll(/\|/g, "")
    .replaceAll(/-/g, "")
    .trim();
}

/** A placeholder an operator left unfilled. Templates ship full of these. */
export function isUnfilled(value) {
  if (value === undefined || value === null) return true;
  const text = String(value).trim();
  return text === "" || text === "[ ]" || text === "[]" || text === "TBD" || text === "TODO";
}

export function loadEnvelope(envelopeText) {
  const envelope = JSON.parse(envelopeText);
  const permitted = new Set();
  const refused = new Map();
  for (const technique of envelope.techniques) {
    if (technique.status === "PERMITTED") permitted.add(technique.id);
    else refused.set(technique.id, technique.errorCode);
  }
  return { permitted, refused };
}

/**
 * Validates a set of already-read artifacts. Kept free of filesystem access so
 * the self-test can exercise it directly on in-memory fixtures.
 */
export function validateArtifacts(documents, envelope) {
  const problems = [];
  const fail = (file, message) => problems.push({ file, message });

  const byKind = new Map();
  for (const document of documents) {
    const list = byKind.get(document.kind) ?? [];
    list.push(document);
    byKind.set(document.kind, list);
  }
  const byName = new Map(documents.map((document) => [document.name, document]));

  for (const document of documents) {
    const definition = ARTIFACTS[document.kind];
    const { frontMatter, body, name } = document;

    for (const key of definition.required) {
      if (isUnfilled(frontMatter[key])) {
        fail(name, `front-matter is missing "${key}". Add "${key}: <value>".`);
      }
    }

    for (const [key, values] of Object.entries(definition.enums ?? {})) {
      const value = frontMatter[key];
      if (!isUnfilled(value) && !values.includes(value)) {
        fail(name, `"${key}" is "${value}"; it must be one of ${values.join(", ")}.`);
      }
    }

    for (const [key, minimum] of Object.entries(definition.lists ?? {})) {
      const value = frontMatter[key];
      if (!Array.isArray(value)) {
        fail(name, `"${key}" must be a list of at least ${minimum} item(s).`);
        continue;
      }
      const filled = value.filter((item) => !isUnfilled(item));
      if (filled.length < minimum) {
        fail(
          name,
          `"${key}" has ${filled.length} filled item(s); at least ${minimum} required.`,
        );
      }
    }

    for (const [key, expectedKind] of Object.entries(definition.links ?? {})) {
      const target = frontMatter[key];
      if (isUnfilled(target)) {
        fail(name, `"${key}" must name the ${expectedKind} artifact it derives from.`);
        continue;
      }
      const resolved = byName.get(target) ?? byName.get(`${target}.md`);
      if (resolved === undefined) {
        fail(name, `"${key}" points at "${target}", which is not in this delivery.`);
      } else if (resolved.kind !== expectedKind) {
        fail(
          name,
          `"${key}" points at "${target}", which is a ${resolved.kind}, not a ${expectedKind}.`,
        );
      }
    }

    for (const heading of definition.sections ?? []) {
      const content = sectionBody(body, heading);
      if (content === null) {
        fail(name, `is missing the "## ${heading}" section.`);
      } else if (isUnfilled(stripScaffolding(content))) {
        fail(name, `left "## ${heading}" unfilled.`);
      }
    }
  }

  // ---- Intent → three materially different territories -------------------
  const territories = byKind.get("creative-territory") ?? [];
  if (territories.length > 0 && territories.length !== 3) {
    fail(
      "delivery",
      `has ${territories.length} creative territories; the standard is exactly 3 materially different ones.`,
    );
  }
  /* An unanswered `territory:` parses as an empty list, which is truthy. */
  const territoryIds = new Set(
    territories
      .map(({ frontMatter }) => frontMatter.territory)
      .filter((id) => typeof id === "string" && id !== ""),
  );
  for (const territory of territories) {
    const others = [...territoryIds].filter(
      (id) => id !== territory.frontMatter.territory,
    );
    const declared = territory.frontMatter.materially_different_from ?? [];
    const missing = others.filter((id) => !declared.includes(id));
    if (missing.length > 0) {
      fail(
        territory.name,
        `must say how it differs from ${missing.join(", ")} in "materially_different_from".`,
      );
    }
    if (
      isUnfilled(territory.frontMatter.starter_brief) &&
      territory.frontMatter.bespoke !== "true"
    ) {
      fail(
        territory.name,
        `must either name a "starter_brief" or declare "bespoke: true". Design values live in the brief, not here.`,
      );
    }
  }

  // ---- Signature slice: coverage and a real capability envelope ----------
  for (const slice of byKind.get("signature-slice") ?? []) {
    const covers = (slice.frontMatter.covers ?? []).map((value) =>
      String(value).toLowerCase(),
    );
    const missing = REQUIRED_SLICE_COVERAGE.filter((moment) => !covers.includes(moment));
    if (missing.length > 0) {
      fail(slice.name, `does not cover ${missing.join(", ")}. A slice must prove all four.`);
    }
    const selected = slice.frontMatter.selected_territory;
    if (!isUnfilled(selected) && territoryIds.size > 0 && !territoryIds.has(selected)) {
      fail(
        slice.name,
        `selects territory "${selected}", which no territory in this delivery declares.`,
      );
    }
    for (const technique of slice.frontMatter.techniques ?? []) {
      if (isUnfilled(technique)) continue;
      if (envelope.refused.has(technique)) {
        fail(
          slice.name,
          `declares "${technique}", which the source policy refuses (${envelope.refused.get(technique)}). Choose another technique or a Platform primitive; do not weaken the policy.`,
        );
      } else if (!envelope.permitted.has(technique)) {
        fail(
          slice.name,
          `declares "${technique}", which the capability envelope does not cover. Add a candidate to scripts/creative/envelope-probe.ts and re-run "pnpm creative:envelope".`,
        );
      }
    }
  }

  // ---- The gate is a human act ------------------------------------------
  for (const gate of byKind.get("creative-gate") ?? []) {
    const decider = String(gate.frontMatter.decided_by ?? "").trim().toLowerCase();
    if (
      decider !== "" &&
      NON_HUMAN_DECIDERS.some(
        (identity) => decider === identity || decider.includes(identity),
      )
    ) {
      fail(
        gate.name,
        `records "${gate.frontMatter.decided_by}" as the decider. The Creative Gate is reserved for a named human; an agent cannot pass its own work.`,
      );
    }
    /* An unanswered field parses as an empty list, so coerce before testing. */
    const decision =
      typeof gate.frontMatter.decision === "string" ? gate.frontMatter.decision : "";
    const evidence = sectionBody(gate.body, "Evidence reviewed");
    if (decision.startsWith("PASS") && (evidence === null || isUnfilled(evidence))) {
      fail(gate.name, `records a ${decision} with no evidence reviewed. Name what was looked at.`);
    }
    if (decision === "PASS_WITH_NAMED_FIXES") {
      const fixes = sectionBody(gate.body, "Named fixes");
      if (fixes === null || isUnfilled(fixes)) {
        fail(gate.name, `is PASS_WITH_NAMED_FIXES but names no fixes.`);
      }
    }
  }

  // ---- Handoff must descend from a passed gate --------------------------
  for (const handoff of byKind.get("production-handoff") ?? []) {
    const gateName = handoff.frontMatter.gate;
    const gate = byName.get(gateName) ?? byName.get(`${gateName}.md`);
    if (gate !== undefined && gate.kind === "creative-gate") {
      if (gate.frontMatter.decision === "FAIL") {
        fail(
          handoff.name,
          `descends from a gate that FAILED. A failed direction does not go to production.`,
        );
      }
    }
    for (const technique of handoff.frontMatter.techniques ?? []) {
      if (!isUnfilled(technique) && envelope.refused.has(technique)) {
        fail(
          handoff.name,
          `hands over "${technique}", which the source policy refuses (${envelope.refused.get(technique)}).`,
        );
      }
    }
  }

  // ---- Media truth ------------------------------------------------------
  for (const plan of byKind.get("media-plan") ?? []) {
    const rows = parseTable(sectionBody(plan.body, "Assets"));
    if (rows.length === 0) {
      fail(plan.name, `has no assets in its "## Assets" table.`);
    }
    for (const row of rows) {
      const asset = row["Asset"] ?? "(unnamed)";
      const provenance = (row["Provenance class"] ?? "").trim();
      const substantiates = (row["Substantiates"] ?? "").trim();
      if (!PROVENANCE_CLASSES.includes(provenance)) {
        fail(
          plan.name,
          `asset "${asset}" has provenance "${provenance || "(blank)"}"; it must be one of ${PROVENANCE_CLASSES.join(", ")}.`,
        );
        continue;
      }
      const claimsAFact =
        substantiates !== "" &&
        !NON_SUBSTANTIATING.includes(substantiates.toLowerCase());
      if (claimsAFact && provenance !== EVIDENCE_CLASS) {
        fail(
          plan.name,
          `asset "${asset}" substantiates "${substantiates}" but is classed ${provenance}. Only ${EVIDENCE_CLASS} may stand behind work, team, premises, results or certifications.`,
        );
      }
      if (isUnfilled(row["Approved by"])) {
        fail(plan.name, `asset "${asset}" has no named human approver.`);
      }
    }
  }

  // ---- Promotion needs repeated evidence, not impressiveness -------------
  for (const ledger of byKind.get("promotion-ledger") ?? []) {
    const rows = parseTable(sectionBody(ledger.body, "Ledger"));
    for (const row of rows) {
      const mechanic = row["Mechanic"] ?? "(unnamed)";
      const decision = (row["Decision"] ?? "").trim();
      if (!PROMOTION_DECISIONS.includes(decision)) {
        fail(
          ledger.name,
          `mechanic "${mechanic}" has decision "${decision || "(blank)"}"; it must be one of ${PROMOTION_DECISIONS.join(", ")}.`,
        );
        continue;
      }
      if (decision !== "FACTORY_CANDIDATE") continue;

      const clients = (row["Clients observed"] ?? "")
        .split(/[,;]/)
        .map((value) => value.trim())
        .filter((value) => value !== "" && !NON_SUBSTANTIATING.includes(value.toLowerCase()));
      if (clients.length < FACTORY_CANDIDATE_MIN_CLIENTS) {
        fail(
          ledger.name,
          `mechanic "${mechanic}" is a FACTORY_CANDIDATE on ${clients.length} delivery(ies). Promotion needs at least ${FACTORY_CANDIDATE_MIN_CLIENTS} named deliveries.`,
        );
      }
      if (isUnfilled(row["Invariant substrate"])) {
        fail(
          ledger.name,
          `mechanic "${mechanic}" is a FACTORY_CANDIDATE with no stated invariant substrate. Name what is invariant, or keep it client-local.`,
        );
      }
    }
  }

  return problems;
}
