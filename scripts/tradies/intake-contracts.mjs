/**
 * The Tradies delivery intake contracts.
 *
 * Five required record roles exist between "the client said yes" and the
 * Factory being ready. One structural role is supplied by exactly one of two
 * records. The vocabularies make the
 * done-for-you workflow checkable rather than remembered.
 *
 * This file is deliberately in `scripts/` rather than in `packages/contracts`.
 * The contracts package's `dist` is vendored wholesale into every generated
 * client artifact, so a module added there ships to every website whether or
 * not anything imports it. Delivery-time tooling has no business inside a
 * client's site. It also carries no dependency for the same reason
 * `scripts/creative/` carries none: hand-rolled checks against a closed
 * vocabulary, exercised by `node --test`.
 *
 * Nothing here reads the filesystem, spawns a process or touches the network.
 * Every check is a pure function of a value the caller already holds — which is
 * also why the business read is a *frozen* record rather than a live lookup.
 */

/**
 * Every refusal this layer can produce.
 *
 * A closed vocabulary, for the same reason the premium bridge keeps one: the
 * negative tests assert on codes, and a failure mode that cannot be named
 * cannot be introduced.
 */
export const REFUSALS = Object.freeze({
  CONTRACT_INVALID: "A delivery record is missing a required field or carries the wrong type.",
  RECORD_KIND_UNKNOWN: "No validator exists for that record kind.",
  IDENTITY_MISMATCH: "Two delivery records name different clients.",
  MEDIA_CLAIM_UNSUPPORTED: "An asset is asked to substantiate a claim its provenance cannot carry.",
  MEDIA_SOURCE_MISSING: "An enhanced or recomposed asset does not name the real asset it came from.",
  MEDIA_LANE_MISMATCH: "An asset's production lane and its provenance class contradict each other.",
  APPROVAL_NOT_HUMAN: "A publication or direction approval names a non-human decider.",
  RESEARCH_AS_CLIENT_FACT: "A researched observation is being published as something the client stated.",
  MEDIA_REALITY_CONTRADICTED: "The creative configuration asks for media the intake does not have.",
});

export class TradiesRefusal extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "TradiesRefusal";
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

export function refuse(code, message, detail = {}) {
  if (!Object.hasOwn(REFUSALS, code)) {
    throw new TypeError(`Unknown Tradies refusal code "${code}".`);
  }
  return new TradiesRefusal(code, message, detail);
}

/* ------------------------------------------------------------------------ */
/* Vocabularies                                                              */
/* ------------------------------------------------------------------------ */

/**
 * The trades this profile covers.
 *
 * A closed list rather than free text, because the shot-gap derivation and the
 * readiness report both branch on it, and because "which businesses is this
 * profile for" is a commercial decision that should be visible in one place.
 * `OTHER_TRADE` is the honest escape hatch for a local service business whose
 * customer journey genuinely fits — a business whose journey does not fit
 * belongs in a different profile, not in this list.
 */
export const TRADES = Object.freeze([
  "ELECTRICAL",
  "PLUMBING",
  "ROOFING",
  "BUILDING",
  "LANDSCAPING",
  "PAINTING",
  "CLEANING",
  "AUTOMOTIVE",
  "HVAC",
  "CARPENTRY",
  "CONCRETING",
  "FENCING",
  "OTHER_TRADE",
]);

export const DELIVERY_TIERS = Object.freeze(["P1", "P2", "P3"]);

/**
 * How a fact reaching the website came to be known.
 *
 * The distinction that matters commercially is the middle one. A client saying
 * "fully licensed and insured" is not the same act as showing the certificate,
 * and a website that prints the two identically has quietly converted a claim
 * into a representation the agency made.
 */
export const TRUTH_CLASSES = Object.freeze([
  "VERIFIED_CLIENT_FACT",
  "CLIENT_CLAIM",
  "VERIFIED_PUBLIC_FACT",
  "INFERRED_OPPORTUNITY",
  "PROPOSED_PITCH_ARCHITECTURE",
  "UNKNOWN",
  "NOT_APPLICABLE",
]);

/**
 * Which truth classes may be printed as a statement of fact.
 *
 * `CLIENT_CLAIM` is publishable only in wording the client approved, which is
 * why credentials carry `approvedWording` rather than being printed from the
 * intake string. `INFERRED_OPPORTUNITY` is the agency's judgement and is never
 * publishable — it is an input to the creative direction, not to the copy.
 */
export const PUBLISHABLE_AS_FACT = Object.freeze([
  "VERIFIED_CLIENT_FACT",
  "VERIFIED_PUBLIC_FACT",
]);

const PROHIBITED_PITCH_CLAIM_TEXT = Object.freeze([
  /\b(?:licen[cs](?:e|ed)|registered electrical contractor|(?:electrical )?registration\s*(?:number|no\.?|#)?\s*\d+|REC\s*(?:number|no\.?|#)?\s*\d+|insured|insurance(?:\s+cover(?:ed)?)?|public liability(?:\s+(?:insurance|cover(?:age|ed)?))?)\b/i,
  /\b(?:testimonials?|customer reviews?|client reviews?|reviews? from (?:our )?customers?|five[- ]star|[1-5](?:\.\d+)?[- ]star|rated (?:[1-5](?:\.\d+)?|five) stars?|customers? (?:say|said))\b/i,
  /\b(?:(?:we|our (?:team|business|company)|the (?:team|business|company)) (?:have |has )?(?:completed|delivered|installed|repaired|built)|(?:recent|past|completed) (?:jobs?|projects?|work|installations?|repairs?))\b/i,
]);

function stringsWithin(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsWithin);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(stringsWithin);
  return [];
}

function carriesProhibitedPitchClaim(value) {
  return stringsWithin(value).some((item) => {
    const withoutExplicitDisclaimers = item
      .replace(/\b(?:a|the|this|it is a) licen[cs]ed trade we do not hold\b/gi, "")
      .replace(/\bno (?:licen[cs]e|registration|insurance|credential|completed[- ]work|testimonial) claim(?: is included| is made)?\b/gi, "")
      .replace(/\b(?:not|never) (?:licen[cs]ed|insured)\b/gi, "");
    return PROHIBITED_PITCH_CLAIM_TEXT.some((pattern) => pattern.test(withoutExplicitDisclaimers));
  });
}

export function assertPitchCopySafe(value) {
  if (carriesProhibitedPitchClaim(value)) {
    throw refuse("CONTRACT_INVALID", "Private-pitch copy contains credential, testimonial, or completed-work claim language; omit it until supported by factual authority.");
  }
}

export const RESEARCH_SOURCE_KINDS = Object.freeze([
  "EXISTING_WEBSITE",
  "GOOGLE_BUSINESS",
  "SOCIAL",
  "REVIEW_PLATFORM",
  "DIRECTORY",
  "CLIENT_DOCUMENT",
  "COMPETITOR",
]);

export const BRAND_REALITY = Object.freeze([
  "STRONG_EXISTING",
  "PARTIAL",
  "MINIMAL",
  "NONE",
]);

export const TRUST_STRATEGIES = Object.freeze([
  "CREDENTIALS_LED",
  "WORK_EVIDENCE_LED",
  "RELATIONSHIP_LED",
  "SCALE_LED",
]);

/** What a raw asset is *of*. Recorded before anyone judges whether it is good. */
export const MEDIA_SUBJECTS = Object.freeze([
  "COMPLETED_WORK",
  "WORK_IN_PROGRESS",
  "BEFORE_STATE",
  "TEAM",
  "VEHICLE",
  "EQUIPMENT",
  "PREMISES",
  "MATERIAL_DETAIL",
  "SIGNAGE",
  "LOGO",
  "DOCUMENT",
  "OTHER",
]);

/**
 * The agency's judgement of what an asset is worth. Never shown to the client,
 * and deliberately independent of provenance: a weak real photograph can be
 * high-value proof, and an extraordinary generated image can be worth nothing
 * as proof.
 */
export const AUDIT_CLASSES = Object.freeze([
  "PROOF_GRADE",
  "SALES_GRADE",
  "RECOVERY_GRADE",
  "REFERENCE_ONLY",
]);

/** Where an asset came from. Governs what it is allowed to substantiate. */
export const PROVENANCE_CLASSES = Object.freeze([
  "CLIENT_JOB_PHOTOGRAPH",
  "CLIENT_PREMISES_OR_TEAM",
  "COMMISSIONED_PHOTOGRAPH",
  "ENHANCED_CLIENT_ASSET",
  "RECOMPOSED_CLIENT_ASSET",
  "GENERATED_SUPPORTING_MEDIA",
  "STOCK_OR_REFERENCE",
]);

/**
 * The production lanes, chosen per gap and recorded.
 *
 * Five rather than four: "enhanced" splits into correction and material
 * recomposition, because that is exactly the line at which an asset stops being
 * able to carry a claim about a specific job. Cropping and re-lighting a real
 * courtyard leaves it that courtyard; extending the frame and inventing the
 * fence does not.
 */
export const PRODUCTION_LANES = Object.freeze([
  "SUPPLIED",
  "COMMISSIONED",
  "AI_ENHANCED",
  "AI_RECOMPOSED",
  "AI_GENERATED_SUPPORTING",
]);

/** What kind of claim an asset is being asked to stand behind. */
export const CLAIM_KINDS = Object.freeze([
  "SPECIFIC_JOB",
  "BUSINESS_ITSELF",
  "ATMOSPHERE",
  "NONE",
]);

/**
 * The invariant that makes the provenance vocabulary load-bearing rather than
 * decorative: **an asset may not substantiate a claim its provenance cannot
 * carry.**
 *
 * A generated image beside the words "our recent work in Sunbury" is the
 * failure this table prevents, and it is a buyer-trust problem before it is a
 * legal one — a reader who suspects one photograph stops believing the rest.
 *
 * `ENHANCED_CLIENT_ASSET` inherits its source's capability rather than
 * declaring its own, which is why it must name a source asset.
 */
export const PROVENANCE_CLAIM_CAPABILITY = Object.freeze({
  CLIENT_JOB_PHOTOGRAPH: Object.freeze(["SPECIFIC_JOB", "BUSINESS_ITSELF", "ATMOSPHERE", "NONE"]),
  CLIENT_PREMISES_OR_TEAM: Object.freeze(["BUSINESS_ITSELF", "ATMOSPHERE", "NONE"]),
  COMMISSIONED_PHOTOGRAPH: Object.freeze(["SPECIFIC_JOB", "BUSINESS_ITSELF", "ATMOSPHERE", "NONE"]),
  ENHANCED_CLIENT_ASSET: Object.freeze(["SPECIFIC_JOB", "BUSINESS_ITSELF", "ATMOSPHERE", "NONE"]),
  RECOMPOSED_CLIENT_ASSET: Object.freeze(["ATMOSPHERE", "NONE"]),
  GENERATED_SUPPORTING_MEDIA: Object.freeze(["NONE"]),
  STOCK_OR_REFERENCE: Object.freeze(["NONE"]),
});

/** Which provenance classes each lane can legitimately produce. */
export const LANE_PROVENANCE = Object.freeze({
  SUPPLIED: Object.freeze(["CLIENT_JOB_PHOTOGRAPH", "CLIENT_PREMISES_OR_TEAM", "STOCK_OR_REFERENCE"]),
  COMMISSIONED: Object.freeze(["COMMISSIONED_PHOTOGRAPH"]),
  AI_ENHANCED: Object.freeze(["ENHANCED_CLIENT_ASSET"]),
  AI_RECOMPOSED: Object.freeze(["RECOMPOSED_CLIENT_ASSET"]),
  AI_GENERATED_SUPPORTING: Object.freeze(["GENERATED_SUPPORTING_MEDIA"]),
});

/** Lanes whose output is derived from a real asset and must name it. */
export const DERIVED_LANES = Object.freeze(["AI_ENHANCED", "AI_RECOMPOSED"]);

export const MOTION_APPETITES = Object.freeze([
  "STILL",
  "MICRO",
  "ENTRANCE",
  "CHOREOGRAPHED",
]);

export const IMAGE_TREATMENTS = Object.freeze(["RESTRAINED", "BALANCED", "DOMINANT"]);

export const DENSITIES = Object.freeze(["COMPACT", "MEASURED", "EXPANSIVE"]);

/**
 * Typographic character, named the way the starter brief names it, so the
 * creative configuration and the generation brief cannot disagree about what
 * was decided.
 */
export const TYPE_FAMILIES = Object.freeze([
  "HUMANIST_SANS",
  "GEOMETRIC_SANS",
  "GROTESQUE_SANS",
  "TRANSITIONAL_SERIF",
  "MODERN_SERIF",
]);

/** The page ground — the one colour decision the brand contract does not carry. */
export const GROUNDS = Object.freeze([
  "WARM_PAPER",
  "COOL_STONE",
  "MINERAL_CLAY",
  "NEUTRAL_LIGHT",
  "DEEP_INK",
]);

export const PROOF_EMPHASES = Object.freeze(["CREDENTIALS", "WORK", "BOTH"]);

/**
 * Names that are not a person.
 *
 * Reused from the premium bridge's rule that an agent cannot sign its own work.
 * The same rule applies to approving a photograph for publication and to
 * approving a creative direction: both are representations made on a real
 * business's behalf.
 */
export const NON_HUMAN_DECIDERS = Object.freeze([
  "agent",
  "ai",
  "assistant",
  "automation",
  "bot",
  "claude",
  "codex",
  "copilot",
  "gpt",
  "llm",
  "model",
  "system",
]);

export function isNonHumanDecider(name) {
  if (typeof name !== "string") return true;
  const normalised = name.trim().toLowerCase();
  if (normalised === "") return true;
  return NON_HUMAN_DECIDERS.some(
    (token) => normalised === token || normalised.split(/[^a-z0-9]+/).includes(token),
  );
}

export const IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]*$/;
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------------ */
/* The checking primitives                                                   */
/* ------------------------------------------------------------------------ */

function checker(record, problems) {
  const value = (path) =>
    path
      .split(".")
      .reduce(
        (current, key) =>
          current === null || current === undefined ? undefined : current[key],
        record,
      );
  const api = {
    value,
    constant(path, expected) {
      if (value(path) !== expected) {
        problems.push(`${path} must be ${JSON.stringify(expected)}.`);
      }
    },
    text(path) {
      const found = value(path);
      if (typeof found !== "string" || found.trim() === "") {
        problems.push(`${path} must be a non-empty string.`);
      }
    },
    optionalText(path) {
      const found = value(path);
      if (found === undefined || found === null) return;
      if (typeof found !== "string" || found.trim() === "") {
        problems.push(`${path} must be a non-empty string when present.`);
      }
    },
    identifier(path) {
      const found = value(path);
      if (typeof found !== "string" || !IDENTIFIER_PATTERN.test(found)) {
        problems.push(`${path} must be a lowercase kebab-case identifier.`);
      }
    },
    date(path) {
      const found = value(path);
      if (typeof found !== "string" || !ISO_DATE_PATTERN.test(found)) {
        problems.push(`${path} must be an ISO date (YYYY-MM-DD).`);
      }
    },
    oneOf(path, values) {
      if (!values.includes(value(path))) {
        problems.push(`${path} must be one of ${values.join(", ")}.`);
      }
    },
    boolean(path) {
      if (typeof value(path) !== "boolean") {
        problems.push(`${path} must be a boolean.`);
      }
    },
    integer(path, minimum = 0) {
      const found = value(path);
      if (!Number.isSafeInteger(found) || found < minimum) {
        problems.push(`${path} must be an integer >= ${minimum}.`);
      }
    },
    /**
     * An array that must be present, and may be empty.
     *
     * Required-but-emptyable is the shape most of these records need: an empty
     * `commitments` is a positive statement that nothing extra was promised
     * during the sale, and it is only a statement if the field had to be there.
     */
    listPresent(path) {
      const found = value(path);
      if (!Array.isArray(found)) {
        problems.push(`${path} must be an array (empty is an answer; missing is not).`);
        return [];
      }
      return found;
    },
    list(path, minimum = 1) {
      const found = value(path);
      if (!Array.isArray(found) || found.length < minimum) {
        problems.push(`${path} must be an array of at least ${minimum} item(s).`);
        return [];
      }
      return found;
    },
    textList(path, minimum = 0) {
      const found = minimum === 0 ? api.listPresent(path) : api.list(path, minimum);
      for (const [index, item] of found.entries()) {
        if (typeof item !== "string" || item.trim() === "") {
          problems.push(`${path}[${index}] must be a non-empty string.`);
        }
      }
      return found;
    },
    humanApprover(path) {
      const found = value(path);
      if (typeof found !== "string" || found.trim() === "") {
        problems.push(`${path} must name the person who decided.`);
        return;
      }
      if (isNonHumanDecider(found)) {
        problems.push(
          `${path} names "${found}", which is not a person. An agent cannot approve a representation made on a business's behalf.`,
        );
      }
    },
  };
  return api;
}

function uniqueIdentifiers(items, key, label, problems) {
  const seen = new Set();
  for (const [index, item] of items.entries()) {
    const id = item?.[key];
    if (typeof id !== "string" || !IDENTIFIER_PATTERN.test(id)) {
      problems.push(`${label}[${index}].${key} must be a lowercase kebab-case identifier.`);
      continue;
    }
    if (seen.has(id)) problems.push(`${label}[${index}].${key} "${id}" is duplicated.`);
    seen.add(id);
  }
  return seen;
}

/* ------------------------------------------------------------------------ */
/* The validators                                                            */
/* ------------------------------------------------------------------------ */

const VALIDATORS = new Map();

export function validateRecord(kind, record) {
  const validator = VALIDATORS.get(kind);
  if (validator === undefined) {
    throw refuse("RECORD_KIND_UNKNOWN", `No Tradies contract validator for "${kind}".`, { kind });
  }
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return [`${kind} must be an object.`];
  }
  return validator(record);
}

export function assertRecord(kind, record) {
  const problems = validateRecord(kind, record);
  if (problems.length > 0) {
    throw refuse("CONTRACT_INVALID", `${kind} is invalid:\n  ${problems.join("\n  ")}`, {
      kind,
      problems,
    });
  }
  return record;
}

/**
 * The closed sale, expressed as the smallest thing delivery needs from it.
 *
 * This exists because of one failure mode: a commitment made in a sales
 * conversation and remembered by nobody at build time. `commitments` and
 * `exclusions` are required arrays, so "nothing extra was promised" has to be
 * stated rather than assumed.
 */
VALIDATORS.set("sale-handoff", (record) => {
  const problems = [];
  const check = checker(record, problems);
  check.constant("schemaVersion", 1);
  check.constant("kind", "SALE_HANDOFF");
  check.identifier("clientId");
  check.text("businessName");
  check.oneOf("trade", TRADES);
  check.oneOf("tier", DELIVERY_TIERS);
  check.date("soldOn");
  check.text("soldBy");
  check.text("approvalAuthority.name");
  check.text("approvalAuthority.role");
  check.text("approvalAuthority.email");

  const contacts = check.list("contacts", 1);
  for (const [index, contact] of contacts.entries()) {
    if (contact === null || typeof contact !== "object") {
      problems.push(`contacts[${index}] must be an object.`);
      continue;
    }
    if (typeof contact.name !== "string" || contact.name.trim() === "") {
      problems.push(`contacts[${index}].name must be a non-empty string.`);
    }
    if (typeof contact.role !== "string" || contact.role.trim() === "") {
      problems.push(`contacts[${index}].role must be a non-empty string.`);
    }
  }

  check.textList("includedPages", 1);
  check.textList("includedCapabilities");
  check.textList("exclusions");
  check.textList("commitments");

  const deadline = check.value("deadline");
  if (deadline !== null && (typeof deadline !== "string" || !ISO_DATE_PATTERN.test(deadline))) {
    problems.push("deadline must be an ISO date or null.");
  }
  const currentSite = check.value("currentSite");
  if (currentSite !== null && (typeof currentSite !== "string" || currentSite.trim() === "")) {
    problems.push("currentSite must be a URL or null.");
  }
  check.text("domain.name");
  check.oneOf("domain.controlledBy", ["CLIENT", "AGENCY", "UNKNOWN"]);
  return problems;
});

/**
 * What the agency found before asking the client for anything.
 *
 * Frozen rather than live: the Factory never performs a lookup, so what was
 * observed and when is a recorded fact rather than whatever a search returns on
 * build day. Every observation must name a source that exists in the same
 * record, and must declare whether it is something anyone can verify or
 * something the agency inferred.
 */
VALIDATORS.set("business-read", (record) => {
  const problems = [];
  const check = checker(record, problems);
  check.constant("schemaVersion", 1);
  check.constant("kind", "BUSINESS_READ");
  check.identifier("clientId");
  check.date("readOn");
  check.text("readBy");
  check.oneOf("brandReality", BRAND_REALITY);
  check.oneOf("trustStrategy", TRUST_STRATEGIES);

  const sources = check.listPresent("sources");
  const sourceIds = uniqueIdentifiers(sources, "sourceId", "sources", problems);
  for (const [index, source] of sources.entries()) {
    if (source === null || typeof source !== "object") continue;
    if (!RESEARCH_SOURCE_KINDS.includes(source.kind)) {
      problems.push(`sources[${index}].kind must be one of ${RESEARCH_SOURCE_KINDS.join(", ")}.`);
    }
    if (typeof source.reference !== "string" || source.reference.trim() === "") {
      problems.push(`sources[${index}].reference must be a non-empty string.`);
    }
    if (typeof source.observedOn !== "string" || !ISO_DATE_PATTERN.test(source.observedOn)) {
      problems.push(`sources[${index}].observedOn must be an ISO date.`);
    }
  }

  const observations = check.listPresent("observations");
  uniqueIdentifiers(observations, "observationId", "observations", problems);
  for (const [index, observation] of observations.entries()) {
    if (observation === null || typeof observation !== "object") continue;
    if (!sourceIds.has(observation.sourceId)) {
      problems.push(
        `observations[${index}].sourceId "${observation.sourceId}" is not a declared source.`,
      );
    }
    if (typeof observation.statement !== "string" || observation.statement.trim() === "") {
      problems.push(`observations[${index}].statement must be a non-empty string.`);
    }
    if (!["VERIFIED_PUBLIC_FACT", "INFERRED_OPPORTUNITY"].includes(observation.classification)) {
      problems.push(
        `observations[${index}].classification must be VERIFIED_PUBLIC_FACT or INFERRED_OPPORTUNITY. Research is never a client fact.`,
      );
    }
  }

  check.textList("positioning.desiredPerception", 1);
  check.textList("positioning.antiPerception", 1);
  check.text("positioning.targetCustomer");
  check.textList("positioning.desiredJobs", 1);
  check.textList("positioning.avoidedJobs");
  check.listPresent("competitors");
  return problems;
});

/**
 * The client's own answers. The only place a client fact may originate.
 *
 * Everything here is something a tradesperson can answer without knowing
 * anything about design. There is no colour question, no layout question and
 * no "which of these photographs is best" — those are agency work, and asking
 * for them is the failure this whole contract is shaped to avoid.
 */
VALIDATORS.set("client-intake", (record) => {
  const problems = [];
  const check = checker(record, problems);
  check.constant("schemaVersion", 1);
  check.constant("kind", "CLIENT_INTAKE");
  check.identifier("clientId");
  check.date("collectedOn");
  check.text("businessName");
  check.text("story");
  check.optionalText("tagline");

  const services = check.list("services", 1);
  const serviceIds = uniqueIdentifiers(services, "serviceId", "services", problems);
  for (const [index, service] of services.entries()) {
    if (service === null || typeof service !== "object") {
      problems.push(`services[${index}] must be an object.`);
      continue;
    }
    const at = `services[${index}]`;
    if (typeof service.title !== "string" || service.title.trim() === "") {
      problems.push(`${at}.title must be a non-empty string.`);
    }
    if (typeof service.summary !== "string" || service.summary.trim() === "") {
      problems.push(`${at}.summary must be a non-empty string.`);
    }
    for (const field of ["covers", "excludes", "suitedTo", "whenToCall", "customerProvides"]) {
      if (!Array.isArray(service[field])) {
        problems.push(`${at}.${field} must be an array (empty is an answer; missing is not).`);
      } else {
        for (const [itemIndex, item] of service[field].entries()) {
          if (typeof item !== "string" || item.trim() === "") {
            problems.push(`${at}.${field}[${itemIndex}] must be a non-empty string.`);
          }
        }
      }
    }
    for (const [stageIndex, stage] of (service.stages ?? []).entries()) {
      if (stage === null || typeof stage !== "object" || typeof stage.title !== "string" || typeof stage.description !== "string") {
        problems.push(`${at}.stages[${stageIndex}] must be { title, description }.`);
      }
    }
    for (const [factIndex, fact] of (service.commercial ?? []).entries()) {
      if (fact === null || typeof fact !== "object" || typeof fact.label !== "string" || typeof fact.value !== "string") {
        problems.push(`${at}.commercial[${factIndex}] must be { label, value, qualifier? }.`);
      }
    }
    for (const [questionIndex, question] of (service.questions ?? []).entries()) {
      if (question === null || typeof question !== "object" || typeof question.question !== "string" || typeof question.answer !== "string") {
        problems.push(`${at}.questions[${questionIndex}] must be { question, answer }.`);
      }
    }
    if (service.narrative !== undefined && (typeof service.narrative !== "string" || service.narrative.trim() === "")) {
      problems.push(`${at}.narrative must be a non-empty string when present.`);
    }
    if (service.featured !== undefined && typeof service.featured !== "boolean") {
      problems.push(`${at}.featured must be a boolean when present.`);
    }
    if (service.groupId !== undefined && !IDENTIFIER_PATTERN.test(String(service.groupId))) {
      problems.push(`${at}.groupId must be a lowercase kebab-case identifier.`);
    }
  }

  const groups = check.listPresent("serviceGroups");
  const groupIds = uniqueIdentifiers(groups, "groupId", "serviceGroups", problems);
  for (const [index, group] of groups.entries()) {
    if (group === null || typeof group !== "object") continue;
    if (typeof group.title !== "string" || group.title.trim() === "") {
      problems.push(`serviceGroups[${index}].title must be a non-empty string.`);
    }
  }
  for (const [index, service] of services.entries()) {
    if (service?.groupId === undefined) continue;
    if (!groupIds.has(service.groupId)) {
      problems.push(
        `services[${index}].groupId "${service.groupId}" is not a declared service group.`,
      );
    }
  }

  check.textList("serviceAreas", 1);
  check.listPresent("process");

  /*
   * Credentials are the sharpest edge in a trade website. A licence number
   * printed from an intake string is a representation the agency made; the same
   * number in wording the client approved is a representation the client made.
   * `evidence` records which of those two happened, and `approvedWording` is
   * what may actually be printed.
   */
  const credentials = check.listPresent("credentials");
  for (const [index, credential] of credentials.entries()) {
    if (credential === null || typeof credential !== "object") {
      problems.push(`credentials[${index}] must be an object.`);
      continue;
    }
    const at = `credentials[${index}]`;
    if (typeof credential.label !== "string" || credential.label.trim() === "") {
      problems.push(`${at}.label must be a non-empty string.`);
    }
    if (!["SIGHTED", "STATED"].includes(credential.evidence)) {
      problems.push(`${at}.evidence must be SIGHTED or STATED.`);
    }
    if (typeof credential.approvedWording !== "string" || credential.approvedWording.trim() === "") {
      problems.push(`${at}.approvedWording must be the exact wording the client approved.`);
    }
  }

  const projects = check.listPresent("projects");
  const projectIds = uniqueIdentifiers(projects, "projectId", "projects", problems);
  for (const [index, project] of projects.entries()) {
    if (project === null || typeof project !== "object") continue;
    const at = `projects[${index}]`;
    if (typeof project.title !== "string" || project.title.trim() === "") {
      problems.push(`${at}.title must be a non-empty string.`);
    }
    if (!Array.isArray(project.serviceIds) || project.serviceIds.length === 0) {
      problems.push(`${at}.serviceIds must name at least one service.`);
    } else {
      for (const [refIndex, serviceId] of project.serviceIds.entries()) {
        if (!serviceIds.has(serviceId)) {
          problems.push(`${at}.serviceIds[${refIndex}] "${serviceId}" is not a declared service.`);
        }
      }
    }
    if (project.completedYear !== undefined && !Number.isSafeInteger(project.completedYear)) {
      problems.push(`${at}.completedYear must be an integer year when present.`);
    }
    if (typeof project.summary !== "string" || project.summary.trim() === "") {
      problems.push(`${at}.summary must be the client's own one-paragraph account of the job.`);
    }
    if (project.featured !== undefined && typeof project.featured !== "boolean") {
      problems.push(`${at}.featured must be a boolean when present.`);
    }
    for (const field of ["brief", "approach", "outcome", "locationLabel", "slug"]) {
      if (project[field] === undefined) continue;
      if (typeof project[field] !== "string" || project[field].trim() === "") {
        problems.push(`${at}.${field} must be a non-empty string when present.`);
      }
    }
    for (const [factIndex, fact] of (project.facts ?? []).entries()) {
      if (fact === null || typeof fact !== "object" || typeof fact.label !== "string" || typeof fact.value !== "string") {
        problems.push(`${at}.facts[${factIndex}] must be { label, value }.`);
      }
    }
  }
  void projectIds;

  check.listPresent("faqs");
  check.listPresent("commercial");
  check.text("contact.enquiryEmail");
  /*
   * A phone number is optional, and when present must be in international form.
   * A trade site whose "call us" link does not dial is the most expensive silent
   * defect in this category, so the shape is checked here rather than hoped for.
   */
  const phone = check.value("contact.phone");
  if (phone !== undefined && (typeof phone !== "string" || !/^\+[1-9][0-9]{7,14}$/.test(phone))) {
    problems.push("contact.phone must be an international number such as +61390000000, or be absent.");
  }
  check.oneOf("contact.quoteModel", [
    "SITE_VISIT_THEN_QUOTE",
    "PHONE_ESTIMATE",
    "FIXED_PRICE_LIST",
    "HOURLY_RATE",
    "OTHER",
  ]);
  check.boolean("contact.emergencyAvailable");
  check.listPresent("team");
  return problems;
});

/**
 * Agency-authored structure for a private nonproduction sales concept.
 *
 * This is deliberately NOT client-intake. Nothing in this record becomes a
 * VERIFIED_CLIENT_FACT merely by existing. It may shape a private pitch, but it
 * cannot carry credentials, completed jobs, testimonials or Production authority.
 */
VALIDATORS.set("pitch-architecture", (record) => {
  const problems = [];
  const check = checker(record, problems);
  check.constant("schemaVersion", 1);
  check.constant("kind", "PITCH_ARCHITECTURE");
  check.identifier("clientId");
  check.constant("mode", "NONPRODUCTION_PITCH");
  check.date("proposedOn");
  check.text("proposedBy");
  check.text("businessName");
  check.text("story");

  const services = check.list("services", 1);
  uniqueIdentifiers(services, "serviceId", "services", problems);
  for (const [index, service] of services.entries()) {
    if (service === null || typeof service !== "object") {
      problems.push(`services[${index}] must be an object.`);
      continue;
    }
    const at = `services[${index}]`;
    if (typeof service.title !== "string" || service.title.trim() === "") problems.push(`${at}.title must be a non-empty string.`);
    if (typeof service.summary !== "string" || service.summary.trim() === "") problems.push(`${at}.summary must be a non-empty string.`);
    for (const field of ["covers", "excludes", "suitedTo", "whenToCall", "customerProvides"]) {
      if (!Array.isArray(service[field])) problems.push(`${at}.${field} must be an array.`);
      else for (const [itemIndex, item] of service[field].entries()) {
        if (typeof item !== "string" || item.trim() === "") problems.push(`${at}.${field}[${itemIndex}] must be non-empty text.`);
      }
    }
  }
  const groups = check.listPresent("serviceGroups");
  const groupIds = uniqueIdentifiers(groups, "groupId", "serviceGroups", problems);
  for (const [index, group] of groups.entries()) {
    if (group === null || typeof group !== "object") continue;
    if (typeof group.title !== "string" || group.title.trim() === "") {
      problems.push(`serviceGroups[${index}].title must be a non-empty string.`);
    }
  }
  for (const [index, service] of services.entries()) {
    if (service?.groupId === undefined) continue;
    if (!groupIds.has(service.groupId)) {
      problems.push(`services[${index}].groupId "${service.groupId}" is not a declared service group.`);
    }
  }
  check.textList("serviceAreas", 1);
  check.listPresent("process");
  const credentials = check.listPresent("credentials");
  if (credentials.length !== 0) problems.push("credentials must be empty in NONPRODUCTION_PITCH authority.");
  const projects = check.listPresent("projects");
  if (projects.length !== 0) problems.push("projects must be empty; a pitch may not invent completed work.");
  const testimonials = check.value("testimonials");
  if (testimonials !== undefined && (!Array.isArray(testimonials) || testimonials.length !== 0)) {
    problems.push("testimonials must be absent or empty; a pitch may not invent customer testimony.");
  }
  const completedJobs = check.value("completedJobs");
  if (completedJobs !== undefined && (!Array.isArray(completedJobs) || completedJobs.length !== 0)) {
    problems.push("completedJobs must be absent or empty; a pitch may not invent completed work.");
  }
  if (check.value("clientApproval") !== undefined) problems.push("clientApproval must be absent; pitch architecture cannot carry owner approval.");
  if (check.value("ownerApproval") !== undefined) problems.push("ownerApproval must be absent; pitch architecture cannot carry owner approval.");
  if (carriesProhibitedPitchClaim([record.businessName, record.tagline, record.story, record.serviceGroups, record.services, record.process, record.faqs, record.commercial])) {
    problems.push("pitch architecture contains credential, testimonial, or completed-work claim language; omit it until supported by factual authority.");
  }
  check.listPresent("faqs");
  check.listPresent("commercial");
  check.text("contact.enquiryEmail");
  check.constant("contact.ownership", "PROPORTION_CONTROLLED");
  const enquiryEmail = check.value("contact.enquiryEmail");
  if (typeof enquiryEmail === "string" && !/^[^@\s]+@proportion\.systems$/i.test(enquiryEmail)) {
    problems.push("contact.enquiryEmail must be a Proportion-controlled @proportion.systems address in NONPRODUCTION_PITCH mode.");
  }
  const phone = check.value("contact.phone");
  if (phone !== undefined && (typeof phone !== "string" || !/^\+[1-9][0-9]{7,14}$/.test(phone))) {
    problems.push("contact.phone must be international E.164-like text, or absent.");
  }
  check.oneOf("contact.quoteModel", ["SITE_VISIT_THEN_QUOTE", "PHONE_ESTIMATE", "FIXED_PRICE_LIST", "HOURLY_RATE", "OTHER"]);
  check.boolean("contact.emergencyAvailable");
  check.textList("sourceRefs", 1);
  check.constant("claimPolicy.authority", "PROPOSED_PITCH_ARCHITECTURE");
  check.constant("claimPolicy.publication", "PRIVATE_PITCH_ONLY");
  check.constant("claimPolicy.clientPreviewAcceptanceRequired", true);
  const prohibited = check.textList("claimPolicy.prohibitedClaims", 1);
  for (const required of ["LICENCE_OR_REGISTRATION", "INSURANCE", "UNVERIFIED_COMPLETED_PROJECT", "UNVERIFIED_TESTIMONIAL"]) {
    if (!prohibited.includes(required)) problems.push(`claimPolicy.prohibitedClaims must include ${required}.`);
  }
  return problems;
});

/**
 * Every asset the client sent, with the agency's judgement of each.
 *
 * The client is asked for volume and honesty, never curation. Which means this
 * record's job is to hold assets nobody would publish alongside assets that
 * carry the whole site, and to keep aesthetic grade and provenance as two
 * independent facts — because the failure they prevent is different in each
 * direction.
 */
VALIDATORS.set("media-inventory", (record) => {
  const problems = [];
  const check = checker(record, problems);
  check.constant("schemaVersion", 1);
  check.constant("kind", "MEDIA_INVENTORY");
  check.identifier("clientId");
  check.date("receivedOn");

  const assets = check.listPresent("assets");
  const assetIds = new Set();
  for (const [index, asset] of assets.entries()) {
    const at = `assets[${index}]`;
    if (asset === null || typeof asset !== "object") {
      problems.push(`${at} must be an object.`);
      continue;
    }
    if (typeof asset.assetId !== "string" || !/^[a-z0-9][a-z0-9._/-]*$/.test(asset.assetId)) {
      problems.push(`${at}.assetId must be a lowercase asset identifier.`);
    } else if (assetIds.has(asset.assetId)) {
      problems.push(`${at}.assetId "${asset.assetId}" is duplicated.`);
    } else {
      assetIds.add(asset.assetId);
    }
    if (typeof asset.sourcePath !== "string" || asset.sourcePath.trim() === "") {
      problems.push(`${at}.sourcePath must be a non-empty string.`);
    }
    if (!MEDIA_SUBJECTS.includes(asset.subject)) {
      problems.push(`${at}.subject must be one of ${MEDIA_SUBJECTS.join(", ")}.`);
    }
    if (!AUDIT_CLASSES.includes(asset.audit)) {
      problems.push(`${at}.audit must be one of ${AUDIT_CLASSES.join(", ")}.`);
    }
    if (!PROVENANCE_CLASSES.includes(asset.provenance)) {
      problems.push(`${at}.provenance must be one of ${PROVENANCE_CLASSES.join(", ")}.`);
    }
    if (!PRODUCTION_LANES.includes(asset.lane)) {
      problems.push(`${at}.lane must be one of ${PRODUCTION_LANES.join(", ")}.`);
    }
    if (!Number.isSafeInteger(asset.width) || asset.width <= 0) {
      problems.push(`${at}.width must be the asset's real pixel width.`);
    }
    if (!Number.isSafeInteger(asset.height) || asset.height <= 0) {
      problems.push(`${at}.height must be the asset's real pixel height.`);
    }
    const focal = asset.focalPoint;
    if (
      focal === null ||
      typeof focal !== "object" ||
      typeof focal.x !== "number" ||
      typeof focal.y !== "number" ||
      focal.x < 0 || focal.x > 1 || focal.y < 0 || focal.y > 1
    ) {
      problems.push(
        `${at}.focalPoint must be {x,y} in 0..1, decided by a person or a model and recorded — never guessed at render time.`,
      );
    }
    const claim = asset.substantiates;
    if (claim === null || typeof claim !== "object" || !CLAIM_KINDS.includes(claim.kind)) {
      problems.push(`${at}.substantiates.kind must be one of ${CLAIM_KINDS.join(", ")}.`);
    }
    if (typeof asset.approvedForPublication !== "boolean") {
      problems.push(`${at}.approvedForPublication must be a boolean.`);
    } else if (asset.approvedForPublication) {
      if (typeof asset.approvedBy !== "string" || asset.approvedBy.trim() === "") {
        problems.push(`${at}.approvedBy must name the person who approved publication.`);
      } else if (isNonHumanDecider(asset.approvedBy)) {
        problems.push(
          `${at}.approvedBy names "${asset.approvedBy}", which is not a person.`,
        );
      }
      /*
       * Alt text is written by whoever knows what the photograph shows, which
       * is the agency at audit time — not derived at render time from a
       * filename. A published asset without it is an accessibility defect that
       * reaches production silently.
       */
      if (typeof asset.alt !== "string" || asset.alt.trim() === "") {
        problems.push(`${at}.alt must describe what a published photograph shows.`);
      }
      if (typeof asset.mediaType !== "string" || !asset.mediaType.startsWith("image/")) {
        problems.push(`${at}.mediaType must be the asset's real image media type.`);
      }
    }
  }

  /* The three cross-field invariants, checked once every asset's shape is known. */
  for (const [index, asset] of assets.entries()) {
    const at = `assets[${index}]`;
    if (!PROVENANCE_CLASSES.includes(asset?.provenance)) continue;

    if (PRODUCTION_LANES.includes(asset.lane)) {
      const allowed = LANE_PROVENANCE[asset.lane];
      if (!allowed.includes(asset.provenance)) {
        problems.push(
          `${at}: lane ${asset.lane} cannot produce provenance ${asset.provenance}. Allowed: ${allowed.join(", ")}.`,
        );
      }
    }

    if (DERIVED_LANES.includes(asset.lane)) {
      if (typeof asset.sourceAssetId !== "string" || !assetIds.has(asset.sourceAssetId)) {
        problems.push(
          `${at}.sourceAssetId must name the real asset this was derived from, and that asset must be in this inventory.`,
        );
      } else if (asset.sourceAssetId === asset.assetId) {
        problems.push(`${at}.sourceAssetId cannot be the asset itself.`);
      }
    }

    const claimKind = asset.substantiates?.kind;
    if (!CLAIM_KINDS.includes(claimKind)) continue;
    const capability = PROVENANCE_CLAIM_CAPABILITY[asset.provenance];
    if (!capability.includes(claimKind)) {
      problems.push(
        `${at}: ${asset.provenance} may substantiate ${capability.join(", ")}, not ${claimKind}.`,
      );
    }
    if (claimKind === "SPECIFIC_JOB" && (typeof asset.substantiates.reference !== "string" || asset.substantiates.reference.trim() === "")) {
      problems.push(`${at}.substantiates.reference must name the job this asset stands behind.`);
    }
  }
  return problems;
});

/**
 * The creative direction, derived from positioning, audience and media reality,
 * and approved by the client as *representation* rather than as pixels.
 *
 * `clientApproval.scope` is a constant for exactly that reason: there is no
 * value it can hold that records a client having approved a layout, so the
 * record cannot be used to claim one did.
 */
VALIDATORS.set("creative-configuration", (record) => {
  const problems = [];
  const check = checker(record, problems);
  check.constant("schemaVersion", 1);
  check.constant("kind", "CREATIVE_CONFIGURATION");
  check.identifier("clientId");
  check.date("derivedOn");
  check.text("derivedBy");
  check.textList("perceptionTargets", 1);
  check.textList("antiTargets", 1);
  check.boolean("brandConstraints.hasExistingBrand");
  check.textList("brandConstraints.lockedColours");
  check.textList("brandConstraints.lockedTypefaces");
  check.text("palette.direction");
  /*
   * Real hexadecimal values, not a mood word. The profile's brand contract
   * measures contrast, so the palette has to be a thing that can be measured;
   * `direction` carries the reasoning beside it so the choice is reviewable.
   */
  for (const field of ["accentColor", "accentContrastColor", "surfaceColor", "textColor"]) {
    const found = check.value(`palette.${field}`);
    if (typeof found !== "string" || !/^#[0-9a-fA-F]{6}$/.test(found)) {
      problems.push(`palette.${field} must be a six-digit hex colour.`);
    }
  }
  check.text("typography.character");
  check.oneOf("typography.displayFamily", TYPE_FAMILIES);
  check.oneOf("typography.textFamily", TYPE_FAMILIES);
  check.oneOf("ground", GROUNDS);
  check.oneOf("density", DENSITIES);
  check.oneOf("imageTreatment", IMAGE_TREATMENTS);
  check.text("temperament");
  check.oneOf("motionAppetite", MOTION_APPETITES);
  check.oneOf("proofEmphasis", PROOF_EMPHASES);
  check.boolean("signatureOpportunity.present");
  if (check.value("signatureOpportunity.present") === true) {
    check.text("signatureOpportunity.material");
  }
  check.boolean("clientApproval.approved");
  check.constant("clientApproval.scope", "REPRESENTATION_AND_DIRECTION");
  if (check.value("clientApproval.approved") === true) {
    check.humanApprover("clientApproval.approvedBy");
    check.date("clientApproval.approvedOn");
  }
  const agencyPitchApproval = check.value("agencyPitchApproval");
  if (agencyPitchApproval !== undefined) {
    check.constant("agencyPitchApproval.approved", true);
    check.humanApprover("agencyPitchApproval.approvedBy");
    check.date("agencyPitchApproval.approvedOn");
    check.constant("agencyPitchApproval.scope", "PRIVATE_PITCH_DIRECTION");
  }
  return problems;
});

export const RECORD_KINDS = Object.freeze([...VALIDATORS.keys()].sort());

/** The filename each record is expected to occupy in a delivery workspace. */
export const RECORD_FILES = Object.freeze({
  "sale-handoff": "sale-handoff.json",
  "business-read": "business-read.json",
  "client-intake": "client-intake.json",
  "pitch-architecture": "pitch-architecture.json",
  "media-inventory": "media-inventory.json",
  "creative-configuration": "creative-configuration.json",
});

/** Refuses a set of records that do not all describe the same client. */
export function assertSameClient(records) {
  const ids = new Map();
  for (const [kind, record] of Object.entries(records)) {
    if (record === undefined || record === null) continue;
    ids.set(kind, record.clientId);
  }
  const distinct = new Set(ids.values());
  if (distinct.size > 1) {
    throw refuse(
      "IDENTITY_MISMATCH",
      `Delivery records name different clients: ${[...ids]
        .map(([kind, id]) => `${kind}=${id}`)
        .join(", ")}`,
      { ids: Object.fromEntries(ids) },
    );
  }
  return [...distinct][0];
}
