import { link, mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  inspectClientExperienceSource,
  ClientExperienceSourcePolicyError,
} from "../../../apps/managed-web/src/generation/client-experience-source-policy";

const manifest = {
  schemaVersion: 1,
  kind: "AUTHORED_CLIENT_EXPERIENCE",
  experienceId: "northline",
  experienceVersion: "1.0.0",
  entrypoint: "index.tsx",
  designDnaPath: "design-dna.json",
  routeIds: ["home"],
  signatureIds: [],
  publicDependencies: [{ name: "motion", version: "12.43.0" }],
  runtime: {
    clientJavaScript: "COMPONENT_SCOPED",
    motion: "CLIENT_LIBRARY",
    reducedMotion: "REQUIRED",
  },
} as const;

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "client-experience-policy-"));
  const experience = join(root, "experience");
  await mkdir(experience, { recursive: true });
  const allFiles = {
    "manifest.json": JSON.stringify(manifest),
    "design-dna.json": JSON.stringify({ schemaVersion: 1 }),
    "index.tsx":
      'import { defineClientExperience } from "@proportion/client-experience";\nexport default defineClientExperience({ schemaVersion: 1, experienceId: "northline", experienceVersion: "1.0.0", routes: { home: () => null } });\n',
    ...files,
  };
  for (const [path, content] of Object.entries(allFiles)) {
    const destination = join(experience, ...path.split("/"));
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, content);
  }
  return root;
}

/** Asserts one authored source file is refused, with an optional exact code. */
async function expectRejectedSource(
  source: string,
  code?: string,
): Promise<void> {
  const root = await fixture({ "routes/Home.tsx": source });
  const inspection = inspectClientExperienceSource({
    inputDirectory: root,
    manifest: manifest as never,
    approvedPublicDependencies: ["motion"],
  });
  await (code === undefined
    ? expect(inspection).rejects.toBeInstanceOf(ClientExperienceSourcePolicyError)
    : expect(inspection).rejects.toMatchObject({ code }));
}

describe("client experience source policy", () => {
  it("accepts fixed public imports, relative source and approved declared dependencies", async () => {
    const root = await fixture({
      "routes/Home.tsx":
        '"use client";\nimport type { ClientExperienceRouteProps } from "@proportion/client-experience";\nimport { m } from "motion/react-m";\nimport data from "../data.json";\nimport "../styles/site.css";\nexport const Home = ({ platform }: ClientExperienceRouteProps) => <m.div>{data.title}<platform.Link href="/projects">Projects</platform.Link></m.div>;\n',
      "data.json": JSON.stringify({ title: "Home" }),
      "styles/site.css": ".site { display: grid; }",
    });
    const result = await inspectClientExperienceSource({
      inputDirectory: root,
      manifest: manifest as never,
      approvedPublicDependencies: ["motion"],
    });

    expect(result.entrypoint).toBe("index.tsx");
    expect(result.publicDependencies).toEqual(["motion"]);
    expect(result.files.some(({ clientRuntime }) => clientRuntime)).toBe(true);
    expect(result.files.map(({ path }) => path)).toEqual([
      "data.json",
      "design-dna.json",
      "index.tsx",
      "manifest.json",
      "routes/Home.tsx",
      "styles/site.css",
    ]);
    // Every inspected file is hashed and classified for the artifact descriptor.
    expect(
      result.files.every(({ sha256 }) => /^[0-9a-f]{64}$/.test(sha256)),
    ).toBe(true);
    expect(
      result.files.find(({ path }) => path === "manifest.json")?.kind,
    ).toBe("MANIFEST");
    expect(
      result.files.find(({ path }) => path === "styles/site.css")?.kind,
    ).toBe("STYLE");
  });

  it("marks server-only authored source as not client runtime", async () => {
    const root = await fixture({
      "routes/Home.tsx": "export const Home = () => <section>Static</section>;\n",
    });
    const result = await inspectClientExperienceSource({
      inputDirectory: root,
      manifest: manifest as never,
      approvedPublicDependencies: ["motion"],
    });

    expect(
      result.files.find(({ path }) => path === "routes/Home.tsx")?.clientRuntime,
    ).toBe(false);
  });

  describe("filesystem boundary", () => {
    it("rejects a symlinked file", async () => {
      const root = await fixture({});
      await symlink("/etc/passwd", join(root, "experience", "escape.ts"));
      await expect(
        inspectClientExperienceSource({
          inputDirectory: root,
          manifest: manifest as never,
          approvedPublicDependencies: ["motion"],
        }),
      ).rejects.toMatchObject({ code: "SYMLINK_FORBIDDEN" });
    });

    it("rejects a symlinked directory", async () => {
      const root = await fixture({});
      await symlink("/etc", join(root, "experience", "config"));
      await expect(
        inspectClientExperienceSource({
          inputDirectory: root,
          manifest: manifest as never,
          approvedPublicDependencies: ["motion"],
        }),
      ).rejects.toMatchObject({ code: "SYMLINK_FORBIDDEN" });
    });

    it("rejects a missing source directory", async () => {
      const root = await mkdtemp(join(tmpdir(), "client-experience-policy-"));
      await expect(
        inspectClientExperienceSource({
          inputDirectory: root,
          manifest: manifest as never,
          approvedPublicDependencies: ["motion"],
        }),
      ).rejects.toMatchObject({ code: "SOURCE_DIRECTORY_MISSING" });
    });

    it("rejects a missing entrypoint", async () => {
      const root = await mkdtemp(join(tmpdir(), "client-experience-policy-"));
      const experience = join(root, "experience");
      await mkdir(experience, { recursive: true });
      await writeFile(
        join(experience, "manifest.json"),
        JSON.stringify(manifest),
      );
      await writeFile(join(experience, "design-dna.json"), "{}");
      await expect(
        inspectClientExperienceSource({
          inputDirectory: root,
          manifest: manifest as never,
          approvedPublicDependencies: ["motion"],
        }),
      ).rejects.toMatchObject({ code: "ENTRYPOINT_MISSING" });
    });

    it("rejects configuration, environment, package and lock files", async () => {
      for (const path of [
        ".env",
        ".env.production",
        "package.json",
        "pnpm-lock.yaml",
        "next.config.ts",
      ]) {
        const root = await fixture({ [path]: "x" });
        await expect(
          inspectClientExperienceSource({
            inputDirectory: root,
            manifest: manifest as never,
            approvedPublicDependencies: ["motion"],
          }),
        ).rejects.toMatchObject({ code: "FILE_NAME_FORBIDDEN" });
      }
    });

    it("rejects API and server runtime boundaries inside authored source", async () => {
      for (const path of ["app/api/route.ts", "server/secrets.ts"]) {
        const root = await fixture({ [path]: "export const x = 1;\n" });
        await expect(
          inspectClientExperienceSource({
            inputDirectory: root,
            manifest: manifest as never,
            approvedPublicDependencies: ["motion"],
          }),
        ).rejects.toMatchObject({ code: "FILE_NAME_FORBIDDEN" });
      }
    });

    it("rejects unsupported file extensions", async () => {
      const root = await fixture({ "scripts/build.sh": "#!/bin/sh\n" });
      await expect(
        inspectClientExperienceSource({
          inputDirectory: root,
          manifest: manifest as never,
          approvedPublicDependencies: ["motion"],
        }),
      ).rejects.toMatchObject({ code: "FILE_TYPE_FORBIDDEN" });
    });
  });

  describe("import boundary", () => {
    it("rejects undeclared bare imports", async () => {
      await expectRejectedSource(
        'import { animate } from "gsap"; export const Home = () => null;\n',
        "IMPORT_FORBIDDEN",
      );
    });

    it("rejects private workspace imports", async () => {
      await expectRejectedSource(
        'import x from "@melbourne-local-growth-ops/site-core"; export const Home = () => String(x);\n',
        "IMPORT_FORBIDDEN",
      );
    });

    it("rejects Node built-ins with and without the node: prefix", async () => {
      for (const specifier of [
        "node:fs",
        "fs",
        "child_process",
        "path",
        "crypto",
      ]) {
        await expectRejectedSource(
          `import x from "${specifier}"; export const Home = () => String(x);\n`,
          "IMPORT_FORBIDDEN",
        );
      }
    });

    it("rejects every Next entrypoint, including server and header primitives", async () => {
      for (const specifier of [
        "next/link",
        "next/image",
        "next/server",
        "next/headers",
        "next/navigation",
        "server-only",
      ]) {
        await expectRejectedSource(
          `import x from "${specifier}"; export const Home = () => String(x);\n`,
          "IMPORT_FORBIDDEN",
        );
      }
    });

    it("rejects a relative import that escapes the fixed source root", async () => {
      await expectRejectedSource(
        'import secret from "../../client-website.json"; export const Home = () => String(secret);\n',
        "PATH_ESCAPE",
      );
    });

    it("rejects an absolute import", async () => {
      await expectRejectedSource(
        'import secret from "/etc/passwd"; export const Home = () => String(secret);\n',
        "IMPORT_FORBIDDEN",
      );
    });

    it("rejects a relative import that resolves to no inspected file", async () => {
      await expectRejectedSource(
        'import missing from "./Missing"; export const Home = () => String(missing);\n',
        "IMPORT_FORBIDDEN",
      );
    });

    it("rejects re-exports through a forbidden specifier", async () => {
      await expectRejectedSource(
        'export * from "next/link";\n',
        "IMPORT_FORBIDDEN",
      );
      await expectRejectedSource(
        'export { readFile } from "node:fs/promises";\n',
        "IMPORT_FORBIDDEN",
      );
    });

    it("rejects a template-literal dynamic import", async () => {
      await expectRejectedSource(
        "export async function load(name: string) { await import(`./routes/${name}`); }\n",
        "DYNAMIC_IMPORT_FORBIDDEN",
      );
    });

    it("rejects a non-literal dynamic import", async () => {
      await expectRejectedSource(
        'const name = "./Other"; export async function load() { await import(name); }\n',
        "DYNAMIC_IMPORT_FORBIDDEN",
      );
    });

    it("rejects import-equals require syntax", async () => {
      await expectRejectedSource(
        'import fs = require("fs");\nexport const Home = () => String(fs);\n',
        "IMPORT_FORBIDDEN",
      );
    });

    it("requires governance approval in addition to manifest declaration", async () => {
      const root = await fixture({});
      await expect(
        inspectClientExperienceSource({
          inputDirectory: root,
          manifest: manifest as never,
          approvedPublicDependencies: [],
        }),
      ).rejects.toMatchObject({ code: "IMPORT_FORBIDDEN" });
    });

    it("refuses a boundary-bypassing package even when declared and approved", async () => {
      const nextManifest = {
        ...manifest,
        publicDependencies: [{ name: "next", version: "16.2.12" }],
      };
      const root = await fixture({});
      await expect(
        inspectClientExperienceSource({
          inputDirectory: root,
          manifest: nextManifest as never,
          // Even an operator mistake that approves `next` must not open the gate.
          approvedPublicDependencies: ["next"],
        }),
      ).rejects.toMatchObject({ code: "IMPORT_FORBIDDEN" });
    });
  });

  describe("execution and server primitives", () => {
    it("rejects a module-scope use server directive", async () => {
      await expectRejectedSource(
        '"use server";\nexport const Home = () => null;\n',
        "EXECUTION_PRIMITIVE_FORBIDDEN",
      );
    });

    it("rejects a use server directive nested inside a function body", async () => {
      await expectRejectedSource(
        'export async function submit(data: FormData) { "use server"; return data; }\n',
        "EXECUTION_PRIMITIVE_FORBIDDEN",
      );
    });

    it("rejects eval, require, Function and their member-access forms", async () => {
      for (const source of [
        'export const run = () => eval("1");\n',
        'export const run = () => require("fs");\n',
        'export const run = () => new Function("return 1");\n',
        'export const run = () => Function("return 1")();\n',
        'export const run = () => globalThis.eval("1");\n',
        'export const run = () => window.eval("1");\n',
      ]) {
        await expectRejectedSource(source, "EXECUTION_PRIMITIVE_FORBIDDEN");
      }
    });

    it("rejects every process reference, not only process.env member access", async () => {
      for (const source of [
        "export const key = process.env.SECRET;\n",
        'export const key = process.env["SECRET"];\n',
        'export const key = process["env"].SECRET;\n',
        "const p = process; export const key = p.env.SECRET;\n",
      ]) {
        await expectRejectedSource(source, "ENVIRONMENT_ACCESS_FORBIDDEN");
      }
    });

    it("rejects source the parser cannot fully understand", async () => {
      await expectRejectedSource(
        "export const broken = (((;\n",
        "SOURCE_PARSE_ERROR",
      );
    });
  });

  describe("network and persistent state", () => {
    it("rejects direct network I/O in call and construct forms", async () => {
      for (const source of [
        'export async function load() { return fetch("https://example.com"); }\n',
        'export const socket = new WebSocket("wss://example.com");\n',
        'export const stream = new EventSource("https://example.com");\n',
        "export const request = new XMLHttpRequest();\n",
        'export const send = () => navigator.sendBeacon("/x");\n',
        'export const worker = new Worker("./w.js");\n',
        'export const load = () => window.fetch("https://example.com");\n',
      ]) {
        await expectRejectedSource(source, "NETWORK_ACCESS_FORBIDDEN");
      }
    });

    it("rejects persistent browser storage", async () => {
      for (const source of [
        'export function save() { localStorage.setItem("x", "y"); }\n',
        'export function save() { window.localStorage.setItem("x", "y"); }\n',
        'export function save() { sessionStorage.setItem("x", "y"); }\n',
        'export function open() { return indexedDB.open("db"); }\n',
      ]) {
        await expectRejectedSource(source, "BROWSER_STATE_FORBIDDEN");
      }
    });

    it("rejects document cookie access through any expression chain", async () => {
      for (const source of [
        'export function save() { document.cookie = "a=b"; }\n',
        'export function save() { window.document.cookie = "a=b"; }\n',
        'export function read() { return document["cookie"]; }\n',
      ]) {
        await expectRejectedSource(source, "BROWSER_STATE_FORBIDDEN");
      }
    });
  });

  describe("markup and URL injection", () => {
    it("rejects dangerouslySetInnerHTML as an attribute and as an object property", async () => {
      for (const source of [
        'export const Unsafe = () => <div dangerouslySetInnerHTML={{ __html: "<b>x</b>" }} />;\n',
        'const props = { dangerouslySetInnerHTML: { __html: "<b>x</b>" } };\nexport const Unsafe = () => <div {...props} />;\n',
      ]) {
        await expectRejectedSource(source, "UNSAFE_MARKUP_FORBIDDEN");
      }
    });

    it("rejects innerHTML style assignment", async () => {
      for (const source of [
        'export function write(el: HTMLElement) { el.innerHTML = "<b>x</b>"; }\n',
        'export function write(el: HTMLElement) { el.outerHTML = "<b>x</b>"; }\n',
        'export function write(el: HTMLElement) { el.insertAdjacentHTML("beforeend", "<b>x</b>"); }\n',
      ]) {
        await expectRejectedSource(source, "UNSAFE_MARKUP_FORBIDDEN");
      }
    });

    it("rejects raw script, iframe, object and embed markup", async () => {
      for (const tag of ["script", "iframe", "object", "embed", "base", "meta"]) {
        await expectRejectedSource(
          `export const Unsafe = () => <${tag} />;\n`,
          "UNSAFE_MARKUP_FORBIDDEN",
        );
      }
    });

    it("rejects raw anchor, image and form elements that bypass Platform primitives", async () => {
      for (const source of [
        'export const Link = () => <a href="/projects">Projects</a>;\n',
        'export const Picture = () => <img alt="x" src="/x.png" />;\n',
        'export const Enquiry = () => <form action="/api/x"><button>Send</button></form>;\n',
      ]) {
        await expectRejectedSource(source, "UNSAFE_MARKUP_FORBIDDEN");
      }
    });

    it("allows Platform and client-local components whose names are not intrinsic", async () => {
      const root = await fixture({
        "routes/Home.tsx":
          'import type { ClientExperienceRouteProps } from "@proportion/client-experience";\nexport const Home = ({ platform }: ClientExperienceRouteProps) => <section><platform.Link href="/projects">Projects</platform.Link><platform.Image assetId="site/hero" sizes="100vw" /></section>;\n',
      });
      await expect(
        inspectClientExperienceSource({
          inputDirectory: root,
          manifest: manifest as never,
          approvedPublicDependencies: ["motion"],
        }),
      ).resolves.toMatchObject({ entrypoint: "index.tsx" });
    });

    it("rejects executable and remote-code URLs", async () => {
      for (const source of [
        'export const href = "javascript:alert(1)";\n',
        'export const href = "JavaScript:alert(1)";\n',
        'export const href = "java\\u0009script:alert(1)";\n',
        'export const href = "data:text/html;base64,PHNjcmlwdD4=";\n',
      ]) {
        await expectRejectedSource(source, "UNSAFE_URL_FORBIDDEN");
      }
    });
  });

  describe("stylesheet boundary", () => {
    it("rejects remote and local CSS imports", async () => {
      for (const css of [
        '@import url("https://example.com/style.css");',
        '@import "./other.css";',
      ]) {
        const root = await fixture({ "styles/site.css": css });
        await expect(
          inspectClientExperienceSource({
            inputDirectory: root,
            manifest: manifest as never,
            approvedPublicDependencies: ["motion"],
          }),
        ).rejects.toMatchObject({ code: "CSS_RESOURCE_REFERENCE_FORBIDDEN" });
      }
    });

    it("rejects CSS url() assets that bypass inspected Platform media", async () => {
      const root = await fixture({
        "styles/site.css": '.hero { background-image: url("/assets/hero.png"); }',
      });
      await expect(
        inspectClientExperienceSource({
          inputDirectory: root,
          manifest: manifest as never,
          approvedPublicDependencies: ["motion"],
        }),
      ).rejects.toMatchObject({ code: "CSS_RESOURCE_REFERENCE_FORBIDDEN" });
    });

    it("rejects legacy CSS execution primitives", async () => {
      for (const css of [
        ".x { width: expression(alert(1)); }",
        ".x { behavior: url(#default#time2); }",
        ".x { -moz-binding: url(evil.xml#xss); }",
      ]) {
        const root = await fixture({ "styles/site.css": css });
        await expect(
          inspectClientExperienceSource({
            inputDirectory: root,
            manifest: manifest as never,
            approvedPublicDependencies: ["motion"],
          }),
        ).rejects.toBeInstanceOf(ClientExperienceSourcePolicyError);
      }
    });
  });

  /**
   * Every case below was reported by an independent adversarial review of this
   * scanner and verified to bypass it before the rules were hardened. They stay
   * as regression cover.
   */
  describe("adversarial review regressions", () => {
    it("rejects path traversal inside an approved package specifier", async () => {
      for (const specifier of [
        "motion/../next/link",
        "motion/../../secret.js",
        "motion/./../next/image",
        "@proportion/client-experience/../../etc/passwd",
      ]) {
        await expectRejectedSource(
          `import x from "${specifier}"; export const Home = () => String(x);\n`,
          "IMPORT_FORBIDDEN",
        );
      }
    });

    it("still accepts an ordinary subpath of an approved package", async () => {
      const root = await fixture({
        "routes/Home.tsx":
          '"use client";\nimport { m } from "motion/react-m";\nexport const Home = () => <m.div />;\n',
      });
      await expect(
        inspectClientExperienceSource({
          inputDirectory: root,
          manifest: manifest as never,
          approvedPublicDependencies: ["motion"],
        }),
      ).resolves.toMatchObject({ entrypoint: "index.tsx" });
    });

    it("rejects CSS identifier escapes that hide a resource reference", async () => {
      for (const css of [
        '@\\69 mport "https://evil.example/x.css";',
        '.hero { background: u\\72 l("https://evil.example/pixel.png"); }',
      ]) {
        const root = await fixture({ "styles/site.css": css });
        await expect(
          inspectClientExperienceSource({
            inputDirectory: root,
            manifest: manifest as never,
            approvedPublicDependencies: ["motion"],
          }),
        ).rejects.toMatchObject({ code: "CSS_RESOURCE_REFERENCE_FORBIDDEN" });
      }
    });

    it("rejects CSS remote references that never write url()", async () => {
      for (const css of [
        '.hero { background-image: image-set("https://evil.example/t.png" 1x); }',
        '@font-face { font-family: X; src: src("https://evil.example/f.woff2"); }',
      ]) {
        const root = await fixture({ "styles/site.css": css });
        await expect(
          inspectClientExperienceSource({
            inputDirectory: root,
            manifest: manifest as never,
            approvedPublicDependencies: ["motion"],
          }),
        ).rejects.toMatchObject({ code: "CSS_RESOURCE_REFERENCE_FORBIDDEN" });
      }
    });

    it("rejects intrinsic elements created through a JSX factory", async () => {
      for (const source of [
        'import { createElement } from "react";\nexport const Home = () => createElement("script", null, "alert(1)");\n',
        'import { jsx } from "react/jsx-runtime";\nexport const Home = () => jsx("iframe", { src: "https://evil.example" });\n',
        'import { createElement } from "react";\nconst tag = "iframe";\nexport const Home = () => createElement(tag, null);\n',
      ]) {
        await expectRejectedSource(source, "UNSAFE_MARKUP_FORBIDDEN");
      }
    });

    it("rejects a variable, namespaced or member JSX tag that could be intrinsic", async () => {
      for (const source of [
        'const Tag = "iframe" as never;\nexport const Home = () => <Tag />;\n',
        "export const Home = () => <svg:script />;\n",
        'const H = { a: "a" } as never;\nexport const Home = () => <H.a href="/x" />;\n',
      ]) {
        await expectRejectedSource(source, "UNSAFE_MARKUP_FORBIDDEN");
      }
    });

    it("rejects execution primitives behind a cast, sequence or constructor chain", async () => {
      for (const source of [
        'export const run = () => (eval as never)("stolen()");\n',
        'export const run = () => (0, eval)("stolen()");\n',
        'export const run = () => new (Function as never)("return 1")();\n',
        'export const run = () => ({}).constructor.constructor("return 1")();\n',
        'export const later = () => setTimeout("alert(1)", 0);\n',
      ]) {
        await expectRejectedSource(source, "EXECUTION_PRIMITIVE_FORBIDDEN");
      }
    });

    it("rejects network access behind a cast or an alias", async () => {
      for (const source of [
        'export const go = () => (fetch as never)("https://evil.example");\n',
        "const { fetch: send } = window;\nexport const exfil = () => send(\"https://evil.example\");\n",
        'export const ping = () => { const i = new Image(); i.src = "https://evil.example/c"; };\n',
        'export const sw = () => navigator.serviceWorker.register("/sw.js");\n',
      ]) {
        await expectRejectedSource(source, "NETWORK_ACCESS_FORBIDDEN");
      }
    });

    it("rejects computed global access to environment and storage", async () => {
      await expectRejectedSource(
        'export const key = (globalThis as never)["process"].env.SECRET;\n',
        "ENVIRONMENT_ACCESS_FORBIDDEN",
      );
      await expectRejectedSource(
        'export const save = () => (globalThis as never)["localStorage"].setItem("a", "b");\n',
        "BROWSER_STATE_FORBIDDEN",
      );
      await expectRejectedSource(
        "export const key = import.meta.env.SECRET;\n",
        "ENVIRONMENT_ACCESS_FORBIDDEN",
      );
    });

    it("rejects DOM script injection and raw document writes", async () => {
      for (const source of [
        'export function boot() { const s = document.createElement("script"); document.head.appendChild(s); }\n',
        'export function w() { document.write("<script>alert(1)</script>"); }\n',
        'export function html(el: Element) { el.append(document.createRange().createContextualFragment("<img src=x onerror=alert(1)>")); }\n',
      ]) {
        await expectRejectedSource(source, "UNSAFE_MARKUP_FORBIDDEN");
      }
    });

    it("rejects a use server directive hidden behind a unicode escape", async () => {
      await expectRejectedSource(
        'export async function submit(d: FormData) { "use serve\\u0072"; return d; }\n',
        "EXECUTION_PRIMITIVE_FORBIDDEN",
      );
    });

    it("honours use client only at module scope", async () => {
      const root = await fixture({
        "routes/Home.tsx":
          'export function Home() { function inner() { "use client"; return 1; } return <section>{inner()}</section>; }\n',
      });
      const result = await inspectClientExperienceSource({
        inputDirectory: root,
        manifest: manifest as never,
        approvedPublicDependencies: ["motion"],
      });
      // React ignores a nested directive, so the file is not a client component.
      expect(
        result.files.find(({ path }) => path === "routes/Home.tsx")
          ?.clientRuntime,
      ).toBe(false);
    });

    it("rejects an executable URL built from a template or concatenation", async () => {
      for (const source of [
        "export const href = `javascript:alert(1)`;\n",
        'export const href = "javas" + "cript:alert(1)";\n',
      ]) {
        await expectRejectedSource(source, "UNSAFE_URL_FORBIDDEN");
      }
    });

    it("rejects a hard link that smuggles a file from outside the root", async () => {
      const root = await fixture({});
      const outside = await mkdtemp(join(tmpdir(), "client-experience-outside-"));
      const secret = join(outside, "secrets.json");
      await writeFile(secret, JSON.stringify({ SMTP_PASSWORD: "hunter2" }));
      await link(secret, join(root, "experience", "vendor.json"));
      await expect(
        inspectClientExperienceSource({
          inputDirectory: root,
          manifest: manifest as never,
          approvedPublicDependencies: ["motion"],
        }),
      ).rejects.toMatchObject({ code: "SYMLINK_FORBIDDEN" });
    });
  });

  /**
   * An unusable policy gets relaxed, and a relaxed policy loses the rules above.
   * These assert that ordinary premium authored work is still accepted.
   */
  describe("legitimate authored work is not rejected", () => {
    async function expectAccepted(
      files: Record<string, string>,
    ): Promise<void> {
      const root = await fixture(files);
      await expect(
        inspectClientExperienceSource({
          inputDirectory: root,
          manifest: manifest as never,
          approvedPublicDependencies: ["motion"],
        }),
      ).resolves.toMatchObject({ entrypoint: "index.tsx" });
    }

    it('allows content that happens to be named "process"', async () => {
      await expectAccepted({
        "routes/Home.tsx":
          'export const copy = { process: { title: "Our process" } };\nexport const Home = ({ studio }: never) => <section>{(studio as never as { process: string[] }).process.map((step) => <p key={step}>{step}</p>)}</section>;\n',
      });
    });

    it("allows a self-hosted font face and an inline SVG mask", async () => {
      await expectAccepted({
        "styles/site.css":
          '@font-face { font-family: "Nl"; src: url("/fonts/nl.woff2") format("woff2"); }\n.x { mask-image: url("data:image/svg+xml;utf8,<svg/>"); }',
      });
    });

    it("allows prose that begins with a scheme-like word", async () => {
      await expectAccepted({
        "routes/Home.tsx":
          'export const title = "JavaScript: The Good Parts";\nexport const Home = () => <p>{title}</p>;\n',
      });
    });

    it("refuses a scheme-like value in a real URL position", async () => {
      for (const source of [
        'export const Home = ({ platform }: never) => <platform.Link href="javascript:alert(1)">x</platform.Link>;\n',
        'const props = { href: "JavaScript: alert(1)" };\nexport const Home = () => <section {...props} />;\n',
      ]) {
        await expectRejectedSource(source, "UNSAFE_URL_FORBIDDEN");
      }
    });

    it("allows CSS comments that mention forbidden constructs", async () => {
      await expectAccepted({
        "styles/site.css":
          "/* see url( docs ) and expression (of intent) */\n.x { color: red; }",
      });
    });

    it("allows a decorated class", async () => {
      await expectAccepted({
        "routes/helpers.ts":
          "const dec = (target: never) => target;\n@dec\nexport class Motion {}\n",
      });
    });
  });
});
