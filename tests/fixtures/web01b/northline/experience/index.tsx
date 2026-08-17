import { defineClientExperience } from "@proportion/client-experience";

import { Conductor } from "./components/Conductor";
import { AboutRoute, ContactRoute } from "./routes/AboutContactRoutes";
import { HomeRoute } from "./routes/HomeRoute";
import { ProjectDetailRoute } from "./routes/ProjectDetailRoute";
import { NotFoundRoute } from "./routes/NotFoundRoute";
import { ProjectsIndexRoute } from "./routes/ProjectsIndexRoute";
import {
  ServiceDetailRoute,
  ServicesIndexRoute,
} from "./routes/ServicesRoutes";

/**
 * Harbour Electrical & Air — "Drawn to code".
 *
 * The direction passed the founder Creative Gate with named fixes on
 * 2026-08-17 (see acceptance/creative-gate-decision.md) and is scaled here to
 * the full route set. That PASS authorises scaling only; it is not final
 * WEB-01B acceptance.
 */
export const authoredClientExperience = defineClientExperience({
  schemaVersion: 1,
  experienceId: "harbour-drawn-to-code",
  experienceVersion: "0.1.0",
  routes: {
    home: HomeRoute,
    "services-index": ServicesIndexRoute,
    "service-detail": ServiceDetailRoute,
    "projects-index": ProjectsIndexRoute,
    "project-detail": ProjectDetailRoute,
    about: AboutRoute,
    contact: ContactRoute,
  },
  notFound: NotFoundRoute,
  signatures: {
    conductor: () => <Conductor nodeCount={4} />,
  },
});

export default authoredClientExperience;
