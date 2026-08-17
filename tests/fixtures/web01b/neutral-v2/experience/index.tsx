import { defineClientExperience } from "@proportion/client-experience";

import {
  ProjectDetailRoute,
  ProjectsIndexRoute,
} from "./routes/projects";
import {
  AboutRoute,
  ContactRoute,
  HomeRoute,
  ServiceDetailRoute,
  ServicesIndexRoute,
} from "./routes/simple";

/**
 * Neutral functional fixture.
 *
 * Its only purpose is to prove multi-route generation, content resolution,
 * media, metadata and 404 behaviour in isolation from any creative decision.
 * It is explicitly not the reference-class proof and must never be presented as
 * evidence of art direction, motion or responsive quality.
 */
export const authoredClientExperience = defineClientExperience({
  schemaVersion: 1,
  experienceId: "neutral-functional",
  experienceVersion: "1.0.0",
  routes: {
    home: HomeRoute,
    "services-index": ServicesIndexRoute,
    "service-detail": ServiceDetailRoute,
    "projects-index": ProjectsIndexRoute,
    "project-detail": ProjectDetailRoute,
    about: AboutRoute,
    contact: ContactRoute,
  },
});

export default authoredClientExperience;
