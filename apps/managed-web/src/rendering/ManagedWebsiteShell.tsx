import type {
  ManagedWebsiteComposition,
  ResolvedWebsiteModule,
} from "@melbourne-local-growth-ops/site-core";
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
      <header className="site-introduction">
        <p className="site-eyebrow">Melbourne local service</p>
        <h1>{composition.configuration.display.businessName}</h1>
        {composition.configuration.display.tagline === undefined
          ? null
          : <p className="site-tagline">
              {composition.configuration.display.tagline}
            </p>}
      </header>

      {composition.regions.map((region) => (
        <section
          aria-label={regionLabel(region.regionId)}
          className={`site-region site-region-${region.regionId}`}
          key={region.regionId}
        >
          {region.modules.map((module) => (
            <ModuleSlot
              key={module.moduleId}
              module={module}
              renderers={renderers}
            />
          ))}
        </section>
      ))}
    </main>
  );
}

interface ModuleSlotProps {
  readonly module: ResolvedWebsiteModule;
  readonly renderers: ManagedModuleRendererRegistry;
}

function ModuleSlot({
  module,
  renderers,
}: ModuleSlotProps): ReactNode {
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
