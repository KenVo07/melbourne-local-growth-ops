import {
  composeCurrentManagedWebsite,
  managedWebsiteRenderers,
} from "../managed-website";
import { ManagedWebsiteShell } from "../rendering";
import {
  buildManagedWebsiteJsonLd,
  serializeStructuredData,
} from "../structured-data";

export default function HomePage() {
  const composition = composeCurrentManagedWebsite();
  const jsonLd = buildManagedWebsiteJsonLd(composition);

  return (
    <>
      {jsonLd === undefined ? null : (
        <script
          dangerouslySetInnerHTML={{ __html: serializeStructuredData(jsonLd) }}
          type="application/ld+json"
        />
      )}
      <ManagedWebsiteShell
        composition={composition}
        renderers={managedWebsiteRenderers}
      />
    </>
  );
}
