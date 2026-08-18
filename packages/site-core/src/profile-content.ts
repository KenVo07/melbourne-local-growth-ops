import {
  translateZodIssues,
  type ValidationResult,
} from "@melbourne-local-growth-ops/contracts";
import { z } from "zod";

const requiredText = z.string().trim().min(1).max(2_000);
const shortText = z.string().trim().min(1).max(200);
const sectionId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/);
const assetId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._/-]*$/);

const safeHttpsUrl = z.url().superRefine((input, context) => {
  if (
    !input.startsWith("https://") ||
    httpsAuthority(input).includes("@")
  ) {
    context.addIssue({
      code: "custom",
      message: "URL must use HTTPS and must not contain credentials.",
    });
  }
});

const safeActionHref = z.string().trim().min(1).max(2_048).superRefine(
  (input, context) => {
    if (/^tel:\+[1-9][0-9]{7,14}$/.test(input)) {
      return;
    }

    if (
      z.url().safeParse(input).success &&
      input.startsWith("https://") &&
      !httpsAuthority(input).includes("@")
    ) {
      return;
    }

    context.addIssue({
      code: "custom",
      message: "Action href must be an HTTPS URL or an international tel: URL.",
    });
  },
);

function httpsAuthority(input: string): string {
  return input.slice("https://".length).split(/[/?#]/, 1)[0] ?? "";
}

export const WebsiteProfileSchema = z.enum([
  "CONTRACTOR",
  "RESTAURANT",
  "RETAILER",
]);

export const WebsiteArchetypeSchema = z.enum([
  "SERVICE_LED",
  "HOSPITALITY_EDITORIAL",
  "CATALOGUE_LED",
]);

export const WebsiteBrandSchema = z
  .strictObject({
    eyebrow: shortText,
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accentContrastColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    surfaceColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .superRefine((brand, context) => {
    if (contrastRatio(brand.accentColor, brand.accentContrastColor) < 4.5) {
      context.addIssue({
        code: "custom",
        path: ["accentContrastColor"],
        message: "Accent text contrast must meet WCAG AA (4.5:1).",
      });
    }
    if (contrastRatio(brand.surfaceColor, brand.textColor) < 4.5) {
      context.addIssue({
        code: "custom",
        path: ["textColor"],
        message: "Surface text contrast must meet WCAG AA (4.5:1).",
      });
    }
  });

const sectionHeading = {
  sectionId,
  heading: shortText,
  eyebrow: shortText.optional(),
} as const;

export const WebsiteExternalActionKindSchema = z.enum([
  "PHONE",
  "RESERVATION",
  "ORDERING",
  "PURCHASE",
  "DIRECTIONS",
]);

const configuredExternalActionSchema = z
  .strictObject({
    actionId: sectionId,
    kind: WebsiteExternalActionKindSchema,
    state: z.literal("CONFIGURED"),
    label: shortText,
    href: safeActionHref,
  })
  .superRefine((action, context) => {
    const isPhone = action.kind === "PHONE";
    if (isPhone !== action.href.startsWith("tel:")) {
      context.addIssue({
        code: "custom",
        path: ["href"],
        message: isPhone
          ? "PHONE actions must use a tel: URL."
          : `${action.kind} actions must use an HTTPS URL.`,
      });
    }
  });

const notConfiguredExternalActionSchema = z.strictObject({
  actionId: sectionId,
  kind: WebsiteExternalActionKindSchema,
  state: z.literal("NOT_CONFIGURED"),
  label: shortText,
  message: requiredText,
});

export const WebsiteExternalActionSchema = z.discriminatedUnion("state", [
  configuredExternalActionSchema,
  notConfiguredExternalActionSchema,
]);

const titledItemSchema = z.strictObject({
  title: shortText,
  description: requiredText,
});

/**
 * Services carry an additive stable identifier so multi-page definitions can
 * route to a service detail page without ever matching an editable display
 * title. The field stays optional: legacy one-page profiles remain valid and
 * gain no route merely because an ID is present. Runtime title or slug matching
 * is prohibited; the v2 cross-validator requires exact IDs.
 */
export const WebsiteServiceItemSchema = z.strictObject({
  serviceId: sectionId.optional(),
  title: shortText,
  description: requiredText,
});

const galleryItemSchema = z.strictObject({
  assetId,
  alt: shortText,
  caption: shortText.optional(),
});

export const WebsiteTestimonialSchema = z.strictObject({
  quote: requiredText,
  attribution: shortText,
  disclosure: shortText.optional(),
});

const faqItemSchema = z.strictObject({
  question: shortText,
  answer: requiredText,
});

export const WebsiteMenuItemSchema = z.strictObject({
  name: shortText,
  description: requiredText.optional(),
  price: shortText,
  dietary: z.array(shortText).max(12).default([]),
});

export const WebsiteMenuCategorySchema = z.strictObject({
  name: shortText,
  description: requiredText.optional(),
  items: z.array(WebsiteMenuItemSchema).min(1).max(100),
});

export const WebsiteCatalogueItemSchema = z.strictObject({
  name: shortText,
  description: requiredText,
  price: shortText.optional(),
  assetId: assetId.optional(),
  purchaseActionId: sectionId.optional(),
});

export const WebsitePolicySchema = z.strictObject({
  title: shortText,
  body: requiredText,
});

export const WebsiteLocationSchema = z.strictObject({
  name: shortText,
  addressLines: z.array(shortText).min(1).max(4),
  locality: shortText,
  region: shortText,
  postalCode: z.string().trim().min(3).max(12),
  directionsUrl: safeHttpsUrl.optional(),
});

const serviceSectionSchema = z.strictObject({
  type: z.literal("SERVICES"),
  ...sectionHeading,
  items: z.array(WebsiteServiceItemSchema).min(1).max(100),
});
const trustSectionSchema = z.strictObject({
  type: z.literal("TRUST_SIGNALS"),
  ...sectionHeading,
  items: z.array(shortText).min(1).max(50),
  disclaimer: requiredText.optional(),
});
const gallerySectionSchema = z.strictObject({
  type: z.literal("GALLERY"),
  ...sectionHeading,
  items: z.array(galleryItemSchema).min(1).max(100),
});
const processSectionSchema = z.strictObject({
  type: z.literal("PROCESS"),
  ...sectionHeading,
  items: z.array(titledItemSchema).min(1).max(50),
});
const testimonialSectionSchema = z.strictObject({
  type: z.literal("TESTIMONIALS"),
  ...sectionHeading,
  items: z.array(WebsiteTestimonialSchema).min(1).max(50),
});
const faqSectionSchema = z.strictObject({
  type: z.literal("FAQ"),
  ...sectionHeading,
  items: z.array(faqItemSchema).min(1).max(100),
});
const menuSectionSchema = z.strictObject({
  type: z.literal("MENU"),
  ...sectionHeading,
  categories: z.array(WebsiteMenuCategorySchema).min(1).max(50),
});
const hoursSectionSchema = z.strictObject({
  type: z.literal("HOURS"),
  ...sectionHeading,
  periods: z
    .array(
      z.strictObject({
        days: shortText,
        hours: shortText,
      }),
    )
    .min(1)
    .max(31),
  exceptions: z.array(shortText).max(24).default([]),
});
const locationSectionSchema = z.strictObject({
  type: z.literal("LOCATION"),
  ...sectionHeading,
  location: WebsiteLocationSchema,
});
const storySectionSchema = z.strictObject({
  type: z.literal("STORY"),
  ...sectionHeading,
  body: requiredText,
});
const eventsSectionSchema = z.strictObject({
  type: z.literal("EVENTS"),
  ...sectionHeading,
  items: z.array(titledItemSchema).min(1).max(100),
});
const collectionsSectionSchema = z.strictObject({
  type: z.literal("COLLECTIONS"),
  ...sectionHeading,
  items: z.array(titledItemSchema).min(1).max(100),
});
const productsSectionSchema = z.strictObject({
  type: z.literal("PRODUCTS"),
  ...sectionHeading,
  items: z.array(WebsiteCatalogueItemSchema).min(1).max(200),
});
const policiesSectionSchema = z.strictObject({
  type: z.literal("POLICIES"),
  ...sectionHeading,
  items: z.array(WebsitePolicySchema).min(1).max(50),
});
const contactSectionSchema = z.strictObject({
  type: z.literal("CONTACT"),
  ...sectionHeading,
  body: requiredText,
});
const actionsSectionSchema = z.strictObject({
  type: z.literal("ACTIONS"),
  ...sectionHeading,
  actions: z.array(WebsiteExternalActionSchema).min(1).max(20),
});

export const WebsiteProfileSectionSchema = z.discriminatedUnion("type", [
  serviceSectionSchema,
  trustSectionSchema,
  gallerySectionSchema,
  processSectionSchema,
  testimonialSectionSchema,
  faqSectionSchema,
  menuSectionSchema,
  hoursSectionSchema,
  locationSectionSchema,
  storySectionSchema,
  eventsSectionSchema,
  collectionsSectionSchema,
  productsSectionSchema,
  policiesSectionSchema,
  contactSectionSchema,
  actionsSectionSchema,
]);

/**
 * What a Contractor website cannot be built without, as distinct from what a
 * Contractor website may show.
 *
 * Every type in this list is something the business *is* — what it does, on what
 * terms, how it works, how to reach it. A business that cannot answer those has
 * no website to generate.
 *
 * GALLERY and TESTIMONIALS are deliberately absent, and their absence is the
 * rule rather than an omission. Both are *evidence*: photographs of finished
 * work, and words from people who paid for it. A business that has not traded
 * yet, or has traded privately, or whose customers will not be quoted, has
 * neither — and requiring the section forced that business to write something
 * into it. The requirement did not produce evidence; it produced a placeholder
 * standing where evidence would go, which is worse than the empty space it
 * filled, because a reader cannot tell the two apart.
 *
 * The capability is untouched: `gallerySectionSchema` and
 * `testimonialSectionSchema` still exist, the renderers still exist, and the
 * search projector still indexes both. A client with real photographs and real
 * quotes declares the sections and everything downstream behaves exactly as
 * before. What changed is only that the client is no longer *made* to.
 *
 * Cardinality inside a declared section stays at `.min(1)` for the same reason.
 * Absence is honest; a heading over nothing is not. A client either has the
 * evidence and shows it, or does not have it and says nothing.
 */
const contractorRequiredSections = Object.freeze([
  "SERVICES",
  "TRUST_SIGNALS",
  "PROCESS",
  "FAQ",
  "CONTACT",
  "ACTIONS",
] as const);
const restaurantRequiredSections = Object.freeze([
  "MENU",
  "HOURS",
  "LOCATION",
  "GALLERY",
  "STORY",
  "EVENTS",
  "ACTIONS",
] as const);
const retailerRequiredSections = Object.freeze([
  "COLLECTIONS",
  "PRODUCTS",
  "POLICIES",
  "HOURS",
  "LOCATION",
  "STORY",
  "ACTIONS",
] as const);

function profileShape<
  const Profile extends z.infer<typeof WebsiteProfileSchema>,
  const Archetype extends z.infer<typeof WebsiteArchetypeSchema>,
>(profile: Profile, archetype: Archetype, requiredSections: readonly string[]) {
  return z
    .strictObject({
      schemaVersion: z.literal(1),
      profile: z.literal(profile),
      archetype: z.literal(archetype),
      brand: WebsiteBrandSchema,
      sections: z.array(WebsiteProfileSectionSchema).min(1).max(64),
    })
    .superRefine((content, context) => {
      const seenIds = new Set<string>();
      const seenTypes = new Set<string>();
      const seenServiceIds = new Set<string>();
      for (const [index, section] of content.sections.entries()) {
        if (seenIds.has(section.sectionId)) {
          context.addIssue({
            code: "custom",
            path: ["sections", index, "sectionId"],
            message: `Section ID "${section.sectionId}" is duplicated.`,
          });
        }
        seenIds.add(section.sectionId);
        seenTypes.add(section.type);

        if (section.type !== "SERVICES") continue;
        for (const [itemIndex, item] of section.items.entries()) {
          if (item.serviceId === undefined) continue;
          if (seenServiceIds.has(item.serviceId)) {
            context.addIssue({
              code: "custom",
              path: ["sections", index, "items", itemIndex, "serviceId"],
              message: `Service ID "${item.serviceId}" is duplicated.`,
            });
          }
          seenServiceIds.add(item.serviceId);
        }
      }

      for (const required of requiredSections) {
        if (!seenTypes.has(required)) {
          context.addIssue({
            code: "custom",
            path: ["sections"],
            message: `${profile} profiles require a ${required} section.`,
          });
        }
      }
    });
}

export const ContractorProfileContentSchema = profileShape(
  "CONTRACTOR",
  "SERVICE_LED",
  contractorRequiredSections,
);
export const RestaurantProfileContentSchema = profileShape(
  "RESTAURANT",
  "HOSPITALITY_EDITORIAL",
  restaurantRequiredSections,
);
export const RetailerProfileContentSchema = profileShape(
  "RETAILER",
  "CATALOGUE_LED",
  retailerRequiredSections,
);

export const WebsiteProfileContentSchema = z.discriminatedUnion("profile", [
  ContractorProfileContentSchema,
  RestaurantProfileContentSchema,
  RetailerProfileContentSchema,
]);

export type WebsiteProfile = z.infer<typeof WebsiteProfileSchema>;
export type WebsiteArchetype = z.infer<typeof WebsiteArchetypeSchema>;
export type WebsiteBrand = z.infer<typeof WebsiteBrandSchema>;
export type WebsiteExternalAction = z.infer<
  typeof WebsiteExternalActionSchema
>;
export type WebsiteProfileSection = z.infer<
  typeof WebsiteProfileSectionSchema
>;
export type WebsiteServiceItem = z.infer<typeof WebsiteServiceItemSchema>;
export type WebsiteServiceSection = Extract<
  WebsiteProfileSection,
  { readonly type: "SERVICES" }
>;

/**
 * Resolves a service by its stable identifier only. Title and slug matching are
 * deliberately unsupported so editing display copy can never change route
 * identity.
 */
export function serviceItemById(
  content: WebsiteProfileContent,
  serviceId: string,
): WebsiteServiceItem | undefined {
  for (const section of content.sections) {
    if (section.type !== "SERVICES") continue;
    const match = section.items.find((item) => item.serviceId === serviceId);
    if (match !== undefined) return match;
  }
  return undefined;
}

/** Every stable service identifier declared by the validated profile. */
export function stableServiceIds(
  content: WebsiteProfileContent,
): readonly string[] {
  return Object.freeze(
    content.sections
      .filter(
        (section): section is WebsiteServiceSection =>
          section.type === "SERVICES",
      )
      .flatMap((section) =>
        section.items
          .map(({ serviceId }) => serviceId)
          .filter((serviceId): serviceId is string => serviceId !== undefined),
      ),
  );
}
export type WebsiteProfileContent = z.infer<
  typeof WebsiteProfileContentSchema
>;

export function validateWebsiteProfileContent(
  input: unknown,
): ValidationResult<WebsiteProfileContent> {
  const result = WebsiteProfileContentSchema.safeParse(input);
  if (!result.success) {
    return { success: false, issues: translateZodIssues(result.error.issues) };
  }

  return { success: true, data: deepFreeze(result.data) };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
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
