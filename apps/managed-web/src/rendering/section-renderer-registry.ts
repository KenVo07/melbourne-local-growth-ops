import type { ReactNode } from "react";

import type {
  RuntimeProfileSection,
  RuntimeWebsiteImage,
} from "../runtime-types";

export type RuntimeProfileSectionType = RuntimeProfileSection["type"];

export interface ManagedSectionRendererContext {
  readonly assets: readonly RuntimeWebsiteImage[];
}

export interface ManagedSectionRenderer {
  readonly type: RuntimeProfileSectionType;
  render(
    section: RuntimeProfileSection,
    context: ManagedSectionRendererContext,
  ): ReactNode;
}

export interface ManagedSectionRendererRegistry {
  readonly registrations: readonly RuntimeProfileSectionType[];
  resolve(type: RuntimeProfileSectionType): ManagedSectionRenderer | undefined;
}

export function createManagedSectionRendererRegistry(
  renderers: readonly ManagedSectionRenderer[],
): ManagedSectionRendererRegistry {
  const sorted = [...renderers].sort((left, right) =>
    left.type < right.type ? -1 : left.type > right.type ? 1 : 0,
  );
  const renderersByType = new Map<
    RuntimeProfileSectionType,
    ManagedSectionRenderer
  >();

  for (const renderer of sorted) {
    if (renderersByType.has(renderer.type)) {
      throw new Error(`Section renderer "${renderer.type}" is registered more than once.`);
    }
    renderersByType.set(renderer.type, Object.freeze({ ...renderer }));
  }

  return Object.freeze({
    registrations: Object.freeze(sorted.map(({ type }) => type)),
    resolve(type: RuntimeProfileSectionType) {
      return renderersByType.get(type);
    },
  });
}
