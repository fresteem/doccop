/**
 * Real-world `.docx` corpus regression tests.
 *
 * Iterates files under `<repo>/test/fixtures/real/` and asserts:
 *  1. `parse(bytes)` does not throw — the file is a valid OOXML archive
 *     that respects our hard constraints (size, XXE-free, namespaces).
 *  2. `parse(serialize(parse(bytes)))` does not throw — the round-trip
 *     is stable. We don't assert byte-equality because xmldom
 *     re-attribute-orders and re-whitespace-collapses; round-trip
 *     stability is the right invariant.
 *
 * When the corpus directory is empty (initial state) the suite skips
 * with an explanatory message rather than failing. This lets the file
 * ship now and start enforcing the invariant once fixtures land.
 *
 * Each `.docx` may have a sibling `.spec.json` declaring expectations:
 *   { source, scenario, expectations: ["parse", "roundtrip", "no-warnings", ...] }
 * The `"parse"` and `"roundtrip"` keys are informational — those assertions
 * run unconditionally. Other expectation strings are reserved for future
 * test extensions (e.g. a strict-render assertion against a minimal config).
 *
 * See `test/fixtures/real/README.md` for the corpus curation rules.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse, serialize } from "../../src/docx/DocxParser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Test file lives at packages/core/test/integration; repo root is 4 levels up.
const CORPUS_DIR = join(__dirname, "..", "..", "..", "..", "test", "fixtures", "real");

/** Recursively collect every `.docx` path under `root`. */
function collectDocxFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile() && entry.toLowerCase().endsWith(".docx")) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out.sort();
}

const docxFiles = collectDocxFiles(CORPUS_DIR);

describe("real-world docx corpus", () => {
  if (docxFiles.length === 0) {
    it.skip("(corpus is empty — populate test/fixtures/real/ to enable; see README.md there)", () => {
      // Intentional skip: not a failure, just nothing to assert against yet.
    });
    return;
  }

  for (const file of docxFiles) {
    const label = relative(CORPUS_DIR, file);
    describe(label, () => {
      it("parses without throwing", () => {
        const bytes = readFileSync(file);
        expect(() => parse(new Uint8Array(bytes))).not.toThrow();
      });

      it("survives parse → serialize → parse round-trip", () => {
        const bytes = readFileSync(file);
        const archive1 = parse(new Uint8Array(bytes));
        const serialized = serialize(archive1);
        expect(() => parse(serialized)).not.toThrow();
      });
    });
  }
});
