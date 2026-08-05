import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

import type {
  ManagedWebsiteRuntime,
  RuntimeWebsiteImage,
  RuntimeWebsiteModule,
} from "../runtime-types";
import {
  ManagedWebsiteRenderError,
  type ManagedModuleRendererRegistry,
} from "./module-renderer-registry";
import type { ManagedSectionRendererRegistry } from "./section-renderer-registry";
import { managedProfileSectionRenderers } from "./sections";

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
      style={profile === undefined ? undefined : profileBrandStyle(profile.brand)}
    >
      <a className="skip-to-content" href="#primary-content">
        Skip to main content
      </a>

      {profile === undefined ? null : (
        <nav aria-label="Section navigation" className="site-nav">
          <ul>{renderSectionLinks(profile.sections)}</ul>
        </nav>
      )}

      <header className="site-hero" id="primary-content" tabIndex={-1}>
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

        {composition.assets
          .filter(({ slotId }) => slotId === "hero")
          .map(renderImageSlot)}
      </header>

      {profile === undefined
        ? composition.regions.map((region) => renderFlatRegion(region, renderers))
        : renderProfileSections(composition, renderers, sectionRenderers)}

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
      <a href={`#profile-section-${section.sectionId}`}>{section.heading}</a>
    </li>
  ));
}

function renderProfileSections(
  composition: ManagedWebsiteRuntime,
  moduleRenderers: ManagedModuleRendererRegistry,
  sectionRenderers: ManagedSectionRendererRegistry,
): ReactNode {
  const profile = composition.profile;
  if (profile === undefined) return null;
  const regionsById = new Map(
    composition.regions.map((region) => [region.regionId, region]),
  );
  const interleavedRegionIds = new Set<string>();
  const sections = profile.sections.map((section) => {
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
        key={section.sectionId}
      >
        <header className="profile-section-heading">
          {section.eyebrow === undefined ? null : <p>{section.eyebrow}</p>}
          <h2 id={headingId}>{section.heading}</h2>
        </header>
        {renderer.render(section, { assets: composition.assets })}
        {modules.length === 0 ? null : <div className="profile-section-modules">{modules}</div>}
      </section>
    );
  });
  const unmatchedRegions = composition.regions
    .filter(({ regionId }) => !interleavedRegionIds.has(regionId))
    .map((region) => renderFlatRegion(region, moduleRenderers));
  return <>{sections}{unmatchedRegions}</>;
}

function renderFlatRegion(
  region: ManagedWebsiteRuntime["regions"][number],
  renderers: ManagedModuleRendererRegistry,
): ReactNode {
  const modules = region.modules.map((module) =>
    renderModuleSlot(module, renderers),
  );
  if (modules.every((module) => module === null)) return null;
  return (
    <section
      aria-label={regionLabel(region.regionId)}
      className={`site-region site-region-${region.regionId}`}
      key={region.regionId}
    >
      {modules}
    </section>
  );
}

type ProfileBrandStyle = CSSProperties & {
  readonly "--profile-accent": string;
  readonly "--profile-accent-contrast": string;
  readonly "--profile-surface": string;
  readonly "--profile-text": string;
};

function profileBrandStyle(
  brand: NonNullable<ManagedWebsiteRuntime["profile"]>["brand"],
): ProfileBrandStyle {
  return {
    "--profile-accent": brand.accentColor,
    "--profile-accent-contrast": brand.accentContrastColor,
    "--profile-surface": brand.surfaceColor,
    "--profile-text": brand.textColor,
  };
}

function renderImageSlot(image: RuntimeWebsiteImage): ReactNode {
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
        sizes={image.sizes}
        src={image.asset.publicPath}
        width={image.asset.width}
      />
    </figure>
  );
}

function renderModuleSlot(
  module: RuntimeWebsiteModule,
  renderers: ManagedModuleRendererRegistry,
): ReactNode {
  const reference = {
    type: module.type,
    moduleVersion: module.moduleVersion,
  } as const;
  const renderer = renderers.resolve(reference);
  if (renderer === undefined) {
    return renderFallback(module);
  }

  const content = renderer.render(module);
  if (content === null || content === undefined || content === false) {
    return null;
  }

  return (
    <div
      className={`module-slot module-slot-${module.type.toLowerCase().replaceAll("_", "-")}`}
      data-module-id={module.moduleId}
      data-module-type={module.type}
      data-module-version={module.moduleVersion}
      key={module.moduleId}
    >
      {content}
    </div>
  );
}

function renderFallback(module: RuntimeWebsiteModule): ReactNode {
  switch (module.contract.fallback.strategy) {
    case "HIDE":
      return null;
    case "STATIC":
      return (
        <aside
          className="module-fallback"
          data-module-id={module.moduleId}
          data-module-version={module.moduleVersion}
          key={module.moduleId}
          role="status"
        >
          {module.contract.fallback.description}
        </aside>
      );
    case "ERROR":
      throw new ManagedWebsiteRenderError({
        code: "MISSING_MODULE_RENDERER",
        reference: {
          type: module.type,
          moduleVersion: module.moduleVersion,
        },
        moduleId: module.moduleId,
      });
  }
}

function regionLabel(regionId: string): string | undefined {
  if (regionId === "primary") return "Primary website content";
  if (regionId === "analytics") return undefined;
  return `${regionId.replaceAll("-", " ")} modules`;
}
