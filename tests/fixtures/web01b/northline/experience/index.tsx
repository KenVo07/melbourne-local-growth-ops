import { defineClientExperience } from "@proportion/client-experience";

import { Conductor } from "./components/Conductor";
import { HomeRoute } from "./routes/HomeRoute";
import { ProjectDetailRoute } from "./routes/ProjectDetailRoute";
import { ProjectsIndexRoute } from "./routes/ProjectsIndexRoute";

/**
 * Harbour Electrical & Air — "Drawn to code".
 *
 * SIGNATURE SLICE ONLY. This covers Home, the record register and one project
 * document: enough to judge the direction before the remaining routes are
 * built. It is proposed for the founder Creative Gate and is not approved.
 */
export const authoredClientExperience = defineClientExperience({
  schemaVersion: 1,
  experienceId: "harbour-drawn-to-code",
  experienceVersion: "0.1.0",
  routes: {
    home: HomeRoute,
    "projects-index": ProjectsIndexRoute,
    "project-detail": ProjectDetailRoute,
  },
  signatures: {
    conductor: () => <Conductor nodeCount={4} />,
  },
});

export default authoredClientExperience;
