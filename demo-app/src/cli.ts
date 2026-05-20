/**
 * CLI demo — runs the engine in-process against in-memory fixtures.
 *
 *   npm run cli            # builds template, renders, writes output.docx
 *
 * No infrastructure, no HTTP, no database. Demonstrates the minimal
 * library-only integration path documented in docs/QUICKSTART.md.
 */

import { writeFileSync } from "node:fs";
import { ensureParaIds, list, parse, render } from "@doccop/core";
import type { RenderConfig, RenderRequest } from "@doccop/core";
import { demoResolvers } from "./resolvers.js";
import { buildSampleTemplate } from "./template.js";

async function main(): Promise<void> {
  console.log("doccop demo (CLI mode)");
  console.log("─".repeat(60));

  // 1. Build a sample template (in real hosts this comes from upload).
  const templateBytes = buildSampleTemplate();
  console.log(`Template built: ${templateBytes.byteLength} bytes`);

  // 2. Parse into a DocxArchive and ensure every paragraph has a
  //    w14:paraId. The HTML preview and the wrap/wrapBlock helpers
  //    address paragraphs by these ids.
  const archive = parse(templateBytes);
  ensureParaIds(archive);

  // 3. Catalogue the placeholders the template carries.
  const placeholders = list(archive);
  console.log(`Placeholders discovered: ${placeholders.length}`);
  for (const p of placeholders) {
    console.log(`  ${p.tag.padEnd(30)} → alias "${p.alias}"`);
  }

  // 4. Assemble a render request.
  const request: RenderRequest = {
    userId: "demo-user",
    templateId: "demo-template",
    templateVersionId: "demo-version-1",
    templateCategory: "CONTRACT",
    documentNumber: "001-2026/CONTRACT",
    parties: [
      { role: "party_a", entityType: "organization", entityId: "internal-acme" },
      { role: "party_b", entityType: "organization", entityId: "external-clientx" },
    ],
    now: new Date(),
  };

  // 5. Wire engine config (strict mode by default).
  const config: RenderConfig = { resolvers: demoResolvers };

  // 6. Render.
  console.log("\nRendering...");
  const t0 = Date.now();
  const result = await render(archive, request, config);
  const elapsed = Date.now() - t0;

  // 7. Persist + report.
  const outputPath = "output.docx";
  writeFileSync(outputPath, result.docx);
  console.log("─".repeat(60));
  console.log(`✓ rendered in ${elapsed}ms (engine reported ${result.durationMs}ms)`);
  console.log(`✓ output: ${outputPath} (${result.docx.byteLength} bytes)`);
  console.log(`✓ warnings: ${result.warnings.length}`);
  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.log(`    [${w.kind}] ${w.tag}: ${w.detail}`);
    }
  }
  console.log("\nResolved values (audit trail — persisted as variablesSnapshot):");
  for (const [tag, value] of Object.entries(result.resolvedValues)) {
    console.log(`  ${tag.padEnd(30)} = "${value}"`);
  }
  console.log(`\nOpen ${outputPath} in Microsoft Word to see the substituted contract.`);
}

main().catch((err: unknown) => {
  console.error("\n✗ demo failed:");
  console.error(err);
  process.exit(1);
});
