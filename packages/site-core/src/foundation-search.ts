import {
  translateZodIssues,
  type ValidationIssue,
  type ValidationResult,
} from "@melbourne-local-growth-ops/contracts";
import { z } from "zod";

import type {
  WebsiteProfileContent,
  WebsiteProfileSection,
} from "./profile-content.js";

const sectionId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/);
const scopedSectionIds = z
  .array(sectionId)
  .min(1)
  .max(64)
  .superRefine((ids, context) => {
    const seen = new Set<string>();
    for (const [index, id] of ids.entries()) {
      if (seen.has(id)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `Section ID "${id}" is duplicated.`,
        });
      }
      seen.add(id);
    }
  });

export const FoundationSearchConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  mode: z.enum(["OFF", "AUTO", "ON"]),
  includeSectionIds: scopedSectionIds.optional(),
});

export type FoundationSearchConfig = z.infer<
  typeof FoundationSearchConfigSchema
>;
export type FoundationSearchResolutionReason =
  | "DEFAULT_OFF"
  | "EXPLICIT_OFF"
  | "EXPLICIT_ON"
  | "AUTO_ENABLED"
  | "AUTO_BELOW_THRESHOLD";

export interface FoundationSearchRecord {
  readonly url: string;
  readonly content: string;
  readonly language: "en";
  readonly meta: Readonly<{
    title: string;
    businessName: string;
    sectionId: string;
    profile: string;
  }>;
  readonly filters: Readonly<{
    profile: readonly string[];
    sectionType: readonly string[];
  }>;
}

export interface FoundationSearchContext {
  readonly businessName: string;
  readonly profile: WebsiteProfileContent;
}

export interface ResolvedFoundationSearch {
  readonly schemaVersion: 1;
  readonly mode: FoundationSearchConfig["mode"];
  readonly enabled: boolean;
  readonly reason: FoundationSearchResolutionReason;
  readonly records: readonly FoundationSearchRecord[];
}

export const FOUNDATION_SEARCH_AUTO_MIN_SECTION_COUNT = 8;
export const FOUNDATION_SEARCH_AUTO_MIN_CHARACTERS = 2_500;

export function validateFoundationSearchConfig(
  input: unknown,
): ValidationResult<FoundationSearchConfig> {
  const result = FoundationSearchConfigSchema.safeParse(input);
  if (!result.success) {
    return { success: false, issues: translateZodIssues(result.error.issues) };
  }
  return { success: true, data: deepFreeze(result.data) };
}

/**
 * Defaults legacy definitions to OFF. AUTO and ON are explicit operator choices,
 * so existing WEB-01 builds do not acquire a new index or browser payload.
 */
export function resolveFoundationSearch(
  input: unknown | undefined,
  context: FoundationSearchContext | undefined,
): ValidationResult<ResolvedFoundationSearch> {
  if (input === undefined) {
    return {
      success: true,
      data: disabledResolution("OFF", "DEFAULT_OFF"),
    };
  }

  const validation = validateFoundationSearchConfig(input);
  if (!validation.success) return validation;
  const config = validation.data;

  if (config.mode === "OFF") {
    return {
      success: true,
      data: disabledResolution("OFF", "EXPLICIT_OFF"),
    };
  }

  if (context === undefined) {
    return {
      success: false,
      issues: Object.freeze([
        validationIssue(
          "REFERENCE_NOT_FOUND",
          ["foundationSearch"],
          "AUTO or ON Foundation Search requires validated profile content and business identity.",
        ),
      ]),
    };
  }

  const scopeIssues = validateScope(config, context.profile);
  if (scopeIssues.length > 0) {
    return { success: false, issues: Object.freeze(scopeIssues) };
  }

  const records = projectProfileSearchRecords(
    context,
    config.includeSectionIds,
  );
  if (config.mode === "ON") {
    return {
      success: true,
      data: deepFreeze({
        schemaVersion: 1,
        mode: "ON" as const,
        enabled: true,
        reason: "EXPLICIT_ON" as const,
        records,
      }),
    };
  }

  const characters = records.reduce(
    (total, record) => total + record.content.length,
    0,
  );
  const enabled =
    records.length >= FOUNDATION_SEARCH_AUTO_MIN_SECTION_COUNT ||
    characters >= FOUNDATION_SEARCH_AUTO_MIN_CHARACTERS;
  return {
    success: true,
    data: deepFreeze({
      schemaVersion: 1,
      mode: "AUTO" as const,
      enabled,
      reason: enabled
        ? ("AUTO_ENABLED" as const)
        : ("AUTO_BELOW_THRESHOLD" as const),
      records: enabled ? records : Object.freeze([]),
    }),
  };
}

export function projectProfileSearchRecords(
  context: FoundationSearchContext,
  includeSectionIds?: readonly string[],
): readonly FoundationSearchRecord[] {
  const included =
    includeSectionIds === undefined ? undefined : new Set(includeSectionIds);
  return deepFreeze(
    context.profile.sections
      .filter(({ sectionId: id }) => included === undefined || included.has(id))
      .map((section) =>
        deepFreeze({
          url: `/#${section.sectionId}`,
          content: normalizeText(
            [
              context.businessName,
              section.heading,
              section.eyebrow ?? "",
              sectionSearchText(section),
            ].join(" "),
          ),
          language: "en" as const,
          meta: {
            title: section.heading,
            businessName: context.businessName,
            sectionId: section.sectionId,
            profile: context.profile.profile,
          },
          filters: {
            profile: Object.freeze([context.profile.profile]),
            sectionType: Object.freeze([section.type]),
          },
        }),
      ),
  );
}

function validateScope(
  config: FoundationSearchConfig,
  profile: WebsiteProfileContent,
): ValidationIssue[] {
  if (config.includeSectionIds === undefined) return [];
  const known = new Set(profile.sections.map(({ sectionId: id }) => id));
  const unknown = config.includeSectionIds.filter((id) => !known.has(id));
  return unknown.length === 0
    ? []
    : [
        validationIssue(
          "REFERENCE_NOT_FOUND",
          ["foundationSearch", "includeSectionIds"],
          `Foundation Search scope references unknown sections: ${unknown.join(", ")}.`,
        ),
      ];
}

/**
 * Single source of truth for projecting one validated profile section into
 * searchable text. Both the legacy one-page projector and the v2 Page Graph
 * projector consume this so the two paths cannot drift apart.
 */
export function sectionSearchText(section: WebsiteProfileSection): string {
  switch (section.type) {
    case "SERVICES":
    case "PROCESS":
    case "EVENTS":
    case "COLLECTIONS":
      return section.items
        .map(({ title, description }) => `${title} ${description}`)
        .join(" ");
    case "TRUST_SIGNALS":
      return [...section.items, section.disclaimer ?? ""].join(" ");
    case "GALLERY":
      return section.items
        .map(({ alt, caption }) => `${alt} ${caption ?? ""}`)
        .join(" ");
    case "TESTIMONIALS":
      return section.items
        .map(
          ({ quote, attribution, disclosure }) =>
            `${quote} ${attribution} ${disclosure ?? ""}`,
        )
        .join(" ");
    case "FAQ":
      return section.items
        .map(({ question, answer }) => `${question} ${answer}`)
        .join(" ");
    case "MENU":
      return section.categories
        .map(
          (category) =>
            `${category.name} ${category.description ?? ""} ${category.items
              .map(
                (item) =>
                  `${item.name} ${item.description ?? ""} ${item.price} ${item.dietary.join(" ")}`,
              )
              .join(" ")}`,
        )
        .join(" ");
    case "HOURS":
      return [
        ...section.periods.map(({ days, hours }) => `${days} ${hours}`),
        ...section.exceptions,
      ].join(" ");
    case "LOCATION":
      return [
        section.location.name,
        ...section.location.addressLines,
        section.location.locality,
        section.location.region,
        section.location.postalCode,
      ].join(" ");
    case "STORY":
    case "CONTACT":
      return section.body;
    case "PRODUCTS":
      return section.items
        .map(
          ({ name, description, price }) =>
            `${name} ${description} ${price ?? ""}`,
        )
        .join(" ");
    case "POLICIES":
      return section.items.map(({ title, body }) => `${title} ${body}`).join(" ");
    case "ACTIONS":
      return section.actions
        .map((action) =>
          action.state === "NOT_CONFIGURED"
            ? `${action.label} ${action.message}`
            : action.label,
        )
        .join(" ");
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}

function disabledResolution(
  mode: "OFF",
  reason: "DEFAULT_OFF" | "EXPLICIT_OFF",
): ResolvedFoundationSearch {
  return deepFreeze({
    schemaVersion: 1,
    mode,
    enabled: false,
    reason,
    records: Object.freeze([]),
  });
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function validationIssue(
  code: ValidationIssue["code"],
  path: readonly (string | number)[],
  message: string,
): ValidationIssue {
  return Object.freeze({ code, path: Object.freeze([...path]), message });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
