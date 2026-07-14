import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.CLI_RUSH_QA_URL ?? "http://127.0.0.1:4174/";
const minutes = Number.parseFloat(process.env.CLI_RUSH_QA_SOAK_MINUTES ?? "30");
if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("CLI_RUSH_QA_SOAK_MINUTES must be positive.");
const outputDirectory = resolve(process.env.CLI_RUSH_QA_OUTPUT ?? "outputs/browser-qa");
const browser = await chromium.launch({ headless: true });

try {
  await mkdir(outputDirectory, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator(".continue-card .primary").click();
  const input = page.locator(".terminal input");
  await input.waitFor();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");
  const snapshot = async () => {
    const metrics = await cdp.send("Performance.getMetrics");
    const values = Object.fromEntries(metrics.metrics.map((entry) => [entry.name, entry.value]));
    return page.evaluate((performanceValues) => ({
      at: Date.now(),
      nodes: document.getElementsByTagName("*").length,
      renderedRows: document.querySelectorAll(".terminal .log > div").length,
      listeners: performanceValues.JSEventListeners ?? null,
      heapBytes: performanceValues.JSHeapUsedSize ?? null,
      documents: performanceValues.Documents ?? null,
    }), values);
  };
  // Fill every bounded history/attempt window and compile hot paths before the
  // retained-growth baseline. Cold DOM expansion and uncollected dead React
  // trees are not memory leaks, so compare full steady-state windows after GC.
  const warmupCommands = 400;
  for (let index = 0; index < warmupCommands; index += 1) {
    await input.fill(`warmup${index % 1000}`);
    await input.press("Enter");
    await page.waitForTimeout(25);
  }
  await cdp.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(100);
  const baseline = await snapshot();
  const samples = [baseline];
  const endAt = Date.now() + minutes * 60_000;
  let commands = 0;
  let lastProgress = 0;
  while (Date.now() < endAt) {
    await input.fill(`invalid${commands % 1000}`);
    await input.press("Enter");
    commands += 1;
    if (commands % 25 === 0) {
      samples.push(await snapshot());
      const elapsed = Date.now() - baseline.at;
      if (elapsed - lastProgress >= 30_000) {
        lastProgress = elapsed;
        process.stdout.write(`Soak ${(elapsed / 60_000).toFixed(1)}/${minutes} min · ${commands} submissions\n`);
      }
    }
    await page.waitForTimeout(250);
  }
  await cdp.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(100);
  const after = await snapshot();
  samples.push(after);
  const heapGrowth = baseline.heapBytes ? (after.heapBytes - baseline.heapBytes) / baseline.heapBytes : null;
  const listenerGrowth = baseline.listeners === null || after.listeners === null ? null : after.listeners - baseline.listeners;
  const targets = {
    boundedRows: after.renderedRows <= 60,
    boundedNodes: after.nodes <= baseline.nodes + 150,
    boundedListeners: listenerGrowth === null || listenerGrowth <= 20,
    boundedHeap: heapGrowth === null || heapGrowth <= .5,
    pageResponsive: await input.isEnabled(),
  };
  const report = {
    generatedAt: new Date().toISOString(),
    url: baseUrl,
    conditions: { viewport: "390x844", cpuThrottle: 4, browser: "repository-pinned Playwright Chromium" },
    durationMinutes: minutes,
    warmupCommands,
    commands,
    baseline,
    after,
    heapGrowth,
    listenerGrowth,
    samples,
    targets,
    pass: Object.values(targets).every(Boolean),
  };
  await writeFile(resolve(outputDirectory, "terminal-soak.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...report, samples: `${samples.length} samples` }, null, 2)}\n`);
  if (!report.pass) process.exitCode = 1;
} finally {
  await browser.close();
}
