import { describe, expect, it } from "vitest";

import { SameOriginGuard } from "../../../apps/managed-web/src/server/contact-guards";

describe("SameOriginGuard", () => {
  const guard = new SameOriginGuard();

  it("allows requests with matching Origin header", () => {
    const request = new Request("https://example.com.au/api/contact", {
      method: "POST",
      headers: { origin: "https://example.com.au" },
    });

    const decision = guard.check(request);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  it("allows requests with matching Referer header", () => {
    const request = new Request("https://example.com.au/api/contact", {
      method: "POST",
      headers: { referer: "https://example.com.au/contact" },
    });

    const decision = guard.check(request);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  it("allows requests with both matching headers", () => {
    const request = new Request("https://example.com.au/api/contact", {
      method: "POST",
      headers: {
        origin: "https://example.com.au",
        referer: "https://example.com.au/contact",
      },
    });

    const decision = guard.check(request);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  it("rejects requests with mismatched Origin", () => {
    const request = new Request("https://example.com.au/api/contact", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });

    const decision = guard.check(request);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("CROSS_SITE_REQUEST");
  });

  it("rejects requests with mismatched Referer", () => {
    const request = new Request("https://example.com.au/api/contact", {
      method: "POST",
      headers: { referer: "https://attacker.example/page" },
    });

    const decision = guard.check(request);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("CROSS_SITE_REQUEST");
  });

  it("allows requests with neither Origin nor Referer for M1 compatibility", () => {
    const request = new Request("https://example.com.au/api/contact", {
      method: "POST",
    });

    const decision = guard.check(request);
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  it("rejects requests with malformed Origin URL", () => {
    const request = new Request("https://example.com.au/api/contact", {
      method: "POST",
      headers: { origin: "not-a-url" },
    });

    const decision = guard.check(request);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("CROSS_SITE_REQUEST");
  });

  it("rejects requests with malformed Referer URL", () => {
    const request = new Request("https://example.com.au/api/contact", {
      method: "POST",
      headers: { referer: "not-a-url" },
    });

    const decision = guard.check(request);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("CROSS_SITE_REQUEST");
  });

  it("rejects subdomain mismatches", () => {
    const request = new Request("https://example.com.au/api/contact", {
      method: "POST",
      headers: { origin: "https://www.example.com.au" },
    });

    const decision = guard.check(request);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("CROSS_SITE_REQUEST");
  });

  it("rejects scheme mismatches (http vs https)", () => {
    const request = new Request("https://example.com.au/api/contact", {
      method: "POST",
      headers: { origin: "http://example.com.au" },
    });

    const decision = guard.check(request);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("CROSS_SITE_REQUEST");
  });

  it("rejects port mismatches", () => {
    const request = new Request("https://example.com.au/api/contact", {
      method: "POST",
      headers: { origin: "https://example.com.au:8443" },
    });

    const decision = guard.check(request);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("CROSS_SITE_REQUEST");
  });

  it("allows when Origin matches and Referer is absent", () => {
    const request = new Request("https://example.com.au/api/contact", {
      method: "POST",
      headers: { origin: "https://example.com.au" },
    });

    const decision = guard.check(request);
    expect(decision.allowed).toBe(true);
  });

  it("rejects when Origin mismatches even if Referer is absent", () => {
    const request = new Request("https://example.com.au/api/contact", {
      method: "POST",
      headers: { origin: "https://other.example" },
    });

    const decision = guard.check(request);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("CROSS_SITE_REQUEST");
  });

  it("derives expected origin from request URL", () => {
    const request = new Request("https://different-host.example/api/contact", {
      method: "POST",
      headers: { origin: "https://different-host.example" },
    });

    const decision = guard.check(request);
    expect(decision.allowed).toBe(true);
  });

  it("allows explicit port 443 matching default https port", () => {
    const request = new Request("https://example.com.au:443/api/contact", {
      method: "POST",
      headers: { origin: "https://example.com.au" },
    });

    const decision = guard.check(request);
    expect(decision.allowed).toBe(true);
  });

  it("allows explicit port 80 matching default http port", () => {
    const request = new Request("http://example.com.au:80/api/contact", {
      method: "POST",
      headers: { origin: "http://example.com.au" },
    });

    const decision = guard.check(request);
    expect(decision.allowed).toBe(true);
  });
});
