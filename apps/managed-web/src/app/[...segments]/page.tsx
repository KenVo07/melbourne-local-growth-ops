import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isAuthoredClientWebsite } from "../../client-experience/load-client-experience";
import {
  authoredPageForPath,
  renderAuthoredPage,
} from "../../client-experience/render-authored-page";
import { composeCurrentManagedWebsite } from "../../managed-website";
import { clientStaticParams, segmentsToPath } from "../../routing/resolve-client-route";
import { authoredClientExperienceContext } from "../../client-experience/load-client-experience";
import { buildManagedRouteMetadata } from "../../structured-data";

/**
 * Every non-root route of the validated Page Graph.
 *
 * `dynamicParams = false` means only the paths generated below exist: anything
 * else is a build-time-known 404 rather than a request-time render. There is no
 * request-time tenancy here — the client identity comes from the validated
 * snapshot compiled into this deployment, never from the URL or the host.
 */
export const dynamicParams = false;

interface RouteParams {
  readonly params: Promise<{ readonly segments?: string[] }>;
}

export function generateStaticParams(): { segments: string[] }[] {
  if (!isAuthoredClientWebsite()) return [];
  return clientStaticParams(
    // The graph is validated; static params exclude the root, which app/page.tsx owns.
    { ...authoredClientExperienceContext().projection.pageGraph },
  ).map(({ segments }) => ({ segments: [...segments] }));
}

export async function generateMetadata({
  params,
}: RouteParams): Promise<Metadata> {
  if (!isAuthoredClientWebsite()) return {};
  const { segments } = await params;
  const page = authoredPageForPath(segmentsToPath(segments));
  if (page === undefined) return {};
  return buildManagedRouteMetadata(composeCurrentManagedWebsite(), page);
}

export default async function ClientRoutePage({ params }: RouteParams) {
  if (!isAuthoredClientWebsite()) notFound();
  const { segments } = await params;
  const page = authoredPageForPath(segmentsToPath(segments));
  if (page === undefined) notFound();
  return renderAuthoredPage(page);
}
