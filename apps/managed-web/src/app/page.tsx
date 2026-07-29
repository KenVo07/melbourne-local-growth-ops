import {
  composeCurrentManagedWebsite,
  managedWebsiteRenderers,
} from "../managed-website";
import { ManagedWebsiteShell } from "../rendering";

export default function HomePage() {
  return (
    <ManagedWebsiteShell
      composition={composeCurrentManagedWebsite()}
      renderers={managedWebsiteRenderers}
    />
  );
}
