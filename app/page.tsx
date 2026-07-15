/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  forwardRef,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  commands,
  executeCliCommand,
  executionSatisfiesLearningObjective,
  handleCliControl,
  initialDevice,
  modeNames,
  prepare,
  prompt,
  redactCommandInput,
  resolveCommand,
  restoreDeviceCheckpoint,
  restoreDeviceState,
  validate,
  type CliMode,
  type CliContext,
  type CliControlKey,
  type Command,
  type DeviceState,
  type Validation,
} from "@/lib/engine.ts";
import {
  correctAnswerEffect,
  gameModeById,
  gameModes,
  initialTimeMs,
  wrongAnswerEffect,
  type GameModeId,
  type GameModeRules,
} from "@/lib/game-modes.ts";
import {
  acceptedCommandContext,
  learningHintsFor,
  learningPoints,
  safeCommandContext,
  type AssistanceLevel,
} from "@/lib/learning.ts";
import {
  cliHelp,
  completeCliInput,
  parserProvenShorthandExamples,
} from "@/lib/cli-assistance.ts";
import {
  buildDailyRecallSession,
  easyPracticeCatalogue,
  weightedCommandQueue,
} from "@/lib/command-queue.ts";
import {
  buildBeginnerCurriculum,
  curriculumProgress,
  nextCurriculumChapter,
  type CurriculumChapter,
} from "@/lib/curriculum.ts";
import {
  acceptedAttemptPolicy,
  appendRoundAttemptRecord,
  classifyRoundRecord,
  failureFeedback,
  mayRevealAnswers,
  restoreRoundAttemptRecords,
  roundAttemptAnswerVisible,
  roundAttemptRecordVersion,
  shouldRecordTimedOutObjective,
  type RoundRecordClass,
  type RoundAttemptMastery,
  type RoundAttemptParserCategory,
  type RoundAttemptRecord,
} from "@/lib/gameplay.ts";
import {
  due,
  nextDue,
  schedule,
  score,
  type Outcome,
  type Review,
} from "@/lib/scheduler.ts";
import { teachingFor } from "@/lib/command-teaching.ts";
import {
  cancelIpv4ScenarioPendingInteraction,
  completeIpv4ScenarioInput,
  createIpv4Scenario,
  getIpv4ScenarioCliHelp,
  getIpv4ScenarioHint,
  getIpv4ScenarioChoices,
  getIpv4ScenarioCatalogue,
  getIpv4ScenarioObjective,
  ipv4ScenarioPrompt,
  redactIpv4ScenarioInput,
  restoreIpv4ScenarioCheckpoint,
  restoreIpv4ScenarioState,
  runIpv4ScenarioCommand,
  submitIpv4ScenarioInterpretation,
  type Ipv4ScenarioActionResult,
  type Ipv4ScenarioChoiceId,
  type Ipv4ScenarioState,
} from "@/lib/ipv4-scenario.ts";
import {
  cancelDeviceBuildPendingInteraction,
  completeDeviceBuildInput,
  createDeviceBuildState,
  deviceBuildContextName,
  deviceBuildLabs,
  deviceBuildPrompt,
  getDeviceBuildCliHelp,
  getDeviceBuildDefinition,
  getDeviceBuildCatalogue,
  getDeviceBuildHint,
  getDeviceBuildStep,
  redactDeviceBuildInput,
  restoreDeviceBuildCheckpoint,
  restoreDeviceBuildState,
  runDeviceBuildCommand,
  type DeviceBuildLabId,
  type DeviceBuildResult,
  type DeviceBuildState,
} from "@/lib/device-build-lab.ts";
import { navigateCommandHistory } from "@/lib/command-history.ts";
import { redactCredentialInput } from "@/lib/command-registry.ts";
import type { RegistryCommand } from "@/lib/command-registry.ts";
import { goodToKnowDistinctions, goodToKnowLessons } from "@/lib/good-to-know.ts";
import { CustomCommandManager } from "@/app/custom-command-manager.tsx";
import {
  commitAuthoritativeCustomCommandRecords,
  migrateLegacyCustomCommands,
  reconcileCustomCommandStores,
  toRegistryCommand,
  type CustomCommandRecord,
} from "@/lib/custom-commands.ts";
import {
  completeNavigationObjective,
  createNavigationScheduler,
  restoreNavigationScheduler,
  scheduleNavigationObjective,
  type NavigationContext,
  type NavigationSchedulerState,
} from "@/lib/navigation-scheduler.ts";
import {
  classifyLearningOutcome,
  learningTaskFor,
  type LearningOutcome,
  type TaskAssistanceState,
} from "@/lib/learning-tasks.ts";

type Screen = "home" | "navigation" | "round" | "report" | "manage" | "scenario" | "scenario-report" | "guided-lab" | "good-to-know";
type FinishReason = "timer" | "early" | "hardcore" | "practice" | "partial" | "complete";
type ReviewReason = "incorrect" | "recovered" | "unanswered";
type SessionKind = "practice" | "chapter" | "daily" | "rush";

const learningCliModes: readonly CliMode[] = ["user", "privileged", "global", "interface", "router", "line", "vlan", "acl", "dhcp"];
const isCliMode = (value: unknown): value is CliMode => typeof value === "string" && learningCliModes.includes(value as CliMode);

interface TerminalInputHandle {
  clear: () => void;
  focusAtEnd: () => void;
  getValue: () => string;
  setValue: (value: string, caret?: number) => void;
}

interface TerminalInputProps {
  accessibleContext: string;
  disabled?: boolean;
  id: string;
  initialValue?: string;
  onClipboardError?: () => void;
  onControl: (value: string, key: CliControlKey) => { draft: string; cursor: number };
  onDraftSettled?: (value: string) => void;
  onHelp: (value: string) => void;
  onPaste?: (text: string) => void;
  onSubmit: (value: string) => void;
  onTab: (value: string) => string;
  promptText: string;
  resetKey: string;
}

interface RevealBundleProps {
  command: string;
  whatItDoes: string;
  whyCorrectHere: string;
  verification?: string;
  recovery?: string;
  shorthand?: readonly string[];
}

const RevealBundle = ({
  command,
  whatItDoes,
  whyCorrectHere,
  verification,
  recovery,
  shorthand = [],
}: RevealBundleProps) => <div className="reveal-bundle" aria-label="Revealed answer and explanation">
  <div><span className="task-kicker">Correct command</span><code className="revealed">{command}</code></div>
  <div><span className="task-kicker">What it does</span><p>{whatItDoes}</p></div>
  <div><span className="task-kicker">Why it is correct here</span><p>{whyCorrectHere}</p></div>
  {verification && <div><span className="task-kicker">How to verify</span><p>{verification}</p></div>}
  {recovery && <div><span className="task-kicker">How to undo or recover</span><p>{recovery}</p></div>}
  <div><span className="task-kicker">Accepted shorthand</span>
    {shorthand.length ? <div className="shorthand-list">{shorthand.map((example) => <code key={example}>{example}</code>)}</div> : <p>No shorter unambiguous form is useful for this action.</p>}
    <p>Other unambiguous IOS prefixes are also accepted.</p>
  </div>
</div>;

const commandForReveal = (
  canonical: string,
  mode: CliContext,
  catalogue: readonly RegistryCommand[],
  profileId?: DeviceState["profileId"],
): RegistryCommand | null => {
  const exact = catalogue.find((entry) => entry.mode === mode && entry.canonical === canonical);
  if (exact) return exact;
  const resolved = resolveCommand(canonical, mode, catalogue as readonly Command[], profileId);
  return resolved.status === "valid" ? resolved.command : null;
};

type PracticeEvidenceRecorder = (
  canonical: string,
  context: CliContext,
  profileId: DeviceState["profileId"],
  outcome: LearningOutcome,
  error?: string | null,
) => void;

const blankTaskAssistance = (): TaskAssistanceState => ({
  hintUsed: false,
  tabUsed: false,
  helpUsed: false,
  answerRevealed: false,
});

const redactionToken = "<redacted>";

const pendingConfirmationLabel = (kind: string | null | undefined): string => {
  if (kind === "save" || kind === "save-startup") return "Awaiting destination filename confirmation";
  if (kind === "reload") return "Awaiting reload confirmation";
  if (kind === "erase" || kind === "erase-startup") return "Awaiting startup-configuration erase confirmation";
  if (kind === "default-interface") return "Awaiting interface reset confirmation";
  return "Awaiting confirmation";
};

const terminalTouchControls: ReadonlyArray<{
  key: CliControlKey;
  label: string;
  description: string;
}> = [
  { key: "ArrowUp", label: "↑", description: "Recall the previous command" },
  { key: "ArrowDown", label: "↓", description: "Recall the next command" },
  { key: "Ctrl+C", label: "^C", description: "Cancel the current line" },
];

/**
 * Keep secrets out of the visible terminal, command recall and persisted
 * sessions. Validation still receives the original input before this copy is
 * produced. This deliberately favours redaction over a plausible-looking log.
 */
const redactCommandForDisplay = (value: string): string => {
  return redactCredentialInput(value).replaceAll("[redacted]", redactionToken);
};

const redactTerminalLine = (line: string): string => {
  const promptAt = Math.max(line.lastIndexOf("# "), line.lastIndexOf("> "));
  if (promptAt >= 0) {
    return `${line.slice(0, promptAt + 2)}${redactCommandForDisplay(line.slice(promptAt + 2))}`;
  }
  return redactCommandForDisplay(line);
};

const TerminalCommandInput = memo(forwardRef<TerminalInputHandle, TerminalInputProps>(function TerminalCommandInput({
  accessibleContext,
  disabled = false,
  id,
  initialValue = "",
  onClipboardError,
  onControl,
  onDraftSettled,
  onHelp,
  onPaste,
  onSubmit,
  onTab,
  promptText,
  resetKey,
}, forwardedRef) {
  const [draft, setDraft] = useState(initialValue);
  const [toolbarOpen, setToolbarOpen] = useState(true);
  const fieldRef = useRef<HTMLInputElement>(null);
  const previousResetKey = useRef(resetKey);

  const focusAtEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const field = fieldRef.current;
      if (!field) return;
      field.focus({ preventScroll: true });
      field.setSelectionRange(field.value.length, field.value.length);
    });
  }, []);

  useImperativeHandle(forwardedRef, () => ({
    clear: () => setDraft(""),
    focusAtEnd,
    getValue: () => fieldRef.current?.value ?? draft,
    setValue: (value, caret = value.length) => {
      setDraft(value);
      requestAnimationFrame(() => {
        const field = fieldRef.current;
        if (!field) return;
        field.focus({ preventScroll: true });
        field.setSelectionRange(Math.min(caret, value.length), Math.min(caret, value.length));
      });
    },
  }), [draft, focusAtEnd]);

  useEffect(() => {
    if (previousResetKey.current === resetKey) return;
    previousResetKey.current = resetKey;
    setDraft(initialValue);
  }, [initialValue, resetKey]);

  useEffect(() => {
    if (!onDraftSettled) return;
    const timer = setTimeout(() => onDraftSettled(draft), 220);
    return () => clearTimeout(timer);
  }, [draft, onDraftSettled]);

  const replaceDraft = (value: string, caret = value.length) => {
    setDraft(value);
    requestAnimationFrame(() => {
      const field = fieldRef.current;
      if (!field) return;
      field.focus({ preventScroll: true });
      field.setSelectionRange(Math.min(caret, value.length), Math.min(caret, value.length));
    });
  };

  const insertClipboard = (text: string) => {
    const clean = text.replace(/\s+/gu, " ").trim();
    if (!clean) return;
    const field = fieldRef.current;
    const start = field?.selectionStart ?? draft.length;
    const end = field?.selectionEnd ?? draft.length;
    const next = `${draft.slice(0, start)}${clean}${draft.slice(end)}`.slice(0, 256);
    onPaste?.(clean);
    replaceDraft(next, Math.min(next.length, start + clean.length));
  };

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    const control = event.ctrlKey && event.shiftKey && event.code === "Digit6"
      ? "Ctrl+Shift+6"
      : event.ctrlKey && !event.altKey && !event.metaKey && ["a", "e", "u", "w", "c", "z"].includes(event.key.toLowerCase())
        ? `Ctrl+${event.key.toUpperCase()}` as Extract<CliControlKey, "Ctrl+A" | "Ctrl+E" | "Ctrl+U" | "Ctrl+W" | "Ctrl+C" | "Ctrl+Z">
        : null;
    if (control) {
      event.preventDefault();
      const next = onControl(event.currentTarget.value, control);
      replaceDraft(next.draft, next.cursor);
      return;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      replaceDraft(onTab(event.currentTarget.value));
      return;
    }
    if (event.key === "?" || event.code === "Slash" && event.shiftKey) {
      event.preventDefault();
      onHelp(event.currentTarget.value);
      focusAtEnd();
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = onControl(event.currentTarget.value, event.key);
      replaceDraft(next.draft, next.cursor);
    }
  };

  return (
    <form className="terminal-input" onSubmit={(event) => {
      event.preventDefault();
      if (disabled) return;
      const submitted = draft;
      onSubmit(submitted);
      if (submitted.trim()) setDraft("");
    }}>
      <label className="sr" htmlFor={id}>{promptText} · {accessibleContext} command input</label>
      <div className="terminal-command-line">
        <span aria-hidden="true">{promptText}</span>
        <input
          id={id}
          ref={fieldRef}
          value={draft}
          onChange={(event) => {
            const value = event.target.value;
            if (value.endsWith("?")) {
              const preserved = value.slice(0, -1);
              setDraft(preserved);
              onHelp(preserved);
              focusAtEnd();
              return;
            }
            setDraft(value);
          }}
          onKeyDown={keys}
          onPaste={(event) => {
            event.preventDefault();
            insertClipboard(event.clipboardData.getData("text"));
          }}
          onContextMenu={(event) => {
            if (!navigator.clipboard?.readText) return;
            event.preventDefault();
            void navigator.clipboard.readText().then(insertClipboard).catch(() => onClipboardError?.());
          }}
          aria-label={`${promptText} · ${accessibleContext} command input`}
          aria-keyshortcuts="Tab ? ArrowUp ArrowDown Enter Control+A Control+E Control+U Control+W Control+C Control+Z Control+Shift+6"
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="send"
          spellCheck={false}
          maxLength={256}
          disabled={disabled}
        />
        <button className="run-command" type="submit" disabled={disabled}>Run</button>
      </div>
      <div className={`terminal-toolbar ${toolbarOpen ? "open" : ""}`} role="toolbar" aria-label="Command assistance and history">
        <button className="toolbar-toggle" type="button" aria-expanded={toolbarOpen} onClick={() => setToolbarOpen((open) => !open)}>
          {toolbarOpen ? "Hide keys" : "Keys"}
        </button>
        <div className="toolbar-actions">
          <button className="cli-assist" type="button" onClick={() => replaceDraft(onTab(draft))} disabled={disabled} aria-label="Complete the current token with Tab">Tab</button>
          <button className="cli-assist" type="button" onClick={() => { onHelp(draft); focusAtEnd(); }} disabled={disabled} aria-label="Show commands available at this prompt">?</button>
        {terminalTouchControls.map((control) => <button
          key={control.key}
          className="terminal-shortcut"
          type="button"
          disabled={disabled}
          aria-label={control.description}
          title={control.description}
          onClick={() => {
            const next = onControl(draft, control.key);
            replaceDraft(next.draft, next.cursor);
          }}
        >{control.label}</button>)}
        </div>
      </div>
    </form>
  );
}));

const TerminalHistory = memo(function TerminalHistory({
  containerRef,
  lines,
  onCopy,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  lines: readonly string[];
  onCopy: () => void;
}) {
  // Keep the complete bounded session model for persistence and review, while
  // mounting only the recent console window. Terminal rows contain no local
  // state, so positional keys intentionally reuse the same small DOM pool.
  const visibleLines = lines.slice(-60);
  return (
    <div className="log" ref={containerRef} aria-label="Terminal history" onMouseUp={onCopy} title="Highlight to copy">
      {visibleLines.map((line, index) => <div key={`terminal-row-${index}`}>{line}</div>)}
    </div>
  );
});

function useStableCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  return useCallback((...args: Args) => callbackRef.current(...args), []);
}

const useViewportEnvironment = () => {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const keyboardOpenRef = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    let viewportFrame = 0;
    const updateStandalone = () => {
      const iosStandalone = "standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
      root.dataset.standalone = standaloneQuery.matches || iosStandalone ? "true" : "false";
    };
    const updateViewport = () => {
      cancelAnimationFrame(viewportFrame);
      viewportFrame = requestAnimationFrame(() => {
        const viewport = window.visualViewport;
        const height = viewport?.height ?? window.innerHeight;
        const offsetTop = Math.max(0, viewport?.offsetTop ?? 0);
        const obscured = Math.max(0, window.innerHeight - height - offsetTop);
        const focused = document.activeElement instanceof HTMLInputElement
          && Boolean(document.activeElement.closest(".terminal"));
        const nextKeyboardOpen = focused && obscured > 120;

        // Dynamic viewport units handle browser chrome while the keyboard is
        // closed. Writing a root variable during every Safari scroll forces a
        // full-page repaint, so use the measured visual viewport only for the
        // terminal's genuine software-keyboard state.
        if (nextKeyboardOpen) {
          root.style.setProperty("--visual-viewport-height", `${Math.round(height)}px`);
          root.style.setProperty("--keyboard-offset", `${Math.round(obscured)}px`);
        } else {
          root.style.removeProperty("--visual-viewport-height");
          root.style.removeProperty("--keyboard-offset");
        }
        root.dataset.keyboardOpen = nextKeyboardOpen ? "true" : "false";
        if (keyboardOpenRef.current !== nextKeyboardOpen) {
          keyboardOpenRef.current = nextKeyboardOpen;
          setKeyboardOpen(nextKeyboardOpen);
        }
      });
    };
    const updateAfterFocus = () => setTimeout(updateViewport, 0);
    updateStandalone();
    updateViewport();
    standaloneQuery.addEventListener?.("change", updateStandalone);
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    document.addEventListener("focusin", updateAfterFocus);
    document.addEventListener("focusout", updateAfterFocus);
    return () => {
      cancelAnimationFrame(viewportFrame);
      standaloneQuery.removeEventListener?.("change", updateStandalone);
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
      document.removeEventListener("focusin", updateAfterFocus);
      document.removeEventListener("focusout", updateAfterFocus);
      root.style.removeProperty("--visual-viewport-height");
      root.style.removeProperty("--keyboard-offset");
      delete root.dataset.keyboardOpen;
    };
  }, []);

  return keyboardOpen;
};

interface CommandProgress {
  attempts: number;
  correct: number;
  firstTry: number;
  lastError: string | null;
  assisted?: number;
  guided?: number;
  revealed?: number;
  lastResponseMs?: number;
  averageResponseMs?: number;
  review?: Review;
}

interface Progress {
  bestScore: number | null;
  bestScores: Partial<Record<GameModeId, number>>;
  bestFieldScores: Partial<Record<GameModeId, number>>;
  bestCombo: number;
  rounds: number;
  sessions: number;
  commands: Record<string, CommandProgress>;
  muted: boolean;
  lastMode: GameModeId;
  lastFirstCommandId: string | null;
}

interface Round {
  score: number;
  submissions: number;
  presented: number;
  resolved: number;
  firstTry: number;
  recovered: number;
  assisted: number;
  unanswered: number;
  combo: number;
  bestCombo: number;
  times: number[];
  timeGainedMs: number;
  timeLostMs: number;
  errors: Record<string, number>;
  reviewIds: string[];
  missed: string[];
  reviewReasons: Record<string, ReviewReason>;
  attemptRecords: RoundAttemptRecord[];
}

interface Report {
  round: Round;
  reason: FinishReason;
  mode: GameModeId;
  personalBest: boolean;
  previousBest: number | null;
  recordKind: RoundRecordClass;
}

interface TimeChange {
  id: number;
  deltaMs: number;
}

interface SavedScenarioSession {
  version: 1;
  state: Ipv4ScenarioState;
  lines: string[];
  history: string[];
  input: string;
  savedAt: number;
}

interface SavedRoundSession {
  version: 2;
  activeMode: GameModeId;
  cursor: number;
  device: DeviceState;
  history: string[];
  input: string;
  lines: string[];
  paused: boolean;
  queue: string[];
  round: Round;
  savedAt: number;
  sessionKind: SessionKind;
  sessionLimit: number | null;
  time: number | null;
}

interface GuidedResumeSummary {
  completed: boolean;
  labId: DeviceBuildLabId;
  stepIndex: number;
  totalSteps: number;
}

const storageKey = "cli-rush-progress-v1";
const customStorageKey = "cli-rush-custom-commands-v2";
const legacyCustomStorageKey = "cli-rush-custom-commands-v1";
const unavailableCustomStoreEtag = "__cli_rush_custom_store_unavailable__";
const scenarioStorageKey = "cli-rush-ipv4-scenario-v1";
const roundStorageKey = "cli-rush-round-v2";
const goodToKnowStorageKey = "cli-rush-good-to-know-v1";

const blankProgress = (): Progress => ({
  bestScore: null,
  bestScores: {},
  bestFieldScores: {},
  bestCombo: 0,
  rounds: 0,
  sessions: 0,
  commands: {},
  muted: false,
  lastMode: "easy",
  lastFirstCommandId: null,
});

const blankRound = (): Round => ({
  score: 0,
  submissions: 0,
  presented: 0,
  resolved: 0,
  firstTry: 0,
  recovered: 0,
  assisted: 0,
  unanswered: 0,
  combo: 0,
  bestCombo: 0,
  times: [],
  timeGainedMs: 0,
  timeLostMs: 0,
  errors: {},
  reviewIds: [],
  missed: [],
  reviewReasons: {},
  attemptRecords: [],
});

const uniq = (values: string[]): string[] => [...new Set(values)];

const errorNames: Record<string, string> = {
  EMPTY: "Empty command",
  TOO_LONG: "Input too long",
  WRONG_MODE: "Wrong CLI mode",
  MISSING_KEYWORD: "Missing keyword",
  MISSING_ARGUMENT: "Missing argument",
  KEYWORD_ORDER: "Keyword order",
  EXTRA_INPUT: "Extra input",
  INVALID_IPV4: "Invalid IPv4 address",
  INVALID_MASK: "Invalid subnet mask",
  MASK_KIND: "Wrong mask type",
  INVALID_INTERFACE: "Invalid interface",
  WRONG_VALUE: "Wrong objective value",
  VERIFY_NOT_CONFIGURE: "Verification instead of configuration",
  CONFIGURE_NOT_VERIFY: "Configuration instead of verification",
  WRONG_OBJECTIVE: "Wrong objective",
  UNSUPPORTED: "Unsupported command",
};

const reviewReasonNames: Record<ReviewReason, string> = {
  incorrect: "Incorrect",
  recovered: "Recovered on retry",
  unanswered: "Unanswered at the buzzer",
};

const attemptMasteryNames: Record<RoundAttemptMastery, string> = {
  independent: "Independent recall",
  recovered: "Recovered recall",
  "guided-discovery": "Guided discovery",
  assisted: "CLI-assisted",
  revealed: "Answer revealed",
  incorrect: "Incorrect submission",
  "not-completed": "Valid command · task not completed",
  skipped: "Skipped",
};

const isGameMode = (value: unknown): value is GameModeId =>
  typeof value === "string" && value in gameModes;

const hydrateProgress = (value: unknown): Progress => {
  const base = blankProgress();
  if (!value || typeof value !== "object") return base;
  const candidate = value as Partial<Progress> & { reducedMotion?: unknown };
  const migratedCandidate = { ...candidate };
  delete migratedCandidate.reducedMotion;
  const legacyNormal = typeof candidate.bestScore === "number"
    ? { normal: candidate.bestScore }
    : {};
  return {
    ...base,
    ...migratedCandidate,
    bestScores: {
      ...legacyNormal,
      ...(candidate.bestScores && typeof candidate.bestScores === "object"
        ? candidate.bestScores
        : {}),
    },
    bestFieldScores: candidate.bestFieldScores && typeof candidate.bestFieldScores === "object"
      ? candidate.bestFieldScores
      : {},
    sessions: Number.isFinite(candidate.sessions)
      ? Number(candidate.sessions)
      : Number(candidate.rounds ?? 0),
    commands: candidate.commands && typeof candidate.commands === "object"
      ? candidate.commands
      : {},
    lastMode: isGameMode(candidate.lastMode) ? candidate.lastMode : "easy",
    lastFirstCommandId: typeof candidate.lastFirstCommandId === "string"
      ? candidate.lastFirstCommandId
      : null,
  };
};

const restoreSavedRound = (value: unknown): SavedRoundSession | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SavedRoundSession>;
  if (candidate.version !== 2 || !isGameMode(candidate.activeMode)) return null;
  if (!Array.isArray(candidate.queue) || !Array.isArray(candidate.lines) || !Array.isArray(candidate.history)) return null;
  if (!candidate.device || typeof candidate.device !== "object" || !candidate.round || typeof candidate.round !== "object") return null;
  const restoredDevice = restoreDeviceState(candidate.device);
  if (!restoredDevice) return null;
  const rawRound = candidate.round as Partial<Round>;
  const restoredRound: Round = {
    ...blankRound(),
    ...rawRound,
    errors: rawRound.errors && typeof rawRound.errors === "object" ? rawRound.errors : {},
    missed: Array.isArray(rawRound.missed) ? rawRound.missed.filter((id): id is string => typeof id === "string").slice(-256) : [],
    reviewIds: Array.isArray(rawRound.reviewIds) ? rawRound.reviewIds.filter((id): id is string => typeof id === "string").slice(-256) : [],
    reviewReasons: rawRound.reviewReasons && typeof rawRound.reviewReasons === "object" ? rawRound.reviewReasons : {},
    attemptRecords: restoreRoundAttemptRecords(rawRound.attemptRecords),
    times: Array.isArray(rawRound.times) ? rawRound.times.filter((time): time is number => typeof time === "number" && Number.isFinite(time)).slice(-512) : [],
  };
  const sessionKind: SessionKind = ["practice", "chapter", "daily", "rush"].includes(String(candidate.sessionKind))
    ? candidate.sessionKind as SessionKind
    : "practice";
  return {
    version: 2,
    activeMode: candidate.activeMode,
    cursor: Number.isInteger(candidate.cursor) && Number(candidate.cursor) >= 0 ? Number(candidate.cursor) : 0,
    device: restoredDevice,
    history: candidate.history.filter((entry): entry is string => typeof entry === "string").map((entry) => redactCommandForDisplay(entry.slice(0, 256))).slice(-80),
    input: typeof candidate.input === "string" ? redactCommandForDisplay(candidate.input.slice(0, 256)) : "",
    lines: candidate.lines.filter((line): line is string => typeof line === "string").map((line) => redactTerminalLine(line.slice(0, 600))).slice(-500),
    paused: Boolean(candidate.paused),
    queue: candidate.queue.filter((id): id is string => typeof id === "string").slice(0, 512),
    round: restoredRound,
    savedAt: typeof candidate.savedAt === "number" ? candidate.savedAt : Date.now(),
    sessionKind,
    sessionLimit: candidate.sessionLimit === null || Number.isInteger(candidate.sessionLimit) ? candidate.sessionLimit ?? null : null,
    time: candidate.time === null || typeof candidate.time === "number" && Number.isFinite(candidate.time) ? candidate.time ?? null : null,
  };
};

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const pct = (value: number): string => `${Math.round(value * 100)}%`;
const seconds = (milliseconds: number): number => Math.round(milliseconds / 1000);

const modeSummary = (rules: GameModeRules): string => {
  if (rules.id === "easy") return "NO CLOCK · FADED HINTS · CLEAN RECALL SCHEDULES";
  if (rules.wrongEndsRound) return `CORRECT +${seconds(rules.correctBonusMs)}S · ONE STRIKE`;
  const rewards = rules.comboBonusMs === null
    ? `CORRECT +${seconds(rules.correctBonusMs)}S`
    : `CORRECT +${seconds(rules.correctBonusMs)}/+${seconds(rules.comboBonusMs)}S`;
  return `${rewards} · ERRORS −${rules.wrongPenaltiesMs.map(seconds).join("/−")}S`;
};

const startLabel = (mode: GameModeId): string =>
  mode === "easy" ? "Start Easy practice" : `Start ${gameModeById(mode).label} rush`;

const CliModeMap = ({ mode }: { mode: CliMode }) => {
  const stages: Array<{ id: string; label: string; prompt: string; modes: CliMode[] }> = [
    { id: "user", label: "User EXEC", prompt: "R1>", modes: ["user"] },
    { id: "privileged", label: "Privileged EXEC", prompt: "R1#", modes: ["privileged"] },
    { id: "global", label: "Global config", prompt: "R1(config)#", modes: ["global"] },
    { id: "feature", label: "Feature scope", prompt: "R1(config-*)#", modes: ["interface", "router", "line", "vlan", "acl", "dhcp"] },
  ];
  return (
    <div className="cli-mode-map" aria-label={`CLI mode map; current mode is ${modeNames[mode]}`}>
      {stages.map((stage, index) => (
        <div className="mode-map-stage" key={stage.id}>
          <span className={stage.modes.includes(mode) ? "active" : ""}>
            <small>{stage.label}</small><code>{stage.prompt}</code>
          </span>
          {index < stages.length - 1 && <i aria-hidden="true">↓</i>}
        </div>
      ))}
    </div>
  );
};

const PracticeWorkspace = ({ children }: { children: ReactNode }) => {
  const [contextCollapsed, setContextCollapsed] = useState(false);
  return (
    <div className={`practice-workspace ${contextCollapsed ? "context-collapsed" : ""}`}>
      <button
        className="workspace-context-toggle"
        type="button"
        aria-expanded={!contextCollapsed}
        aria-label={contextCollapsed ? "Open learning context" : "Collapse learning context"}
        onClick={() => setContextCollapsed((collapsed) => !collapsed)}
      >
        <span aria-hidden="true">{contextCollapsed ? "‹" : "›"}</span>
        <b>{contextCollapsed ? "Learn" : "Hide"}</b>
      </button>
      {children}
    </div>
  );
};

const ScenarioTopology = ({ state }: { state: Ipv4ScenarioState }) => {
  const interfaceReady = state.interfaceState.adminUp && state.interfaceState.address !== null;
  const routeReady = state.defaultRoute === state.parameters.gateway;
  const routeWrong = state.defaultRoute !== null && !routeReady;
  return (
    <div className="scenario-topology" aria-label="Live branch IPv4 path">
      <span className="topology-node"><small>BRANCH LAN</small><b>{state.parameters.networkAddress}/{state.parameters.prefixLength}</b></span>
      <i className={interfaceReady ? "ready" : "pending"} aria-hidden="true">⇄</i>
      <span className={`topology-node router ${interfaceReady ? "ready" : "pending"}`}><small>R1 · {state.parameters.interfaceName}</small><b>{state.interfaceState.address ?? "unassigned"}</b></span>
      <i className={routeReady ? "ready" : routeWrong ? "fault" : "pending"} aria-hidden="true">⇢</i>
      <span className={`topology-node ${routeReady ? "ready" : routeWrong ? "fault" : "pending"}`}><small>UPSTREAM GATEWAY</small><b>{state.defaultRoute ?? "not set"}</b></span>
      <i className={routeReady && interfaceReady ? "ready" : "pending"} aria-hidden="true">⇢</i>
      <span className={`topology-node ${routeReady && interfaceReady ? "ready" : "pending"}`}><small>REMOTE TEST</small><b>{state.parameters.remoteTarget}</b></span>
    </div>
  );
};

const guidedLabStorageKey = (id: DeviceBuildLabId) => `cli-rush-guided-lab-${id}-v1`;

interface SavedGuidedLab {
  state: DeviceBuildState;
  lines: string[];
  history: string[];
  savedAt: number;
}

const navigationStorageKey = "cli-rush-navigation-v2";

interface SavedNavigationSession {
  version: 2;
  scheduler: NavigationSchedulerState;
  device: DeviceState;
  lines: string[];
  history: string[];
  draft: string;
}

const navigationMode = (context: NavigationContext): CliMode =>
  isCliMode(context) ? context : context === "acl-standard" || context === "acl-extended" ? "acl" : "global";

const NavigationPractice = ({ keyboardOpen, onHome, onEvidence }: { keyboardOpen: boolean; onHome: () => void; onEvidence: PracticeEvidenceRecorder }) => {
  const [scheduler, setScheduler] = useState(() => createNavigationScheduler(1, "router-ios-xe"));
  const [device, setDevice] = useState(() => initialDevice("router-ios-xe"));
  const [lines, setLines] = useState<string[]>([
    "CLI RUSH // CLI NAVIGATION",
    "Move through real prompt contexts with commands and terminal editing keys.",
  ]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(-1);
  const [historyDraft, setHistoryDraft] = useState("");
  const [restoredDraft, setRestoredDraft] = useState("");
  const [feedback, setFeedback] = useState({ tone: "neutral", title: "Terminal ready", message: "Complete the current navigation task." });
  const [hintLevel, setHintLevel] = useState<0 | 1 | 2>(0);
  const [taskAssistance, setTaskAssistance] = useState<TaskAssistanceState>(blankTaskAssistance);
  const [taskDetailsOpen, setTaskDetailsOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const draftRef = useRef("");
  const inputRef = useRef<TerminalInputHandle>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const scheduled = useMemo(() => scheduleNavigationObjective(scheduler), [scheduler]);
  const task = scheduled.objective;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(navigationStorageKey) ?? "null") as Partial<SavedNavigationSession> | null;
      const restoredScheduler = restoreNavigationScheduler(saved?.scheduler);
      const restoredDevice = restoreDeviceState(saved?.device, restoredScheduler?.profileId);
      if (saved?.version === 2 && restoredScheduler && restoredDevice
        && restoredDevice.context === restoredScheduler.currentContext) {
        setScheduler(restoredScheduler);
        setDevice({ ...restoredDevice, mode: navigationMode(restoredScheduler.currentContext) });
        setLines(Array.isArray(saved.lines) ? saved.lines.filter((line): line is string => typeof line === "string").map(redactTerminalLine).slice(-160) : []);
        setHistory(Array.isArray(saved.history) ? saved.history.filter((entry): entry is string => typeof entry === "string").map(redactCommandForDisplay).slice(-40) : []);
        draftRef.current = typeof saved.draft === "string" ? redactCommandForDisplay(saved.draft.slice(0, 256)) : "";
        setRestoredDraft(draftRef.current);
      }
    } catch {}
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      const saved: SavedNavigationSession = {
        version: 2,
        scheduler: scheduled.state,
        device,
        lines: lines.map(redactTerminalLine).slice(-160),
        history: history.map(redactCommandForDisplay).slice(-40),
        draft: redactCommandForDisplay(draftRef.current),
      };
      localStorage.setItem(navigationStorageKey, JSON.stringify(saved));
    } catch {}
  }, [device, history, lines, ready, scheduled.state]);

  useEffect(() => {
    setHintLevel(0);
    setTaskAssistance(blankTaskAssistance());
    setTaskDetailsOpen(false);
    const editingDraft = task.event.type === "control" && ["Ctrl+A", "Ctrl+E", "Ctrl+U", "Ctrl+W"].includes(task.event.key)
      ? "show ip interface brief"
      : draftRef.current;
    requestAnimationFrame(() => editingDraft ? inputRef.current?.setValue(editingDraft) : inputRef.current?.focusAtEnd());
  }, [task]);

  useEffect(() => {
    if (keyboardOpen) setTaskDetailsOpen(false);
  }, [keyboardOpen]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 1_000_000_000;
  }, [lines]);

  const reset = (profileId: "router-ios-xe" | "catalyst-l2") => {
    if (scheduler.completed > 0 && !window.confirm(`Restart CLI Navigation on the ${profileId === "router-ios-xe" ? "router" : "switch"} profile? Saved navigation progress will be replaced.`)) return;
    const seed = new Uint32Array(1);
    crypto.getRandomValues(seed);
    const nextScheduler = createNavigationScheduler(seed[0] || 1, profileId);
    setScheduler(nextScheduler);
    setDevice(initialDevice(profileId));
    setHistory([]);
    setHistoryAt(-1);
    setHistoryDraft("");
    draftRef.current = "";
    setRestoredDraft("");
    setLines(["CLI RUSH // CLI NAVIGATION", `${profileId === "router-ios-xe" ? "Router" : "Catalyst switch"} prompt graph started.`]);
    setFeedback({ tone: "neutral", title: "Navigation restarted", message: "Complete the task shown beside the terminal." });
  };

  const completeTask = (nextDevice: DeviceState, output: string[], entry: string) => {
    if (task.event.type === "command") {
      onEvidence(task.event.canonical, navigationMode(scheduled.state.currentContext), device.profileId, classifyLearningOutcome(true, taskAssistance));
    }
    const completed = completeNavigationObjective(scheduled.state, task.id);
    setScheduler(completed);
    setDevice(nextDevice);
    setLines((values) => [...values, entry, ...output, "✓ Navigation task complete"].slice(-160));
    setFeedback({ tone: "success", title: "Task complete", message: `${task.task} The prompt is now ${prompt(nextDevice)}.` });
    draftRef.current = "";
    setRestoredDraft("");
  };

  const syncAfterUnrelated = (nextDevice: DeviceState) => {
    if (nextDevice.context === scheduled.state.currentContext) return scheduled.state;
    return {
      ...scheduled.state,
      currentContext: nextDevice.context as NavigationContext,
      pending: null,
    };
  };

  const restoreCheckpoint = () => {
    const restored = restoreDeviceCheckpoint(device);
    setDevice(restored.state);
    setScheduler(syncAfterUnrelated(restored.state));
    setLines((values) => [...values, "[recovery] Restore checkpoint", ...restored.output].slice(-160));
    setFeedback({
      tone: restored.accepted ? "neutral" : "error",
      title: restored.accepted ? "Checkpoint restored" : "Checkpoint unavailable",
      message: restored.accepted
        ? "The previous simulated running state is active again. The navigation task remains open and no mastery was awarded."
        : restored.output.join(" "),
    });
    setTimeout(() => inputRef.current?.focusAtEnd(), 0);
  };

  const submit = (value: string) => {
    if (!value.trim()) return;
    const currentPrompt = prompt(device);
    const display = redactCommandInput(value, device.context, commands, device.profileId);
    const execution = executeCliCommand(device, value, commands);
    setHistory((values) => [...values, display].slice(-40));
    setHistoryAt(-1);
    setHistoryDraft("");

    let satisfies = false;
    if (task.event.type === "command") {
      const expected = resolveCommand(task.event.canonical, device.context, commands, device.profileId);
      satisfies = expected.status === "valid"
        && executionSatisfiesLearningObjective(expected.command, device, execution, commands);
    }
    if (satisfies) {
      completeTask(execution.state, execution.output, `${currentPrompt} ${display}`);
      return;
    }
    setLines((values) => [...values, `${currentPrompt} ${display}`, ...execution.output, execution.accepted ? "% Valid command; the scheduled task is still open." : "% Task still open."].slice(-160));
    if (execution.accepted) {
      setDevice(execution.state);
      setScheduler(syncAfterUnrelated(execution.state));
      setFeedback({ tone: "neutral", title: "Valid command · task still open", message: execution.state.context === device.context ? "That command ran, but it did not produce the requested outcome." : "That command changed context, so the scheduler safely replanned a reachable task." });
    } else {
      setFeedback({ tone: "error", title: "Command not accepted", message: execution.output.join(" ") });
      if (task.event.type === "command") onEvidence(task.event.canonical, navigationMode(scheduled.state.currentContext), device.profileId, "incorrect", execution.output.join(" "));
    }
  };

  const completeInput = (value: string) => {
    const completion = completeCliInput(value, device.context, commands, device.profileId);
    if (completion.changed) setTaskAssistance((current) => ({ ...current, tabUsed: true }));
    setLines((values) => [...values, `% Tab: ${completion.message}`].slice(-160));
    return completion.input;
  };

  const showHelp = (value: string) => {
    const help = cliHelp(value, device.context, commands, device.profileId);
    if (help.options.length) setTaskAssistance((current) => ({ ...current, helpUsed: true }));
    const optionLines = help.options.map((option) => `  ${option.value.padEnd(18)} ${option.description}`);
    if (help.hiddenOptions) optionLines.push(`  … ${help.hiddenOptions} more options`);
    setLines((values) => [...values, `${prompt(device)} ${redactCommandInput(value, device.context, commands, device.profileId)}?`, ...(optionLines.length ? optionLines : ["  % No matching options"])].slice(-160));
  };

  const recall = (value: string, direction: "older" | "newer") => {
    const recalled = navigateCommandHistory(history, value, historyAt, historyDraft, direction);
    setHistoryAt(recalled.index);
    setHistoryDraft(recalled.draft);
    return recalled.value;
  };

  const control = (value: string, key: CliControlKey) => {
    let draft = value;
    let cursor = value.length;
    let nextDevice = device;
    let output: string[] = [];
    if (key === "ArrowUp" || key === "ArrowDown") {
      draft = recall(value, key === "ArrowUp" ? "older" : "newer");
      cursor = draft.length;
    } else {
      const result = handleCliControl(device, key, value, history, historyAt < 0 ? history.length : historyAt);
      draft = result.draft;
      cursor = result.cursor;
      nextDevice = result.state;
      output = result.output;
    }

    if (task.event.type === "control" && task.event.key === key) {
      completeTask(nextDevice, output, `${prompt(device)} ${key}`);
    } else if (nextDevice.context !== device.context) {
      setDevice(nextDevice);
      setScheduler(syncAfterUnrelated(nextDevice));
      setLines((values) => [...values, `${prompt(device)} ${key}`, ...output, "% Context changed; the scheduler replanned from the current prompt."].slice(-160));
      setFeedback({ tone: "neutral", title: "Control key applied", message: "The requested task was not complete, so the next task was made reachable from this prompt." });
    } else if (output.length) {
      setLines((values) => [...values, `${prompt(device)} ${key}`, ...output].slice(-160));
    }
    draftRef.current = draft;
    return { draft, cursor };
  };

  const copySelection = () => {
    const selection = window.getSelection();
    const text = selection?.toString() ?? "";
    if (!text.trim() || !selection || !logRef.current || ![selection.anchorNode, selection.focusNode].every((node) => node && logRef.current?.contains(node))) return;
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).catch(() => {});
    else document.execCommand("copy");
  };

  const answer = task.event.type === "command" ? task.event.canonical : task.event.key;
  const commandFamily = task.event.type === "command" ? task.event.canonical.split(" ")[0] : "terminal editing key";
  const revealCommand = hintLevel === 2 && task.event.type === "command"
    ? commandForReveal(task.event.canonical, navigationMode(scheduler.currentContext), commands, device.profileId)
    : null;
  const revealTask = revealCommand ? learningTaskFor(revealCommand as Command) : null;
  const revealShorthand = revealCommand
    ? parserProvenShorthandExamples(revealCommand, commands, device.profileId)
    : [];

  return <section className="game navigation-practice">
    <div className="activity-bar"><span>CLI Navigation</span><strong>{scheduler.completed} completed</strong><span>{scheduler.profileId === "router-ios-xe" ? "Router" : "Catalyst switch"} · {modeNames[device.context]}</span></div>
    <PracticeWorkspace>
      <aside className="task-panel">
        <div className="task-summary">
          <span className="task-kicker">Current task</span>
          <h1>{task.task}</h1>
          <code className="current-context">{prompt(device)} · {modeNames[device.context]}</code>
          <p>Practise one context transition or editing action at a time. Valid unrelated commands still run.</p>
          <button className="task-details-toggle" type="button" aria-expanded={taskDetailsOpen} onClick={() => setTaskDetailsOpen(true)}>Need help?</button>
        </div>
        <div className={`task-details ${taskDetailsOpen ? "open" : ""}`}>
          <div className="task-details-head"><strong>Navigation help</strong><button type="button" aria-label="Close navigation help" onClick={() => { setTaskDetailsOpen(false); inputRef.current?.focusAtEnd(); }}>×</button></div>
          <CliModeMap mode={device.mode} />
          <p>{hintLevel === 0 ? "Read the current prompt and decide which context or editing outcome is requested." : hintLevel === 1 ? `Use the ${commandFamily} family from this exact prompt.` : "Study the result, then type or press it yourself. A reveal never completes the task."}</p>
          {hintLevel < 2 ? <button className="secondary" type="button" onClick={() => { setHintLevel((level) => level === 0 ? 1 : 2); setTaskAssistance((current) => ({ ...current, hintUsed: true, answerRevealed: hintLevel === 1 || current.answerRevealed })); }}>{hintLevel === 0 ? "Hint" : "Show answer · no mastery"}</button> : revealTask ? <RevealBundle
            command={answer}
            whatItDoes={revealTask.correctExplanation}
            whyCorrectHere={`${revealTask.whyThisMatters} ${revealTask.expectedEffect}`}
            verification={revealTask.verification}
            recovery={revealTask.recovery}
            shorthand={revealShorthand}
          /> : <RevealBundle
            command={answer}
            whatItDoes="Applies the requested terminal editing or session-control action without sending text to a network device."
            whyCorrectHere={`The current objective asks for ${task.task.toLocaleLowerCase("en-GB")} The action must still be pressed by the learner.`}
            verification="Confirm the caret, draft, prompt or running-operation state changed exactly as requested."
            recovery="Use the opposite history direction or retype the draft if the editing action was accidental."
          />}
          <hr />
          <p>Change virtual profile to practise profile-specific VLAN, range and router contexts.</p>
          <div className="learning-actions"><button type="button" className="secondary" onClick={() => reset("router-ios-xe")}>Router path</button><button type="button" className="secondary" onClick={() => reset("catalyst-l2")}>Switch path</button></div>
        </div>
      </aside>
      <div className="terminal-panel">
        <div className="terminal">
          <div className="terminal-head"><span>{device.hostname} · navigation simulator</span><details className="activity-menu"><summary>More</summary><div>{device.recoveryCheckpoint && <button type="button" onClick={restoreCheckpoint}>Restore checkpoint</button>}<button type="button" onClick={onHome}>Back to home</button><button type="button" onClick={() => reset(scheduler.profileId)}>Restart path</button></div></details></div>
          <TerminalHistory lines={lines} containerRef={logRef} onCopy={copySelection} />
          <TerminalCommandInput
            key={task.id}
            ref={inputRef}
            id="navigation-command"
            initialValue={restoredDraft}
            promptText={prompt(device)}
            accessibleContext={`${modeNames[device.context]}; task: ${task.task}`}
            resetKey={task.id}
            onDraftSettled={(value) => { draftRef.current = value; }}
            onControl={control}
            onSubmit={submit}
            onTab={completeInput}
            onHelp={showHelp}
          />
        </div>
        <div className={`command-status ${feedback.tone}`} role="status" aria-live="polite" aria-atomic="true"><strong>{feedback.title}</strong><span>{feedback.message}</span></div>
        <p className="help">Tab and ? use the full prompt grammar · ↑/↓ history · Ctrl+A/E/U/W edit · Ctrl+C cancels · Ctrl+Z exits · Ctrl+Shift+6 interrupts</p>
      </div>
    </PracticeWorkspace>
  </section>;
};

const GuidedBuildLab = ({ labId, keyboardOpen, onHome, onEvidence }: { labId: DeviceBuildLabId; keyboardOpen: boolean; onHome: () => void; onEvidence: PracticeEvidenceRecorder }) => {
  const definition = getDeviceBuildDefinition(labId);
  const [state, setState] = useState(() => createDeviceBuildState(labId));
  const [lines, setLines] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(-1);
  const [historyDraft, setHistoryDraft] = useState("");
  const [hintLevel, setHintLevel] = useState<0 | 1 | 2 | 3>(0);
  const [result, setResult] = useState<DeviceBuildResult | null>(null);
  const [tabUsed, setTabUsed] = useState(false);
  const [helpUsed, setHelpUsed] = useState(false);
  const [taskDetailsOpen, setTaskDetailsOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const inputRef = useRef<TerminalInputHandle>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const lesson = getDeviceBuildStep(state);
  const hint = hintLevel ? getDeviceBuildHint(state, hintLevel) : null;
  const labCatalogue = getDeviceBuildCatalogue(state);
  const revealedLabCommand = hintLevel === 3 && lesson ? commandForReveal(lesson.command, lesson.mode, labCatalogue, state.device.profileId) : null;
  const revealedLabShorthand = revealedLabCommand
    ? parserProvenShorthandExamples(revealedLabCommand, labCatalogue, state.device.profileId)
    : [];
  const phases = ["access", "identity", "security", "services", "interfaces", "verification"] as const;
  const activePhase = lesson?.phase ?? "verification";
  const currentPhaseIndex = phases.indexOf(activePhase);

  const openingLines = useCallback(() => [
    `CLI RUSH // LAB ${definition.number} // ${definition.shortTitle.toUpperCase()}`,
    "Isolated deterministic simulator · input is never sent to a device",
    `BUILD PLAN // ${definition.summary}`,
  ], [definition]);

  useEffect(() => {
    let restored = false;
    try {
      const raw = localStorage.getItem(guidedLabStorageKey(labId));
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SavedGuidedLab>;
        const safeState = restoreDeviceBuildState(saved.state);
        if (safeState && Array.isArray(saved.lines) && saved.lines.every(line => typeof line === "string") && Array.isArray(saved.history) && saved.history.every(command => typeof command === "string")) {
          setState(safeState);
          setLines(saved.lines.map(redactTerminalLine).slice(-160));
          setHistory(saved.history.map(redactCommandForDisplay).slice(-30));
          restored = true;
        }
      }
    } catch {}
    if (!restored) setLines(openingLines());
    setReady(true);
  }, [labId, openingLines]);

  useEffect(() => {
    if (!ready) return;
    try {
      const saved: SavedGuidedLab = {
        state,
        lines: lines.map(redactTerminalLine).slice(-160),
        history: history.map(redactCommandForDisplay).slice(-30),
        savedAt: Date.now(),
      };
      localStorage.setItem(guidedLabStorageKey(labId), JSON.stringify(saved));
    } catch {}
  }, [history, labId, lines, ready, state]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 1_000_000_000;
  }, [lines]);

  useEffect(() => {
    if (!state.completed) setTimeout(() => {
      if (!window.matchMedia("(min-width: 651px)").matches) return;
      inputRef.current?.focusAtEnd();
    }, 0);
  }, [state.stepIndex, state.completed]);

  useEffect(() => {
    if (keyboardOpen) setTaskDetailsOpen(false);
  }, [keyboardOpen]);

  const restart = () => {
    if (!window.confirm(`Restart Lab ${definition.number} from the first prompt? Its saved position will be replaced.`)) return;
    const next = createDeviceBuildState(labId);
    setState(next);
    inputRef.current?.clear();
    setHistory([]);
    setHistoryAt(-1);
    setHistoryDraft("");
    setHintLevel(0);
    setTabUsed(false);
    setHelpUsed(false);
    setResult(null);
    setLines(openingLines());
  };

  const focusAtEnd = () => setTimeout(() => {
    inputRef.current?.focusAtEnd();
  }, 0);

  const submit = (value: string) => {
    if (!lesson || !value.trim() && state.device.pendingInteraction === null) return;
    const entered = value.trim();
    const outcome = runDeviceBuildCommand(state, entered);
    setResult(outcome);
    const displayCommand = outcome.displayInput ?? redactDeviceBuildInput(state, entered);
    setLines(values => [...values, `${deviceBuildPrompt(state)}${displayCommand ? ` ${displayCommand}` : ""}`, ...outcome.output, outcome.accepted ? "✓ Step accepted" : outcome.awaitingConfirmation ? `… ${pendingConfirmationLabel(outcome.state.device.pendingInteraction?.kind)}` : `% ${outcome.explanation}`].slice(-160));
    if (displayCommand) setHistory(values => [...values, displayCommand].slice(-30));
    setHistoryAt(-1);
    setHistoryDraft("");
    setState(outcome.state);
    if (outcome.accepted) {
      onEvidence(lesson.command, lesson.mode, state.device.profileId, classifyLearningOutcome(true, {
        hintUsed: hintLevel > 0,
        tabUsed,
        helpUsed,
        answerRevealed: hintLevel === 3,
      }));
      setHintLevel(0);
      setTabUsed(false);
      setHelpUsed(false);
    } else {
      if (!outcome.valid && !outcome.awaitingConfirmation) onEvidence(lesson.command, lesson.mode, state.device.profileId, "incorrect", outcome.explanation);
      focusAtEnd();
    }
  };

  const restoreCheckpoint = () => {
    const outcome = restoreDeviceBuildCheckpoint(state);
    setState(outcome.state);
    setResult(outcome);
    setLines((values) => [
      ...values,
      "[recovery] Restore checkpoint",
      ...outcome.output,
      `% ${outcome.explanation}`,
    ].slice(-160));
    focusAtEnd();
  };

  const complete = (value: string) => {
    const completion = completeDeviceBuildInput(state, value);
    if (completion.changed) {
      setTabUsed(true);
    }
    setLines(values => [...values, `% Tab: ${completion.message}`].slice(-160));
    setResult(null);
    focusAtEnd();
    return completion.input;
  };

  const showCliHelp = (value: string) => {
    const help = getDeviceBuildCliHelp(state, value);
    setLines(values => [
      ...values,
      `${deviceBuildPrompt(state)} ${redactDeviceBuildInput(state, value)}?`,
      ...help.options.map(option => `  ${option.value.padEnd(22)} ${option.description}`),
    ].slice(-160));
    if (help.options.length) setHelpUsed(true);
    focusAtEnd();
  };

  const recallHistory = (value: string, direction: "older" | "newer") => {
    const recalled = navigateCommandHistory(history, value, historyAt, historyDraft, direction);
    setHistoryAt(recalled.index);
    setHistoryDraft(recalled.draft);
    return recalled.value;
  };

  const controlInput = (value: string, key: CliControlKey) => {
    if (key === "ArrowUp" || key === "ArrowDown") {
      const recalled = recallHistory(value, key === "ArrowUp" ? "older" : "newer");
      return { draft: recalled, cursor: recalled.length };
    }

    const bridge = initialDevice(definition.deviceProfile);
    bridge.context = state.mode;
    bridge.mode = isCliMode(state.mode) ? state.mode : "global";
    const edit = handleCliControl(bridge, key, value, history, historyAt < 0 ? history.length : historyAt);
    if (["Ctrl+A", "Ctrl+E", "Ctrl+U", "Ctrl+W"].includes(key)) {
      return { draft: edit.draft, cursor: edit.cursor };
    }

    const beforePrompt = deviceBuildPrompt(state);
    if (key === "Ctrl+Shift+6") {
      setLines((values) => [...values, `${beforePrompt} ^C`, "% Operation interrupted."].slice(-160));
      setResult(null);
      return { draft: edit.draft, cursor: edit.cursor };
    }

    if (key === "Ctrl+C") {
      if (state.device.pendingInteraction) {
        const cancelled = cancelDeviceBuildPendingInteraction(state);
        setState(cancelled.state);
        setResult(cancelled);
        setLines((values) => [...values, `${beforePrompt} ^C`, ...cancelled.output].slice(-160));
      } else {
        const exited = runDeviceBuildCommand(state, "end");
        setState(exited.state);
        setResult(null);
        setLines((values) => [...values, `${beforePrompt}${value.trim() ? ` ${redactDeviceBuildInput(state, value)}` : ""}^C`].slice(-160));
      }
      setHistoryAt(-1);
      setHistoryDraft("");
      return { draft: "", cursor: 0 };
    }

    const entered = value.trim();
    if (state.device.pendingInteraction) {
      const cancelled = cancelDeviceBuildPendingInteraction(state);
      setState(cancelled.state);
      setResult(cancelled);
      setLines((values) => [...values, `${beforePrompt} ^Z`, ...cancelled.output].slice(-160));
      setHistoryAt(-1);
      setHistoryDraft("");
      return { draft: "", cursor: 0 };
    }
    const commandOutcome = entered ? runDeviceBuildCommand(state, entered) : null;
    const exited = runDeviceBuildCommand(commandOutcome?.state ?? state, "end");
    const outcome = commandOutcome
      ? { ...commandOutcome, state: exited.state, output: [...commandOutcome.output, ...exited.output] }
      : exited;
    setState(outcome.state);
    if (commandOutcome) {
      const displayCommand = commandOutcome.displayInput ?? redactDeviceBuildInput(state, entered);
      setHistory((values) => [...values, displayCommand].slice(-30));
      setLines((values) => [
        ...values,
        `${beforePrompt} ${displayCommand}`,
        ...outcome.output,
        "^Z",
        outcome.accepted ? "✓ Command accepted · returned to Privileged EXEC" : `% ${outcome.explanation}`,
      ].slice(-160));
      setResult(outcome);
      if (outcome.accepted) {
        if (lesson) onEvidence(lesson.command, lesson.mode, state.device.profileId, classifyLearningOutcome(true, {
          hintUsed: hintLevel > 0,
          tabUsed,
          helpUsed,
          answerRevealed: hintLevel === 3,
        }));
        setHintLevel(0);
        setTabUsed(false);
        setHelpUsed(false);
      }
    } else {
      setLines((values) => [...values, `${beforePrompt} ^Z`, ...outcome.output].slice(-160));
      setResult(outcome);
    }
    setHistoryAt(-1);
    setHistoryDraft("");
    return { draft: "", cursor: 0 };
  };

  const copySelection = () => {
    const selection = window.getSelection();
    if (!selection?.toString().trim() || !logRef.current || ![selection.anchorNode, selection.focusNode].every(node => node && logRef.current?.contains(node))) return;
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(selection.toString()).catch(() => {});
    else document.execCommand("copy");
  };

  const clipboardError = () => setResult({ accepted: false, valid: false, state, output: [], explanation: "Clipboard permission was blocked. Use Ctrl+V or the browser’s native right-click menu.", useCase: "Pasted text remains inert inside the simulator.", verification: "Check the prompt before submitting.", rollback: "No simulated state changed.", category: "invalid", errorCode: "WRONG_COMMAND" });

  return (
    <section className="game guided-build">
      <div className="activity-bar">
        <span>Lab {definition.number}</span>
        <strong>{definition.shortTitle}</strong>
        <span>{state.completed ? `${definition.steps.length} of ${definition.steps.length} completed` : `Step ${state.stepIndex + 1} of ${definition.steps.length} · ${state.stepIndex} completed`}</span>
      </div>
      <PracticeWorkspace>
        <aside className="task-panel">
          <div className="task-summary">
            <span className="task-kicker">{state.completed ? "Lab complete" : `${activePhase} · current task`}</span>
            <h1>{state.completed ? `${definition.title} is complete.` : lesson?.objective}</h1>
            <code className="current-context">{deviceBuildPrompt(state)} · {deviceBuildContextName(state)}</code>
            {!state.completed && <p>{lesson?.why}</p>}
            <button className="task-details-toggle" type="button" aria-expanded={taskDetailsOpen} onClick={() => setTaskDetailsOpen(true)}>Need help?</button>
          </div>
          <div className={`task-details ${taskDetailsOpen ? "open" : ""}`}>
            <div className="task-details-head"><strong>Task support</strong><button type="button" aria-label="Close task support" onClick={() => { setTaskDetailsOpen(false); focusAtEnd(); }}>×</button></div>
            <div className="lab-phase-map" aria-label={`Build phase: ${activePhase}`}>
              {phases.map((phase, index) => <span key={phase} className={index < currentPhaseIndex || state.completed ? "complete" : index === currentPhaseIndex ? "active" : ""}><i>{index < currentPhaseIndex || state.completed ? "✓" : index + 1}</i>{phase}</span>)}
            </div>
            {!state.completed && <section className="task-help">
              <span className="task-kicker">Hint</span>
              <strong>{hint?.heading ?? "Not sure what comes next?"}</strong>
              <p>{hint?.explanation ?? "Start with a reasoning hint. Reveal the worked command only when you need it."}</p>
              {hint?.example && hintLevel < 3 && <code>{deviceBuildPrompt(state)} {hint.example}</code>}
              {hintLevel === 0 ? <button className="secondary" type="button" onClick={() => setHintLevel(1)}>Hint 1 · reasoning</button>
                : hintLevel === 1 ? <button className="secondary" type="button" onClick={() => setHintLevel(2)}>Hint 2 · command shape</button>
                : hintLevel === 2 ? <button className="secondary" type="button" onClick={() => setHintLevel(3)}>Show answer · no mastery</button>
                : <><span className="assistance-state">Answer revealed · practise again</span>{lesson && <RevealBundle
                  command={lesson.command || "Press Enter"}
                  whatItDoes={lesson.detail}
                  whyCorrectHere={`${lesson.why} ${lesson.interpretation}`}
                  verification={lesson.verify}
                  recovery={lesson.rollback}
                  shorthand={revealedLabShorthand}
                />}</>}
            </section>}
            {result && <section className={`lesson-detail ${result.accepted ? "accepted" : "rejected"}`}>
              <div><span className="task-kicker">{result.accepted ? "What changed" : "Why it did not work"}</span><p>{result.explanation}</p></div>
              <div><span className="task-kicker">Why this matters</span><p>{result.useCase}</p></div>
              <div><span className="task-kicker">Verify</span><p>{result.verification}</p></div>
              <div><span className="task-kicker">Undo</span><p>{result.rollback}</p></div>
            </section>}
          </div>
        </aside>

        <div className="terminal-panel">
          <div className="terminal guided-terminal">
            <div className="terminal-head"><span>{state.hostname} · simulated console</span><details className="activity-menu"><summary>More</summary><div>{state.device.recoveryCheckpoint && <button type="button" onClick={restoreCheckpoint}>Restore checkpoint</button>}<button type="button" onClick={onHome}>Leave lab</button><button type="button" onClick={restart}>Restart lab</button></div></details></div>
            <TerminalHistory containerRef={logRef} lines={lines} onCopy={copySelection} />
            {state.completed ? <div className="scenario-complete-action"><button className="primary small" onClick={onHome}>Return to Labs</button></div> : <TerminalCommandInput
              key={`${labId}-${state.stepIndex}`}
              ref={inputRef}
              id="guided-command"
              promptText={deviceBuildPrompt(state)}
              accessibleContext={deviceBuildContextName(state)}
              resetKey={`${labId}-${state.stepIndex}`}
              onControl={controlInput}
              onSubmit={submit}
              onTab={complete}
              onHelp={showCliHelp}
              onClipboardError={clipboardError}
            />}
          </div>
          <div className={`command-status ${result?.accepted ? "success" : result && !result.valid ? "error" : "neutral"}`} role="status" aria-live="polite" aria-atomic="true">
            <strong>{result ? result.accepted ? "Command accepted" : result.awaitingConfirmation ? "Confirmation required" : result.valid ? "Valid command · task still open" : "Task still open" : "Terminal ready"}</strong>
            <span>{result ? `${result.explanation} ${result.useCase}` : "Enter a command, use Tab for the current token, or press ? to browse this prompt."}</span>
          </div>
          <p className="help">Autosaved locally · {tabUsed || hintLevel ? "Assisted – practise again" : helpUsed ? "Guided discovery" : "Independent recall available"} · Highlight to copy</p>
        </div>
      </PracticeWorkspace>
    </section>
  );
};

interface SavedGoodToKnowSession {
  version: 1;
  stepIndex: number;
  reviewIndex: number | null;
  checkpointRestoredAt: number | null;
}

const runGoodToKnowFixture = (current: DeviceState, fixture: readonly string[]): DeviceState => {
  let state = current;
  for (const command of fixture) {
    const result = executeCliCommand(state, command, commands);
    if (!result.accepted) return state;
    state = result.state;
  }
  return state;
};

const createGoodToKnowDevice = (): DeviceState => {
  let state = runGoodToKnowFixture(initialDevice("router-ios-xe"), [
    "enable",
    "configure terminal",
    "interface GigabitEthernet0/0/1",
    "description BASELINE UPLINK",
    "end",
    "copy running-config startup-config",
  ]);
  if (state.pendingInteraction) state = executeCliCommand(state, "", commands).state;
  return state;
};

const replayGoodToKnowLesson = (current: DeviceState, index: number): DeviceState => {
  const lesson = goodToKnowLessons[index];
  if (!lesson) return current;
  let state = runGoodToKnowFixture(current, lesson.fixture ?? []);
  if (lesson.control) return handleCliControl(state, lesson.control, lesson.initialDraft ?? "", [], 0).state;
  state = executeCliCommand(state, lesson.command, commands).state;
  if (lesson.confirmation === "accept-default") state = executeCliCommand(state, "", commands).state;
  if (lesson.confirmation === "confirm") state = executeCliCommand(state, "confirm", commands).state;
  if (lesson.confirmation === "decline") state = executeCliCommand(state, "no", commands).state;
  return state;
};

const restoreGoodToKnowSession = (saved: SavedGoodToKnowSession): DeviceState => {
  let state = createGoodToKnowDevice();
  for (let index = 0; index < saved.stepIndex; index += 1) {
    state = replayGoodToKnowLesson(state, index);
    if (saved.checkpointRestoredAt === index + 1) state = restoreDeviceCheckpoint(state).state;
  }
  const current = goodToKnowLessons[saved.stepIndex];
  return current ? runGoodToKnowFixture(state, current.fixture ?? []) : state;
};

const validGoodToKnowSession = (value: unknown): SavedGoodToKnowSession | null => {
  if (!value || typeof value !== "object") return null;
  const saved = value as Partial<SavedGoodToKnowSession>;
  if (saved.version !== 1 || !Number.isInteger(saved.stepIndex) || saved.stepIndex! < 0 || saved.stepIndex! > goodToKnowLessons.length) return null;
  const reviewIndex = saved.reviewIndex === null || Number.isInteger(saved.reviewIndex) && saved.reviewIndex! >= 0 && saved.reviewIndex! < goodToKnowLessons.length
    ? saved.reviewIndex ?? null
    : null;
  const checkpointRestoredAt = saved.checkpointRestoredAt === null || Number.isInteger(saved.checkpointRestoredAt) && saved.checkpointRestoredAt! >= 1 && saved.checkpointRestoredAt! <= saved.stepIndex!
    ? saved.checkpointRestoredAt ?? null
    : null;
  return { version: 1, stepIndex: saved.stepIndex!, reviewIndex, checkpointRestoredAt };
};

const GoodToKnowPractice = ({ onHome, onEvidence }: { onHome: () => void; onEvidence: PracticeEvidenceRecorder }) => {
  const [session, setSession] = useState<SavedGoodToKnowSession>({ version: 1, stepIndex: 0, reviewIndex: null, checkpointRestoredAt: null });
  const [state, setState] = useState<DeviceState>(createGoodToKnowDevice);
  const [lines, setLines] = useState<string[]>([
    "CLI RUSH // SAVE, UNDO AND GET UNSTUCK",
    "Saved training-router fixture ready · answers stay hidden until you reveal them",
  ]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(-1);
  const [revealed, setRevealed] = useState(false);
  const [tabUsed, setTabUsed] = useState(false);
  const [helpUsed, setHelpUsed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const inputRef = useRef<TerminalInputHandle>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const lesson = goodToKnowLessons[session.stepIndex];
  const reviewed = session.reviewIndex === null ? null : goodToKnowLessons[session.reviewIndex];
  const revealedGoodCommand = revealed && lesson ? commandForReveal(lesson.command, lesson.mode, commands, state.profileId) : null;
  const revealedGoodShorthand = revealedGoodCommand
    ? parserProvenShorthandExamples(revealedGoodCommand, commands, state.profileId)
    : [];
  const reviewedCommand = reviewed ? commandForReveal(reviewed.command, reviewed.mode, commands, state.profileId) : null;

  const persist = useCallback((next: SavedGoodToKnowSession) => {
    setSession(next);
    try { localStorage.setItem(goodToKnowStorageKey, JSON.stringify(next)); } catch {}
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(goodToKnowStorageKey);
      const restored = raw ? validGoodToKnowSession(JSON.parse(raw)) : null;
      if (!restored) return;
      setSession(restored);
      setState(restoreGoodToKnowSession(restored));
      setLines([
        "CLI RUSH // SAVE, UNDO AND GET UNSTUCK",
        `Restored at exercise ${Math.min(restored.stepIndex + 1, goodToKnowLessons.length)} of ${goodToKnowLessons.length}.`,
      ]);
    } catch {}
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 1_000_000_000;
  }, [lines]);

  const finishLesson = (nextState: DeviceState) => {
    if (!lesson) return;
    onEvidence(lesson.command, lesson.mode, state.profileId, classifyLearningOutcome(true, {
      hintUsed: false,
      tabUsed,
      helpUsed,
      answerRevealed: revealed,
    }));
    const nextStep = session.stepIndex + 1;
    const nextLesson = goodToKnowLessons[nextStep];
    setState(nextLesson ? runGoodToKnowFixture(nextState, nextLesson.fixture ?? []) : nextState);
    persist({ ...session, stepIndex: nextStep, reviewIndex: session.stepIndex });
    setRevealed(false);
    setTabUsed(false);
    setHelpUsed(false);
    setAcknowledged(false);
  };

  const submit = (raw: string) => {
    if (!lesson || reviewed || lesson.acknowledgement && !acknowledged) return;
    const wasPending = state.pendingInteraction;
    const execution = executeCliCommand(state, raw, commands);
    const display = raw.trim() ? redactCommandInput(raw, state.context, commands, state.profileId) : "[Enter]";
    setState(execution.state);
    if (raw.trim()) {
      setHistory((current) => [...current, display].slice(-30));
      setHistoryAt(-1);
    }
    setLines((current) => [...current, `${prompt(state)} ${display}`, ...execution.output].slice(-160));

    if (wasPending) {
      if (lesson.confirmation === "accept-default" && execution.accepted) finishLesson(execution.state);
      else if (lesson.confirmation === "confirm" && execution.accepted) finishLesson(execution.state);
      else if (lesson.confirmation === "decline" && /confirmation declined/iu.test(execution.output.join(" "))) finishLesson(execution.state);
      else setTimeout(() => inputRef.current?.focusAtEnd(), 0);
      return;
    }

    const expected = resolveCommand(lesson.command, lesson.mode, commands, state.profileId);
    const expectedProduction = expected.status === "valid" ? expected.event.production.command.id : null;
    if (!execution.accepted || execution.event?.production.command.id !== expectedProduction) {
      setLines((current) => [...current, execution.accepted
        ? "% Valid simulator command, but the stated exercise is still open."
        : "% Exercise remains open; inspect the prompt or use ? for contextual help."].slice(-160));
      setTimeout(() => inputRef.current?.focusAtEnd(), 0);
      if (!execution.accepted) onEvidence(lesson.command, lesson.mode, state.profileId, "incorrect", execution.output.join(" "));
      return;
    }
    if (lesson.confirmation) {
      setLines((current) => [...current, lesson.confirmation === "decline"
        ? "Safety decision: type no to decline this simulated disruption."
        : lesson.confirmation === "confirm"
          ? "Broad change staged: type confirm only after reviewing the warning."
          : "Press Enter to accept startup-config as the destination."].slice(-160));
      setTimeout(() => inputRef.current?.focusAtEnd(), 0);
      return;
    }
    finishLesson(execution.state);
  };

  const control = (draft: string, key: CliControlKey) => {
    const result = handleCliControl(state, key, draft, history, historyAt < 0 ? history.length : historyAt);
    setState(result.state);
    if (typeof result.historyIndex === "number") setHistoryAt(result.historyIndex === history.length ? -1 : result.historyIndex);
    if (result.output.length) setLines((current) => [...current, `${prompt(state)} ${redactCommandForDisplay(draft)}`, ...result.output].slice(-160));
    const controlCompletes = lesson && !reviewed && lesson.control === key && state.context === lesson.mode
      && (key === "Ctrl+C"
        ? !result.executed && result.state.hostname === state.hostname
        : key === "Ctrl+Z" && result.executed && result.state.hostname === "Z-DRAFT-RAN");
    if (controlCompletes) finishLesson(result.state);
    return { draft: result.draft, cursor: result.cursor };
  };

  const complete = (value: string) => {
    const completion = completeCliInput(value, state.context, commands, state.profileId);
    if (completion.changed) setTabUsed(true);
    setLines((current) => [...current, `% Tab: ${completion.message}`].slice(-160));
    return completion.input;
  };

  const help = (value: string) => {
    const result = cliHelp(value, state.context, commands, state.profileId);
    if (result.options.length) setHelpUsed(true);
    setLines((current) => [
      ...current,
      `${prompt(state)} ${redactCommandInput(value, state.context, commands, state.profileId)}?`,
      ...(result.options.length ? result.options.map((option) => `  ${option.value.padEnd(22)} ${option.description}`) : ["  % No matching options"]),
    ].slice(-160));
  };

  const continueAfterReview = () => {
    persist({ ...session, reviewIndex: null });
    setTimeout(() => inputRef.current?.focusAtEnd(), 0);
  };

  const restoreCheckpoint = () => {
    const result = restoreDeviceCheckpoint(state);
    setState(result.state);
    setLines((current) => [...current, ...result.output].slice(-160));
    if (result.accepted) persist({ ...session, checkpointRestoredAt: session.stepIndex });
  };

  const restart = () => {
    if (!window.confirm("Restart Save, undo and get unstuck from the saved training fixture?")) return;
    const next = { version: 1, stepIndex: 0, reviewIndex: null, checkpointRestoredAt: null } satisfies SavedGoodToKnowSession;
    try { localStorage.removeItem(goodToKnowStorageKey); } catch {}
    setSession(next);
    setState(createGoodToKnowDevice());
    setLines(["CLI RUSH // SAVE, UNDO AND GET UNSTUCK", "New saved training-router fixture ready."]);
    setHistory([]);
    setHistoryAt(-1);
    setRevealed(false);
    setTabUsed(false);
    setHelpUsed(false);
    setAcknowledged(false);
  };

  const copySelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !logRef.current?.contains(selection.anchorNode)) return;
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(selection.toString()).catch(() => {});
  };

  return <section className="scenario guided-lab" aria-labelledby="good-to-know-title">
    <div className="activity-bar">
      <button className="secondary small" type="button" onClick={onHome}>← Practice home</button>
      <strong>{session.stepIndex >= goodToKnowLessons.length ? "Complete" : `Exercise ${session.stepIndex + 1} of ${goodToKnowLessons.length}`}</strong>
      <span>IOS XE training router · autosaved locally</span>
    </div>
    <PracticeWorkspace>
      <aside className="task-panel">
        {reviewed ? <div className="task-summary">
          <span className="task-kicker">EXERCISE COMPLETE</span>
          <h1 id="good-to-know-title">{reviewed.title}</h1>
          <RevealBundle
            command={reviewed.command}
            whatItDoes={reviewed.summary}
            whyCorrectHere={reviewed.why}
            verification={reviewed.verification}
            recovery={reviewed.recovery}
            shorthand={reviewedCommand ? parserProvenShorthandExamples(reviewedCommand, commands, state.profileId) : []}
          />
          <button className="primary" type="button" onClick={continueAfterReview}>{session.stepIndex >= goodToKnowLessons.length ? "View completion" : "Continue"}</button>
        </div> : lesson ? <>
          <div className="task-summary">
            <span className="task-kicker">SAVE, UNDO AND GET UNSTUCK</span>
            <h1 id="good-to-know-title">{lesson.title}</h1>
            <p>{lesson.task}</p>
            <code className="current-context">{prompt(state)} · {modeNames[state.context]}</code>
            <p>{lesson.summary}</p>
          </div>
          {lesson.acknowledgement && <label className="case-note"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> {lesson.acknowledgement}</label>}
          <div className="report-actions">
            <button className="secondary" type="button" onClick={() => setRevealed(true)} disabled={revealed}>Reveal answer</button>
            <button className="secondary" type="button" onClick={restart}>Restart exercises</button>
          </div>
          {revealed && <div className="task-details open"><strong>Revealed answer · assisted practice</strong><RevealBundle
            command={lesson.command}
            whatItDoes={lesson.summary}
            whyCorrectHere={lesson.why}
            verification={lesson.verification}
            recovery={lesson.recovery}
            shorthand={revealedGoodShorthand}
          /></div>}
        </> : <div className="task-summary">
          <span className="task-kicker">PRACTICAL COMPLETE</span>
          <h1 id="good-to-know-title">You practised safe save, undo and recovery decisions.</h1>
          <p>Repeat the sequence until you can explain why a merge, a replacement and a reload are different operations.</p>
          <div className="report-actions"><button className="primary" type="button" onClick={onHome}>Return to practice</button><button className="secondary" type="button" onClick={restart}>Run again</button></div>
        </div>}
        <details className="task-details open">
          <summary>Review the distinctions</summary>
          {goodToKnowDistinctions.map((item) => <p key={item.id}><b>{item.title}:</b> {item.detail}</p>)}
        </details>
      </aside>
      <div className="terminal-panel">
        <div className="terminal-heading"><span>••• R1 // ISOLATED SAFETY PRACTICE</span><div>{state.recoveryCheckpoint && <button type="button" onClick={restoreCheckpoint}>Restore checkpoint</button>}<button type="button" onClick={restart}>Restart</button></div></div>
        <div className="terminal-body">
          <TerminalHistory lines={lines} containerRef={logRef} onCopy={copySelection} />
          {!reviewed && lesson && <TerminalCommandInput
            key={`good-${lesson.id}`}
            ref={inputRef}
            id="good-to-know-command"
            promptText={prompt(state)}
            accessibleContext={modeNames[state.context]}
            initialValue={lesson.initialDraft ?? ""}
            resetKey={lesson.id}
            disabled={Boolean(lesson.acknowledgement && !acknowledged)}
            onControl={control}
            onSubmit={submit}
            onTab={complete}
            onHelp={help}
            onClipboardError={() => setLines((current) => [...current, "% Clipboard permission was blocked; use Ctrl+V or the browser menu."].slice(-160))}
          />}
        </div>
        <p className="help">Use ? and Tab without a penalty · Up/Down recalls commands · Highlight to copy · Recovery stays inside the simulator</p>
      </div>
    </PracticeWorkspace>
  </section>;
};

export default function GameClient() {
  const keyboardOpen = useViewportEnvironment();
  const [screen, setScreen] = useState<Screen>("home");
  const [progress, setProgress] = useState<Progress>(blankProgress);
  const [round, setRound] = useState<Round>(blankRound);
  const [report, setReport] = useState<Report | null>(null);
  const [selectedMode, setSelectedMode] = useState<GameModeId>("easy");
  const [activeMode, setActiveMode] = useState<GameModeId>("easy");
  const [sessionKind, setSessionKind] = useState<SessionKind>("practice");
  const [sessionLimit, setSessionLimit] = useState<number | null>(null);
  const [scenario, setScenario] = useState<Ipv4ScenarioState>(() => createIpv4Scenario(1));
  const [scenarioInput, setScenarioInput] = useState("");
  const [scenarioLines, setScenarioLines] = useState<string[]>([]);
  const [scenarioLesson, setScenarioLesson] = useState<Ipv4ScenarioActionResult | null>(null);
  const [scenarioHistory, setScenarioHistory] = useState<string[]>([]);
  const [scenarioHistoryAt, setScenarioHistoryAt] = useState(-1);
  const [scenarioHistoryDraft, setScenarioHistoryDraft] = useState("");
  const [scenarioSessionAvailable, setScenarioSessionAvailable] = useState(false);
  const [navigationSessionAvailable, setNavigationSessionAvailable] = useState(false);
  const [scenarioPersistenceReady, setScenarioPersistenceReady] = useState(false);
  const [, setScenarioSavedAt] = useState<number | null>(null);
  const [scenarioHintLevel, setScenarioHintLevel] = useState<0 | 1 | 2 | 3>(0);
  const [scenarioTabUsed, setScenarioTabUsed] = useState(false);
  const [scenarioHelpUsed, setScenarioHelpUsed] = useState(false);
  const [activeGuidedLab, setActiveGuidedLab] = useState<DeviceBuildLabId>("router-foundation");
  const [guidedResumes, setGuidedResumes] = useState<GuidedResumeSummary[]>([]);
  const [roundResumeAvailable, setRoundResumeAvailable] = useState(false);
  const [taskDetailsOpen, setTaskDetailsOpen] = useState(false);

  const progressRef = useRef(progress);
  const roundRef = useRef(round);
  const finishing = useRef(false);
  const retried = useRef(new Set<string>());
  const lockInQueued = useRef(new Set<string>());
  const roundAttempts = useRef(new Map<string, number>());
  const reviewBaselines = useRef(new Map<string, Review | undefined>());
  const submittedForCurrentObjective = useRef(false);
  const consecutiveWrong = useRef(0);
  const cliAssisted = useRef(false);
  const guidedDiscovery = useRef(false);
  const roundHadCliAssistance = useRef(false);
  const pendingRoundInput = useRef("");
  const assistanceRecorded = useRef({ assisted: false, guided: false, revealed: false });
  const timeChangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerLastTick = useRef<number | null>(null);
  const pausedAt = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const activeAudioRef = useRef<OscillatorNode[]>([]);

  const [queue, setQueue] = useState(() => commands.map((command) => command.id));
  const [cursor, setCursor] = useState(0);
  const [device, setDevice] = useState<DeviceState>(initialDevice);
  const [time, setTime] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(-1);
  const [historyDraft, setHistoryDraft] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [advancing, setAdvancing] = useState(false);
  const [presentationAttempt, setPresentationAttempt] = useState(1);
  const [assistance, setAssistance] = useState<AssistanceLevel>(0);
  const [cliAssistanceUsed, setCliAssistanceUsed] = useState(false);
  const [guidedDiscoveryUsed, setGuidedDiscoveryUsed] = useState(false);
  const [easyComplete, setEasyComplete] = useState(false);
  const [timeChange, setTimeChange] = useState<TimeChange | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());

  const [customRecords, setCustomRecords] = useState<CustomCommandRecord[]>([]);
  const [customStatus, setCustomStatus] = useState("");
  const [serverBacked, setServerBacked] = useState(false);
  const [customStoreUnavailable, setCustomStoreUnavailable] = useState(false);
  const [dockerUser, setDockerUser] = useState<string | null>(null);
  const [feedback, setFeedbackState] = useState({
    tone: "neutral",
    title: "Terminal ready",
    message: "Choose a game mode, read the objective and build the command.",
  });
  const feedbackElementRef = useRef<HTMLDivElement>(null);
  const pendingProgressPersistence = useRef<Progress | null>(null);
  const progressPersistenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roundSnapshotRef = useRef<SavedRoundSession | null>(null);
  const roundDraftRef = useRef("");
  const customEtagRef = useRef<string | null>(null);

  const inputRef = useRef<TerminalInputHandle>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const resumeButtonRef = useRef<HTMLButtonElement>(null);
  const nextEasyButtonRef = useRef<HTMLButtonElement>(null);
  const reportHeadingRef = useRef<HTMLHeadingElement>(null);
  const scenarioInputRef = useRef<TerminalInputHandle>(null);
  const scenarioLogRef = useRef<HTMLDivElement>(null);

  const setFeedback = useCallback((next: { tone: string; title: string; message: string }) => {
    // Feedback is the latency-sensitive part of command acceptance. Update the
    // small live region immediately, then reconcile it through React as a
    // non-urgent render so the surrounding workspace does not block the cue.
    const element = feedbackElementRef.current;
    if (element) {
      element.className = `command-status ${next.tone}`;
      const title = element.querySelector("strong");
      const message = element.querySelector("span");
      if (title) title.textContent = next.title;
      if (message) message.textContent = next.message;
    }
    startTransition(() => setFeedbackState(next));
  }, []);

  const customCommands = useMemo(
    () => customRecords.map(toRegistryCommand).filter((command): command is Command => command !== null),
    [customRecords],
  );
  const catalogue = useMemo(() => [...commands, ...customCommands], [customCommands]);
  const reviews = useMemo(() => {
    const knownIds = new Set(catalogue.map((command) => command.id));
    return Object.fromEntries(
      Object.entries(progress.commands)
        .filter(([id, value]) => knownIds.has(id) && value.review)
        .map(([id, value]) => [id, value.review!]),
    );
  }, [catalogue, progress.commands]);
  const curriculum = useMemo(
    () => buildBeginnerCurriculum(catalogue.filter((command) => !command.custom)),
    [catalogue],
  );
  const curriculumStates = useMemo(
    () => curriculumProgress(curriculum, reviews),
    [curriculum, reviews],
  );
  const nextChapterState = useMemo(
    () => nextCurriculumChapter(curriculum, reviews),
    [curriculum, reviews],
  );
  const item = useMemo(
    () => catalogue.find((command) => command.id === (queue[cursor] ?? queue.at(-1))) ?? catalogue[0],
    [catalogue, cursor, queue],
  );
  const learningHints = useMemo(() => learningHintsFor(item), [item]);
  const currentTeaching = useMemo(() => teachingFor(item), [item]);
  const currentLearningTask = useMemo(() => learningTaskFor(item), [item]);
  const currentRevealShorthand = useMemo(
    () => assistance === 3 ? parserProvenShorthandExamples(item, catalogue, device.profileId) : [],
    [assistance, catalogue, device.profileId, item],
  );
  const roundParserReady = useMemo(() => {
    if (screen !== "round") return null;
    const prepared = prepare(device, item);
    const resolved = resolveCommand(item.canonical, item.mode, catalogue, prepared.profileId);
    // Exercise the invalid-input diagnostic path before the field is exposed.
    // This keeps parser construction and first-call JIT work out of command 1.
    const warmInput = "__cli_rush_parser_warmup__";
    const execution = executeCliCommand(prepared, warmInput, catalogue);
    validate(warmInput, prepared.mode, item.id, catalogue);
    executionSatisfiesLearningObjective(item, prepared, execution, catalogue);
    safeCommandContext(item);
    return resolved;
  }, [catalogue, device, item, screen]);
  void roundParserReady;
  const scenarioChoices = useMemo(() => getIpv4ScenarioChoices(scenario), [scenario]);
  const scenarioHint = useMemo(
    () => scenarioHintLevel === 0 ? null : getIpv4ScenarioHint(scenario, scenarioHintLevel),
    [scenario, scenarioHintLevel],
  );
  const scenarioRevealCatalogue = useMemo(() => getIpv4ScenarioCatalogue(scenario), [scenario]);
  const scenarioRevealCommand = useMemo(() => scenarioHintLevel === 3 && scenarioHint?.example
    ? commandForReveal(scenarioHint.example, scenario.mode, scenarioRevealCatalogue, "router-ios-xe")
    : null, [scenario.mode, scenarioHint, scenarioHintLevel, scenarioRevealCatalogue]);
  const activeRules = gameModeById(activeMode);
  const selectedRules = gameModeById(selectedMode);
  const timed = time !== null;

  const attemptRecord = (
    learnerInput: string,
    parserCategory: RoundAttemptParserCategory,
    mastery: RoundAttemptMastery,
    parserReason: string,
    nonCompletionReason: string,
  ): RoundAttemptRecord => ({
    version: roundAttemptRecordVersion,
    commandId: item.id,
    task: item.objective,
    learnerInput,
    parserCategory,
    parserReason,
    correctCommand: redactCommandInput(item.canonical, item.mode, catalogue, item.deviceProfile ?? device.profileId),
    purpose: currentTeaching.purpose,
    nonCompletionReason,
    requiredContext: modeNames[item.mode],
    verification: currentTeaching.verify,
    stateEffect: currentTeaching.expected,
    mastery,
  });

  const recordAttempt = (
    base: Round,
    learnerInput: string,
    parserCategory: RoundAttemptParserCategory,
    mastery: RoundAttemptMastery,
    parserReason: string,
    nonCompletionReason: string,
  ): Round => ({
    ...base,
    attemptRecords: appendRoundAttemptRecord(
      base.attemptRecords,
      attemptRecord(learnerInput, parserCategory, mastery, parserReason, nonCompletionReason),
    ),
  });

  const save = useCallback((next: Progress) => {
    progressRef.current = next;
    pendingProgressPersistence.current = next;
    startTransition(() => setProgress(next));
    if (progressPersistenceTimer.current) clearTimeout(progressPersistenceTimer.current);
    progressPersistenceTimer.current = setTimeout(() => {
      const pending = pendingProgressPersistence.current;
      if (!pending) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(pending));
        pendingProgressPersistence.current = null;
      } catch {}
    }, 120);
  }, []);

  useEffect(() => {
    const flushProgress = () => {
      const pending = pendingProgressPersistence.current;
      if (!pending) return;
      try {
        localStorage.setItem(storageKey, JSON.stringify(pending));
        pendingProgressPersistence.current = null;
      } catch {}
    };
    window.addEventListener("pagehide", flushProgress);
    return () => {
      window.removeEventListener("pagehide", flushProgress);
      if (progressPersistenceTimer.current) clearTimeout(progressPersistenceTimer.current);
      flushProgress();
    };
  }, []);

  const setRoundBoth = useCallback((next: Round) => {
    roundRef.current = next;
    startTransition(() => setRound(next));
  }, []);

  useEffect(() => {
    roundSnapshotRef.current = {
      version: 2,
      activeMode,
      cursor,
      device,
      history: history.map(redactCommandForDisplay).slice(-80),
      input: "",
      lines: lines.map(redactTerminalLine).slice(-500),
      paused,
      queue: queue.slice(0, 512),
      round,
      savedAt: Date.now(),
      sessionKind,
      sessionLimit,
      time,
    };
  }, [activeMode, cursor, device, history, lines, paused, queue, round, sessionKind, sessionLimit, time]);

  const rememberRoundDraft = useCallback((value: string) => {
    roundDraftRef.current = value;
  }, []);

  const refreshGuidedResumes = useCallback(() => {
    const summaries = deviceBuildLabs.flatMap((lab) => {
      try {
        const raw = localStorage.getItem(guidedLabStorageKey(lab.id));
        if (!raw) return [];
        const saved = JSON.parse(raw) as Partial<SavedGuidedLab>;
        const restored = restoreDeviceBuildState(saved.state);
        if (!restored) return [];
        return [{
          completed: restored.completed,
          labId: lab.id,
          stepIndex: restored.stepIndex,
          totalSteps: getDeviceBuildDefinition(lab.id).steps.length,
        } satisfies GuidedResumeSummary];
      } catch {
        return [];
      }
    });
    setGuidedResumes(summaries);
  }, []);

  const clearSavedRound = useCallback(() => {
    try { localStorage.removeItem(roundStorageKey); } catch {}
    setRoundResumeAvailable(false);
  }, []);

  useEffect(() => {
    let localCommands: Command[] = [];
    let localCustomRecords: CustomCommandRecord[] = [];
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const loaded = hydrateProgress(JSON.parse(raw));
        progressRef.current = loaded;
        setProgress(loaded);
        setSelectedMode(loaded.lastMode);
      }
      const versionTwoRaw = localStorage.getItem(customStorageKey);
      const legacyRaw = localStorage.getItem(legacyCustomStorageKey);
      const customRaw = versionTwoRaw ?? legacyRaw;
      if (customRaw) {
        const migration = migrateLegacyCustomCommands(JSON.parse(customRaw), { catalogue: commands });
        localCustomRecords = [...migration.records];
        setCustomRecords([...migration.records]);
        localCommands = migration.records
          .map(toRegistryCommand)
          .filter((command): command is Command => command !== null);
        localStorage.setItem(customStorageKey, JSON.stringify(migration.records));
        if (migration.storeIssues.length) {
          setCustomStatus(migration.storeIssues.map((issue) => issue.message).join(" "));
        } else if (!versionTwoRaw && legacyRaw) {
          setCustomStatus("Legacy custom content was retained for semantic review.");
        }
      }
    } catch {}

    try {
      const scenarioRaw = localStorage.getItem(scenarioStorageKey);
      if (scenarioRaw) {
        const saved = JSON.parse(scenarioRaw) as Partial<SavedScenarioSession>;
        const restored = saved.version === 1 ? restoreIpv4ScenarioState(saved.state) : null;
        if (restored) {
          const restoredLines = Array.isArray(saved.lines)
            ? saved.lines.filter((line): line is string => typeof line === "string").map((line) => redactTerminalLine(line.slice(0, 500))).slice(-120)
            : [];
          const restoredHistory = Array.isArray(saved.history)
            ? saved.history.filter((entry): entry is string => typeof entry === "string").map((entry) => redactCommandForDisplay(entry.slice(0, 256))).slice(-20)
            : [];
          setScenario(restored);
          setScenarioLines(restoredLines.length ? restoredLines : ["CLI RUSH // IPV4 FIELD LAB // RESTORED SESSION"]);
          setScenarioHistory(restoredHistory);
          setScenarioInput(typeof saved.input === "string" ? saved.input.slice(0, 256) : "");
          setScenarioSessionAvailable(true);
          setScenarioSavedAt(typeof saved.savedAt === "number" ? saved.savedAt : null);
        }
      }
    } catch {}
    setScenarioPersistenceReady(true);
    refreshGuidedResumes();

    const requestedScreen = new URL(window.location.href).searchParams.get("activity");
    const requestedLab = new URL(window.location.href).searchParams.get("lab");
    if (requestedScreen === "round") {
      try {
        const restored = restoreSavedRound(JSON.parse(localStorage.getItem(roundStorageKey) ?? "null"));
        if (restored) {
          const knownIds = new Set([...commands, ...localCommands].map((command) => command.id));
          const restoredQueue = restored.queue.filter((id) => knownIds.has(id));
          if (restoredQueue.length) {
            setActiveMode(restored.activeMode);
            setSelectedMode(restored.activeMode);
            setSessionKind(restored.sessionKind);
            setSessionLimit(restored.sessionLimit);
            setRoundBoth(restored.round);
            setQueue(restoredQueue);
            setCursor(Math.min(restored.cursor, restoredQueue.length - 1));
            setDevice(restored.device);
            setTime(restored.time);
            setPaused(restored.paused);
            setHistory(restored.history);
            setLines(restored.lines);
            roundDraftRef.current = restored.input;
            setRoundResumeAvailable(true);
            setScreen("round");
          }
        }
      } catch {}
    } else if (requestedScreen === "scenario" || requestedScreen === "scenario-report") {
      setScreen(requestedScreen);
    } else if (requestedScreen === "guided-lab" && deviceBuildLabs.some((lab) => lab.id === requestedLab)) {
      setActiveGuidedLab(requestedLab as DeviceBuildLabId);
      setScreen("guided-lab");
    } else if (requestedScreen === "good-to-know") {
      setScreen("good-to-know");
    }

    try {
      if (localStorage.getItem(roundStorageKey)) setRoundResumeAvailable(true);
      if (localStorage.getItem(navigationStorageKey)) setNavigationSessionAvailable(true);
    } catch {}

    if (requestedScreen === "navigation") setScreen("navigation");

    void (async () => {
      let authenticatedDockerSession = false;
      try {
        const session = await fetch("/api/session", { credentials: "same-origin" });
        if (!session.ok) return;
        authenticatedDockerSession = true;
        const sessionData = await session.json();
        setDockerUser(sessionData.username);
        const response = await fetch("/api/custom-commands", { credentials: "same-origin" });
        if (!response.ok) {
          customEtagRef.current = unavailableCustomStoreEtag;
          setCustomStoreUnavailable(true);
          setServerBacked(true);
          setCustomStatus(`Docker command storage is unavailable (HTTP ${response.status}). Browser commands were retained and no server write was attempted.`);
          return;
        }
        const serverCommands = await response.json();
        const migration = migrateLegacyCustomCommands(serverCommands, { catalogue: commands });
        const reconciled = reconcileCustomCommandStores(localCustomRecords, migration.records);
        customEtagRef.current = response.headers.get("etag");
        setCustomStoreUnavailable(false);
        setServerBacked(true);
        if (reconciled.retainedLocal) {
          // An empty new Docker volume must not erase an existing browser-only
          // authoring store. Keep it visible; the next deliberate save imports
          // the complete validated set under the server's current ETag.
          setCustomRecords(reconciled.records);
          setCustomStatus("The Docker command store is empty. Existing browser commands were retained; your next deliberate command edit will save the validated set to Docker.");
          return;
        }
        const mirrored = commitAuthoritativeCustomCommandRecords(
          reconciled.records,
          setCustomRecords,
          (records) => localStorage.setItem(customStorageKey, JSON.stringify(records)),
        );
        const loadedStatus = migration.storeIssues.length
          ? migration.storeIssues.map((issue) => issue.message).join(" ")
          : migration.records.some((record) => record.status === "incomplete")
            ? "Stored legacy content is retained but inactive until its semantic fields are reviewed."
            : "Custom command schema 2 loaded from the Docker data volume.";
        setCustomStatus(`${loadedStatus}${mirrored ? "" : " Docker data is active, but this browser could not update its optional local mirror."}`);
      } catch {
        if (authenticatedDockerSession) {
          customEtagRef.current = unavailableCustomStoreEtag;
          setCustomStoreUnavailable(true);
          setServerBacked(true);
          setCustomStatus("Docker command storage could not be reached. Browser commands were retained and no server write will be attempted; retry after the local service is healthy.");
        }
      }
    })();
  }, [refreshGuidedResumes, setRoundBoth]);

  useEffect(() => {
    if (screen !== "round") return;
    const restoredDraft = roundDraftRef.current;
    submittedForCurrentObjective.current = false;
    pendingRoundInput.current = "";
    if (lockInQueued.current.delete(item.id)) {
      roundAttempts.current.delete(item.id);
      reviewBaselines.current.delete(item.id);
      retried.current.delete(item.id);
    }
    setPresentationAttempt((roundAttempts.current.get(item.id) ?? 0) + 1);
    setAssistance(0);
    cliAssisted.current = false;
    guidedDiscovery.current = false;
    assistanceRecorded.current = { assisted: false, guided: false, revealed: false };
    setCliAssistanceUsed(false);
    setGuidedDiscoveryUsed(false);
    setEasyComplete(false);
    setTaskDetailsOpen(false);
    setDevice((current) => {
      const prepared = prepare(current, item);
      // Build the profile registry before the learner's first submission so a
      // cold parser index never sits on the command-acceptance path.
      resolveCommand(item.canonical, item.mode, catalogue, prepared.profileId);
      return prepared;
    });
    setStartedAt(performance.now());
    pausedAt.current = null;
    setAdvancing(false);
    setTimeout(() => restoredDraft ? inputRef.current?.setValue(restoredDraft) : inputRef.current?.focusAtEnd(), 0);
  }, [catalogue, cursor, item, screen]);

  useEffect(() => {
    if (!scenarioPersistenceReady) return;
    const url = new URL(window.location.href);
    const activity = screen === "home" || screen === "manage" || screen === "report" ? null : screen;
    const currentActivity = url.searchParams.get("activity");
    const currentLab = url.searchParams.get("lab");
    const nextLab = screen === "guided-lab" ? activeGuidedLab : null;
    if (currentActivity === activity && currentLab === nextLab) return;
    if (activity) url.searchParams.set("activity", activity);
    else url.searchParams.delete("activity");
    if (nextLab) url.searchParams.set("lab", nextLab);
    else url.searchParams.delete("lab");
    window.history.pushState({ cliRushActivity: activity, lab: nextLab }, "", `${url.pathname}${url.search}${url.hash}`);
  }, [activeGuidedLab, scenarioPersistenceReady, screen]);

  useEffect(() => {
    const onPopState = () => {
      const url = new URL(window.location.href);
      const activity = url.searchParams.get("activity");
      const lab = url.searchParams.get("lab");
      if (activity === "round" && roundResumeAvailable) setScreen("round");
      else if (activity === "navigation") setScreen("navigation");
      else if (activity === "scenario" || activity === "scenario-report") setScreen(activity);
      else if (activity === "good-to-know") setScreen("good-to-know");
      else if (activity === "guided-lab" && deviceBuildLabs.some((entry) => entry.id === lab)) {
        setActiveGuidedLab(lab as DeviceBuildLabId);
        setScreen("guided-lab");
      } else setScreen("home");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [roundResumeAvailable]);

  useEffect(() => {
    if (keyboardOpen) setTaskDetailsOpen(false);
  }, [keyboardOpen]);

  useEffect(() => {
    if (screen === "round" && paused) {
      setTimeout(() => resumeButtonRef.current?.focus(), 0);
    }
  }, [paused, screen]);

  useEffect(() => {
    if (screen === "round" && activeMode === "easy" && easyComplete) {
      setTaskDetailsOpen(!window.matchMedia("(max-width: 800px)").matches);
      requestAnimationFrame(() => nextEasyButtonRef.current?.scrollIntoView({ block: "nearest" }));
    }
  }, [activeMode, easyComplete, screen]);

  useEffect(() => {
    if (screen === "report") {
      setTimeout(() => reportHeadingRef.current?.focus(), 0);
    }
  }, [screen]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [screen]);

  useEffect(() => {
    if (screen !== "home" && screen !== "report") return;
    setClockNow(Date.now());
    const id = setInterval(() => setClockNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [screen]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 1_000_000_000;
  }, [lines]);

  useEffect(() => {
    if (scenarioLogRef.current) scenarioLogRef.current.scrollTop = 1_000_000_000;
  }, [scenarioLines]);

  useEffect(() => {
    if (!scenarioPersistenceReady || !scenarioSessionAvailable) return;
    const id = setTimeout(() => {
      const savedAt = Date.now();
      const session: SavedScenarioSession = {
        version: 1,
        state: scenario,
        lines: scenarioLines.map(redactTerminalLine).slice(-120),
        history: scenarioHistory.map(redactCommandForDisplay).slice(-20),
        input: redactIpv4ScenarioInput(scenario, scenarioInput.slice(0, 256)),
        savedAt,
      };
      try {
        localStorage.setItem(scenarioStorageKey, JSON.stringify(session));
        setScenarioSavedAt(savedAt);
      } catch {}
    }, 120);
    return () => clearTimeout(id);
  }, [scenario, scenarioHistory, scenarioInput, scenarioLines, scenarioPersistenceReady, scenarioSessionAvailable]);

  useEffect(() => {
    if (screen !== "round") return;
    setRoundResumeAvailable(true);
    const persist = () => {
      const snapshot = roundSnapshotRef.current;
      if (!snapshot) return;
      try {
        localStorage.setItem(roundStorageKey, JSON.stringify({
          ...snapshot,
        input: redactCommandInput(roundDraftRef.current, snapshot.device.context, catalogue, snapshot.device.profileId),
          savedAt: Date.now(),
        }));
      } catch {}
    };
    persist();
    const schedulePersist = () => {
      if ("requestIdleCallback" in window) window.requestIdleCallback(() => persist(), { timeout: 2_000 });
      else setTimeout(persist, 0);
    };
    const timer = setInterval(schedulePersist, 5_000);
    const onPageHide = () => persist();
    const onVisibility = () => { if (document.visibilityState === "hidden") persist(); };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      persist();
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [catalogue, screen]);

  useEffect(() => {
    if (screen === "report") clearSavedRound();
  }, [clearSavedRound, screen]);

  useEffect(() => {
    setScenarioHintLevel(0);
    setScenarioTabUsed(false);
    setScenarioHelpUsed(false);
  }, [scenario.phase]);

  useEffect(() => {
    if (screen !== "round" || paused || advancing) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focusAtEnd();
    });
    return () => cancelAnimationFrame(id);
  }, [advancing, cursor, paused, screen]);

  useEffect(() => {
    if (screen === "scenario" && scenarioChoices.length === 0) {
      setTimeout(() => scenarioInputRef.current?.focusAtEnd(), 0);
    }
  }, [scenario.phase, scenarioChoices.length, screen]);

  useEffect(() => {
    if (screen !== "round" || paused || !timed) {
      timerLastTick.current = null;
      return;
    }

    timerLastTick.current = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const elapsed = Math.max(0, now - (timerLastTick.current ?? now));
      timerLastTick.current = now;
      setTime((value) => value === null ? null : Math.max(0, value - elapsed));
    }, 100);

    return () => {
      clearInterval(id);
      timerLastTick.current = null;
    };
  }, [paused, screen, timed]);

  useEffect(() => () => {
    if (timeChangeTimer.current) clearTimeout(timeChangeTimer.current);
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    for (const oscillator of activeAudioRef.current) {
      try { oscillator.stop(); } catch {}
    }
    activeAudioRef.current = [];
    if (audioContextRef.current) void audioContextRef.current.close();
  }, []);

  const tone = () => {
    if (progressRef.current.muted) return;
    try {
      const context = audioContextRef.current ?? new window.AudioContext();
      audioContextRef.current = context;
      void context.resume();
      for (const active of activeAudioRef.current) {
        try { active.stop(); } catch {}
      }
      activeAudioRef.current = [];
      const now = context.currentTime;
      const streak = Math.max(1, roundRef.current.combo + 1);
      const tierLift = streak >= 10 ? 120 : streak >= 5 ? 80 : streak >= 3 ? 40 : 0;
      const notes = [{ frequency: 620 + tierLift, start: 0, duration: 0.12, volume: 0.035 }, { frequency: 880 + tierLift, start: 0.085, duration: 0.19, volume: 0.045 }];
      for (const note of notes) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(note.frequency, now + note.start);
        oscillator.frequency.exponentialRampToValueAtTime(note.frequency * 1.045, now + note.start + note.duration);
        gain.gain.setValueAtTime(0.0001, now + note.start);
        gain.gain.exponentialRampToValueAtTime(note.volume, now + note.start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now + note.start);
        oscillator.stop(now + note.start + note.duration + 0.01);
        activeAudioRef.current.push(oscillator);
        oscillator.onended = () => {
          activeAudioRef.current = activeAudioRef.current.filter((node) => node !== oscillator);
          oscillator.disconnect();
          gain.disconnect();
        };
      }
    } catch {}
  };

  const showTimeChange = useCallback((deltaMs: number) => {
    if (!deltaMs) return;
    setTimeChange({ id: Date.now(), deltaMs });
    if (timeChangeTimer.current) clearTimeout(timeChangeTimer.current);
    timeChangeTimer.current = setTimeout(() => setTimeChange(null), 1_100);
  }, []);

  const scheduleAdvance = useCallback((delayMs: number) => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => setCursor((value) => value + 1), delayMs);
  }, []);

  const queueLockIn = useCallback((id: string) => {
    if (lockInQueued.current.has(id)) return;
    lockInQueued.current.add(id);
    setQueue((values) => {
      const next = [...values];
      next.splice(Math.min(next.length, cursor + 3), 0, id);
      return next;
    });
    setSessionLimit((value) => value === null ? null : value + 1);
  }, [cursor]);

  const reviewForRoundOutcome = useCallback((
    id: string,
    current: Review | undefined,
    outcome: Outcome,
    responseMs?: number,
  ) => {
    if (!reviewBaselines.current.has(id)) reviewBaselines.current.set(id, current);
    return schedule(reviewBaselines.current.get(id), outcome, Date.now(), responseMs);
  }, []);

  const updateCommand = useCallback((
    id: string,
    count: number,
    first: boolean,
    lastError: string | null,
    outcome: Outcome,
    responseMs?: number,
  ) => {
    const current = progressRef.current;
    const old = current.commands[id];
    save({
      ...current,
      commands: {
        ...current.commands,
        [id]: {
          ...old,
          attempts: (old?.attempts ?? 0) + count,
          correct: (old?.correct ?? 0) + 1,
          firstTry: (old?.firstTry ?? 0) + (first ? 1 : 0),
          lastError,
          ...(responseMs === undefined ? {} : {
            lastResponseMs: responseMs,
            averageResponseMs: old?.averageResponseMs === undefined
              ? responseMs
              : Math.round(old.averageResponseMs * 0.75 + responseMs * 0.25),
          }),
          review: reviewForRoundOutcome(id, old?.review, outcome, responseMs),
        },
      },
    });
  }, [reviewForRoundOutcome, save]);

  const updatePracticeCommand = useCallback((
    id: string,
    correct: boolean,
    lastError: string | null,
    clean = false,
    responseMs?: number,
    learningOutcome?: Outcome,
  ) => {
    const current = progressRef.current;
    const old = current.commands[id];
    save({
      ...current,
      commands: {
        ...current.commands,
        [id]: {
          ...old,
          attempts: (old?.attempts ?? 0) + 1,
          correct: (old?.correct ?? 0) + (correct ? 1 : 0),
          firstTry: (old?.firstTry ?? 0) + (clean ? 1 : 0),
          lastError,
          ...(responseMs === undefined ? {} : {
            lastResponseMs: responseMs,
            averageResponseMs: old?.averageResponseMs === undefined
              ? responseMs
              : Math.round(old.averageResponseMs * 0.75 + responseMs * 0.25),
          }),
          review: correct
            ? reviewForRoundOutcome(id, old?.review, learningOutcome ?? (clean ? "firstTry" : "retry"), responseMs)
            : reviewForRoundOutcome(id, old?.review, "failed", responseMs),
        },
      },
    });
  }, [reviewForRoundOutcome, save]);

  const recordPracticeEvidence = useCallback<PracticeEvidenceRecorder>((
    canonical,
    context,
    profileId,
    outcome,
    error = null,
  ) => {
    const resolved = resolveCommand(canonical, context, catalogue, profileId);
    if (resolved.status !== "valid") return;
    const scheduleOutcome: Outcome = outcome === "independent"
      ? "firstTry"
      : outcome === "guided-discovery"
        ? "guided"
        : outcome === "assisted"
          ? "assisted"
          : outcome === "revealed"
            ? "revealed"
            : outcome === "skipped"
              ? "skipped"
              : "failed";
    updatePracticeCommand(
      resolved.command.id,
      outcome !== "incorrect" && outcome !== "skipped",
      error,
      outcome === "independent",
      undefined,
      scheduleOutcome,
    );
  }, [catalogue, updatePracticeCommand]);

  const recordCommandAssistance = useCallback((
    id: string,
    kind: "assisted" | "guided" | "revealed",
  ) => {
    if (assistanceRecorded.current[kind]) return;
    assistanceRecorded.current[kind] = true;
    const current = progressRef.current;
    const old = current.commands[id];
    save({
      ...current,
      commands: {
        ...current.commands,
        [id]: {
          ...old,
          attempts: old?.attempts ?? 0,
          correct: old?.correct ?? 0,
          firstTry: old?.firstTry ?? 0,
          lastError: old?.lastError ?? null,
          [kind]: (old?.[kind] ?? 0) + 1,
        },
      },
    });
  }, [save]);

  const failUnresolved = useCallback((id: string, count: number, lastError: string | null) => {
    const current = progressRef.current;
    const old = current.commands[id];
    save({
      ...current,
      commands: {
        ...current.commands,
        [id]: {
          ...old,
          attempts: (old?.attempts ?? 0) + count,
          correct: old?.correct ?? 0,
          firstTry: old?.firstTry ?? 0,
          lastError,
          review: reviewForRoundOutcome(id, old?.review, "failed"),
        },
      },
    });
  }, [reviewForRoundOutcome, save]);

  const skipUnresolved = useCallback((id: string) => {
    const current = progressRef.current;
    const old = current.commands[id];
    save({
      ...current,
      commands: {
        ...current.commands,
        [id]: {
          ...old,
          attempts: old?.attempts ?? 0,
          correct: old?.correct ?? 0,
          firstTry: old?.firstTry ?? 0,
          lastError: "SKIPPED",
          review: reviewForRoundOutcome(id, old?.review, "skipped"),
        },
      },
    });
  }, [reviewForRoundOutcome, save]);

  const persistCustom = async (next: CustomCommandRecord[]): Promise<boolean> => {
    setCustomStatus("Saving…");
    try {
      if (serverBacked) {
        if (customEtagRef.current === unavailableCustomStoreEtag) {
          setCustomStatus("Docker command storage is unavailable. No changes were saved, so the server copy cannot be overwritten without a current version.");
          return false;
        }
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (customEtagRef.current) headers["if-match"] = customEtagRef.current;
        const response = await fetch("/api/custom-commands", {
          method: "PUT",
          headers,
          credentials: "same-origin",
          body: JSON.stringify(next),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: "Save failed." }));
          throw new Error(body.error || "Save failed.");
        }
        customEtagRef.current = response.headers.get("etag") ?? customEtagRef.current;
        setCustomStoreUnavailable(false);
        const mirrored = commitAuthoritativeCustomCommandRecords(
          next,
          setCustomRecords,
          (records) => localStorage.setItem(customStorageKey, JSON.stringify(records)),
        );
        setCustomStatus(mirrored
          ? "Saved to the Docker data volume."
          : "Saved to the Docker data volume, but this browser could not update its optional local mirror.");
        return true;
      }
      localStorage.setItem(customStorageKey, JSON.stringify(next));
      setCustomRecords(next);
      setCustomStatus("Saved in this browser.");
      return true;
    } catch (error) {
      setCustomStatus(error instanceof Error ? error.message : "Save failed.");
      return false;
    }
  };

  const logout = async () => {
    await fetch("/logout", { method: "POST", credentials: "same-origin" });
    window.location.assign("/login");
  };

  const finish = useCallback((reason: FinishReason) => {
    if (finishing.current || screen !== "round") return;
    finishing.current = true;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    const timerReachedZero = reason === "timer";
    const competitiveRunComplete = timerReachedZero || reason === "hardcore" || reason === "complete";
    let completedRound = roundRef.current;

    if (shouldRecordTimedOutObjective(
      timerReachedZero,
      submittedForCurrentObjective.current,
    )) {
      const firstPresentation = !roundAttempts.current.has(item.id);
      completedRound = {
        ...completedRound,
        presented: completedRound.presented + (firstPresentation ? 1 : 0),
        unanswered: completedRound.unanswered + 1,
        reviewIds: uniq([...completedRound.reviewIds, item.id]),
        missed: uniq([...completedRound.missed, item.id]),
        reviewReasons: {
          ...completedRound.reviewReasons,
          [item.id]: "unanswered",
        },
      };
      setRoundBoth(completedRound);
      failUnresolved(item.id, 0, "TIME_EXPIRED");
    }

    const current = progressRef.current;
    const recordKind: RoundRecordClass = activeMode === "easy"
      ? null
      : classifyRoundRecord(
          completedRound.resolved,
          roundHadCliAssistance.current ? Math.max(1, completedRound.assisted) : 0,
        );
    const recordScores = recordKind === "field" ? current.bestFieldScores : current.bestScores;
    const previousBest = recordScores[activeMode]
      ?? (recordKind === "clean" && activeMode === "normal" ? current.bestScore : null)
      ?? null;
    const personalBest = competitiveRunComplete
      && activeMode !== "easy"
      && recordKind !== null
      && (previousBest === null || completedRound.score > previousBest);
    const bestScores = personalBest && recordKind === "clean"
      ? { ...current.bestScores, [activeMode]: completedRound.score }
      : current.bestScores;
    const bestFieldScores = personalBest && recordKind === "field"
      ? { ...current.bestFieldScores, [activeMode]: completedRound.score }
      : current.bestFieldScores;

    save({
      ...current,
      sessions: current.sessions + 1,
      rounds: current.rounds + (competitiveRunComplete ? 1 : 0),
      bestScore: activeMode === "normal" && personalBest && recordKind === "clean"
        ? completedRound.score
        : current.bestScore,
      bestScores,
      bestFieldScores,
      bestCombo: Math.max(current.bestCombo, completedRound.bestCombo),
      lastMode: activeMode,
    });
    setReport({
      round: completedRound,
      reason,
      mode: activeMode,
      personalBest,
      previousBest,
      recordKind,
    });
    pausedAt.current = null;
    setPaused(false);
    setScreen("report");
  }, [activeMode, failUnresolved, item, save, screen, setRoundBoth]);

  useEffect(() => {
    if (screen === "round" && time === 0) finish("timer");
  }, [finish, screen, time]);

  useEffect(() => {
    if (screen !== "round" || sessionKind !== "rush" || cursor < queue.length - 5) return;
    setQueue((currentQueue) => {
      const queuedIds = new Set(currentQueue);
      const remaining = catalogue.filter((command) => !queuedIds.has(command.id));
      if (!remaining.length) return currentQueue;
      const random = () => {
        const value = new Uint32Array(1);
        crypto.getRandomValues(value);
        return value[0] / 0x1_0000_0000;
      };
      const extension = weightedCommandQueue(
        remaining,
        progressRef.current.commands,
        currentQueue.at(-1) ?? null,
        random,
        {
          limit: Math.min(20, remaining.length),
          recentCommands: currentQueue
            .slice(-8)
            .map((id) => catalogue.find((command) => command.id === id))
            .filter((command): command is Command => Boolean(command)),
        },
      );
      return [...currentQueue, ...extension];
    });
  }, [catalogue, cursor, queue.length, screen, sessionKind]);

  useEffect(() => {
    if (
      screen === "round"
      && sessionKind === "rush"
      && cursor >= queue.length
      && catalogue.every((command) => queue.includes(command.id))
    ) {
      finish("complete");
    }
  }, [catalogue, cursor, finish, queue, screen, sessionKind]);

  const chooseMode = (mode: GameModeId) => {
    setSelectedMode(mode);
    save({ ...progressRef.current, lastMode: mode });
  };

  const launchRound = (
    mode: GameModeId,
    kind: SessionKind,
    nextQueue: string[],
    chapter?: CurriculumChapter,
  ) => {
    if (!nextQueue.length) return;
    const rules = gameModeById(mode);
    const nextRound = blankRound();
    const currentProgress = progressRef.current;
    setActiveMode(mode);
    setSessionKind(kind);
    setSessionLimit(kind === "rush" ? null : nextQueue.length);
    setRoundBoth(nextRound);
    setQueue(nextQueue);
    setCursor(0);
    setDevice(initialDevice());
    setTime(initialTimeMs(mode));
    pausedAt.current = null;
    setPaused(false);
    inputRef.current?.clear();
    roundDraftRef.current = "";
    setHistory([]);
    setHistoryAt(-1);
    setHistoryDraft("");
    setLines([
      kind === "daily"
        ? `CLI RUSH // DAILY RECALL // ${nextQueue.length} DUE`
        : kind === "chapter"
          ? `CLI RUSH // BEGINNER PATH // ${chapter?.title.toUpperCase() ?? "CHAPTER"}`
          : `CLI RUSH // ${rules.label.toUpperCase()} MODE`,
      kind === "daily"
        ? "Untimed due review · clean recall advances spacing · CLI help counts as field assistance"
        : kind === "chapter"
          ? "Small guided chapter · clean untimed recall schedules the next review"
          : mode === "easy"
            ? "Untimed adaptive practice · clean recall contributes to mastery"
            : modeSummary(rules),
    ]);
    setFeedback({
      tone: "neutral",
      title: kind === "daily"
        ? "Today’s due recall started"
        : kind === "chapter"
          ? `${chapter?.title ?? "Beginner chapter"} started`
          : mode === "easy" ? "Learning session started" : `${rules.label} rush started`,
      message: mode === "easy"
        ? "Retrieve independently when you can. Semantic help and IOS-style assistance remain available without being misclassified as clean recall."
        : "Correct commands add time. Check the objective and current CLI prompt.",
    });
    setReport(null);
    setTimeChange(null);
    finishing.current = false;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    retried.current.clear();
    lockInQueued.current.clear();
    roundAttempts.current.clear();
    reviewBaselines.current.clear();
    submittedForCurrentObjective.current = false;
    consecutiveWrong.current = 0;
    roundHadCliAssistance.current = false;
    pendingRoundInput.current = "";
    save({
      ...currentProgress,
      lastMode: mode,
      lastFirstCommandId: nextQueue[0] ?? null,
    });
    setScreen("round");
  };

  const secureRandom = () => {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0] / 0x1_0000_0000;
  };

  const startBeginnerPath = () => {
    const currentProgress = progressRef.current;
    if (nextChapterState) {
      const chapterCommands = catalogue.filter((command) =>
        nextChapterState.chapter.commandIds.includes(command.id));
      const nextQueue = weightedCommandQueue(
        chapterCommands,
        currentProgress.commands,
        currentProgress.lastFirstCommandId,
        secureRandom,
        {
          limit: chapterCommands.length,
          currentTopics: [...new Set(chapterCommands.map((command) => command.topic))],
          recentCommands: [catalogue.find((command) => command.id === currentProgress.lastFirstCommandId)]
            .filter((command): command is Command => Boolean(command)),
        },
      );
      launchRound("easy", "chapter", nextQueue, nextChapterState.chapter);
      return;
    }
    const nextQueue = weightedCommandQueue(
      catalogue,
      currentProgress.commands,
      currentProgress.lastFirstCommandId,
      secureRandom,
      {
        limit: 6,
        recentCommands: [catalogue.find((command) => command.id === currentProgress.lastFirstCommandId)]
          .filter((command): command is Command => Boolean(command)),
      },
    );
    launchRound("easy", "practice", nextQueue);
  };

  const startEasyPractice = () => {
    const currentProgress = progressRef.current;
    const pool = easyPracticeCatalogue(catalogue, nextChapterState?.chapter.commandIds ?? []);
    const nextQueue = weightedCommandQueue(
      pool,
      currentProgress.commands,
      currentProgress.lastFirstCommandId,
      secureRandom,
      {
        limit: Math.min(10, pool.length),
        recentCommands: [catalogue.find((command) => command.id === currentProgress.lastFirstCommandId)]
          .filter((command): command is Command => Boolean(command)),
      },
    );
    launchRound("easy", "practice", nextQueue);
  };

  const start = () => {
    const mode = selectedMode;
    if (mode === "easy") {
      startEasyPractice();
      return;
    }
    const currentProgress = progressRef.current;
    const nextQueue = weightedCommandQueue(
      catalogue,
      currentProgress.commands,
      currentProgress.lastFirstCommandId,
      secureRandom,
      { limit: 20 },
    );
    launchRound(mode, "rush", nextQueue);
  };

  const startDailyRecall = () => {
    const currentProgress = progressRef.current;
    const nextQueue = buildDailyRecallSession(catalogue, currentProgress.commands, {
      now: Date.now(),
      limit: 10,
      previousFirstId: currentProgress.lastFirstCommandId,
    });
    setSelectedMode("easy");
    launchRound("easy", "daily", nextQueue);
  };

  const startIpv4Lab = () => {
    const seedValue = new Uint32Array(1);
    crypto.getRandomValues(seedValue);
    const next = createIpv4Scenario(seedValue[0] || 1);
    setScenario(next);
    setScenarioInput("");
    setScenarioHistory([]);
    setScenarioHistoryAt(-1);
    setScenarioHistoryDraft("");
    setScenarioSessionAvailable(true);
    setScenarioSavedAt(Date.now());
    setScenarioHintLevel(0);
    setScenarioLesson(null);
    setScenarioLines([
      "CLI RUSH // IPV4 FIELD LAB",
      "Manual mode navigation · baseline · configure · diagnose · prove rollback · recover · save",
      `WORK ORDER // ${next.parameters.interfaceName} // ${next.parameters.localAddress}/${next.parameters.prefixLength} // gateway ${next.parameters.gateway} // test ${next.parameters.remoteTarget}`,
    ]);
    setScreen("scenario");
  };

  const resumeIpv4Lab = () => {
    setScenarioHintLevel(0);
    setScreen(scenario.phase === "complete" ? "scenario-report" : "scenario");
  };

  const restartIpv4Lab = () => {
    if (!window.confirm("Restart the IPv4 lab with a new seeded work order? The saved lab position will be replaced.")) return;
    startIpv4Lab();
  };

  const goHome = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    if (timeChangeTimer.current) clearTimeout(timeChangeTimer.current);
    finishing.current = false;
    pausedAt.current = null;
    setPaused(false);
    setAdvancing(false);
    setTimeChange(null);
    setTaskDetailsOpen(false);
    refreshGuidedResumes();
    try { setNavigationSessionAvailable(Boolean(localStorage.getItem(navigationStorageKey))); } catch {}
    setScreen("home");
  };

  const recordScenarioResult = (
    result: Ipv4ScenarioActionResult,
    entryLabel: string,
  ) => {
    setScenario(result.state);
    setScenarioSessionAvailable(true);
    setScenarioLesson(result);
    setScenarioLines((values) => [
      ...values,
      entryLabel,
      ...result.output,
      result.awaitingConfirmation ? `… ${pendingConfirmationLabel(result.state.pendingConfirmation)}` : result.accepted ? "✓ Step accepted" : `% ${result.explanation}`,
    ].slice(-120));
    setScenarioInput("");
    if (result.accepted) {
      setScenarioHintLevel(0);
      setScenarioTabUsed(false);
      setScenarioHelpUsed(false);
    }
  };

  const submitScenarioCommand = (value: string) => {
    if ((!value.trim() && scenario.pendingConfirmation === null) || scenarioChoices.length > 0 || scenario.phase === "complete") return;
    const entered = value;
    const result = runIpv4ScenarioCommand(scenario, entered);
    const expectedBefore = getIpv4ScenarioHint(scenario, 3).example;
    if (entered.trim() && result.accepted) {
      recordPracticeEvidence(entered, scenario.mode, "router-ios-xe", classifyLearningOutcome(true, {
        hintUsed: scenarioHintLevel > 0,
        tabUsed: scenarioTabUsed,
        helpUsed: scenarioHelpUsed,
        answerRevealed: scenarioHintLevel === 3,
      }));
    } else if (entered.trim() && !result.valid && expectedBefore && expectedBefore !== "Press Enter") {
      recordPracticeEvidence(expectedBefore, scenario.mode, "router-ios-xe", "incorrect", result.explanation);
    }
    const displayCommand = entered.trim() ? result.displayInput ?? redactIpv4ScenarioInput(scenario, entered) : "[Enter]";
    if (entered.trim()) setScenarioHistory((values) => [...values, displayCommand].slice(-20));
    setScenarioHistoryAt(-1);
    setScenarioHistoryDraft("");
    recordScenarioResult(result, `${ipv4ScenarioPrompt(scenario)} ${displayCommand}`);
  };

  const restoreScenarioCheckpoint = () => {
    const result = restoreIpv4ScenarioCheckpoint(scenario);
    recordScenarioResult(result, "[recovery] Restore checkpoint");
    focusScenarioInputAtEnd();
  };

  const chooseScenarioInterpretation = (choice: Ipv4ScenarioChoiceId, label: string) => {
    const result = submitIpv4ScenarioInterpretation(scenario, choice);
    recordScenarioResult(result, `[interpretation] ${label}`);
  };

  const focusScenarioInputAtEnd = () => {
    setTimeout(() => scenarioInputRef.current?.focusAtEnd(), 0);
  };

  const completeScenarioInput = (value: string) => {
    const completion = completeIpv4ScenarioInput(scenario, value);
    if (completion.changed) setScenarioTabUsed(true);
    setScenarioLines((values) => [
      ...values,
      `% Tab: ${completion.message}`,
    ].slice(-120));
    focusScenarioInputAtEnd();
    return completion.input;
  };

  const showScenarioCliOptions = (value: string) => {
    const result = getIpv4ScenarioCliHelp(scenario, value);
    if (result.options.length) setScenarioHelpUsed(true);
    const optionLines = result.options.map((option) =>
      `  ${option.value.padEnd(18)} ${option.description}`);
    if (result.hiddenOptions) optionLines.push(`  … ${result.hiddenOptions} more options`);
    setScenarioLines((values) => [
      ...values,
      `${ipv4ScenarioPrompt(scenario)} ${redactIpv4ScenarioInput(scenario, value)}?`,
      ...(optionLines.length ? optionLines : ["  % No matching options"]),
    ].slice(-120));
    focusScenarioInputAtEnd();
  };

  const recallScenarioHistory = (value: string, direction: "older" | "newer") => {
    const recalled = navigateCommandHistory(
      scenarioHistory,
      value,
      scenarioHistoryAt,
      scenarioHistoryDraft,
      direction,
    );
    setScenarioHistoryAt(recalled.index);
    setScenarioHistoryDraft(recalled.draft);
    focusScenarioInputAtEnd();
    return recalled.value;
  };

  const controlScenarioInput = (value: string, key: CliControlKey) => {
    if (key === "ArrowUp" || key === "ArrowDown") {
      const recalled = recallScenarioHistory(value, key === "ArrowUp" ? "older" : "newer");
      return { draft: recalled, cursor: recalled.length };
    }

    const bridge = initialDevice("router-ios-xe");
    bridge.context = scenario.mode;
    bridge.mode = scenario.mode;
    const edit = handleCliControl(bridge, key, value, scenarioHistory, scenarioHistoryAt < 0 ? scenarioHistory.length : scenarioHistoryAt);
    if (["Ctrl+A", "Ctrl+E", "Ctrl+U", "Ctrl+W"].includes(key)) {
      return { draft: edit.draft, cursor: edit.cursor };
    }

    const currentPrompt = ipv4ScenarioPrompt(scenario);
    if (key === "Ctrl+Shift+6") {
      setScenarioLines((values) => [...values, `${currentPrompt} ^C`, "% Operation interrupted."].slice(-120));
      setScenarioLesson(null);
      return { draft: edit.draft, cursor: edit.cursor };
    }

    if (key === "Ctrl+C") {
      if (scenario.pendingConfirmation) {
        const cancelled = cancelIpv4ScenarioPendingInteraction(scenario);
        setScenario(cancelled.state);
        setScenarioLesson(cancelled);
        setScenarioLines((values) => [...values, `${currentPrompt} ^C`, ...cancelled.output].slice(-120));
      } else {
        setScenario({ ...scenario, mode: "privileged", pendingConfirmation: null, pendingConfirmationAdvances: false });
        setScenarioLines((values) => [...values, `${currentPrompt}${value.trim() ? ` ${redactIpv4ScenarioInput(scenario, value)}` : ""}^C`].slice(-120));
        setScenarioLesson(null);
      }
      setScenarioHistoryAt(-1);
      setScenarioHistoryDraft("");
      return { draft: "", cursor: 0 };
    }

    const entered = value.trim();
    if (scenario.pendingConfirmation) {
      const cancelled = cancelIpv4ScenarioPendingInteraction(scenario);
      recordScenarioResult({ ...cancelled, output: [...cancelled.output, "^Z"] }, `${currentPrompt} ^Z`);
      return { draft: "", cursor: 0 };
    }
    let outcome = entered ? runIpv4ScenarioCommand(scenario, entered) : runIpv4ScenarioCommand(scenario, "end");
    let output = [...outcome.output];
    if (entered && outcome.accepted && outcome.state.mode !== "privileged") {
      const exited = runIpv4ScenarioCommand(outcome.state, "end");
      if (exited.accepted) {
        output = [...output, ...exited.output];
        outcome = { ...exited, output, explanation: `${outcome.explanation} Ctrl+Z then returned directly to Privileged EXEC.` };
      }
    }
    if (outcome.state.mode !== "privileged") outcome = { ...outcome, state: { ...outcome.state, mode: "privileged", pendingConfirmation: null, pendingConfirmationAdvances: false } };
    const displayCommand = entered
      ? redactIpv4ScenarioInput(scenario, entered)
      : "";
    if (displayCommand) setScenarioHistory((values) => [...values, displayCommand].slice(-20));
    setScenarioHistoryAt(-1);
    setScenarioHistoryDraft("");
    recordScenarioResult(
      { ...outcome, output: [...output, "^Z"] },
      `${currentPrompt}${displayCommand ? ` ${displayCommand}` : ""}`,
    );
    return { draft: "", cursor: 0 };
  };

  const nextEasyObjective = () => {
    setEasyComplete(false);
    setAdvancing(false);
    if (sessionLimit !== null && cursor + 1 >= sessionLimit) {
      finish("practice");
      return;
    }
    setCursor((value) => value + 1);
  };

  const showAssistance = (level: Exclude<AssistanceLevel, 0>) => {
    recordCommandAssistance(item.id, "assisted");
    if (level === 3) recordCommandAssistance(item.id, "revealed");
    roundHadCliAssistance.current = true;
    setAssistance(level);
    setTaskDetailsOpen(true);
  };

  const pauseRound = () => {
    pausedAt.current = performance.now();
    setPaused(true);
  };

  const resumeRound = () => {
    const now = performance.now();
    const pauseStarted = pausedAt.current;
    if (pauseStarted !== null) {
      setStartedAt((value) => value + Math.max(0, now - pauseStarted));
    }
    pausedAt.current = null;
    setPaused(false);
    setTimeout(() => inputRef.current?.focusAtEnd(), 0);
  };

  const skipObjective = () => {
    if (paused || advancing || time === 0 || easyComplete) return;
    const previousAttempt = roundAttempts.current.get(item.id) ?? 0;
    const firstPresentation = previousAttempt === 0;
    roundAttempts.current.set(item.id, Math.max(1, previousAttempt));
    submittedForCurrentObjective.current = true;
    roundDraftRef.current = "";
    const nextRound: Round = recordAttempt({
      ...roundRef.current,
      presented: roundRef.current.presented + (firstPresentation ? 1 : 0),
      unanswered: roundRef.current.unanswered + 1,
      combo: 0,
      reviewIds: uniq([...roundRef.current.reviewIds, item.id]),
      missed: uniq([...roundRef.current.missed, item.id]),
      reviewReasons: {
        ...roundRef.current.reviewReasons,
        [item.id]: "unanswered",
      },
    }, "[objective skipped]", "skipped", "skipped", "The learner deliberately skipped this objective.", "No command was submitted and no simulated state changed.");
    setRoundBoth(nextRound);
    skipUnresolved(item.id);
    setHistoryAt(-1);
    setHistoryDraft("");

    if (activeMode === "easy") {
      const answer = redactCommandInput(item.canonical, device.context, catalogue, device.profileId);
      setLines((values) => [
        ...values,
        `${prompt(device)} [objective skipped]`,
        `Answer: ${answer}`,
        "No mastery credit · a clean recall review has been scheduled.",
      ].slice(-60));
      setFeedback({
        tone: "neutral",
        title: "Objective skipped · answer shown",
        message: "Study the command and explanation, then move on. This is recorded as skipped rather than a successful recall.",
      });
      setTaskDetailsOpen(true);
      setEasyComplete(true);
      setAdvancing(true);
      return;
    }

    setLines((values) => [
      ...values,
      `${prompt(device)} [objective skipped]`,
      "% Answer hidden until the full timer expires.",
    ].slice(-60));
    setFeedback({
      tone: "neutral",
      title: "Objective skipped",
      message: activeMode === "hardcore"
        ? "Skipping ends a Hardcore run. The answer remains hidden because the timer did not expire."
        : "No points or mastery credit were awarded. The answer remains hidden while this timed run continues.",
    });
    setAdvancing(true);
    if (activeMode === "hardcore") {
      finish("hardcore");
      return;
    }
    scheduleAdvance(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : 300);
  };

  const markCliAssisted = () => {
    recordCommandAssistance(item.id, "assisted");
    cliAssisted.current = true;
    roundHadCliAssistance.current = true;
    setCliAssistanceUsed(true);
  };

  const focusInputAtEnd = () => {
    setTimeout(() => inputRef.current?.focusAtEnd(), 0);
  };

  const completeCommandInput = (value: string) => {
    const completion = completeCliInput(value, device.context, catalogue, device.profileId);
    if (completion.assisted) markCliAssisted();
    if (completion.changed) {
      setHistoryAt(-1);
    }
    setFeedback({
      tone: "neutral",
      title: completion.changed ? "Tab completion · no penalty" : "No unique completion",
      message: `${completion.message} No score or time-bank adjustment was made.`,
    });
    focusInputAtEnd();
    return completion.input;
  };

  const showCliOptions = (value: string) => {
    const result = cliHelp(value, device.context, catalogue, device.profileId);
    if (result.options.length) {
      guidedDiscovery.current = true;
      setGuidedDiscoveryUsed(true);
      recordCommandAssistance(item.id, "guided");
      roundHadCliAssistance.current = true;
    }
    const optionLines = result.options.map((option) =>
      `  ${option.value.padEnd(18)} ${option.description}`);
    if (result.hiddenOptions) {
      optionLines.push(`  … ${result.hiddenOptions} more options; type another character to narrow the list.`);
    }
    setLines((values) => [
      ...values,
      `${prompt(device)} ${redactCommandInput(value, device.context, catalogue, device.profileId)}?`,
      ...(optionLines.length ? optionLines : ["  % No matching options"]),
    ].slice(-60));
    setFeedback({
      tone: "neutral",
      title: result.options.length ? "Guided discovery" : "No context options",
      message: `${result.message} This is not an error; a later clean-recall check will be scheduled.`,
    });
    focusInputAtEnd();
  };

  const commandPasted = (text: string) => {
    if (text.trim()) markCliAssisted();
    setFeedback({ tone: "neutral", title: "Clipboard pasted", message: "Review the command at the prompt before running it." });
  };

  const commandClipboardError = () => setFeedback({
    tone: "error",
    title: "Clipboard permission blocked",
    message: "Use Ctrl+V, or allow clipboard access for this site and right-click again.",
  });

  const scenarioClipboardError = () => setScenarioLesson({
    accepted: false,
    state: scenario,
    output: [],
    explanation: "Clipboard permission was blocked. Use Ctrl+V or allow clipboard access for this local site.",
    useCase: "Clipboard input remains inert text inside the learning lab.",
    verification: "Check that the intended text appears at the prompt before submitting it.",
    rollback: "No device state changed.",
    nextObjective: getIpv4ScenarioObjective(scenario),
    errorCode: "UNSUPPORTED",
  });

  const copySelectionFrom = (container: HTMLDivElement | null) => {
    const selection = window.getSelection();
    const selectedText = selection?.toString() ?? "";
    if (!selectedText.trim() || !selection || !container) return;
    const selectionIsInLog = [selection.anchorNode, selection.focusNode]
      .every((node) => node && container.contains(node));
    if (!selectionIsInLog) return;
    const copied = () => setFeedback({
      tone: "neutral",
      title: "Terminal selection copied",
      message: "The selected terminal text is now on the clipboard; paste it with Ctrl+V or right-click.",
    });
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(selectedText).then(copied).catch(() => {});
    else if (document.execCommand("copy")) copied();
  };

  const copyTerminalSelection = () => copySelectionFrom(logRef.current);
  const copyScenarioSelection = () => copySelectionFrom(scenarioLogRef.current);

  const restoreRoundCheckpoint = () => {
    const restored = restoreDeviceCheckpoint(device);
    setDevice(restored.state);
    setLines((values) => [
      ...values,
      "[recovery] Restore checkpoint",
      ...restored.output,
    ].slice(-80));
    setFeedback({
      tone: restored.accepted ? "neutral" : "error",
      title: restored.accepted ? "Checkpoint restored" : "Checkpoint unavailable",
      message: restored.accepted
        ? "The previous simulated running state is active again. The current objective remains open and no mastery was awarded."
        : restored.output.join(" "),
    });
    focusInputAtEnd();
  };

  const submit = (value: string) => {
    if (paused || advancing || time === 0) return;
    const execution = executeCliCommand(device, value, catalogue);
    const objectiveComplete = executionSatisfiesLearningObjective(item, device, execution, catalogue);
    const normalisedInput = value.trim().replace(/\s+/gu, " ")
      || (device.pendingInteraction ? "[Enter]" : "");
    const diagnostic = validate(value, device.mode, item.id, catalogue);
    const result: Validation = objectiveComplete
      ? { ok: true, command: item, input: normalisedInput }
      : execution.accepted
        ? {
            ok: false,
            input: normalisedInput,
            code: "WRONG_OBJECTIVE",
            message: "That command was accepted, but it does not complete the current objective.",
          }
        : !diagnostic.ok
          ? {
              ...diagnostic,
              input: normalisedInput,
              message: execution.output[0] || diagnostic.message,
            }
          : {
              ok: false,
              input: normalisedInput,
              code: execution.resolution?.status === "wrong-context"
                ? "WRONG_MODE"
                : execution.resolution?.status === "incomplete"
                  ? "MISSING_ARGUMENT"
                  : execution.resolution?.status === "ambiguous"
                    ? "MISSING_KEYWORD"
                    : "UNSUPPORTED",
              message: execution.output[0] || "That command is not available at this prompt.",
            };
    if (!result.input) {
      if (!result.ok) {
        setFeedback({ tone: "error", title: "Nothing entered", message: result.message });
      }
      return;
    }
    roundDraftRef.current = "";
    const displayInput = result.input === "[Enter]"
      ? "[Enter]"
      : redactCommandInput(result.input, device.context, catalogue, device.profileId);
    const learnerRecordInput = device.pendingInteraction && pendingRoundInput.current
      ? `${pendingRoundInput.current} → ${displayInput}`
      : displayInput;

    const startsExpectedConfirmation = !device.pendingInteraction
      && execution.accepted
      && execution.state.pendingInteraction !== null
      && execution.event?.command.id === item.id;
    if (startsExpectedConfirmation) {
      pendingRoundInput.current = displayInput;
      setDevice(execution.state);
      setHistory((values) => [...values, displayInput].slice(-20));
      setHistoryAt(-1);
      setHistoryDraft("");
      setLines((values) => [
        ...values,
        `${prompt(device)} ${displayInput}`,
        ...execution.output,
      ].slice(-60));
      setFeedback({
        tone: "neutral",
        title: execution.state.pendingInteraction?.kind === "save"
          ? "Confirm the destination filename"
          : "Confirmation required",
        message: execution.state.pendingInteraction?.kind === "save"
          ? "Press Enter to accept startup-config. The save objective is not complete until the simulator returns [OK]."
          : "Read the simulated prompt and confirm the operation. The objective is not complete until the device accepts it.",
      });
      focusInputAtEnd();
      return;
    }

    if (execution.accepted && !objectiveComplete) {
      setDevice(execution.state);
    }
    if (execution.accepted && !objectiveComplete && activeMode === "easy") {
      setRoundBoth(recordAttempt(
        roundRef.current,
        displayInput,
        "valid-unrelated",
        "not-completed",
        "The shared parser accepted this command at the current prompt.",
        "The command did not produce the outcome requested by the current task, so mastery was unchanged.",
      ));
      setLines(values => [
        ...values,
        `${prompt(device)} ${displayInput}`,
        ...execution.output,
        "% Valid command, but the current task is not complete.",
      ].slice(-80));
      setHistory(values => [...values, displayInput].slice(-30));
      setHistoryAt(-1);
      setHistoryDraft("");
      setFeedback({
        tone: "neutral",
        title: "Valid command · task still open",
        message: "The simulator applied that command. Exploration has no error penalty in this untimed activity.",
      });
      setTimeout(() => inputRef.current?.focusAtEnd(), 0);
      return;
    }

    submittedForCurrentObjective.current = true;
    const attempt = (roundAttempts.current.get(item.id) ?? 0) + 1;
    const attemptAssistance = {
      hintUsed: assistance > 0 && assistance < 3,
      tabUsed: cliAssisted.current,
      helpUsed: guidedDiscovery.current,
      answerRevealed: assistance === 3,
    };
    roundAttempts.current.set(item.id, attempt);
    const currentPrompt = prompt(device);
    const safeContext = safeCommandContext(item);
    const safeContextLine = `Why: ${safeContext.explanation} Use case: ${safeContext.useCase}`;
    setHistory((values) => [...values, displayInput].slice(-20));
    setHistoryAt(-1);
    setHistoryDraft("");

    if (!result.ok) {
      const code = result.code;
      const parserCategory: RoundAttemptParserCategory = execution.accepted ? "valid-unrelated" : "parser-error";
      const nonCompletionReason = execution.accepted
        ? "The simulator accepted the command, but its state or output did not satisfy this objective."
        : result.message;

      if (activeMode === "easy") {
        const nextRound: Round = recordAttempt({
          ...roundRef.current,
          submissions: roundRef.current.submissions + 1,
          presented: roundRef.current.presented + (attempt === 1 ? 1 : 0),
          combo: 0,
          errors: {
            ...roundRef.current.errors,
            [code]: (roundRef.current.errors[code] ?? 0) + 1,
          },
          reviewIds: uniq([...roundRef.current.reviewIds, item.id]),
          reviewReasons: {
            ...roundRef.current.reviewReasons,
            [item.id]: "incorrect",
          },
        }, learnerRecordInput, parserCategory, "incorrect", errorNames[code] ?? code, nonCompletionReason);
        setFeedback({
          tone: "error",
          title: errorNames[code] ?? "Keep learning",
          message: `${result.message} ${safeContext.explanation} ${safeContext.useCase} Stay on this objective and try again; mastery is unchanged.`,
        });
        startTransition(() => {
          setRoundBoth(nextRound);
          updatePracticeCommand(item.id, false, code);
          if (assistance === 0) {
            recordCommandAssistance(item.id, "assisted");
            roundHadCliAssistance.current = true;
          }
          setLines((values) => [
            ...values,
            `${currentPrompt} ${displayInput}`,
            `% ${result.message}`,
            safeContextLine,
            "Learning coach opened the semantic structure. Try the same objective again.",
          ].slice(-60));
          setAssistance((level) => level === 0 ? 1 : level);
          setPresentationAttempt(attempt + 1);
        });
        return;
      }

      const effect = wrongAnswerEffect(activeMode, consecutiveWrong.current);
      consecutiveWrong.current = effect.nextConsecutiveWrong;
      const lostMs = Math.abs(effect.timeDeltaMs);
      const actualLostMs = Math.min(lostMs, time ?? lostMs);
      const nextRound: Round = recordAttempt({
        ...roundRef.current,
        submissions: roundRef.current.submissions + 1,
        presented: roundRef.current.presented + (attempt === 1 ? 1 : 0),
        combo: 0,
        timeLostMs: roundRef.current.timeLostMs + actualLostMs,
        errors: {
          ...roundRef.current.errors,
          [code]: (roundRef.current.errors[code] ?? 0) + 1,
        },
        reviewIds: uniq([...roundRef.current.reviewIds, item.id]),
        missed: uniq([...roundRef.current.missed, item.id]),
        reviewReasons: {
          ...roundRef.current.reviewReasons,
          [item.id]: "incorrect",
        },
      }, learnerRecordInput, parserCategory, "incorrect", errorNames[code] ?? code, nonCompletionReason);
      setRoundBoth(nextRound);
      failUnresolved(item.id, 1, code);

      if (effect.terminalFailure) {
        setLines((values) => [
          ...values,
          `${currentPrompt} ${displayInput}`,
          `% ${result.message}`,
          safeContextLine,
          "✕ Hardcore run ended · answer remains hidden",
        ].slice(-60));
        setFeedback({
          tone: "error",
          title: "Hardcore run ended",
          message: `One incorrect command ended this run. ${safeContext.explanation} ${safeContext.useCase} The answer remains hidden because the timer did not expire.`,
        });
        finish("hardcore");
        return;
      }

      setTime((value) => value === null ? null : Math.max(0, value + effect.timeDeltaMs));
      showTimeChange(effect.timeDeltaMs);
      setLines((values) => [
        ...values,
        `${currentPrompt} ${displayInput}`,
        `% ${result.message}`,
        safeContextLine,
        `▼ ${seconds(lostMs)} seconds lost · error tier ${effect.nextConsecutiveWrong}`,
      ].slice(-60));
      if (!retried.current.has(item.id)) {
        retried.current.add(item.id);
        setQueue((values) => {
          const next = [...values];
          next.splice(Math.min(next.length, cursor + 4), 0, item.id);
          return next;
        });
      }
      setFeedback({
        tone: "error",
        title: `${errorNames[code] ?? "Command error"} · −${seconds(lostMs)}s`,
        message: `${failureFeedback(result.message)} ${safeContext.explanation} ${safeContext.useCase}`,
      });
      setAdvancing(true);
      scheduleAdvance(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 250 : 700);
      return;
    }

    const responseMs = Math.max(0, performance.now() - startedAt);
    const simulation = execution;
    const acceptedContext = acceptedCommandContext(item);
    const acceptedContextLine = `Why: ${acceptedContext.explanation} Use case: ${acceptedContext.useCase}`;
    const policy = acceptedAttemptPolicy(attempt, roundRef.current.combo, attemptAssistance);
    const assistanceOutcome = ["guided-discovery", "cli-assisted", "answer-revealed"].includes(policy.classification);

    if (activeMode === "easy") {
      const clean = policy.cleanRecall;
      const learningStreak = policy.combo;
      const points = learningPoints(item.difficulty, attempt, Math.max(1, learningStreak), assistance);
      const nextRound: Round = recordAttempt({
        ...roundRef.current,
        score: roundRef.current.score + points,
        submissions: roundRef.current.submissions + 1,
        presented: roundRef.current.presented + (attempt === 1 ? 1 : 0),
        resolved: roundRef.current.resolved + 1,
        firstTry: roundRef.current.firstTry + (clean ? 1 : 0),
        recovered: roundRef.current.recovered + (attempt > 1 ? 1 : 0),
        assisted: roundRef.current.assisted + (assistanceOutcome ? 1 : 0),
        combo: learningStreak,
        bestCombo: Math.max(roundRef.current.bestCombo, learningStreak),
        times: [...roundRef.current.times, responseMs],
        reviewIds: uniq([...roundRef.current.reviewIds, item.id]),
        reviewReasons: attempt > 1
          ? { ...roundRef.current.reviewReasons, [item.id]: "recovered" }
          : roundRef.current.reviewReasons,
      }, learnerRecordInput, "accepted-objective", policy.masteryOutcome, "The command completed the requested simulator outcome.", "None; the operational task completed.");
      pendingRoundInput.current = "";
      setFeedback({
        tone: "success",
        title: clean
          ? `Recalled independently · +${points}`
          : policy.classification === "guided-discovery"
            ? `Guided discovery · +${points}`
            : policy.classification === "cli-assisted"
              ? `Assisted operational solve · +${points}`
          : policy.classification === "answer-revealed" ? "Command reinforced" : `Recovered on retry · +${points}`,
        message: `${acceptedContext.explanation} ${acceptedContext.useCase} ${clean ? "This clean recall advances the spaced-review interval." : policy.classification === "guided-discovery" ? "Question-mark discovery scheduled an earlier clean-recall check." : policy.classification === "recovered-recall" ? "The recovered command remains on a shorter review interval." : "Assistance is recorded separately and schedules another independent attempt."}`,
      });
      startTransition(() => {
        setRoundBoth(nextRound);
        updatePracticeCommand(item.id, true, null, clean, responseMs, policy.reviewOutcome);
        if (assistanceOutcome) queueLockIn(item.id);
        setDevice(simulation.state);
        setLines((values) => [
          ...values,
          `${currentPrompt} ${displayInput}`,
          ...simulation.output,
          acceptedContextLine,
          points
            ? `✓ +${points} learning points · ${clean ? `${learningStreak}x clean streak · review scheduled` : "operational solve"}`
            : "✓ Reinforcement complete · revealed answer earns no points",
        ].slice(-60));
        setEasyComplete(true);
        setAdvancing(true);
      });
      tone();
      return;
    }

    const timeEffect = correctAnswerEffect(activeMode, policy.combo);
    consecutiveWrong.current = timeEffect.nextConsecutiveWrong;
    const points = score(
      item.difficulty,
      policy.attempt,
      responseMs,
      policy.combo,
      policy.classification === "answer-revealed",
    );
    const nextRound: Round = recordAttempt({
      ...roundRef.current,
      score: roundRef.current.score + points,
      submissions: roundRef.current.submissions + 1,
      presented: roundRef.current.presented + (attempt === 1 ? 1 : 0),
      resolved: roundRef.current.resolved + 1,
      firstTry: roundRef.current.firstTry + (policy.masteryEligible ? 1 : 0),
      recovered: roundRef.current.recovered + (policy.firstTry ? 0 : 1),
      assisted: roundRef.current.assisted + (assistanceOutcome ? 1 : 0),
      combo: policy.combo,
      bestCombo: Math.max(roundRef.current.bestCombo, policy.combo),
      times: [...roundRef.current.times, responseMs],
      timeGainedMs: roundRef.current.timeGainedMs + timeEffect.timeDeltaMs,
      reviewIds: uniq([...roundRef.current.reviewIds, item.id]),
      reviewReasons: policy.firstTry
        ? roundRef.current.reviewReasons
        : { ...roundRef.current.reviewReasons, [item.id]: "recovered" },
    }, learnerRecordInput, "accepted-objective", policy.masteryOutcome, "The command completed the requested simulator outcome.", "None; the operational task completed.");
    pendingRoundInput.current = "";
    setRoundBoth(nextRound);
    updateCommand(item.id, 1, policy.masteryEligible, null, policy.reviewOutcome, responseMs);
    if (assistanceOutcome) queueLockIn(item.id);
    setDevice(simulation.state);
    setTime((value) => value === null ? null : value + timeEffect.timeDeltaMs);
    showTimeChange(timeEffect.timeDeltaMs);
    const award = policy.classification === "guided-discovery"
      ? "guided discovery · clean recall scheduled"
      : policy.classification === "cli-assisted"
        ? "CLI-assisted recall · clean recall scheduled"
        : policy.classification === "answer-revealed"
          ? "revealed reinforcement · no mastery credit"
      : policy.cleanRecall
      ? `${policy.combo}x clean combination`
      : "reduced retry credit";
    setLines((values) => [
      ...values,
      `${currentPrompt} ${displayInput}`,
      ...simulation.output,
      acceptedContextLine,
      `✓ +${points} points · +${seconds(timeEffect.timeDeltaMs)}s · ${award}`,
    ].slice(-60));
      setFeedback({
        tone: "success",
      title: policy.cleanRecall
        ? `Command accepted · +${seconds(timeEffect.timeDeltaMs)}s`
        : policy.classification === "guided-discovery"
          ? `Guided discovery · +${seconds(timeEffect.timeDeltaMs)}s`
          : policy.classification === "cli-assisted"
            ? `Assisted command · +${seconds(timeEffect.timeDeltaMs)}s`
            : policy.classification === "answer-revealed"
              ? `Reinforced · +${seconds(timeEffect.timeDeltaMs)}s`
        : `Recovered on retry · +${seconds(timeEffect.timeDeltaMs)}s`,
      message: policy.classification === "guided-discovery"
        ? `${acceptedContext.explanation} ${acceptedContext.useCase} +${points} points; question-mark discovery scheduled an earlier independent review.`
        : policy.classification === "cli-assisted"
          ? `${acceptedContext.explanation} ${acceptedContext.useCase} +${points} points; Tab, paste or a hint is recorded as assisted.`
          : policy.classification === "answer-revealed"
            ? `${acceptedContext.explanation} ${acceptedContext.useCase} The reveal earns no mastery credit and schedules reinforcement.`
        : policy.cleanRecall
        ? `${acceptedContext.explanation} ${acceptedContext.useCase} +${points} points.`
        : `${acceptedContext.explanation} ${acceptedContext.useCase} +${points} reduced retry points; the mastery interval did not advance.`,
    });
    setAdvancing(true);
    tone();
    scheduleAdvance(window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 250 : 180);
  };

  const recallCommandHistory = (value: string, direction: "older" | "newer") => {
    const recalled = navigateCommandHistory(history, value, historyAt, historyDraft, direction);
    setHistoryAt(recalled.index);
    setHistoryDraft(recalled.draft);
    return recalled.value;
  };

  const controlCommandInput = (value: string, key: CliControlKey) => {
    if (key === "ArrowUp" || key === "ArrowDown") {
      const recalled = recallCommandHistory(value, key === "ArrowUp" ? "older" : "newer");
      return { draft: recalled, cursor: recalled.length };
    }

    const control = handleCliControl(
      device,
      key,
      value,
      history,
      historyAt < 0 ? history.length : historyAt,
    );
    if (["Ctrl+A", "Ctrl+E", "Ctrl+U", "Ctrl+W"].includes(key)) {
      return { draft: control.draft, cursor: control.cursor };
    }

    const currentPrompt = prompt(device);
    const safeDraft = value.trim()
      ? redactCommandInput(value, device.context, catalogue, device.profileId)
      : "";
    roundDraftRef.current = "";
    setHistoryAt(-1);
    setHistoryDraft("");

    if (key === "Ctrl+Shift+6") {
      setLines((values) => [...values, `${currentPrompt} ^C`, ...control.output.slice(1)].slice(-80));
      setFeedback({ tone: "neutral", title: "Operation interrupted", message: "Ctrl+Shift+6 stopped the simulated operation without submitting an answer." });
      return { draft: control.draft, cursor: control.cursor };
    }

    if (key === "Ctrl+C") {
      setDevice(control.state);
      setLines((values) => [...values, `${currentPrompt}${safeDraft ? ` ${safeDraft}` : ""}^C`].slice(-80));
      setFeedback({ tone: "neutral", title: "Draft cancelled", message: "The command was not executed. Configuration context returned to Privileged EXEC." });
      return { draft: control.draft, cursor: control.cursor };
    }

    if (safeDraft) submit(value);
    setDevice(control.state);
    setLines((values) => [...values, safeDraft ? "^Z · returned to Privileged EXEC" : `${currentPrompt} ^Z`].slice(-80));
    if (!safeDraft) setFeedback({ tone: "neutral", title: "Returned to Privileged EXEC", message: "Ctrl+Z left configuration without submitting an answer." });
    return { draft: control.draft, cursor: control.cursor };
  };

  const resumeSavedRound = () => {
    try {
      const restored = restoreSavedRound(JSON.parse(localStorage.getItem(roundStorageKey) ?? "null"));
      if (!restored) {
        clearSavedRound();
        return;
      }
      const knownIds = new Set(catalogue.map((command) => command.id));
      const restoredQueue = restored.queue.filter((id) => knownIds.has(id));
      if (!restoredQueue.length) {
        clearSavedRound();
        return;
      }
      setActiveMode(restored.activeMode);
      setSelectedMode(restored.activeMode);
      setSessionKind(restored.sessionKind);
      setSessionLimit(restored.sessionLimit);
      setRoundBoth(restored.round);
      setQueue(restoredQueue);
      setCursor(Math.min(restored.cursor, restoredQueue.length - 1));
      setDevice(restored.device);
      setTime(restored.time);
      setPaused(restored.paused);
      setHistory(restored.history);
      setLines(restored.lines);
      roundDraftRef.current = restored.input;
      setScreen("round");
    } catch {
      clearSavedRound();
    }
  };

  const openGuidedLab = (labId: DeviceBuildLabId) => {
    setActiveGuidedLab(labId);
    setScreen("guided-lab");
  };

  const restartGuidedLab = (labId: DeviceBuildLabId) => {
    const definition = getDeviceBuildDefinition(labId);
    if (!window.confirm(`Restart Lab ${definition.number} from its first prompt? The saved position will be replaced.`)) return;
    try { localStorage.removeItem(guidedLabStorageKey(labId)); } catch {}
    refreshGuidedResumes();
    openGuidedLab(labId);
  };

  const stableSubmit = useStableCallback(submit);
  const stableControlCommandInput = useStableCallback(controlCommandInput);
  const stableCompleteCommandInput = useStableCallback(completeCommandInput);
  const stableShowCliOptions = useStableCallback(showCliOptions);
  const stableCommandPasted = useStableCallback(commandPasted);
  const stableCommandClipboardError = useStableCallback(commandClipboardError);
  const stableCopyTerminalSelection = useStableCallback(copyTerminalSelection);
  const stableSubmitScenarioCommand = useStableCallback(submitScenarioCommand);
  const stableControlScenarioInput = useStableCallback(controlScenarioInput);
  const stableCompleteScenarioInput = useStableCallback(completeScenarioInput);
  const stableShowScenarioCliOptions = useStableCallback(showScenarioCliOptions);
  const stableScenarioClipboardError = useStableCallback(scenarioClipboardError);
  const stableCopyScenarioSelection = useStableCallback(copyScenarioSelection);

  const dueCount = due(reviews, clockNow).length;
  const nextReview = nextDue(reviews);
  const cleanRecallCount = Object.values(reviews).filter((review) => (review.cleanRecalls ?? 0) > 0).length;
  const completedChapterCount = curriculumStates.filter((state) => state.complete).length;
  const toggleSound = () => save({ ...progressRef.current, muted: !progressRef.current.muted });
  const firstGuidedResume = guidedResumes.find((entry) => !entry.completed);
  const continuation = roundResumeAvailable
    ? {
        eyebrow: "Continue where you stopped",
        title: "Continue saved command practice",
        detail: "Your objective, CLI mode and redacted terminal history will return exactly where you stopped.",
        action: resumeSavedRound,
        label: "Continue activity",
        duration: "2–5 min",
      }
    : scenarioSessionAvailable && scenario.phase !== "complete"
      ? {
          eyebrow: "Continue where you stopped",
          title: `Continue Lab 1 · Step ${scenario.acceptedActions + 1}`,
          detail: `${ipv4ScenarioPrompt(scenario)} · ${getIpv4ScenarioObjective(scenario)}`,
          action: resumeIpv4Lab,
          label: "Continue Lab 1",
          duration: "5–10 min",
        }
      : firstGuidedResume
        ? {
            eyebrow: "Continue where you stopped",
            title: `Continue Lab ${getDeviceBuildDefinition(firstGuidedResume.labId).number} · Step ${firstGuidedResume.stepIndex + 1}`,
            detail: getDeviceBuildDefinition(firstGuidedResume.labId).title,
            action: () => openGuidedLab(firstGuidedResume.labId),
            label: `Continue Lab ${getDeviceBuildDefinition(firstGuidedResume.labId).number}`,
            duration: "5–10 min",
          }
        : {
            eyebrow: "Your next step",
            title: navigationSessionAvailable ? "Continue CLI navigation" : "Start CLI navigation",
            detail: "Learn the prompts first, then practise moving between them without getting stranded.",
            action: () => setScreen("navigation"),
            label: navigationSessionAvailable ? "Continue CLI navigation" : "Start CLI navigation",
            duration: "3–5 min",
          };

  const commonError = report
    ? Object.entries(report.round.errors).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
    : null;
  const medianResponse = report ? median(report.round.times) : null;
  const reportRules = report ? gameModeById(report.mode) : null;
  const reportCanReveal = report?.reason === "timer";
  const reportHasVisibleReview = Boolean(
    report && reportCanReveal && report.round.missed.length > 0,
  );
  const reportHasHiddenMisses = Boolean(
    report && !reportCanReveal && report.round.missed.length > 0,
  );
  const reportFocusCommand = report
    ? catalogue.find((command) => command.id === report.round.missed[0])
    : undefined;
  const reportFocusContext = reportFocusCommand
    ? safeCommandContext(reportFocusCommand)
    : null;

  const reportHeading = report?.reason === "practice"
    ? sessionKind === "daily"
      ? "Today’s due recall is complete."
      : sessionKind === "chapter"
        ? "Beginner chapter complete."
        : "Practice complete."
    : report?.reason === "partial"
      ? sessionKind === "daily" ? "Daily Recall paused." : sessionKind === "chapter" ? "Beginner chapter paused." : "Practice ended."
    : report?.reason === "complete"
      ? "Full catalogue pass complete."
    : report?.reason === "hardcore"
      ? "Hardcore run ended."
      : report?.reason === "early"
        ? "Run ended early."
        : `${reportRules?.label ?? "Timed"} run complete.`;

  const reportBody = report?.reason === "practice"
    ? sessionKind === "daily"
      ? "Each clean due recall has updated its next interval. Assisted operational solves remain scheduled for future independent retrieval."
      : sessionKind === "chapter"
        ? "The chapter records clean recall command by command. Complete every prerequisite independently to unlock the next chapter."
        : "Your attempts are saved locally. Clean, unaided recall contributes to spacing; assisted operational solves are tracked separately."
    : report?.reason === "partial"
      ? "Completed attempts are saved. Remaining due or chapter work is still waiting and has not been reported as complete."
    : report?.reason === "complete"
      ? "Every objective in this catalogue pass was presented. Answers remain hidden because the time bank did not expire."
    : report?.reason === "hardcore"
      ? "One incorrect command ended this run. Completed attempts are saved, but the answer stays hidden because the timer did not expire."
      : report?.reason === "early"
        ? "Completed attempts were saved, but answers remain hidden because the timer did not reach zero."
         : "Your result and review schedule are saved locally. Correct answers for objectives that need review are available below.";

  const activeActivityName = screen === "round"
    ? sessionKind === "daily" ? "Daily recall" : sessionKind === "chapter" ? "Beginner path" : `${activeRules.label} practice`
    : screen === "navigation" ? "CLI Navigation"
    : screen === "scenario" ? "Lab 1 · IPv4 troubleshooting"
    : screen === "guided-lab" ? `Lab ${getDeviceBuildDefinition(activeGuidedLab).number} · ${getDeviceBuildDefinition(activeGuidedLab).shortTitle}`
    : screen === "good-to-know" ? "Save, undo and get unstuck"
    : screen === "scenario-report" ? "Lab 1 report"
    : screen === "report" ? "Practice report"
    : screen === "manage" ? "Command administration"
    : "Home";
  const activeProgressLabel = screen === "round"
    ? `Step ${cursor + 1}${sessionLimit ? ` of ${sessionLimit}` : ""}`
    : screen === "navigation" ? "Progress saved"
    : screen === "scenario" ? `${scenario.acceptedActions} completed`
    : screen === "guided-lab" ? "Progress saved"
    : screen === "good-to-know" ? "Progress saved"
    : "";

  return (
    <main className={`shell screen-${screen}`}>
      <div className="grid-bg" />
      <header>
        {screen !== "home" && <button className="mobile-back" type="button" onClick={goHome} aria-label="Back to home">‹</button>}
        <button className="brand brand-link" type="button" onClick={goHome} aria-label="Return to CLI RUSH home">
          <b>CR</b>
          <span><strong>CLI RUSH</strong><small>Network Command Arena</small></span>
        </button>
        {screen !== "home" && <div className="mobile-activity"><strong>{activeActivityName}</strong><span>{activeProgressLabel}</span></div>}
        <div className="controls">
          <button className="sound-control" aria-pressed={!progress.muted} onClick={toggleSound}>
            {progress.muted ? "Sound off" : "Sound on"}
          </button>
          <details key={screen} className="account-menu">
            <summary>Account</summary>
            <div>
              <span className="saved">● {serverBacked
                ? customStoreUnavailable ? "Docker data unavailable" : "Docker data active"
                : "Saved locally"}</span>
              <button type="button" onClick={() => setScreen(screen === "manage" ? "home" : "manage")}>
                {screen === "manage" ? "Back to game" : "Manage commands"}
              </button>
              {dockerUser && <button type="button" onClick={() => void logout()}>Log out {dockerUser}</button>}
            </div>
          </details>
        </div>
      </header>

      {screen === "home" && (
        <section className="home home-streamlined">
          <section className="practice-hub" aria-labelledby="practice-title">
            <div className="section-heading">
              <div><p className="eyebrow">Start here</p><h1 id="practice-title">Choose your next five minutes.</h1></div>
              <p>The recommended session follows your saved position and recall schedule.</p>
            </div>
            <div className="practice-actions">
              <button className="practice-option recommended" type="button" onClick={continuation.action}>
                <span><small>{continuation.eyebrow}</small><strong>{continuation.title}</strong><em>{continuation.detail}</em></span>
                <b>{continuation.label}<i>{continuation.duration}</i></b>
              </button>
              <button className="practice-option" type="button" onClick={dueCount > 0 ? startDailyRecall : () => { chooseMode("easy"); startBeginnerPath(); }}>
                <span><small>{dueCount > 0 ? "Spaced recall" : "Build your review queue"}</small><strong>{dueCount > 0 ? `${dueCount} review${dueCount === 1 ? "" : "s"} due` : "Beginner recall"}</strong><em>{dueCount > 0 ? "Retrieve without help to extend each interval." : "A clean first recall schedules the next review."}</em></span>
                <b>{dueCount > 0 ? `Review up to ${Math.min(10, dueCount)}` : "Start Easy"}<i>{dueCount > 0 ? `${Math.max(1, Math.ceil(Math.min(10, dueCount) * 0.35))} min` : "5 min"}</i></b>
              </button>
              <button className="practice-option" type="button" onClick={start}>
                <span><small>Command Rush</small><strong>{selectedRules.label} mode</strong><em>{selectedRules.description}</em></span>
                <b>{startLabel(selectedMode)}<i>{selectedMode === "easy" ? "Untimed" : "60 sec"}</i></b>
              </button>
              <button className="practice-option" type="button" onClick={() => document.getElementById("labs-title")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                <span><small>Stateful practice</small><strong>Open Labs</strong><em>Configure, diagnose, verify and recover simulated devices.</em></span>
                <b>Browse labs<i>{deviceBuildLabs.length + 1} guided labs</i></b>
              </button>
            </div>
          </section>

          <section className="daily-summary" aria-label="Learning progress">
            <div><small>Due now</small><strong>{dueCount}</strong><span>{nextReview && dueCount === 0 ? `Next in ${Math.max(1, Math.ceil((nextReview - clockNow) / 60_000))} min` : dueCount ? "Ready to review" : "Queue is clear"}</span></div>
            <div><small>Clean recalls</small><strong>{cleanRecallCount}</strong><span>Commands retrieved unaided</span></div>
            <div><small>Best streak</small><strong>{progress.bestCombo}</strong><span>Correct commands in a row</span></div>
            <div><small>Sessions</small><strong>{progress.sessions}</strong><span>Saved on this device</span></div>
          </section>

          <div className="home-learning-grid">
            <article className="dashboard-card curriculum-card">
              <p className="eyebrow">Learning path · {completedChapterCount}/{curriculumStates.length} chapters</p>
              <h2>{nextChapterState?.chapter.title ?? "Beginner path complete"}</h2>
              <p>{nextChapterState?.chapter.description ?? "All prerequisite chapters have independent recall evidence. Keep them alive through due reviews and practical labs."}</p>
              {nextChapterState && <div className="chapter-progress"><span>{nextChapterState.cleanRecallCount}/{nextChapterState.commandCount} independently recalled</span><i><b style={{ width: `${nextChapterState.commandCount ? (nextChapterState.cleanRecallCount / nextChapterState.commandCount) * 100 : 0}%` }} /></i></div>}
              <button className="secondary" type="button" onClick={() => { chooseMode("easy"); startBeginnerPath(); }}>{nextChapterState ? `Continue ${nextChapterState.chapter.title}` : "Start adaptive Easy practice"}</button>
            </article>

            <section className="labs-library" aria-labelledby="labs-title">
              <div className="labs-library-head"><div><p className="eyebrow">Practical learning</p><h2 id="labs-title">Labs</h2></div><p>Untimed, stateful and saved locally.</p></div>
              <ol className="lab-list">
                <li className="dashboard-card lab-card">
                  <span className="lab-number">01</span>
                  <div><small>IPv4 troubleshooting</small><h3>Bring up, diagnose and recover a branch interface</h3><p>Baseline a simple lab network, configure the LAN, diagnose the missing route, prove its effect, recover and save the verified state.</p></div>
                  <div className="lab-list-actions">
                    <button className="primary small" type="button" onClick={scenarioSessionAvailable ? resumeIpv4Lab : startIpv4Lab}>{scenarioSessionAvailable ? scenario.phase === "complete" ? "View Lab 1" : `Continue Lab 1 · ${scenario.acceptedActions} done` : "Start Lab 1"}</button>
                    {scenarioSessionAvailable && <details className="lab-more"><summary>More</summary><button type="button" onClick={restartIpv4Lab}>Restart from the beginning</button></details>}
                  </div>
                </li>
              </ol>
              <details className="additional-labs">
                <summary>View router and switch build labs</summary>
                <ol className="lab-list">
                {deviceBuildLabs.map((lab) => {
                  const savedLab = guidedResumes.find((entry) => entry.labId === lab.id);
                  return <li className="dashboard-card lab-card" key={lab.id}>
                    <span className="lab-number">{String(lab.number).padStart(2, "0")}</span>
                    <div><small>{lab.deviceType} foundation</small><h3>{lab.title}</h3><p>{lab.summary}</p></div>
                    <div className="lab-list-actions">
                      <button className="primary small" type="button" onClick={() => openGuidedLab(lab.id)}>{savedLab ? savedLab.completed ? `Review Lab ${lab.number}` : `Continue Lab ${lab.number} · ${savedLab.stepIndex}/${savedLab.totalSteps}` : `Start Lab ${lab.number}`}</button>
                      {savedLab && <details className="lab-more"><summary>More</summary><button type="button" onClick={() => restartGuidedLab(lab.id)}>Restart from the beginning</button></details>}
                    </div>
                  </li>;
                })}
              </ol>
              </details>
            </section>
          </div>

          <details className="mode-picker">
            <summary><span><small>Change game mode</small><strong>{selectedRules.label}</strong></span><span>{selectedRules.description}</span></summary>
            <div className="mode-grid" role="group" aria-label="Game mode">
              {(Object.keys(gameModes) as GameModeId[]).map((mode) => {
                const rules = gameModeById(mode);
                const active = selectedMode === mode;
                return <button key={mode} className={`mode-card ${active ? "active" : ""}`} aria-pressed={active} onClick={() => chooseMode(mode)}><strong>{rules.label}</strong><p>{rules.description}</p><small>{modeSummary(rules)}</small></button>;
              })}
            </div>
            <button className="primary mode-start" type="button" onClick={start}>{startLabel(selectedMode)}</button>
          </details>

          <details className="good-to-know">
            <summary><span><small>Good to know · hands-on</small><strong>Save, undo and get unstuck</strong></span><span>{goodToKnowLessons.length} short safety exercises</span></summary>
            <div className="knowledge-grid">
              <article>
                <h3>Practise in an isolated router fixture</h3>
                <p>Answers stay hidden until you deliberately reveal them, every input uses the shared IOS-style parser, and your exact exercise is saved locally.</p>
                <button className="primary" type="button" onClick={() => setScreen("good-to-know")}>Open safety practice</button>
              </article>
              {goodToKnowDistinctions.map((item) => <article key={item.id}><h3>{item.title}</h3><p>{item.detail}</p></article>)}
            </div>
          </details>

          <p className="case-note"><b>IOS keywords are case-insensitive:</b> <code>vlan 20</code>, <code>Vlan 20</code> and <code>VLAN 20</code> mean the same thing. Passwords and shared secrets remain case-sensitive.</p>
        </section>
      )}

      {screen === "round" && (
        <section className={`game game-${activeMode}`}>
          <div className="activity-bar">
            <span>{sessionKind === "daily" ? "Daily recall" : sessionKind === "chapter" ? "Beginner path" : `${activeRules.label} mode`}</span>
            <strong>{sessionLimit ? `Step ${Math.min(cursor + 1, sessionLimit)} of ${sessionLimit}` : `Command ${cursor + 1}`}</strong>
            <span className={time !== null && time <= 10_000 ? "danger" : ""}>
              {timed ? `${Math.ceil(time / 1000)}s` : "Untimed"} · {activeMode === "easy" ? `${round.score} points` : `${round.score} score`} · {round.combo}× streak
              {timeChange && <em key={timeChange.id} className={timeChange.deltaMs > 0 ? "gain" : "loss"}>{timeChange.deltaMs > 0 ? "+" : "−"}{seconds(Math.abs(timeChange.deltaMs))}s</em>}
            </span>
          </div>

          {timed && <div className="track" role="progressbar" aria-label="Time bank" aria-valuemin={0} aria-valuemax={60} aria-valuenow={Math.min(60, Math.ceil((time ?? 0) / 1000))}><i style={{ width: `${Math.min(100, (time ?? 0) / 600)}%` }} /></div>}

          <PracticeWorkspace>
            <aside className={`task-panel ${easyComplete ? "answer-complete" : ""}`}>
              <div className="task-summary">
                <span className="task-kicker">{sessionKind === "daily" ? "Due retrieval" : sessionKind === "chapter" ? "Chapter objective" : "Operational objective"}</span>
                <h1 id="objective-title">{paused ? "Objective hidden while paused" : item.objective}</h1>
                <code className="current-context">{prompt(device)} · {modeNames[device.mode]}</code>
                <p>{item.topic} · difficulty {item.difficulty}{presentationAttempt > 1 ? ` · try ${presentationAttempt}` : ""}</p>
                {!paused && <button className="task-details-toggle" type="button" aria-expanded={taskDetailsOpen} onClick={() => setTaskDetailsOpen((open) => !open)}>{easyComplete ? "View explanation" : "Need help?"}</button>}
                {easyComplete && <div className="answer-next">
                  <button ref={nextEasyButtonRef} className="primary small" type="button" onClick={nextEasyObjective}>Next command</button>
                  <span>Continue now, or open the explanation first.</span>
                </div>}
              </div>
              {!paused && <div className={`task-details ${taskDetailsOpen ? "open" : ""}`}>
                <div className="task-details-head"><strong>{easyComplete ? "Explanation and real use" : "Learning coach"}</strong><button type="button" onClick={() => { setTaskDetailsOpen(false); inputRef.current?.focusAtEnd(); }} aria-label="Close task details">×</button></div>
                {!easyComplete ? <>
                  <p>{learningHints.strategy.text}</p>
                  {assistance >= 1 && <code>{learningHints.structure.text}</code>}
                  {assistance >= 2 && <code>{learningHints.family.text}</code>}
                  {assistance >= 3 && <RevealBundle
                    command={learningHints.reveal.text}
                    whatItDoes={currentLearningTask.correctExplanation}
                    whyCorrectHere={`${currentLearningTask.whyThisMatters} ${currentLearningTask.expectedEffect}`}
                    verification={currentLearningTask.verification}
                    recovery={currentLearningTask.recovery}
                    shorthand={currentRevealShorthand}
                  />}
                  {item.topic === "CLI navigation" && <CliModeMap mode={device.mode} />}
                  <div className="learning-actions assistance-buttons" aria-label="Learning assistance">
                    <button className="secondary" type="button" onClick={() => showAssistance(assistance === 0 ? 1 : 2)} disabled={assistance >= 2}>
                      {assistance === 0 ? "Show hint" : assistance === 1 ? "Show another hint" : "Hints shown"}
                    </button>
                    <button className="secondary reveal-control" type="button" onClick={() => showAssistance(3)} disabled={assistance === 3}>Reveal answer · no mastery</button>
                  </div>
                  <ul className="assistance-ledger" aria-label="Attempt assistance status">
                    <li className={guidedDiscoveryUsed ? "used" : ""}><b>?</b><span>guided options</span><em>{guidedDiscoveryUsed ? "used" : "unused"}</em></li>
                    <li className={cliAssistanceUsed ? "used" : ""}><b>Tab</b><span>completion or paste</span><em>{cliAssistanceUsed ? "used" : "unused"}</em></li>
                    <li className={assistance > 0 ? "used" : ""}><b>Hint</b><span>task coaching</span><em>{assistance > 0 ? "used" : "unused"}</em></li>
                    <li className={assistance === 3 ? "used" : ""}><b>Reveal</b><span>full answer</span><em>{assistance === 3 ? "used" : "unused"}</em></li>
                  </ul>
                  {(assistance > 0 || cliAssistanceUsed || guidedDiscoveryUsed) && <p className="assisted-note">{guidedDiscoveryUsed && assistance === 0 && !cliAssistanceUsed ? "Guided discovery is an authentic CLI skill; it schedules an earlier clean-recall check." : "Assisted practice is useful, but this attempt will not advance clean-recall mastery."}</p>}
                </> : <>
                  <p className="mnemonic">{learningHints.postAnswerMnemonic}</p>
                  <div className="teaching-card">
                    <div><small>Why it matters</small><p>{currentTeaching.purpose}</p></div>
                    <div><small>When to use it</small><p>{currentTeaching.whenToUse}</p></div>
                    <div><small>Mental model</small><p>{currentTeaching.mentalModel}</p></div>
                    <div><small>Worked example</small><p>{currentTeaching.workedExample}</p></div>
                    <div><small>Syntax</small><code>{currentTeaching.syntax}</code></div>
                    <div><small>Expected output</small><p>{currentTeaching.expected}</p></div>
                    <div><small>Verify</small><p>{currentTeaching.verify}</p></div>
                    <div><small>Common trap</small><p>{currentTeaching.commonTrap}</p></div>
                    <div><small>Rollback</small><p>{currentTeaching.rollback}</p></div>
                    <div><small>Risk</small><p>{currentTeaching.risk}</p></div>
                  </div>
                </>}
              </div>}
            </aside>

            <div className="terminal-panel">
              <div className="terminal">
                <div className="terminal-head">
                  <span>● ● ● &nbsp; {device.hostname}{" // console"}</span>
                  <details className="activity-menu"><summary>More</summary><div>{device.recoveryCheckpoint && <button type="button" onClick={restoreRoundCheckpoint} disabled={paused || advancing}>Restore checkpoint</button>}{timed && <button type="button" onClick={pauseRound} disabled={paused || advancing}>Pause</button>}<button type="button" onClick={skipObjective} disabled={paused || advancing || easyComplete}>Skip objective</button><button type="button" onClick={() => finish(activeMode === "easy" ? "partial" : "early")}>Finish activity</button><button type="button" onClick={goHome}>Back to home</button></div></details>
                </div>
                {paused ? <div className="pause" role="group" aria-labelledby="pause-title"><b aria-hidden="true">Ⅱ</b><h2 id="pause-title">Run paused</h2><p>The clock is stopped and the objective is hidden.</p><div><button ref={resumeButtonRef} className="primary small" onClick={resumeRound}>Resume run</button><button className="secondary" onClick={() => finish("early")}>End run</button></div></div> : <>
                  <TerminalHistory lines={lines} containerRef={logRef} onCopy={stableCopyTerminalSelection} />
                  <TerminalCommandInput
                    key={`${item.id}-${cursor}`}
                    ref={inputRef}
                    id="command"
                    promptText={prompt(device)}
                    accessibleContext={`${modeNames[device.mode]}; objective: ${item.objective}`}
                    resetKey={`${item.id}-${cursor}`}
                    onDraftSettled={rememberRoundDraft}
                    disabled={advancing}
                    onControl={stableControlCommandInput}
                    onSubmit={stableSubmit}
                    onTab={stableCompleteCommandInput}
                    onHelp={stableShowCliOptions}
                    onPaste={stableCommandPasted}
                    onClipboardError={stableCommandClipboardError}
                  />
                </>}
              </div>

              {!paused && <div ref={feedbackElementRef} className={`command-status ${feedback.tone}`} role="status" aria-live="polite" aria-atomic="true"><strong>{feedback.title}</strong><span>{feedback.message}</span></div>}
              <p className="help">Tab completes the current token · ? lists valid options · ↑/↓ recalls redacted history · Highlight to copy · Right-click or Ctrl+V pastes</p>
            </div>
          </PracticeWorkspace>
        </section>
      )}

      {screen === "scenario" && (
        <section className="game field-lab">
          <div className="activity-bar">
            <span>Lab 1</span>
            <strong>IPv4 troubleshooting</strong>
            <span>{scenario.phase === "complete" ? "Complete" : `${scenario.acceptedActions} steps completed`} · {modeNames[scenario.mode]}</span>
          </div>
          <PracticeWorkspace>
            <aside className="task-panel">
              <div className="task-summary">
                <span className="task-kicker">{scenarioChoices.length ? "Interpret the evidence" : scenario.phase === "complete" ? "Lab complete" : "Operational objective"}</span>
                <h1>{getIpv4ScenarioObjective(scenario)}</h1>
                <code className="current-context">{ipv4ScenarioPrompt(scenario)} · {modeNames[scenario.mode]}</code>
                <p>See, decide, change, verify and recover. The simulator keeps every accepted state transition.</p>
                <button className="task-details-toggle" type="button" aria-expanded={taskDetailsOpen} onClick={() => setTaskDetailsOpen((open) => !open)}>{scenarioLesson ? "View explanation" : "View ticket and hints"}</button>
              </div>
              <div className={`task-details ${taskDetailsOpen ? "open" : ""}`}>
                <div className="task-details-head"><strong>Work order and coaching</strong><button type="button" onClick={() => { setTaskDetailsOpen(false); scenarioInputRef.current?.focusAtEnd(); }} aria-label="Close task details">×</button></div>
                <div className="scenario-ticket" aria-label="Branch change ticket"><span>Interface <b>{scenario.parameters.interfaceName}</b></span><span>LAN address <b>{scenario.parameters.localAddress}/{scenario.parameters.prefixLength}</b></span><span>Gateway <b>{scenario.parameters.gateway}</b></span><span>Test target <b>{scenario.parameters.remoteTarget}</b></span></div>
                <ScenarioTopology state={scenario} />
                {scenario.phase !== "complete" && <section className={`scenario-hint ${scenarioHint ? `focus-${scenarioHint.visualFocus}` : ""}`}>
                  <div><small>Progressive help</small><strong>{scenarioHint?.heading ?? "Stuck on the next step?"}</strong><p>{scenarioHint?.explanation ?? "Start with a reasoning hint. If that is not enough, reveal one worked command using this work order’s exact values."}</p>{scenarioHint?.example && scenarioHintLevel < 3 && <code>{ipv4ScenarioPrompt(scenario)} {scenarioHint.example}</code>}{scenarioHintLevel === 3 && scenarioHint?.example && <RevealBundle
                    command={scenarioHint.example}
                    whatItDoes={scenarioHint.whatItDoes ?? "Applies the revealed action to the isolated simulator."}
                    whyCorrectHere={scenarioHint.whyCorrectHere ?? scenarioHint.explanation}
                    verification={scenarioHint.verification}
                    recovery={scenarioHint.recovery}
                    shorthand={scenarioRevealCommand ? parserProvenShorthandExamples(scenarioRevealCommand, scenarioRevealCatalogue, "router-ios-xe") : []}
                  />}{scenarioHint?.breakdown && <div className="command-breakdown" aria-label="Command anatomy">{scenarioHint.breakdown.map((part, index) => <span key={`${part.token}-${index}`}><code>{part.token}</code><small>{part.meaning}</small></span>)}</div>}</div>
                  {scenarioHintLevel < 3 ? <button className="secondary" type="button" onClick={() => setScenarioHintLevel((level) => level === 0 ? 1 : level === 1 ? 2 : 3)}>{scenarioHintLevel === 0 ? "Hint 1 · reasoning" : scenarioHintLevel === 1 ? "Hint 2 · command shape" : "Show answer · assisted"}</button> : <span className="hint-complete">Answer revealed · practise again without it</span>}
                </section>}
                {scenarioLesson && <section className={`scenario-lesson ${scenarioLesson.accepted ? "accepted" : "rejected"}`}><div><small>{scenarioLesson.accepted ? "Why it worked" : "Why it did not work"}</small><p>{scenarioLesson.explanation}</p></div><div><small>Real use</small><p>{scenarioLesson.useCase}</p></div><div><small>Verify</small><p>{scenarioLesson.verification}</p></div><div><small>Rollback</small><p>{scenarioLesson.rollback}</p></div>{scenarioLesson.example && <div className="lesson-example"><small>Worked example</small><code>{scenarioLesson.example}</code></div>}</section>}
              </div>
            </aside>

            <div className="terminal-panel">
              <div className="terminal scenario-terminal">
                <div className="terminal-head"><span>● ● ● &nbsp; R1 // isolated simulator</span><details className="activity-menu"><summary>More</summary><div>{scenario.recoveryCheckpoint && <button type="button" onClick={restoreScenarioCheckpoint}>Restore checkpoint</button>}<button type="button" onClick={restartIpv4Lab}>Restart lab</button><button type="button" onClick={goHome}>Back to home</button></div></details></div>
                <TerminalHistory lines={scenarioLines} containerRef={scenarioLogRef} onCopy={stableCopyScenarioSelection} />
                {scenarioChoices.length ? <div className="scenario-choices" role="group" aria-label="Interpret the displayed evidence">{scenarioChoices.map((choice) => <button key={choice.id} type="button" onClick={() => chooseScenarioInterpretation(choice.id, choice.label)}>{choice.label}</button>)}</div> : scenario.phase === "complete" ? <div className="scenario-complete-action"><button className="primary small" onClick={() => setScreen("scenario-report")}>View lab report</button></div> : <TerminalCommandInput
                  key={`${scenario.phase}-${scenario.acceptedActions}`}
                  ref={scenarioInputRef}
                  id="scenario-command"
                  initialValue={scenarioInput}
                  onDraftSettled={setScenarioInput}
                  promptText={ipv4ScenarioPrompt(scenario)}
                  accessibleContext={`${modeNames[scenario.mode]}; objective: ${getIpv4ScenarioObjective(scenario)}`}
                  resetKey={`${scenario.phase}-${scenario.acceptedActions}`}
                  onControl={stableControlScenarioInput}
                  onSubmit={stableSubmitScenarioCommand}
                  onTab={stableCompleteScenarioInput}
                  onHelp={stableShowScenarioCliOptions}
                  onClipboardError={stableScenarioClipboardError}
                />}
              </div>
              <div className={`command-status ${scenarioLesson?.accepted ? "success" : scenarioLesson?.valid === false ? "error" : "neutral"}`} role="status" aria-live="polite" aria-atomic="true"><strong>{scenarioLesson ? scenarioLesson.awaitingConfirmation ? "Confirmation required" : scenarioLesson.accepted ? "Step accepted" : scenarioLesson.valid ? "Valid command · task still open" : "Task still open" : "Terminal ready"}</strong><span>{scenarioLesson ? `${scenarioLesson.explanation} ${scenarioLesson.useCase}` : "Enter a command, use ? to inspect the current grammar, or use Tab to complete an unambiguous token."}</span></div>
              <p className="help">Manual prompts · ↑/↓ recalls redacted history · Highlight to copy · Right-click or Ctrl+V pastes · Input never leaves the simulator</p>
            </div>
          </PracticeWorkspace>
        </section>
      )}

      {screen === "scenario-report" && (
        <section className="report scenario-report">
          <div className="report-title">
            <p className="eyebrow">IPV4 FIELD LAB COMPLETE</p>
            <h1>You completed the whole operational lifecycle.</h1>
            <p>You captured a baseline, configured the LAN, diagnosed a missing default route, repaired and verified reachability, removed the exact route to prove causality, then restored, reverified and saved the known-good state.</p>
          </div>
          <div className="final-score">
            <small>ACCEPTED ACTIONS</small>
            <b>{scenario.acceptedActions}</b>
            <em>STATEFUL LAB</em>
          </div>
          <div className="report-detail">
            <div><small>ADDRESSING PLAN</small><b>{scenario.parameters.interfaceName} · {scenario.parameters.localAddress}/{scenario.parameters.prefixLength}</b><p>Gateway {scenario.parameters.gateway} · remote test target {scenario.parameters.remoteTarget}</p></div>
            <div><small>OPERATIONAL PRACTICE</small><b>Baseline → configure → diagnose → repair → prove → recover → save</b><p>The final startup snapshot contains the restored default route only after the route table and end-to-end probe both pass.</p></div>
          </div>
          <div className="report-actions">
            <button className="primary" onClick={startIpv4Lab}>Run a new seeded lab</button>
            <button className="secondary" onClick={() => setScreen("home")}>Return home</button>
          </div>
        </section>
      )}

      {screen === "navigation" && <NavigationPractice keyboardOpen={keyboardOpen} onHome={goHome} onEvidence={recordPracticeEvidence} />}

      {screen === "guided-lab" && <GuidedBuildLab key={activeGuidedLab} labId={activeGuidedLab} keyboardOpen={keyboardOpen} onHome={goHome} onEvidence={recordPracticeEvidence} />}

      {screen === "good-to-know" && <GoodToKnowPractice onHome={goHome} onEvidence={recordPracticeEvidence} />}

      {screen === "report" && report && (
        <section className={`report report-${report.mode}`}>
          <div className="report-title">
            <p className="eyebrow">{report.reason === "hardcore" ? "HARDCORE RUN" : report.mode === "easy" ? "PRACTICE REPORT" : "RUN REPORT"}</p>
            <h1 ref={reportHeadingRef} tabIndex={-1}>{reportHeading}</h1>
            <p>{reportBody}</p>
          </div>
          <div className="final-score">
            <small>{report.mode === "easy" ? "LEARNING POINTS" : report.recordKind === "field" ? "FIELD CLI SCORE" : "CLEAN RECALL SCORE"}</small>
            <b>{report.round.score}</b>
            {report.personalBest && <em>{report.recordKind === "field" ? "FIELD CLI BEST" : "CLEAN RECALL BEST"}</em>}
          </div>

          <div className="report-grid">
            <div><small>Commands resolved</small><b>{report.round.resolved}</b><span>{report.round.recovered} recovered · {report.round.assisted} assisted</span></div>
            <div><small>Clean recall</small><b>{pct(report.round.presented ? report.round.firstTry / report.round.presented : 0)}</b><span>{report.round.firstTry} of {report.round.presented}</span></div>
            <div><small>Submission accuracy</small><b>{pct(report.round.submissions ? report.round.resolved / report.round.submissions : 0)}</b><span>{report.round.resolved} of {report.round.submissions}</span></div>
            <div><small>Best clean streak</small><b>{report.round.bestCombo}x</b><span>Assistance does not extend it</span></div>
            <div><small>Median response</small><b>{medianResponse === null ? "—" : `${(medianResponse / 1000).toFixed(1)}s`}</b><span>Resolved commands</span></div>
            <div><small>Time gained</small><b>{report.mode === "easy" ? "—" : `+${seconds(report.round.timeGainedMs)}s`}</b><span>Correct commands</span></div>
            <div><small>Time lost</small><b>{report.mode === "easy" || report.mode === "hardcore" ? "—" : `−${seconds(report.round.timeLostMs)}s`}</b><span>{report.mode === "hardcore" ? "One-strike rule" : "Incorrect commands"}</span></div>
            <div><small>Scheduled reviews</small><b>{uniq(report.round.reviewIds).length}</b><span>{report.round.unanswered} unanswered</span></div>
          </div>

          <div className="report-detail">
            <div>
              <small>{report.reason === "hardcore" ? "RUN-ENDING ERROR" : "MOST COMMON ERROR"}</small>
              <b>{commonError ? errorNames[commonError] : report.round.unanswered ? "Unanswered at the buzzer" : "No errors recorded"}</b>
              <p>{reportFocusContext ? `${reportFocusContext.explanation} ${reportFocusContext.useCase}` : commonError ? "This is the clearest target for deliberate practice." : report.round.unanswered ? "The final objective has been added to the review queue." : "Spacing will test whether this recall holds."}</p>
            </div>
            <div>
              <small>RECOMMENDED NEXT ACTION</small>
              <b>{report.reason === "partial" ? "Continue the unfinished learning session" : report.mode === "easy" ? "Return when the scheduled review is due" : reportHasVisibleReview ? "Review the needs-review commands below" : reportHasHiddenMisses ? "Start another unassisted run while the error is fresh" : "Repeat after the review interval"}</b>
              <p>{report.reason === "partial" ? "Nothing unfinished was marked complete; the same due reviews or prerequisite chapter remain available from the home screen." : report.mode === "easy" ? "Move to Normal when you can retrieve the chapter without semantic, Tab or question-mark help." : reportHasVisibleReview ? "Incorrect, recovered and unanswered items are scheduled for another unassisted attempt." : reportHasHiddenMisses ? "The answer stays hidden until a full timer expires; another recall attempt protects the learning signal." : "Accuracy is established; let spacing test retention."}</p>
            </div>
          </div>

          {report.round.attemptRecords.length > 0 && <div className="answer-review">
            <div className="answer-review-head"><span>SUBMISSION REVIEW</span><b>{report.round.attemptRecords.length} recorded</b></div>
            {report.round.attemptRecords.map((attempt, index) => {
              const answerVisible = roundAttemptAnswerVisible(
                report.mode,
                reportCanReveal,
                attempt.mastery,
                report.round.missed.includes(attempt.commandId),
              );
              const revealedCommand = catalogue.find((entry) => entry.id === attempt.commandId);
              const revealedTask = revealedCommand ? learningTaskFor(revealedCommand) : null;
              return <article key={`${attempt.commandId}-${index}`}>
                <small>{attemptMasteryNames[attempt.mastery]} · {attempt.parserCategory.replaceAll("-", " ")}</small>
                <h3>{attempt.task}</h3>
                <p><b>Learner input:</b> <code>{attempt.learnerInput || "No command text"}</code></p>
                <p><b>Parser or outcome:</b> {attempt.parserReason}</p>
                <p><b>Why it failed or stayed open:</b> {attempt.nonCompletionReason}</p>
                <p><b>Required context:</b> {attempt.requiredContext}</p>
                <p><b>Purpose:</b> {attempt.purpose}</p>
                {answerVisible ? <RevealBundle
                  command={attempt.correctCommand}
                  whatItDoes={revealedTask?.correctExplanation ?? attempt.purpose}
                  whyCorrectHere={`${attempt.purpose} ${attempt.stateEffect}`}
                  verification={attempt.verification}
                  recovery={revealedTask?.recovery}
                  shorthand={revealedCommand ? parserProvenShorthandExamples(revealedCommand, catalogue, revealedCommand.deviceProfile) : []}
                /> : <p><b>Answer withheld:</b> The exact missed command and verification path appear only after the full timer expires.</p>}
              </article>;
            })}
          </div>}

          {mayRevealAnswers(reportCanReveal) && report.round.missed.length > 0 && (
            <div className="answer-review">
              <div className="answer-review-head"><span>NEEDS REVIEW</span><b>{uniq(report.round.missed).length} objectives</b></div>
              {uniq(report.round.missed).map((id) => {
                const command = catalogue.find((entry) => entry.id === id);
                const reason = report.round.reviewReasons[id];
                if (!command) return null;
                const teaching = teachingFor(command);
                const task = learningTaskFor(command);
                return (
                  <article key={id}>
                    <small>{modeNames[command.mode]} · {command.topic}{reason ? ` · ${reviewReasonNames[reason]}` : ""}</small>
                    <h3>{command.objective}</h3>
                    <RevealBundle
                      command={command.canonical}
                      whatItDoes={task.correctExplanation}
                      whyCorrectHere={`${teaching.purpose} ${teaching.expected}`}
                      verification={teaching.verify}
                      recovery={teaching.rollback}
                      shorthand={parserProvenShorthandExamples(command, catalogue, command.deviceProfile)}
                    />
                    <p><b>When:</b> {teaching.whenToUse}</p>
                    <p><b>Syntax:</b> <code>{teaching.syntax}</code></p>
                    <p><b>Expected:</b> {teaching.expected}</p>
                    <p><b>Verify:</b> {teaching.verify}</p>
                    <p><b>Common trap:</b> {teaching.commonTrap}</p>
                    <p><b>Rollback:</b> {teaching.rollback}</p>
                    <p><b>Risk:</b> {teaching.risk}</p>
                  </article>
                );
              })}
            </div>
          )}

          <div className="report-actions">
            {sessionKind === "daily" && dueCount > 0
              ? <button className="primary" onClick={startDailyRecall}>Recall remaining due commands</button>
              : <button className="primary" onClick={report.mode === "easy" ? startBeginnerPath : start}>{sessionKind === "chapter" ? "Continue beginner path" : report.mode === "easy" ? "Start Easy practice" : `Run ${reportRules?.label ?? "mode"} again`}</button>}
            <button className="secondary" onClick={() => setScreen("home")}>Choose another mode</button>
          </div>
        </section>
      )}

      {screen === "manage" && (
        <CustomCommandManager
          records={customRecords}
          baseCatalogue={commands}
          onPersist={persistCustom}
          persistenceLabel={serverBacked ? "stored under the container’s /data volume" : "stored in this browser"}
          status={customStatus}
        />
      )}

      {screen !== "navigation" && screen !== "round" && screen !== "scenario" && screen !== "guided-lab" && screen !== "good-to-know" && (
        <footer>
          <span>Independent educational simulator · Not affiliated with or endorsed by Cisco</span>
          <span>IOS XE learning pack v0.1 · Simulator-tested draft</span>
        </footer>
      )}
    </main>
  );
}
