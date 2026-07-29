import type {
  ResolvedWebsiteModule,
  WebsiteModuleReference,
} from "@melbourne-local-growth-ops/site-core";
import type { ReactNode } from "react";

export interface ManagedModuleRenderer {
  readonly reference: WebsiteModuleReference;
  render(module: ResolvedWebsiteModule): ReactNode;
}

export type ManagedWebsiteRenderErrorCode =
  | "DUPLICATE_MODULE_RENDERER"
  | "MISSING_MODULE_RENDERER"
  | "INCOMPATIBLE_MODULE_RENDERER";

interface ManagedWebsiteRenderErrorDetails {
  readonly code: ManagedWebsiteRenderErrorCode;
  readonly reference: WebsiteModuleReference;
  readonly moduleId?: string;
}

export class ManagedWebsiteRenderError extends Error {
  override readonly name = "ManagedWebsiteRenderError";
  readonly code: ManagedWebsiteRenderErrorCode;
  readonly reference: WebsiteModuleReference;
  readonly moduleId: string | undefined;

  constructor(details: ManagedWebsiteRenderErrorDetails) {
    super(renderErrorMessage(details));
    this.code = details.code;
    this.reference = Object.freeze({ ...details.reference });
    this.moduleId = details.moduleId;
  }
}

export interface ManagedModuleRendererRegistry {
  readonly registrations: readonly WebsiteModuleReference[];
  resolve(
    reference: WebsiteModuleReference,
  ): ManagedModuleRenderer | undefined;
}

function rendererKey(reference: WebsiteModuleReference): string {
  return `${reference.type}\u0000${reference.moduleVersion}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createManagedModuleRendererRegistry(
  renderers: readonly ManagedModuleRenderer[],
): ManagedModuleRendererRegistry {
  const sorted = [...renderers].sort(
    (left, right) =>
      compareText(left.reference.type, right.reference.type) ||
      compareText(
        left.reference.moduleVersion,
        right.reference.moduleVersion,
      ),
  );
  const renderersByReference = new Map<string, ManagedModuleRenderer>();

  for (const renderer of sorted) {
    const reference = Object.freeze({ ...renderer.reference });
    const key = rendererKey(reference);
    if (renderersByReference.has(key)) {
      throw new ManagedWebsiteRenderError({
        code: "DUPLICATE_MODULE_RENDERER",
        reference,
      });
    }

    renderersByReference.set(
      key,
      Object.freeze({
        reference,
        render(module: ResolvedWebsiteModule): ReactNode {
          return renderer.render(module);
        },
      }),
    );
  }

  const registrations = Object.freeze(
    sorted.map(({ reference }) => Object.freeze({ ...reference })),
  );

  return Object.freeze({
    registrations,
    resolve(reference: WebsiteModuleReference) {
      return renderersByReference.get(rendererKey(reference));
    },
  });
}

function renderErrorMessage(
  details: ManagedWebsiteRenderErrorDetails,
): string {
  const identity = `${details.reference.type} version ${details.reference.moduleVersion}`;
  switch (details.code) {
    case "DUPLICATE_MODULE_RENDERER":
      return `Renderer for ${identity} is registered more than once.`;
    case "MISSING_MODULE_RENDERER":
      return `Module "${String(details.moduleId)}" requires a renderer for ${identity}.`;
    case "INCOMPATIBLE_MODULE_RENDERER":
      return `Module "${String(details.moduleId)}" is incompatible with its renderer for ${identity}.`;
  }
}
