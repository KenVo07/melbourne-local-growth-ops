import type { Metadata } from "next";

import {
  authoredHomePage,
  renderAuthoredPage,
} from "../client-experience/render-authored-page";
import { isAuthoredClientWebsite } from "../client-experience/load-client-experience";
import {
  composeCurrentManagedWebsite,
  managedWebsiteRenderers,
} from "../managed-website";
import { ManagedWebsiteShell } from "../rendering";
import {
  buildManagedRouteMetadata,
  buildManagedWebsiteJsonLd,
  serializeStructuredData,
} from "../structured-data";

/**
 * The root route.
 *
 * A legacy (`schemaVersion: 1`) definition renders the existing one-page shell
 * unchanged. An authored definition resolves its validated home page and renders
 * it through the client's own route component. The mode comes from validation,
 * never from a file happening to exist on disk.
 */
export function generateMetadata(): Metadata {
  if (!isAuthoredClientWebsite()) return {};
  return buildManagedRouteMetadata(
    composeCurrentManagedWebsite(),
    authoredHomePage(),
  );
}

export default function HomePage() {
  const composition = composeCurrentManagedWebsite();
  const jsonLd = buildManagedWebsiteJsonLd(composition);
  const structuredData =
    jsonLd === undefined ? null : (
      <script
        dangerouslySetInnerHTML={{ __html: serializeStructuredData(jsonLd) }}
        type="application/ld+json"
      />
    );

  if (isAuthoredClientWebsite()) {
    return (
      <>
        {structuredData}
        {renderAuthoredPage(authoredHomePage())}
      </>
    );
  }

  return (
    <>
      {structuredData}
      <ManagedWebsiteShell
        composition={composition}
        renderers={managedWebsiteRenderers}
      />
    </>
  );
}
