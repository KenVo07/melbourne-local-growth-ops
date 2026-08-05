import { createElement } from "react";

import type { RuntimeProfileSection } from "../../runtime-types";
import type {
  ManagedSectionRenderer,
  ManagedSectionRendererContext,
} from "../section-renderer-registry";
import { createManagedSectionRendererRegistry } from "../section-renderer-registry";

export { ExternalAction } from "./ExternalAction";
export { ProfileSection } from "./ProfileSection";

import { ProfileSection } from "./ProfileSection";

const sectionTypes = Object.freeze([
  "SERVICES",
  "TRUST_SIGNALS",
  "GALLERY",
  "PROCESS",
  "TESTIMONIALS",
  "FAQ",
  "MENU",
  "HOURS",
  "LOCATION",
  "STORY",
  "EVENTS",
  "COLLECTIONS",
  "PRODUCTS",
  "POLICIES",
  "CONTACT",
  "ACTIONS",
] as const);

export const managedProfileSectionRenderers =
  createManagedSectionRendererRegistry(
    sectionTypes.map(
      (type): ManagedSectionRenderer => Object.freeze({
        type,
        render(
          section: RuntimeProfileSection,
          context: ManagedSectionRendererContext,
        ) {
          if (section.type !== type) {
            throw new Error(`Section "${section.sectionId}" does not match renderer "${type}".`);
          }
          return createElement(ProfileSection, {
            assets: context.assets,
            section,
          });
        },
      }),
    ),
  );
