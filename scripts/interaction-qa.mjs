import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.CLI_RUSH_QA_URL ?? "http://127.0.0.1:4174/";
const outputDirectory = resolve(process.env.CLI_RUSH_QA_OUTPUT ?? "outputs/browser-qa");
const browser = await chromium.launch({ headless: true });
const assertions = [];
const check = (name, pass, detail = null) => {
  assertions.push({ name, pass: Boolean(pass), detail });
  if (!pass) throw new Error(`${name}${detail ? `: ${JSON.stringify(detail)}` : ""}`);
};

try {
  await mkdir(outputDirectory, { recursive: true });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desktop.addInitScript(() => {
    const events = { starts: [], scheduledStops: [], forcedStops: 0, resumes: 0 };
    class QaOscillator {
      constructor() {
        this.type = "sine";
        this.onended = null;
        this.frequency = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
      }
      connect() {}
      disconnect() {}
      start(at) { events.starts.push(at); }
      stop(at) {
        if (typeof at === "number") events.scheduledStops.push(at);
        else events.forcedStops += 1;
      }
    }
    class QaGain {
      constructor() { this.gain = { setValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
      connect() {}
      disconnect() {}
    }
    class QaAudioContext {
      constructor() { this.currentTime = 1; this.destination = {}; }
      createOscillator() { return new QaOscillator(); }
      createGain() { return new QaGain(); }
      resume() { events.resumes += 1; return Promise.resolve(); }
      close() { return Promise.resolve(); }
    }
    Object.defineProperty(window, "AudioContext", { configurable: true, value: QaAudioContext });
    Object.defineProperty(window, "__cliRushAudioQa", { configurable: true, value: events });
  });
  const page = await desktop.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  check("home has no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  let soundButton = page.getByRole("button", { name: /^Sound (?:on|off)$/u });
  const initialSound = await soundButton.getAttribute("aria-pressed");
  await soundButton.click();
  await page.waitForFunction((previous) => {
    const control = document.querySelector(".sound-control");
    return control?.getAttribute("aria-pressed") !== previous;
  }, initialSound);
  const toggledSound = await soundButton.getAttribute("aria-pressed");
  check("Sound toggle changes its visible and accessible state", toggledSound !== initialSound, { initialSound, toggledSound });
  await page.waitForFunction((expected) => {
    try {
      const saved = JSON.parse(localStorage.getItem("cli-rush-progress-v1") ?? "null");
      return String(!saved?.muted) === expected;
    } catch {
      return false;
    }
  }, toggledSound);
  await page.reload({ waitUntil: "networkidle" });
  soundButton = page.getByRole("button", { name: /^Sound (?:on|off)$/u });
  check("Sound setting persists after refresh", await soundButton.getAttribute("aria-pressed") === toggledSound, toggledSound);
  if (toggledSound !== "true") await soundButton.click();
  await page.screenshot({ path: resolve(outputDirectory, "interaction-home-desktop.png"), fullPage: true });
  await page.locator(".continue-card .primary").click();
  const input = page.locator(".terminal input");
  await input.waitFor();
  await input.fill("en");
  await input.press("Tab");
  const completed = await input.inputValue();
  const caret = await input.evaluate((element) => element.selectionStart);
  check("physical Tab completes one token", /^enable ?$/u.test(completed), completed);
  check("Tab keeps the caret at the end", caret === completed.length, { caret, length: completed.length });
  const historyBeforeHelp = await page.locator(".terminal .log").textContent();
  await input.press("?");
  const historyAfterHelp = await page.locator(".terminal .log").textContent();
  check("physical question mark opens contextual help", historyAfterHelp !== historyBeforeHelp && /\?|<cr>|option/iu.test(historyAfterHelp ?? ""), historyAfterHelp);
  check("question mark preserves terminal focus", await input.evaluate((element) => element === document.activeElement));
  await input.fill("enable");
  await input.press("Enter");
  check("submission preserves terminal focus", await input.evaluate((element) => element === document.activeElement));
  await input.fill("show version");
  await input.press("Enter");
  await input.press("ArrowUp");
  check("ArrowUp recalls the previous command", (await input.inputValue()) === "show version", await input.inputValue());
  await page.getByRole("button", { name: "Complete the current token with Tab" }).click();
  await page.waitForTimeout(50);
  check("touch Tab restores terminal focus", await input.evaluate((element) => element === document.activeElement));
  await page.screenshot({ path: resolve(outputDirectory, "interaction-activity-desktop.png"), fullPage: false });

  await page.locator(".brand-link").click();
  await page.locator(".screen-home").waitFor();
  await page.locator("details.mode-picker > summary").click();
  await page.getByRole("button", { name: "Start Easy practice" }).click();
  await page.locator(".screen-round").waitFor();
  const revealAndSubmit = async () => {
    const workspace = page.locator(".screen-round");
    const roundInput = workspace.locator(".terminal input");
    await roundInput.waitFor();
    if (!await workspace.locator(".task-details").isVisible()) {
      await workspace.locator("button.task-details-toggle").click();
    }
    await workspace.getByRole("button", { name: "Hint: show structure" }).click();
    await workspace.getByRole("button", { name: "Show command family" }).click();
    await workspace.getByRole("button", { name: "Reveal answer · no mastery" }).click();
    const answer = (await workspace.locator(".reveal-bundle code.revealed").textContent())?.trim() ?? "";
    return { roundInput, answer };
  };
  let revealed = await revealAndSubmit();
  check("revealing an answer does not play the reward sound", await page.evaluate(() => window.__cliRushAudioQa.starts.length === 0));
  await revealed.roundInput.fill(revealed.answer);
  await revealed.roundInput.press("Enter");
  await page.waitForTimeout(50);
  check("an assisted correct submission plays one short two-note reward", await page.evaluate(() => window.__cliRushAudioQa.starts.length === 2 && window.__cliRushAudioQa.scheduledStops.length === 2));
  await page.getByRole("button", { name: "Next command" }).click();
  revealed = await revealAndSubmit();
  await revealed.roundInput.fill(revealed.answer);
  await revealed.roundInput.press("Enter");
  await page.waitForTimeout(50);
  check("a rapid reward stops the previous notes before starting new ones", await page.evaluate(() => window.__cliRushAudioQa.starts.length === 4 && window.__cliRushAudioQa.forcedStops >= 2));

  const cdp = await desktop.newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 720, height: 450, screenWidth: 1440, screenHeight: 900, deviceScaleFactor: 1, mobile: false });
  await page.waitForTimeout(250);
  const zoom = await page.evaluate(() => {
    const activeInput = document.querySelector(".terminal input");
    const rect = activeInput?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      inputReachable: Boolean(rect && rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight),
      viewport: [innerWidth, innerHeight],
    };
  });
  check("200 percent effective desktop zoom keeps content available", !zoom.overflow && zoom.inputReachable, zoom);
  await page.locator(".brand-link").click();
  await page.locator(".screen-home").waitFor();
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.addInitScript(() => {
    const state = { height: 844, offsetTop: 0 };
    const listeners = new Map();
    const visualViewport = {
      get height() { return state.height; },
      get offsetTop() { return state.offsetTop; },
      get width() { return 390; },
      get offsetLeft() { return 0; },
      get pageLeft() { return 0; },
      get pageTop() { return 0; },
      get scale() { return 1; },
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
      },
      removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: visualViewport });
    Object.defineProperty(window, "__cliRushSetVisualViewport", {
      configurable: true,
      value: (height, offsetTop = 0) => {
        state.height = height;
        state.offsetTop = offsetTop;
        for (const listener of listeners.get("resize") ?? []) listener(new Event("resize"));
      },
    });
  });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(baseUrl, { waitUntil: "networkidle" });
  await mobilePage.locator(".continue-card .primary").click();
  const mobileInput = mobilePage.locator(".terminal input");
  await mobileInput.waitFor();
  await mobileInput.focus();
  await mobilePage.evaluate(() => window.__cliRushSetVisualViewport(430));
  await mobilePage.waitForFunction(() => document.documentElement.dataset.keyboardOpen === "true");
  await mobilePage.waitForTimeout(250);
  const keyboard = await mobilePage.evaluate(() => {
    const element = document.querySelector(".terminal input");
    const rect = element?.getBoundingClientRect();
    const form = document.querySelector(".terminal form")?.getBoundingClientRect();
    const status = document.querySelector(".command-status")?.getBoundingClientRect();
    const shell = document.querySelector(".shell")?.getBoundingClientRect();
    const taskDisplay = getComputedStyle(document.querySelector(".task-panel")).display;
    return {
      reachable: Boolean(rect && rect.top >= 0 && rect.bottom <= 430),
      formContained: Boolean(form && form.bottom <= 430),
      statusContained: Boolean(status && status.bottom <= 430),
      shellContained: Boolean(shell && shell.bottom <= 431),
      taskHidden: taskDisplay === "none",
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      innerHeight,
      visualHeight: window.visualViewport?.height,
    };
  });
  check("software keyboard gives the terminal the visible iPhone viewport", keyboard.reachable && keyboard.formContained && keyboard.statusContained && keyboard.shellContained && keyboard.taskHidden && !keyboard.overflow, keyboard);
  await mobilePage.screenshot({ path: resolve(outputDirectory, "interaction-mobile-keyboard.png"), fullPage: false });
  await mobilePage.evaluate(() => window.__cliRushSetVisualViewport(844));
  await mobilePage.waitForFunction(() => document.documentElement.dataset.keyboardOpen !== "true");
  check("closing the software keyboard restores normal viewport sizing", await mobilePage.evaluate(() => !document.documentElement.style.getPropertyValue("--visual-viewport-height")));
  await mobile.close();

  const standalone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await standalone.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    Object.defineProperty(window, "matchMedia", { value: (query) => query === "(display-mode: standalone)"
      ? { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return true; } }
      : nativeMatchMedia(query) });
  });
  let installed = await standalone.newPage();
  await installed.goto(baseUrl, { waitUntil: "networkidle" });
  const labButton = installed.getByRole("button", { name: /Start Lab 1|Continue Lab 1/iu });
  await labButton.click();
  const scenarioInput = installed.locator("#scenario-command");
  await scenarioInput.waitFor();
  await scenarioInput.fill("enable");
  await scenarioInput.press("Enter");
  await installed.waitForTimeout(300);
  await installed.close();
  installed = await standalone.newPage();
  await installed.goto(new URL("?activity=scenario", baseUrl).href, { waitUntil: "networkidle" });
  check("standalone relaunch restores the activity", await installed.locator("#scenario-command").count() === 1 && await installed.getByText(/Step 2 of 26/iu).count() > 0);
  check("standalone display mode is applied", await installed.evaluate(() => document.documentElement.dataset.standalone === "true"));
  await installed.locator(".brand-link").click();
  check("in-app brand Back returns home", await installed.locator(".continue-card").count() === 1);
  await standalone.close();

  const report = { generatedAt: new Date().toISOString(), url: baseUrl, assertions, pass: assertions.every((entry) => entry.pass) };
  await writeFile(resolve(outputDirectory, "interaction-results.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
