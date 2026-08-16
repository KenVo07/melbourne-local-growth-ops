import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

import type {
  ManagedWebsiteRuntime,
  RuntimeProfileSection,
  RuntimeWebsiteExperience,
  RuntimeWebsiteImage,
} from "../runtime-types";
import type { ManagedModuleRendererRegistry } from "./module-renderer-registry";
import {
  renderFlatRegion,
  renderModuleSlot,
} from "./render-region";
import type { ManagedSectionRendererRegistry } from "./section-renderer-registry";
import { FoundationSearch } from "./search/FoundationSearch";
import { managedProfileSectionRenderers } from "./sections";
import { SignatureSlot } from "./signatures/SignatureSlot";

export interface ManagedWebsiteShellProps {
  readonly composition: ManagedWebsiteRuntime;
  readonly renderers: ManagedModuleRendererRegistry;
  readonly sectionRenderers?: ManagedSectionRendererRegistry;
}

export function ManagedWebsiteShell({
  composition,
  renderers,
  sectionRenderers = managedProfileSectionRenderers,
}: ManagedWebsiteShellProps) {
  const profile = composition.profile;
  const experience = composition.experience;
  const sections = orderedProfileSections(profile?.sections, experience);
  const heroLayout = experience?.designDna.composition.heroLayout ?? "SPLIT";
  const heroImages = composition.assets
    .filter(({ slotId }) => slotId === "hero")
    .map((image) => renderImageSlot(image, heroLayout));
  const introduction = (
    <div className="site-introduction">
      <p className="site-eyebrow">
        {profile?.brand.eyebrow ?? "Melbourne local service"}
      </p>
      <h1>{composition.configuration.display.businessName}</h1>
      {composition.configuration.display.tagline === undefined
        ? null
        : <p className="site-tagline">
            {composition.configuration.display.tagline}
          </p>}
    </div>
  );
  return (
    <main
      className="managed-site"
      data-client-id={composition.configuration.clientId}
      data-configuration-id={composition.provenance.configurationId}
      data-configuration-version={composition.provenance.configurationVersion}
      data-template-id={composition.provenance.template.templateId}
      data-template-version={
        composition.provenance.template.templateVersion
      }
      data-profile={profile?.profile}
      data-archetype={profile?.archetype}
      data-experience-source={experience?.source.toLowerCase()}
      data-hero-layout={heroLayout.toLowerCase()}
      data-content-width={experience?.designDna.composition.contentWidth.toLowerCase()}
      data-section-rhythm={experience?.designDna.composition.sectionRhythm.toLowerCase()}
      data-surface-treatment={experience?.designDna.composition.surfaceTreatment.toLowerCase()}
      data-gallery-frame={experience?.designDna.media.galleryFrame.toLowerCase()}
      data-hero-frame={experience?.designDna.media.heroFrame.toLowerCase()}
      data-hero-fit={experience?.designDna.media.heroFit.toLowerCase()}
      data-display-family={experience?.designDna.typography.displayFamily.toLowerCase()}
      data-navigation={experience?.designDna.composition.navigation.toLowerCase()}
      data-action-style={experience?.designDna.interaction.actionStyle.toLowerCase()}
      data-motion={experience?.designDna.interaction.motion.toLowerCase()}
      style={profile === undefined
        ? undefined
        : experienceStyle(profile.brand, experience)}
    >
      <a className="skip-to-content" href="#primary-content">
        Skip to main content
      </a>

      {profile === undefined ? null : (
        <nav aria-label="Section navigation" className="site-nav">
          <ul>{renderSectionLinks(sections)}</ul>
        </nav>
      )}

      {composition.foundationSearch.enabled ? (
        <FoundationSearch
          businessName={composition.configuration.display.businessName}
        />
      ) : null}

      <header className="site-hero" id="primary-content" tabIndex={-1}>
        {heroLayout === "MEDIA_FIRST"
          ? <>{heroImages}{introduction}</>
          : <>{introduction}{heroImages}</>}
      </header>

      {profile === undefined ? null : (
        <SignatureSlot
          businessName={composition.configuration.display.businessName}
          placement="AFTER_HERO"
          profile={profile}
          signature={experience?.signature}
        />
      )}

      {profile === undefined ? null : (
        <SignatureSlot
          businessName={composition.configuration.display.businessName}
          placement="BEFORE_SECTIONS"
          profile={profile}
          signature={experience?.signature}
        />
      )}

      {profile === undefined
        ? composition.regions.map((region) => renderFlatRegion(region, renderers))
        : renderProfileSections(
            composition,
            sections,
            renderers,
            sectionRenderers,
          )}

      {profile === undefined ? null : (
        <SignatureSlot
          businessName={composition.configuration.display.businessName}
          placement="BEFORE_FOOTER"
          profile={profile}
          signature={experience?.signature}
        />
      )}

      <footer className="site-footer">
        <p className="site-footer-business">
          {composition.configuration.display.businessName}
        </p>
      </footer>
    </main>
  );
}

function renderSectionLinks(
  sections: NonNullable<ManagedWebsiteRuntime["profile"]>["sections"],
): ReactNode {
  return sections.map((section) => (
    <li key={section.sectionId}>
      <a href={`#${section.sectionId}`}>{section.heading}</a>
    </li>
  ));
}

function renderProfileSections(
  composition: ManagedWebsiteRuntime,
  orderedSections: readonly RuntimeProfileSection[],
  moduleRenderers: ManagedModuleRendererRegistry,
  sectionRenderers: ManagedSectionRendererRegistry,
): ReactNode {
  const profile = composition.profile;
  if (profile === undefined) return null;
  const regionsById = new Map(
    composition.regions.map((region) => [region.regionId, region]),
  );
  const interleavedRegionIds = new Set<string>();
  const sections = orderedSections.map((section) => {
    const renderer = sectionRenderers.resolve(section.type);
    if (renderer === undefined) {
      throw new Error(`Profile section "${section.type}" has no renderer.`);
    }
    const region = regionsById.get(section.sectionId);
    if (region !== undefined) interleavedRegionIds.add(region.regionId);
    const modules = region?.modules.map((module) =>
      renderModuleSlot(module, moduleRenderers),
    ) ?? [];
    const headingId = `profile-section-${section.sectionId}`;
    return (
      <section
        aria-labelledby={headingId}
        className={`profile-section profile-section-${section.type.toLowerCase().replaceAll("_", "-")}`}
        data-section-id={section.sectionId}
        data-section-type={section.type}
        id={section.sectionId}
        data-section-featured={
          composition.experience?.designDna.composition.featuredSectionId ===
          section.sectionId
            ? "true"
            : undefined
        }
        key={section.sectionId}
        tabIndex={-1}
      >
        <header className="profile-section-heading">
          {section.eyebrow === undefined ? null : <p>{section.eyebrow}</p>}
          <h2 id={headingId}>{section.heading}</h2>
        </header>
        {renderer.render(section, {
          assets: composition.assets,
          experience: composition.experience,
        })}
        {modules.length === 0 ? null : <div className="profile-section-modules">{modules}</div>}
      </section>
    );
  });
  const unmatchedRegions = composition.regions
    .filter(({ regionId }) => !interleavedRegionIds.has(regionId))
    .map((region) => renderFlatRegion(region, moduleRenderers));
  return <>{sections}{unmatchedRegions}</>;
}

type ExperienceStyle = CSSProperties & {
  readonly "--profile-accent": string;
  readonly "--profile-accent-contrast": string;
  readonly "--profile-surface": string;
  readonly "--profile-text": string;
  readonly "--experience-display-size": string;
  readonly "--experience-display-tracking": string;
};

function experienceStyle(
  brand: NonNullable<ManagedWebsiteRuntime["profile"]>["brand"],
  experience: RuntimeWebsiteExperience | undefined,
): ExperienceStyle {
  const palette = experience?.designDna.palette ?? brand;
  const displayScale = experience?.designDna.typography.displayScale ?? "BALANCED";
  const tracking = experience?.designDna.typography.tracking ?? "NORMAL";
  return {
    "--profile-accent": palette.accentColor,
    "--profile-accent-contrast": palette.accentContrastColor,
    "--profile-surface": palette.surfaceColor,
    "--profile-text": palette.textColor,
    "--experience-display-size": displayScaleValue(displayScale),
    "--experience-display-tracking": trackingValue(tracking),
  };
}

function renderImageSlot(
  image: RuntimeWebsiteImage,
  heroLayout: RuntimeWebsiteExperience["designDna"]["composition"]["heroLayout"],
): ReactNode {
  return (
    <figure
      className={`asset-slot asset-slot-${image.slotId}`}
      data-asset-id={image.asset.assetId}
      data-asset-media-type={image.asset.mediaType}
      data-asset-slot={image.slotId}
      key={image.slotId}
    >
      <Image
        alt={image.alt}
        className="managed-image"
        height={image.asset.height}
        preload={image.priority}
        sizes={heroImageSizes(heroLayout, image.sizes)}
        src={image.asset.publicPath}
        width={image.asset.width}
      />
    </figure>
  );
}

function orderedProfileSections(
  sections: readonly RuntimeProfileSection[] | undefined,
  experience: RuntimeWebsiteExperience | undefined,
): readonly RuntimeProfileSection[] {
  if (sections === undefined) return [];
  const order = experience?.designDna.composition.sectionOrder;
  if (order === undefined) return sections;
  const byId = new Map(sections.map((section) => [section.sectionId, section]));
  return order.map((sectionId) => {
    const section = byId.get(sectionId);
    if (section === undefined) {
      throw new Error(`Validated section order references "${sectionId}" without content.`);
    }
    return section;
  });
}

function heroImageSizes(
  heroLayout: RuntimeWebsiteExperience["designDna"]["composition"]["heroLayout"],
  legacySizes: string,
): string {
  switch (heroLayout) {
    case "MEDIA_FIRST":
      return "100vw";
    case "STACKED":
      return "(min-width: 70rem) 70rem, 100vw";
    case "SPLIT":
      return legacySizes;
  }
}

function displayScaleValue(
  scale: RuntimeWebsiteExperience["designDna"]["typography"]["displayScale"],
): string {
  switch (scale) {
    case "COMPACT":
      return "clamp(2.5rem, 8vw, 5.5rem)";
    case "BALANCED":
      return "clamp(2.75rem, 10vw, 6.75rem)";
    case "EXPANSIVE":
      return "clamp(3rem, 12vw, 8rem)";
  }
}

function trackingValue(
  tracking: RuntimeWebsiteExperience["designDna"]["typography"]["tracking"],
): string {
  switch (tracking) {
    case "TIGHT":
      return "-0.055em";
    case "NORMAL":
      return "-0.035em";
    case "OPEN":
      return "0.015em";
  }
}

