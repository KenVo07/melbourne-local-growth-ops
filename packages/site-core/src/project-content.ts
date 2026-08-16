import {
  translateZodIssues,
  type ValidationIssue,
  type ValidationResult,
} from "@melbourne-local-growth-ops/contracts";
import { z } from "zod";

import { WebsiteMediaReferenceSchema } from "./media-reference.js";

const boundedId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/);
const slug = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const shortText = z.string().trim().min(1).max(200);
const longText = z.string().trim().min(1).max(4_000);

export const WebsiteProjectTruthModeSchema = z.enum([
  "VERIFIED_CLIENT",
  "DEMONSTRATION",
]);

export const WebsiteProjectFactSchema = z.strictObject({
  label: shortText,
  value: shortText,
});

export const WebsiteProjectStoryBlockTypeSchema = z.enum([
  "BRIEF",
  "CHALLENGE",
  "APPROACH",
  "DELIVERY",
  "OUTCOME",
  "NOTE",
]);

export const WebsiteProjectStoryBlockSchema = z.strictObject({
  blockId: boundedId,
  type: WebsiteProjectStoryBlockTypeSchema,
  heading: shortText,
  body: longText,
  media: z.array(WebsiteMediaReferenceSchema).max(12).default([]),
});

export const WebsiteProjectSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    projectId: boundedId,
    slug,
    title: shortText,
    summary: longText,
    truthMode: WebsiteProjectTruthModeSchema,
    demonstrationDisclosure: longText.optional(),
    serviceIds: z.array(boundedId).min(1).max(24),
    locationLabel: shortText.optional(),
    hero: WebsiteMediaReferenceSchema,
    gallery: z.array(WebsiteMediaReferenceSchema).max(60).default([]),
    facts: z.array(WebsiteProjectFactSchema).max(24).default([]),
    story: z.array(WebsiteProjectStoryBlockSchema).min(1).max(24),
    relatedProjectIds: z.array(boundedId).max(12).default([]),
  })
  .superRefine((project, context) => {
    if (
      project.truthMode === "DEMONSTRATION" &&
      project.demonstrationDisclosure === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["demonstrationDisclosure"],
        message:
          "Demonstration projects require an explicit public disclosure so concept work cannot be mistaken for client evidence.",
      });
    }
    if (
      project.truthMode === "VERIFIED_CLIENT" &&
      project.demonstrationDisclosure !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["demonstrationDisclosure"],
        message:
          "Verified client projects must not carry a demonstration disclosure. Correct the truth mode or the project evidence.",
      });
    }
    const storyIds = new Set<string>();
    for (const [index, block] of project.story.entries()) {
      if (storyIds.has(block.blockId)) {
        context.addIssue({
          code: "custom",
          path: ["story", index, "blockId"],
          message: `Story block ID "${block.blockId}" is duplicated.`,
        });
      }
      storyIds.add(block.blockId);
    }
  });

export const WebsiteProjectCollectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projects: z.array(WebsiteProjectSchema).max(250),
});

export type WebsiteProjectTruthMode = z.infer<
  typeof WebsiteProjectTruthModeSchema
>;
export type WebsiteProjectStoryBlock = z.infer<
  typeof WebsiteProjectStoryBlockSchema
>;
export type WebsiteProject = z.infer<typeof WebsiteProjectSchema>;
export type WebsiteProjectCollection = z.infer<
  typeof WebsiteProjectCollectionSchema
>;

export function validateWebsiteProjectCollection(
  input: unknown,
): ValidationResult<WebsiteProjectCollection> {
  const parsed = WebsiteProjectCollectionSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, issues: translateZodIssues(parsed.error.issues) };
  }
  const issues = validateCollectionReferences(parsed.data);
  return issues.length === 0
    ? { success: true, data: deepFreeze(parsed.data) }
    : { success: false, issues: Object.freeze(issues) };
}

export function projectById(
  collection: WebsiteProjectCollection,
  projectId: string,
): WebsiteProject | undefined {
  return collection.projects.find((project) => project.projectId === projectId);
}

export function projectBySlug(
  collection: WebsiteProjectCollection,
  projectSlug: string,
): WebsiteProject | undefined {
  return collection.projects.find((project) => project.slug === projectSlug);
}

function validateCollectionReferences(
  collection: WebsiteProjectCollection,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Map<string, number>();
  const slugs = new Map<string, number>();

  for (const [index, project] of collection.projects.entries()) {
    if (ids.has(project.projectId)) {
      issues.push(
        issue(
          "DUPLICATE_IDENTIFIER",
          ["projects", index, "projectId"],
          `Project ID "${project.projectId}" is duplicated.`,
        ),
      );
    } else {
      ids.set(project.projectId, index);
    }
    if (slugs.has(project.slug)) {
      issues.push(
        issue(
          "DUPLICATE_IDENTIFIER",
          ["projects", index, "slug"],
          `Project slug "${project.slug}" is duplicated.`,
        ),
      );
    } else {
      slugs.set(project.slug, index);
    }
  }

  for (const [projectIndex, project] of collection.projects.entries()) {
    const seenRelated = new Set<string>();
    for (const [relatedIndex, relatedId] of project.relatedProjectIds.entries()) {
      if (relatedId === project.projectId) {
        issues.push(
          issue(
            "INVALID_INPUT",
            ["projects", projectIndex, "relatedProjectIds", relatedIndex],
            "A project cannot relate to itself.",
          ),
        );
      } else if (!ids.has(relatedId)) {
        issues.push(
          issue(
            "REFERENCE_NOT_FOUND",
            ["projects", projectIndex, "relatedProjectIds", relatedIndex],
            `Related project "${relatedId}" does not exist.`,
          ),
        );
      }
      if (seenRelated.has(relatedId)) {
        issues.push(
          issue(
            "DUPLICATE_IDENTIFIER",
            ["projects", projectIndex, "relatedProjectIds", relatedIndex],
            `Related project "${relatedId}" is duplicated.`,
          ),
        );
      }
      seenRelated.add(relatedId);
    }
  }
  return issues;
}

function issue(
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
