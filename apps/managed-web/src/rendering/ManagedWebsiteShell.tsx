import type {
  ManagedWebsiteComposition,
  ResolvedWebsiteImage,
  ResolvedWebsiteModule,
} from "@melbourne-local-growth-ops/site-core";
import Image from "next/image";
import type { ReactNode } from "react";

import {
  ManagedWebsiteRenderError,
  type ManagedModuleRendererRegistry,
} from "./module-renderer-registry";

export interface ManagedWebsiteShellProps {
  readonly composition: ManagedWebsiteComposition;
  readonly renderers: ManagedModuleRendererRegistry;
}

export function ManagedWebsiteShell({
  composition,
  renderers,
}: ManagedWebsiteShellProps) {
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
    >
      <header className="site-hero">
        <div className="site-introduction">
          <p className="site-eyebrow">Melbourne local service</p>
          <h1>{composition.configuration.display.businessName}</h1>
          {composition.configuration.display.tagline === undefined
            ? null
            : <p className="site-tagline">
                {composition.configuration.display.tagline}
              </p>}
        </div>

        {composition.assets.map(renderImageSlot)}
      </header>

      {composition.regions.map((region) => {
        const modules = region.modules.map((module) =>
          renderModuleSlot(module, renderers),
        );
        if (modules.every((module) => module === null)) {
          return null;
        }

        return (
          <section
            aria-label={regionLabel(region.regionId)}
            className={`site-region site-region-${region.regionId}`}
            key={region.regionId}
          >
            {modules}
          </section>
        );
      })}
    </main>
  );
}

function renderImageSlot(image: ResolvedWebsiteImage): ReactNode {
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
  module: ResolvedWebsiteModule,
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

function renderFallback(module: ResolvedWebsiteModule): ReactNode {
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

function regionLabel(regionId: string): string {
  return regionId === "primary"
    ? "Primary website content"
    : `${regionId.replaceAll("-", " ")} modules`;
}
