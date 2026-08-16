import { copyFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { close, createIndex } from "pagefind";

import type { RuntimeFoundationSearch } from "../runtime-types";

export interface FoundationSearchBuildResult {
  readonly enabled: boolean;
  readonly recordCount: number;
  readonly outputDirectory: string;
}

/**
 * Builds one isolated Pagefind index from already-validated public records.
 * Disabled builds always remove stale output before returning.
 */
export async function buildFoundationSearchIndex(
  search: RuntimeFoundationSearch,
  outputDirectory: string,
): Promise<FoundationSearchBuildResult> {
  await rm(outputDirectory, { recursive: true, force: true });
  if (!search.enabled) {
    return { enabled: false, recordCount: 0, outputDirectory };
  }

  const created = await createIndex({ writePlayground: false });
  assertNoPagefindErrors("create index", created.errors);
  if (created.index === undefined) {
    throw new Error("Pagefind failed to create an isolated index.");
  }

  try {
    for (const record of search.records) {
      const added = await created.index.addCustomRecord({
        url: record.url,
        content: record.content,
        language: record.language,
        meta: { ...record.meta },
        filters: Object.fromEntries(
          Object.entries(record.filters).map(([key, values]) => [key, [...values]]),
        ),
      });
      assertNoPagefindErrors(`add record ${record.meta.sectionId}`, added.errors);
    }

    const written = await created.index.writeFiles({ outputPath: outputDirectory });
    assertNoPagefindErrors("write index", written.errors);
    await copyFile(
      new URL("./foundation-search-browser.js", import.meta.url),
      join(outputDirectory, "foundation-search.js"),
    );
  } finally {
    await created.index.deleteIndex();
    await close();
  }

  return {
    enabled: true,
    recordCount: search.records.length,
    outputDirectory,
  };
}

function assertNoPagefindErrors(operation: string, errors: readonly string[]): void {
  if (errors.length > 0) {
    throw new Error(`Pagefind could not ${operation}: ${errors.join("; ")}`);
  }
}
