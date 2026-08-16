import {
  translateZodIssues,
  type ValidationIssue,
  type ValidationResult,
} from "@melbourne-local-growth-ops/contracts";
import { z } from "zod";

import type { WebsiteProfileContent } from "./profile-content.js";

const boundedId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/);
const semanticVersion = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+$/);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const orderedSectionIds = z
  .array(boundedId)
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

export const WebsiteExperiencePaletteSchema = z
  .strictObject({
    accentColor: hexColor,
    accentContrastColor: hexColor,
    surfaceColor: hexColor,
    textColor: hexColor,
  })
  .superRefine((palette, context) => {
    if (
      contrastRatio(palette.accentColor, palette.accentContrastColor) < 4.5
    ) {
      context.addIssue({
        code: "custom",
        path: ["accentContrastColor"],
        message: "Accent text contrast must meet WCAG AA (4.5:1).",
      });
    }
    if (contrastRatio(palette.surfaceColor, palette.textColor) < 4.5) {
      context.addIssue({
        code: "custom",
        path: ["textColor"],
        message: "Surface text contrast must meet WCAG AA (4.5:1).",
      });
    }
  });

export const WebsiteDesignDnaSchema = z.strictObject({
  palette: WebsiteExperiencePaletteSchema,
  typography: z.strictObject({
    displayFamily: z.enum(["SANS", "SERIF"]),
    bodyFamily: z.enum(["SANS", "SERIF"]),
    displayScale: z.enum(["COMPACT", "BALANCED", "EXPANSIVE"]),
    tracking: z.enum(["TIGHT", "NORMAL", "OPEN"]),
  }),
  composition: z.strictObject({
    heroLayout: z.enum(["SPLIT", "STACKED", "MEDIA_FIRST"]),
    navigation: z.enum(["INLINE", "COMPACT"]),
    contentWidth: z.enum(["STANDARD", "WIDE"]),
    sectionRhythm: z.enum(["COMPACT", "BALANCED", "EXPANSIVE"]),
    surfaceTreatment: z.enum(["FLAT", "BANDED", "CARDS"]),
    sectionOrder: orderedSectionIds.optional(),
    featuredSectionId: boundedId.optional(),
  }),
  media: z.strictObject({
    heroFrame: z.enum(["EDGE_TO_EDGE", "CONTAINED", "INSET"]),
    heroFit: z.enum(["COVER", "CONTAIN"]),
    galleryFrame: z.enum(["NATURAL", "UNIFORM", "EDITORIAL"]),
  }),
  interaction: z.strictObject({
    actionStyle: z.enum(["TEXT", "SOLID", "OUTLINE"]),
    motion: z.enum(["NONE", "SUBTLE"]),
  }),
});

export const WebsiteSignatureReferenceSchema = z.strictObject({
  signatureId: boundedId,
  placement: z.enum(["AFTER_HERO", "BEFORE_SECTIONS", "BEFORE_FOOTER"]),
});

export const WebsiteExperienceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  experienceId: boundedId,
  experienceVersion: semanticVersion,
  designDna: WebsiteDesignDnaSchema,
  signature: WebsiteSignatureReferenceSchema.optional(),
});

export type WebsiteDesignDna = z.infer<typeof WebsiteDesignDnaSchema>;
export type WebsiteSignatureReference = z.infer<
  typeof WebsiteSignatureReferenceSchema
>;
export type WebsiteExperience = z.infer<typeof WebsiteExperienceSchema>;
export type WebsiteExperienceSource = "EXPLICIT" | "LEGACY_PROFILE_DEFAULT";
export type ResolvedWebsiteExperience = WebsiteExperience & {
  readonly source: WebsiteExperienceSource;
};

export function validateWebsiteExperience(
  input: unknown,
): ValidationResult<WebsiteExperience> {
  const result = WebsiteExperienceSchema.safeParse(input);
  if (!result.success) {
    return { success: false, issues: translateZodIssues(result.error.issues) };
  }
  return { success: true, data: deepFreeze(result.data) };
}

/**
 * Resolves the optional client-specific experience layer without changing the
 * semantic profile. Legacy inputs preserve the accepted WEB-01 visual path;
 * explicit inputs may reorder sections only as an exact permutation.
 */
export function resolveWebsiteExperience(
  input: unknown | undefined,
  profile: WebsiteProfileContent | undefined,
): ValidationResult<ResolvedWebsiteExperience | undefined> {
  if (input === undefined) {
    return {
      success: true,
      data:
        profile === undefined
          ? undefined
          : deepFreeze(legacyExperienceFor(profile)),
    };
  }

  const validation = validateWebsiteExperience(input);
  if (!validation.success) return validation;

  const issues = validateSectionReferences(validation.data, profile);
  if (issues.length > 0) {
    return { success: false, issues: Object.freeze(issues) };
  }

  return {
    success: true,
    data: deepFreeze({ ...validation.data, source: "EXPLICIT" as const }),
  };
}

function validateSectionReferences(
  experience: WebsiteExperience,
  profile: WebsiteProfileContent | undefined,
): ValidationIssue[] {
  const order = experience.designDna.composition.sectionOrder;
  const featured = experience.designDna.composition.featuredSectionId;
  if (order === undefined && featured === undefined) return [];

  if (profile === undefined) {
    return [
      validationIssue(
        "REFERENCE_NOT_FOUND",
        ["designDna", "composition"],
        "Section composition references require validated profile content.",
      ),
    ];
  }

  const profileIds = profile.sections.map(({ sectionId }) => sectionId);
  const profileIdSet = new Set(profileIds);
  const issues: ValidationIssue[] = [];

  if (order !== undefined) {
    const orderSet = new Set(order);
    const missing = profileIds.filter((id) => !orderSet.has(id));
    const unknown = order.filter((id) => !profileIdSet.has(id));
    if (
      order.length !== profileIds.length ||
      orderSet.size !== profileIdSet.size ||
      missing.length > 0 ||
      unknown.length > 0
    ) {
      issues.push(
        validationIssue(
          "REFERENCE_NOT_FOUND",
          ["designDna", "composition", "sectionOrder"],
          `Section order must be an exact permutation of the profile section IDs. Missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}.`,
        ),
      );
    }
  }

  if (featured !== undefined && !profileIdSet.has(featured)) {
    issues.push(
      validationIssue(
        "REFERENCE_NOT_FOUND",
        ["designDna", "composition", "featuredSectionId"],
        `Featured section "${featured}" does not exist in the profile.`,
      ),
    );
  }

  return issues;
}

function legacyExperienceFor(
  profile: WebsiteProfileContent,
): ResolvedWebsiteExperience {
  return {
    schemaVersion: 1,
    experienceId: `legacy-${profile.profile.toLowerCase()}`,
    experienceVersion: "1.0.0",
    source: "LEGACY_PROFILE_DEFAULT",
    designDna: {
      palette: {
        accentColor: profile.brand.accentColor,
        accentContrastColor: profile.brand.accentContrastColor,
        surfaceColor: profile.brand.surfaceColor,
        textColor: profile.brand.textColor,
      },
      typography: {
        displayFamily: "SERIF",
        bodyFamily: "SANS",
        displayScale: "BALANCED",
        tracking: "NORMAL",
      },
      composition: {
        heroLayout: "SPLIT",
        navigation: "INLINE",
        contentWidth: "STANDARD",
        sectionRhythm: "BALANCED",
        surfaceTreatment: "CARDS",
      },
      media: {
        heroFrame: "CONTAINED",
        heroFit: "COVER",
        galleryFrame: "UNIFORM",
      },
      interaction: {
        actionStyle: "SOLID",
        motion: "NONE",
      },
    },
  };
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

function contrastRatio(left: string, right: string): number {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: string): number {
  const components = [
    color.slice(1, 3),
    color.slice(3, 5),
    color.slice(5, 7),
  ].map((component) => {
    const channel = Number.parseInt(component, 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * (components[0] ?? 0) +
    0.7152 * (components[1] ?? 0) +
    0.0722 * (components[2] ?? 0)
  );
}
