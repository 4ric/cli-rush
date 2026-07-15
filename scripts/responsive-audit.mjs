import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.CLI_RUSH_QA_URL ?? "http://127.0.0.1:4174/";
const outputDirectory = resolve(process.env.CLI_RUSH_QA_OUTPUT ?? "outputs/browser-qa");
const allViewports = [
  { name: "small-phone", width: 360, height: 800, mobile: true },
  { name: "iphone-portrait", width: 390, height: 844, mobile: true },
  { name: "large-phone", width: 430, height: 932, mobile: true },
  { name: "iphone-landscape", width: 844, height: 390, mobile: true },
  { name: "tablet", width: 768, height: 1024, mobile: true },
  { name: "tablet-landscape", width: 1024, height: 768, mobile: false },
  { name: "laptop-1080p", width: 1366, height: 768, mobile: false },
  { name: "desktop-1080p", width: 1920, height: 1080, mobile: false },
  { name: "desktop-2k", width: 2560, height: 1440, mobile: false },
  { name: "ultrawide", width: 3440, height: 1440, mobile: false },
];
const requestedViewport = process.env.CLI_RUSH_QA_VIEWPORT;
const viewports = requestedViewport
  ? allViewports.filter((viewport) => viewport.name === requestedViewport)
  : allViewports;
if (viewports.length === 0) throw new Error(`Unknown CLI_RUSH_QA_VIEWPORT: ${requestedViewport}`);

const browser = await chromium.launch({ headless: true });
const results = [];

const inspect = async (page, viewport, screen) => page.evaluate(({ viewportName, expectedScreen }) => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
      && !element.closest("details:not([open])");
  };
  const insideHorizontalScroller = (element) => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (parent.scrollWidth > parent.clientWidth + 1 && ["auto", "scroll"].includes(style.overflowX)) return true;
    }
    return false;
  };
  const label = (element) => element.getAttribute("aria-label") || element.textContent?.trim().replaceAll(/\s+/gu, " ").slice(0, 80) || element.tagName;
  const rectOf = (selector) => {
    const element = document.querySelector(selector);
    if (!element || !visible(element)) return null;
    const rect = element.getBoundingClientRect();
    return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
  };
  const horizontalClips = [...document.querySelectorAll("button,input,summary,h1,h2,h3,code")]
    .filter(visible)
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      return !insideHorizontalScroller(element) && (rect.left < -1 || rect.right > innerWidth + 1);
    })
    .map(label);
  const wrappedContentClips = [...document.querySelectorAll(".task-panel h1,.task-details p,.task-details code,.guided-context,.scenario-ticket,.command-breakdown,.teaching-card p")]
    .filter(visible)
    .filter((element) => !insideHorizontalScroller(element) && element.scrollWidth > element.clientWidth + 2)
    .map(label);
  const terminal = rectOf(".terminal-panel > .terminal");
  const form = rectOf(".terminal-panel > .terminal form");
  const status = rectOf(".terminal-panel > .command-status");
  const task = rectOf(".practice-workspace > .task-panel");
  const terminalPanel = rectOf(".practice-workspace > .terminal-panel");
  const workspace = document.querySelector(".practice-workspace");
  const workspaceStyle = workspace ? getComputedStyle(workspace) : null;
  const input = document.querySelector(".terminal-panel > .terminal input");
  const inputRect = input && visible(input) ? input.getBoundingClientRect() : null;
  const terminalFormContained = !terminal || !form || (form.top >= terminal.top - 1 && form.bottom <= terminal.bottom + 1);
  const feedbackSeparated = !terminal || !status || status.top >= terminal.bottom - 1;
  const horizontallyArranged = workspaceStyle?.display === "grid" || workspaceStyle?.flexDirection === "row";
  const columnsSeparated = !task || !terminalPanel || !horizontallyArranged || terminalPanel.right <= task.left + 1;
  const mobileStackSeparated = !task || !terminalPanel || horizontallyArranged || task.bottom <= terminalPanel.top + 1;
  const activeScreen = [...document.querySelector("main")?.classList ?? []].find((entry) => entry.startsWith("screen-"))?.slice(7) ?? null;
  const expectedActiveScreen = expectedScreen === "home-expanded" ? "home"
    : expectedScreen.startsWith("guided-lab-") ? "guided-lab"
      : expectedScreen.startsWith("scenario-") ? "scenario"
        : expectedScreen.startsWith("round-") ? "round"
      : expectedScreen;
  const inputFontSize = input ? Number.parseFloat(getComputedStyle(input).fontSize) : null;
  const taskWidth = task?.width ?? null;
  const problems = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) problems.push("document has horizontal overflow");
  if (horizontalClips.length) problems.push(`horizontally clipped content: ${horizontalClips.join(" | ")}`);
  if (wrappedContentClips.length) problems.push(`unwrapped learning content: ${wrappedContentClips.join(" | ")}`);
  if (!terminalFormContained) problems.push("command form escapes the simulated terminal");
  if (!feedbackSeparated) problems.push("Learning Coach/feedback overlaps the terminal");
  if (!columnsSeparated || !mobileStackSeparated) problems.push("task and terminal panels overlap");
  if (inputFontSize !== null && inputFontSize < 16) problems.push(`command input is ${inputFontSize}px`);
  if (expectedActiveScreen && activeScreen !== expectedActiveScreen) problems.push(`expected ${expectedActiveScreen}, found ${activeScreen}`);
  if (taskWidth !== null && innerWidth > 900 && taskWidth < 280) problems.push(`desktop learning context is only ${taskWidth.toFixed(1)}px wide`);
  if (activeScreen === "manage" && document.querySelector(".account-menu[open]")) problems.push("account menu stayed open over command administration");
  return {
    viewport: viewportName,
    screen: expectedScreen,
    activeScreen,
    documentSize: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    horizontalClips,
    wrappedContentClips,
    terminalFormContained,
    feedbackSeparated,
    panelsSeparated: columnsSeparated && mobileStackSeparated,
    inputFontSize,
    inputReachable: !inputRect || (inputRect.left >= -1 && inputRect.right <= innerWidth + 1),
    taskWidth,
    geometry: { terminal, form, status, task, terminalPanel, workspaceDisplay: workspaceStyle?.display, workspaceDirection: workspaceStyle?.flexDirection },
    problems,
    pass: problems.length === 0,
  };
}, { viewportName: viewport.name, expectedScreen: screen });

const saveScreenshot = async (page, viewport, screen) => {
  const fullJourneyViewport = ["iphone-portrait", "laptop-1080p", "desktop-2k"].includes(viewport.name);
  const representativeScreen = screen === "home" || screen === "navigation";
  if (!fullJourneyViewport && !representativeScreen) return;
  await page.screenshot({
    path: resolve(outputDirectory, `responsive-${viewport.name}-${screen}.png`),
    fullPage: false,
  });
};

const settle = async (page, selector) => {
  await page.locator(selector).waitFor({ state: "visible" });
  await page.waitForTimeout(80);
};

const record = async (page, viewport, screen) => {
  const result = await inspect(page, viewport, screen);
  results.push(result);
  await saveScreenshot(page, viewport, screen);
};

const returnHome = async (page) => {
  await page.locator(".brand-link").click();
  await settle(page, ".screen-home");
};

const recordOpenCoach = async (page, viewport, screen) => {
  const toggle = page.locator("button.task-details-toggle");
  if (await toggle.count() === 0 || !await toggle.isVisible()) return;
  await toggle.click();
  await page.locator(".task-details.open").waitFor({ state: "visible" });
  await page.waitForTimeout(220);
  await record(page, viewport, `${screen}-help`);
  const close = page.locator(".task-details.open .task-details-head button");
  if (await close.count() && await close.isVisible()) await close.click();
};

try {
  await mkdir(outputDirectory, { recursive: true });
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    try {
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await settle(page, ".screen-home");
      await record(page, viewport, "home");

      await page.locator("details.mode-picker > summary").click();
      await page.locator("details.good-to-know > summary").click();
      await record(page, viewport, "home-expanded");
      await page.locator("details.mode-picker > summary").click();
      await page.locator("details.good-to-know > summary").click();

      await page.locator(".practice-option.recommended").click();
      await settle(page, ".screen-navigation .terminal input");
      await record(page, viewport, "navigation");
      await returnHome(page);

      await page.locator("details.mode-picker > summary").click();
      await page.getByRole("button", { name: /^Normal\b/u }).click();
      await page.getByRole("button", { name: "Start Normal rush", exact: true }).click();
      await settle(page, ".screen-round .terminal input");
      await record(page, viewport, "round");
      await recordOpenCoach(page, viewport, "round");
      await page.locator(".activity-menu > summary").click();
      await page.getByRole("button", { name: "Finish activity" }).click();
      await settle(page, ".screen-report");
      await record(page, viewport, "report");
      await returnHome(page);

      await page.getByRole("button", { name: /(?:Start|Continue|View) Lab 1/iu }).click();
      await settle(page, ".screen-scenario");
      await record(page, viewport, "scenario");
      await recordOpenCoach(page, viewport, "scenario");
      await returnHome(page);

      await page.locator("details.additional-labs > summary").click();
      await page.getByRole("button", { name: /(?:Start|Continue|Review) Lab 2/iu }).click();
      await settle(page, ".screen-guided-lab");
      await record(page, viewport, "guided-lab-router");
      await recordOpenCoach(page, viewport, "guided-lab-router");
      await returnHome(page);

      await page.locator("details.additional-labs > summary").click();
      await page.getByRole("button", { name: /(?:Start|Continue|Review) Lab 3/iu }).click();
      await settle(page, ".screen-guided-lab");
      await record(page, viewport, "guided-lab-switch");
      await returnHome(page);

      await page.locator("details.good-to-know > summary").click();
      await page.getByRole("button", { name: "Open safety practice" }).click();
      await settle(page, ".screen-good-to-know");
      await record(page, viewport, "good-to-know");
      await returnHome(page);

      await page.locator("details.account-menu > summary").click();
      await page.getByRole("button", { name: "Manage commands" }).click();
      await settle(page, ".screen-manage");
      await record(page, viewport, "manage");
    } catch (error) {
      results.push({
        viewport: viewport.name,
        screen: "audit-harness",
        problems: [error instanceof Error ? error.message : String(error)],
        pass: false,
      });
    } finally {
      await context.close();
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    engine: "Playwright Chromium",
    url: baseUrl,
    viewports,
    results,
    pass: results.every((entry) => entry.pass),
  };
  await writeFile(resolve(outputDirectory, "responsive-results.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.pass) process.exitCode = 1;
} finally {
  await browser.close();
}
