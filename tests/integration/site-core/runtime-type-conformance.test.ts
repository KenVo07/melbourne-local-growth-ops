import { describe, expect, it } from "vitest";

import type {
  ClientExperienceManifest,
  WebsiteMediaReference,
  WebsiteNavigationItem,
  WebsitePageDefinition,
  WebsitePageGraph,
  WebsiteProfileContent,
  WebsiteProject,
  WebsiteProjectCollection,
  WebsiteProjectStoryBlock,
} from "@melbourne-local-growth-ops/site-core";
import type {
  RuntimeClientExperienceManifest,
  RuntimeMediaReference,
  RuntimeNavigationItem,
  RuntimePageDefinition,
  RuntimePageGraph,
  RuntimeProject,
  RuntimeProjectCollection,
  RuntimeProjectStoryBlock,
  RuntimeWebsiteProfileContent,
} from "../../../apps/managed-web/src/runtime-types";

/**
 * `apps/managed-web/src/runtime-types.ts` is a deliberately dependency-free
 * mirror of the validated site-core contracts. A generated client artifact
 * copies it and must not carry a private workspace dependency, so the mirror
 * cannot simply re-export site-core.
 *
 * That duplication is only safe while the two stay in step. These are
 * compile-time assertions: every validated contract value must be assignable to
 * its portable counterpart. If someone widens a site-core contract and forgets
 * the mirror, `pnpm typecheck` fails here rather than the drift reaching a
 * client artifact silently.
 */
type AssertAssignable<Source, Target> = Source extends Target ? true : never;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time only
type Conformance = [
  AssertAssignable<WebsiteMediaReference, RuntimeMediaReference>,
  AssertAssignable<WebsitePageDefinition, RuntimePageDefinition>,
  AssertAssignable<WebsitePageGraph, RuntimePageGraph>,
  AssertAssignable<WebsiteNavigationItem, RuntimeNavigationItem>,
  AssertAssignable<WebsiteProject, RuntimeProject>,
  AssertAssignable<WebsiteProjectStoryBlock, RuntimeProjectStoryBlock>,
  AssertAssignable<WebsiteProjectCollection, RuntimeProjectCollection>,
  AssertAssignable<WebsiteProfileContent, RuntimeWebsiteProfileContent>,
  AssertAssignable<ClientExperienceManifest, RuntimeClientExperienceManifest>,
];

const conformance: Conformance = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];

describe("portable runtime type mirror", () => {
  it("accepts every validated site-core contract", () => {
    // The real assertion is the type annotation above; this keeps the file a
    // runnable test so a broken mirror surfaces in the suite as well as in tsc.
    expect(conformance).toHaveLength(9);
    expect(conformance.every(Boolean)).toBe(true);
  });
});
