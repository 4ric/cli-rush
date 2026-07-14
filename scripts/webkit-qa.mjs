import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { webkit } from "playwright";

const baseUrl = process.env.CLI_RUSH_QA_URL ?? "http://127.0.0.1:4174/";
const outputDirectory = resolve(process.env.CLI_RUSH_QA_OUTPUT ?? "outputs/browser-qa");
const browser = await webkit.launch({ headless: true });
const results = [];

try {
  await mkdir(outputDirectory, { recursive: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator(".continue-card .primary").click();
    const input = page.locator(".terminal input");
    await input.waitFor();
    await input.fill("en");
    await input.press("Tab");
    const tabValue = await input.inputValue();
    await input.press("?");
    await page.waitForTimeout(50);
    const measurements = await page.evaluate(() => {
      const inputElement = document.querySelector(".terminal input");
      const rect = inputElement?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        inputReachable: Boolean(rect && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight),
        inputFocused: inputElement === document.activeElement,
        fontSize: inputElement ? Number.parseFloat(getComputedStyle(inputElement).fontSize) : 0,
      };
    });
    const pass = /^enable ?$/u.test(tabValue) && !measurements.overflow && measurements.inputReachable && measurements.inputFocused && measurements.fontSize >= 16;
    results.push({ viewport: `${viewport.width}x${viewport.height}`, tabValue, ...measurements, pass });
    await page.screenshot({ path: resolve(outputDirectory, `webkit-${viewport.width}x${viewport.height}.png`) });
    await context.close();
  }
  const report = { generatedAt: new Date().toISOString(), engine: "Playwright WebKit", url: baseUrl, results, pass: results.every((entry) => entry.pass) };
  await writeFile(resolve(outputDirectory, "webkit-results.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.pass) process.exitCode = 1;
} finally {
  await browser.close();
}
