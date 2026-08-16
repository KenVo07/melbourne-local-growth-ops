import {
  translateZodIssues,
  type ValidationResult,
} from "@melbourne-local-growth-ops/contracts";
import { z } from "zod";

const assetId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._/-]*$/);
const altText = z.string().trim().min(1).max(300);
const captionText = z.string().trim().min(1).max(500);

export const WebsiteMediaRoleSchema = z.enum([
  "HERO",
  "PROJECT",
  "GALLERY",
  "CONTENT",
  "PORTRAIT",
  "DECORATIVE",
]);

export const WebsiteMediaAspectSchema = z.enum([
  "NATURAL",
  "LANDSCAPE",
  "PORTRAIT",
  "SQUARE",
  "PANORAMIC",
]);

export const WebsiteMediaFitSchema = z.enum(["COVER", "CONTAIN"]);

export const WebsiteMediaFocalPointSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const WebsiteMediaViewportOverrideSchema = z.strictObject({
  aspect: WebsiteMediaAspectSchema.optional(),
  fit: WebsiteMediaFitSchema.optional(),
  focalPoint: WebsiteMediaFocalPointSchema.optional(),
});

export const WebsiteMediaPresentationSchema = z.strictObject({
  aspect: WebsiteMediaAspectSchema,
  fit: WebsiteMediaFitSchema,
  focalPoint: WebsiteMediaFocalPointSchema.optional(),
  mobile: WebsiteMediaViewportOverrideSchema.optional(),
  tablet: WebsiteMediaViewportOverrideSchema.optional(),
});

const informativeMediaReferenceSchema = z.strictObject({
  assetId,
  role: WebsiteMediaRoleSchema.exclude(["DECORATIVE"]),
  decorative: z.literal(false),
  alt: altText,
  caption: captionText.optional(),
  presentation: WebsiteMediaPresentationSchema,
});

const decorativeMediaReferenceSchema = z.strictObject({
  assetId,
  role: z.literal("DECORATIVE"),
  decorative: z.literal(true),
  alt: z.literal(""),
  caption: z.never().optional(),
  presentation: WebsiteMediaPresentationSchema,
});

export const WebsiteMediaReferenceSchema = z.discriminatedUnion("decorative", [
  informativeMediaReferenceSchema,
  decorativeMediaReferenceSchema,
]);

export type WebsiteMediaRole = z.infer<typeof WebsiteMediaRoleSchema>;
export type WebsiteMediaAspect = z.infer<typeof WebsiteMediaAspectSchema>;
export type WebsiteMediaFit = z.infer<typeof WebsiteMediaFitSchema>;
export type WebsiteMediaFocalPoint = z.infer<typeof WebsiteMediaFocalPointSchema>;
export type WebsiteMediaViewportOverride = z.infer<
  typeof WebsiteMediaViewportOverrideSchema
>;
export type WebsiteMediaPresentation = z.infer<
  typeof WebsiteMediaPresentationSchema
>;
export type WebsiteMediaReference = z.infer<typeof WebsiteMediaReferenceSchema>;

export function validateWebsiteMediaReference(
  input: unknown,
): ValidationResult<WebsiteMediaReference> {
  const parsed = WebsiteMediaReferenceSchema.safeParse(input);
  return parsed.success
    ? { success: true, data: deepFreeze(parsed.data) }
    : { success: false, issues: translateZodIssues(parsed.error.issues) };
}

export function mediaObjectPosition(
  reference: WebsiteMediaReference,
  viewport: "MOBILE" | "TABLET" | "DESKTOP",
): string {
  const override =
    viewport === "MOBILE"
      ? reference.presentation.mobile
      : viewport === "TABLET"
        ? reference.presentation.tablet
        : undefined;
  const focalPoint = override?.focalPoint ?? reference.presentation.focalPoint;
  return focalPoint === undefined
    ? "50% 50%"
    : `${formatPercentage(focalPoint.x)} ${formatPercentage(focalPoint.y)}`;
}

function formatPercentage(value: number): string {
  return `${Math.round(value * 10_000) / 100}%`;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
