import type { ReactNode } from "react";

import type {
  ManagedWebsiteRuntime,
  RuntimeWebsiteModule,
} from "../runtime-types";
import {
  ManagedWebsiteRenderError,
  type ManagedModuleRendererRegistry,
} from "./module-renderer-registry";

export type ManagedWebsiteRegion = ManagedWebsiteRuntime["regions"][number];

/**
 * Renders one validated module slot.
 *
 * Shared by the legacy one-page shell and the authored client experience path
 * so both produce identical module markup and identical fallback behavior. A
 * missing renderer follows the module's declared fallback strategy rather than
 * silently disappearing.
 */
export function renderModuleSlot(
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

/**
 * Renders every module in one validated region. Authored client source reaches
 * this only through `PlatformRegion`, so it never receives module or connector
 * data itself.
 */
export function renderManagedRegion(
  region: ManagedWebsiteRegion,
  renderers: ManagedModuleRendererRegistry,
): ReactNode {
  const modules = region.modules.map((module) =>
    renderModuleSlot(module, renderers),
  );
  return modules.every((module) => module === null) ? null : modules;
}

/**
 * Renders one validated region as a standalone landmark section, the shape the
 * legacy one-page shell places between profile sections.
 */
export function renderFlatRegion(
  region: ManagedWebsiteRegion,
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

export function regionLabel(regionId: string): string | undefined {
  if (regionId === "primary") return "Primary website content";
  if (regionId === "analytics") return undefined;
  return `${regionId.replaceAll("-", " ")} modules`;
}
