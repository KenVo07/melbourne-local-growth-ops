import type { InfrastructureKind } from "@melbourne-local-growth-ops/contracts";
import { describe, expect, it } from "vitest";

import {
  createWebsiteModuleRegistry,
  WebsiteModulePipelineError,
  type WebsiteModuleContract,
} from "./index.js";

function moduleContract(
  type: WebsiteModuleContract["type"],
  version: string,
  dependencies: WebsiteModuleContract["dependencies"] = [],
): WebsiteModuleContract {
  return {
    type,
    version,
    executionBoundary: "RENDER_ONLY",
    dependencies,
    portability: "TRANSFERABLE",
    analyticsEvents: [],
    fallback: {
      strategy: "ERROR",
      description: `${type} requires a renderer.`,
    },
  };
}

function capturePipelineError(
  operation: () => unknown,
): WebsiteModulePipelineError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(WebsiteModulePipelineError);
    return error as WebsiteModulePipelineError;
  }

  throw new Error("Expected a WebsiteModulePipelineError");
}

describe("WebsiteModuleRegistry", () => {
  it("lists registrations deterministically regardless of input order", () => {
    const registrations = [
      moduleContract("BOOKING_CTA", "2.0.0"),
      moduleContract("ANALYTICS", "1.0.0"),
      moduleContract("BOOKING_CTA", "1.0.0"),
    ];

    const forward = createWebsiteModuleRegistry(registrations);
    const reverse = createWebsiteModuleRegistry([...registrations].reverse());

    const expected = [
      { type: "ANALYTICS", moduleVersion: "1.0.0" },
      { type: "BOOKING_CTA", moduleVersion: "1.0.0" },
      { type: "BOOKING_CTA", moduleVersion: "2.0.0" },
    ];
    expect(forward.registrations).toEqual(expected);
    expect(reverse.registrations).toEqual(expected);
  });

  it("resolves the exact module type and version", () => {
    const bookingV1 = moduleContract("BOOKING_CTA", "1.0.0");
    const bookingV2 = moduleContract("BOOKING_CTA", "2.0.0");
    const registry = createWebsiteModuleRegistry([bookingV2, bookingV1]);

    const resolved = registry.resolve({
      type: "BOOKING_CTA",
      moduleVersion: "2.0.0",
    });

    expect(resolved).toMatchObject({
      type: "BOOKING_CTA",
      version: "2.0.0",
    });
    expect(resolved).not.toBe(bookingV2);
  });

  it("rejects duplicate exact registrations", () => {
    const error = capturePipelineError(() =>
      createWebsiteModuleRegistry([
        moduleContract("BOOKING_CTA", "1.0.0"),
        moduleContract("BOOKING_CTA", "1.0.0"),
      ]),
    );

    expect(error).toMatchObject({
      code: "DUPLICATE_MODULE_REGISTRATION",
      type: "BOOKING_CTA",
      moduleVersion: "1.0.0",
    });
  });

  it("distinguishes an unregistered type from an unsupported version", () => {
    const registry = createWebsiteModuleRegistry([
      moduleContract("BOOKING_CTA", "2.0.0"),
      moduleContract("BOOKING_CTA", "1.0.0"),
    ]);

    const unknown = capturePipelineError(() =>
      registry.resolve({ type: "ANALYTICS", moduleVersion: "1.0.0" }),
    );
    const unsupported = capturePipelineError(() =>
      registry.resolve({ type: "BOOKING_CTA", moduleVersion: "3.0.0" }),
    );

    expect(unknown).toMatchObject({
      code: "UNKNOWN_MODULE",
      availableVersions: [],
    });
    expect(unsupported).toMatchObject({
      code: "UNSUPPORTED_MODULE_VERSION",
      availableVersions: ["1.0.0", "2.0.0"],
    });
  });

  it("protects registry metadata from caller mutation", () => {
    const analyticsEvents = ["booking_cta_clicked"];
    const dependencies: InfrastructureKind[] = [];
    const contract = {
      ...moduleContract("BOOKING_CTA", "1.0.0", dependencies),
      analyticsEvents,
    };
    const registry = createWebsiteModuleRegistry([contract]);

    analyticsEvents.push("mutated");
    dependencies.push("DATABASE");

    expect(
      registry.resolve({ type: "BOOKING_CTA", moduleVersion: "1.0.0" }),
    ).toMatchObject({
      dependencies: [],
      analyticsEvents: ["booking_cta_clicked"],
    });
  });
});
