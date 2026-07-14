import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  assertCommandInventoryBaseline,
  generateCommandCoverage,
} from "../lib/command-coverage.ts";
import { commands } from "../lib/engine.ts";

const outputPath = resolve(process.argv[2] ?? "validation/command-coverage.json");
const report = generateCommandCoverage(commands);

assertCommandInventoryBaseline(report);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Wrote ${report.inventory.supportedProfileContextProductions} profile/context productions to ${outputPath}\n`,
);
