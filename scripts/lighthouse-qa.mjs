import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { chromium } from "playwright";
import { startFlow } from "lighthouse";
import defaultConfig from "lighthouse/core/config/default-config.js";

const baseUrl = process.env.CLI_RUSH_QA_URL ?? "http://127.0.0.1:4174/";
const outputDirectory = resolve(process.env.CLI_RUSH_QA_OUTPUT ?? "outputs/browser-qa");
const browser = await puppeteer.launch({
  executablePath: process.env.CLI_RUSH_BROWSER ?? chromium.executablePath(),
  headless: true,
  args: ["--no-first-run", "--disable-background-networking"],
});

try {
  await mkdir(outputDirectory, { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const session = await page.createCDPSession();
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8, connectionType: "cellular4g" });
  const flow = await startFlow(page, {
    name: "CLI RUSH mobile task flow",
    config: defaultConfig,
    flags: { formFactor: "mobile", throttlingMethod: "provided", screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 1, disabled: false } },
  });
  await flow.navigate(baseUrl, { name: "Home navigation" });
  await flow.startTimespan({ name: "Open activity and use terminal" });
  await page.locator(".continue-card .primary").click();
  const input = page.locator(".terminal input");
  await input.wait();
  await input.fill("e");
  await input.click();
  await page.keyboard.press("Tab");
  await page.keyboard.type("?");
  await input.fill("enable");
  await page.keyboard.press("Enter");
  await flow.endTimespan();
  const result = await flow.createFlowResult();
  const navigation = result.steps.find((step) => step.lhr.gatherMode === "navigation")?.lhr;
  const timespan = result.steps.find((step) => step.lhr.gatherMode === "timespan")?.lhr;
  const value = (lhr, id) => lhr?.audits[id]?.numericValue ?? null;
  const measurements = {
    lcpMs: value(navigation, "largest-contentful-paint"),
    cls: value(navigation, "cumulative-layout-shift"),
    inpMs: value(timespan, "interaction-to-next-paint"),
  };
  const targets = {
    lcpBelow2500Ms: measurements.lcpMs !== null && measurements.lcpMs < 2_500,
    clsBelowPointOne: measurements.cls !== null && measurements.cls < .1,
    inpBelow200Ms: measurements.inpMs !== null && measurements.inpMs < 200,
  };
  const report = { generatedAt: new Date().toISOString(), url: baseUrl, conditions: { viewport: "390x844", cpuThrottle: 4, latencyMs: 40, downKbps: 1600, upKbps: 750, method: "Lighthouse provided throttling" }, measurements, targets, pass: Object.values(targets).every(Boolean), flow: result };
  await writeFile(resolve(outputDirectory, "lighthouse-flow.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...report, flow: undefined }, null, 2)}\n`);
  if (!report.pass) process.exitCode = 1;
} finally {
  await browser.close();
}
