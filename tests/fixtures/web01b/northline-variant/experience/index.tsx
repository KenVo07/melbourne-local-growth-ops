import { defineClientExperience } from "@proportion/client-experience";

import {
  AboutRoute,
  ContactRoute,
  HomeRoute,
  NotFoundRoute,
  ProjectDetailRoute,
  ProjectsIndexRoute,
  ServiceDetailRoute,
  ServicesIndexRoute,
} from "./routes/routes";

/**
 * "Night shift" — the WEB-01B same-profile variation proof.
 *
 * Identical Kernel, profile, page graph, projects, modules and connectors as
 * the flagship "drawn to code" experience. Only this authored source differs.
 * Bounded deliberately: it need not match the flagship's polish, only prove that
 * a second Contractor site can be materially unrelated without forking Core, a
 * Profile Pack or the repository, and without a fourth template appearing.
 */
export const authoredClientExperience = defineClientExperience({
  schemaVersion: 1,
  experienceId: "harbour-night-shift",
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
});

export default authoredClientExperience;
