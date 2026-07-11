/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */
"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyCommand,
  commands,
  initialDevice,
  modeNames,
  prepare,
  prompt,
  seededOrder,
  validate,
  type CliMode,
  type Command,
  type CommandKind,
  type DeviceState,
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
  learningHintsFor,
  learningPoints,
  type AssistanceLevel,
} from "@/lib/learning.ts";
import {
  acceptedAttemptPolicy,
  failureFeedback,
  mayRevealAnswers,
  shouldRecordTimedOutObjective,
} from "@/lib/gameplay.ts";
import {
  due,
  nextDue,
  schedule,
  score,
  type Outcome,
  type Review,
} from "@/lib/scheduler.ts";

type Screen = "home" | "round" | "report" | "manage";
type FinishReason = "timer" | "early" | "hardcore" | "practice";
type ReviewReason = "incorrect" | "recovered" | "unanswered";

interface CommandProgress {
  attempts: number;
  correct: number;
  firstTry: number;
  lastError: string | null;
  review?: Review;
}

interface Progress {
  bestScore: number | null;
  bestScores: Partial<Record<GameModeId, number>>;
  bestCombo: number;
  rounds: number;
  sessions: number;
  commands: Record<string, CommandProgress>;
  muted: boolean;
  reducedMotion: boolean;
  lastMode: GameModeId;
}

interface Round {
  score: number;
  submissions: number;
  presented: number;
  resolved: number;
  firstTry: number;
  recovered: number;
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
}

interface Report {
  round: Round;
  reason: FinishReason;
  mode: GameModeId;
  personalBest: boolean;
  previousBest: number | null;
}

interface TimeChange {
  id: number;
  deltaMs: number;
}

const storageKey = "cli-rush-progress-v1";
const customStorageKey = "cli-rush-custom-commands-v1";

const blankProgress = (): Progress => ({
  bestScore: null,
  bestScores: {},
  bestCombo: 0,
  rounds: 0,
  sessions: 0,
  commands: {},
  muted: false,
  reducedMotion: false,
  lastMode: "easy",
});

const blankRound = (): Round => ({
  score: 0,
  submissions: 0,
  presented: 0,
  resolved: 0,
  firstTry: 0,
  recovered: 0,
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
});

const emptyCustom = () => ({
  objective: "",
  canonical: "",
  explanation: "",
  topic: "Custom",
  mode: "privileged" as CliMode,
  kind: "verification" as CommandKind,
  difficulty: 1 as 1 | 2 | 3,
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

const isGameMode = (value: unknown): value is GameModeId =>
  typeof value === "string" && value in gameModes;

const hydrateProgress = (value: unknown): Progress => {
  const base = blankProgress();
  if (!value || typeof value !== "object") return base;
  const candidate = value as Partial<Progress>;
  const legacyNormal = typeof candidate.bestScore === "number"
    ? { normal: candidate.bestScore }
    : {};
  return {
    ...base,
    ...candidate,
    bestScores: {
      ...legacyNormal,
      ...(candidate.bestScores && typeof candidate.bestScores === "object"
        ? candidate.bestScores
        : {}),
    },
    sessions: Number.isFinite(candidate.sessions)
      ? Number(candidate.sessions)
      : Number(candidate.rounds ?? 0),
    commands: candidate.commands && typeof candidate.commands === "object"
      ? candidate.commands
      : {},
    lastMode: isGameMode(candidate.lastMode) ? candidate.lastMode : "easy",
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
  if (rules.id === "easy") return "NO CLOCK · STAGED HINTS · NO MASTERY";
  if (rules.wrongEndsRound) return `CORRECT +${seconds(rules.correctBonusMs)}S · ONE STRIKE`;
  const rewards = rules.comboBonusMs === null
    ? `CORRECT +${seconds(rules.correctBonusMs)}S`
    : `CORRECT +${seconds(rules.correctBonusMs)}/+${seconds(rules.comboBonusMs)}S`;
  return `${rewards} · ERRORS −${rules.wrongPenaltiesMs.map(seconds).join("/−")}S`;
};

const startLabel = (mode: GameModeId): string =>
  mode === "easy" ? "Start Easy practice" : `Start ${gameModeById(mode).label} rush`;

export default function GameClient() {
  const [screen, setScreen] = useState<Screen>("home");
  const [progress, setProgress] = useState<Progress>(blankProgress);
  const [round, setRound] = useState<Round>(blankRound);
  const [report, setReport] = useState<Report | null>(null);
  const [selectedMode, setSelectedMode] = useState<GameModeId>("easy");
  const [activeMode, setActiveMode] = useState<GameModeId>("easy");

  const progressRef = useRef(progress);
  const roundRef = useRef(round);
  const finishing = useRef(false);
  const retried = useRef(new Set<string>());
  const roundAttempts = useRef(new Map<string, number>());
  const reviewBaselines = useRef(new Map<string, Review | undefined>());
  const submittedForCurrentObjective = useRef(false);
  const consecutiveWrong = useRef(0);
  const timeChangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerLastTick = useRef<number | null>(null);
  const pausedAt = useRef<number | null>(null);

  const [queue, setQueue] = useState(() => seededOrder(1));
  const [cursor, setCursor] = useState(0);
  const [device, setDevice] = useState<DeviceState>(initialDevice);
  const [time, setTime] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(-1);
  const [lines, setLines] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [advancing, setAdvancing] = useState(false);
  const [presentationAttempt, setPresentationAttempt] = useState(1);
  const [assistance, setAssistance] = useState<AssistanceLevel>(0);
  const [easyComplete, setEasyComplete] = useState(false);
  const [timeChange, setTimeChange] = useState<TimeChange | null>(null);

  const [customCommands, setCustomCommands] = useState<Command[]>([]);
  const [customDraft, setCustomDraft] = useState(emptyCustom);
  const [customStatus, setCustomStatus] = useState("");
  const [serverBacked, setServerBacked] = useState(false);
  const [dockerUser, setDockerUser] = useState<string | null>(null);
  const [feedback, setFeedback] = useState({
    tone: "neutral",
    title: "Terminal ready",
    message: "Choose a game mode, read the objective and build the command.",
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const resumeButtonRef = useRef<HTMLButtonElement>(null);
  const learningAidRef = useRef<HTMLElement>(null);
  const nextEasyButtonRef = useRef<HTMLButtonElement>(null);
  const reportHeadingRef = useRef<HTMLHeadingElement>(null);

  const catalogue = useMemo(
    () => [...commands, ...customCommands],
    [customCommands],
  );
  const item = useMemo(
    () => catalogue.find((command) => command.id === queue[cursor % queue.length]) ?? catalogue[0],
    [catalogue, cursor, queue],
  );
  const learningHints = useMemo(() => learningHintsFor(item), [item]);
  const activeRules = gameModeById(activeMode);
  const selectedRules = gameModeById(selectedMode);
  const timed = time !== null;

  const save = useCallback((next: Progress) => {
    progressRef.current = next;
    setProgress(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {}
  }, []);

  const setRoundBoth = useCallback((next: Round) => {
    roundRef.current = next;
    setRound(next);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const loaded = hydrateProgress(JSON.parse(raw));
        progressRef.current = loaded;
        setProgress(loaded);
        setSelectedMode(loaded.lastMode);
      }
      const customRaw = localStorage.getItem(customStorageKey);
      if (customRaw) {
        const parsed = JSON.parse(customRaw) as Command[];
        if (Array.isArray(parsed)) setCustomCommands(parsed);
      }
    } catch {}

    void (async () => {
      try {
        const session = await fetch("/api/session", { credentials: "same-origin" });
        if (!session.ok) return;
        const sessionData = await session.json();
        setDockerUser(sessionData.username);
        const response = await fetch("/api/custom-commands", { credentials: "same-origin" });
        if (!response.ok) return;
        const serverCommands = await response.json();
        if (Array.isArray(serverCommands)) {
          setCustomCommands(serverCommands);
          setServerBacked(true);
          localStorage.setItem(customStorageKey, JSON.stringify(serverCommands));
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (screen !== "round") return;
    submittedForCurrentObjective.current = false;
    setPresentationAttempt((roundAttempts.current.get(item.id) ?? 0) + 1);
    setAssistance(0);
    setEasyComplete(false);
    setDevice((current) => prepare(current, item));
    setHistory([]);
    setHistoryAt(-1);
    setStartedAt(performance.now());
    pausedAt.current = null;
    setAdvancing(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [cursor, item, screen]);

  useEffect(() => {
    if (screen === "round" && paused) {
      setTimeout(() => resumeButtonRef.current?.focus(), 0);
    }
  }, [paused, screen]);

  useEffect(() => {
    if (screen === "round" && activeMode === "easy" && easyComplete) {
      setTimeout(() => nextEasyButtonRef.current?.focus(), 0);
    }
  }, [activeMode, easyComplete, screen]);

  useEffect(() => {
    if (screen === "report") {
      setTimeout(() => reportHeadingRef.current?.focus(), 0);
    }
  }, [screen]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

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
  }, []);

  const tone = (good: boolean) => {
    if (progressRef.current.muted) return;
    try {
      const Ctx = window.AudioContext;
      const context = new Ctx();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = good ? 740 : 190;
      gain.gain.setValueAtTime(0.04, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.08);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.08);
      oscillator.onended = () => void context.close();
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

  const reviewForRoundOutcome = useCallback((
    id: string,
    current: Review | undefined,
    outcome: Outcome,
  ) => {
    if (!reviewBaselines.current.has(id)) reviewBaselines.current.set(id, current);
    return schedule(reviewBaselines.current.get(id), outcome, Date.now());
  }, []);

  const updateCommand = useCallback((
    id: string,
    count: number,
    first: boolean,
    lastError: string | null,
    outcome: Outcome,
  ) => {
    const current = progressRef.current;
    const old = current.commands[id];
    save({
      ...current,
      commands: {
        ...current.commands,
        [id]: {
          attempts: (old?.attempts ?? 0) + count,
          correct: (old?.correct ?? 0) + 1,
          firstTry: (old?.firstTry ?? 0) + (first ? 1 : 0),
          lastError,
          review: reviewForRoundOutcome(id, old?.review, outcome),
        },
      },
    });
  }, [reviewForRoundOutcome, save]);

  const updatePracticeCommand = useCallback((
    id: string,
    correct: boolean,
    lastError: string | null,
  ) => {
    const current = progressRef.current;
    const old = current.commands[id];
    save({
      ...current,
      commands: {
        ...current.commands,
        [id]: {
          attempts: (old?.attempts ?? 0) + 1,
          correct: (old?.correct ?? 0) + (correct ? 1 : 0),
          firstTry: old?.firstTry ?? 0,
          lastError,
          review: old?.review,
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
          attempts: (old?.attempts ?? 0) + count,
          correct: old?.correct ?? 0,
          firstTry: old?.firstTry ?? 0,
          lastError,
          review: reviewForRoundOutcome(id, old?.review, "failed"),
        },
      },
    });
  }, [reviewForRoundOutcome, save]);

  const persistCustom = async (next: Command[]) => {
    setCustomStatus("Saving…");
    try {
      if (serverBacked) {
        const response = await fetch("/api/custom-commands", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(next),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: "Save failed." }));
          throw new Error(body.error || "Save failed.");
        }
      }
      localStorage.setItem(customStorageKey, JSON.stringify(next));
      setCustomCommands(next);
      setCustomStatus(serverBacked
        ? "Saved to the Docker data volume."
        : "Saved in this browser.");
    } catch (error) {
      setCustomStatus(error instanceof Error ? error.message : "Save failed.");
    }
  };

  const addCustom = (event: FormEvent) => {
    event.preventDefault();
    const draft = customDraft;
    if (!draft.objective.trim() || !draft.canonical.trim() || !draft.explanation.trim()) {
      setCustomStatus("Question, correct command and explanation are required.");
      return;
    }
    const command: Command = {
      ...draft,
      id: `custom.${crypto.randomUUID().replaceAll("-", "")}`,
      objective: draft.objective.trim(),
      canonical: draft.canonical.trim().replace(/\s+/g, " "),
      explanation: draft.explanation.trim(),
      topic: draft.topic.trim() || "Custom",
      custom: true,
    };
    void persistCustom([...customCommands, command]);
    setCustomDraft(emptyCustom());
  };

  const removeCustom = (id: string) =>
    void persistCustom(customCommands.filter((command) => command.id !== id));

  const logout = async () => {
    await fetch("/logout", { method: "POST", credentials: "same-origin" });
    window.location.assign("/login");
  };

  const finish = useCallback((reason: FinishReason) => {
    if (finishing.current || screen !== "round") return;
    finishing.current = true;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    const timerReachedZero = reason === "timer";
    const competitiveRunComplete = timerReachedZero || reason === "hardcore";
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
    const previousBest = current.bestScores[activeMode]
      ?? (activeMode === "normal" ? current.bestScore : null)
      ?? null;
    const personalBest = competitiveRunComplete
      && activeMode !== "easy"
      && (previousBest === null || completedRound.score > previousBest);
    const bestScores = personalBest
      ? { ...current.bestScores, [activeMode]: completedRound.score }
      : current.bestScores;

    save({
      ...current,
      sessions: current.sessions + 1,
      rounds: current.rounds + (competitiveRunComplete ? 1 : 0),
      bestScore: activeMode === "normal" && personalBest
        ? completedRound.score
        : current.bestScore,
      bestScores,
      bestCombo: activeMode === "easy"
        ? current.bestCombo
        : Math.max(current.bestCombo, completedRound.bestCombo),
      lastMode: activeMode,
    });
    setReport({
      round: completedRound,
      reason,
      mode: activeMode,
      personalBest,
      previousBest,
    });
    pausedAt.current = null;
    setPaused(false);
    setScreen("report");
  }, [activeMode, failUnresolved, item, save, screen, setRoundBoth]);

  useEffect(() => {
    if (screen === "round" && time === 0) finish("timer");
  }, [finish, screen, time]);

  const chooseMode = (mode: GameModeId) => {
    setSelectedMode(mode);
    save({ ...progressRef.current, lastMode: mode });
  };

  const start = () => {
    const mode = selectedMode;
    const rules = gameModeById(mode);
    const nextRound = blankRound();
    setActiveMode(mode);
    setRoundBoth(nextRound);
    setQueue(seededOrder(progressRef.current.sessions + 1, catalogue));
    setCursor(0);
    setDevice(initialDevice());
    setTime(initialTimeMs(mode));
    pausedAt.current = null;
    setPaused(false);
    setInput("");
    setLines([
      `CLI RUSH // ${rules.label.toUpperCase()} MODE`,
      mode === "easy"
        ? "Learning mode: hints are available and mastery is not advanced"
        : modeSummary(rules),
    ]);
    setFeedback({
      tone: "neutral",
      title: mode === "easy" ? "Learning session started" : `${rules.label} rush started`,
      message: mode === "easy"
        ? "Use the learning coach, try the command and keep going until it sticks."
        : "Correct commands add time. Check the objective and current CLI prompt.",
    });
    setReport(null);
    setTimeChange(null);
    finishing.current = false;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    retried.current.clear();
    roundAttempts.current.clear();
    reviewBaselines.current.clear();
    submittedForCurrentObjective.current = false;
    consecutiveWrong.current = 0;
    save({ ...progressRef.current, lastMode: mode });
    setScreen("round");
  };

  const nextEasyObjective = () => {
    setEasyComplete(false);
    setAdvancing(false);
    setCursor((value) => value + 1);
  };

  const showAssistance = (level: Exclude<AssistanceLevel, 0>) => {
    setAssistance(level);
    setTimeout(() => learningAidRef.current?.focus(), 0);
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
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (paused || advancing || time === 0) return;
    const result = validate(input, device.mode, item.id, catalogue);
    if (!result.input) {
      if (!result.ok) {
        setFeedback({ tone: "error", title: "Nothing entered", message: result.message });
      }
      return;
    }

    submittedForCurrentObjective.current = true;
    const attempt = (roundAttempts.current.get(item.id) ?? 0) + 1;
    roundAttempts.current.set(item.id, attempt);
    const currentPrompt = prompt(device);
    setHistory((values) => [...values, result.input].slice(-20));
    setHistoryAt(-1);

    if (!result.ok) {
      const code = result.code;

      if (activeMode === "easy") {
        const nextRound: Round = {
          ...roundRef.current,
          submissions: roundRef.current.submissions + 1,
          presented: roundRef.current.presented + (attempt === 1 ? 1 : 0),
          combo: 0,
          errors: {
            ...roundRef.current.errors,
            [code]: (roundRef.current.errors[code] ?? 0) + 1,
          },
          reviewReasons: {
            ...roundRef.current.reviewReasons,
            [item.id]: "incorrect",
          },
        };
        setRoundBoth(nextRound);
        updatePracticeCommand(item.id, false, code);
        setLines((values) => [
          ...values,
          `${currentPrompt} ${result.input}`,
          `% ${result.message}`,
          "Learning coach opened the command shape. Try the same objective again.",
        ].slice(-60));
        setInput("");
        setAssistance((level) => level === 0 ? 1 : level);
        setPresentationAttempt(attempt + 1);
        setFeedback({
          tone: "error",
          title: errorNames[code] ?? "Keep learning",
          message: `${result.message} Stay on this objective and try again; mastery is unchanged.`,
        });
        tone(false);
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }

      const effect = wrongAnswerEffect(activeMode, consecutiveWrong.current);
      consecutiveWrong.current = effect.nextConsecutiveWrong;
      const lostMs = Math.abs(effect.timeDeltaMs);
      const actualLostMs = Math.min(lostMs, time ?? lostMs);
      const nextRound: Round = {
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
      };
      setRoundBoth(nextRound);
      failUnresolved(item.id, 1, code);
      setInput("");
      tone(false);

      if (effect.terminalFailure) {
        setLines((values) => [
          ...values,
          `${currentPrompt} ${result.input}`,
          `% ${result.message}`,
          "✕ Hardcore run ended · answer remains hidden",
        ].slice(-60));
        setFeedback({
          tone: "error",
          title: "Hardcore run ended",
          message: "One incorrect command ended this run. The answer remains hidden because the timer did not expire.",
        });
        finish("hardcore");
        return;
      }

      setTime((value) => value === null ? null : Math.max(0, value + effect.timeDeltaMs));
      showTimeChange(effect.timeDeltaMs);
      setLines((values) => [
        ...values,
        `${currentPrompt} ${result.input}`,
        `% ${result.message}`,
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
        message: failureFeedback(result.message),
      });
      setAdvancing(true);
      scheduleAdvance(progressRef.current.reducedMotion ? 250 : 700);
      return;
    }

    const responseMs = Math.max(0, performance.now() - startedAt);
    const simulation = applyCommand(device, item);

    if (activeMode === "easy") {
      const learningStreak = roundRef.current.combo + 1;
      const points = learningPoints(item.difficulty, attempt, learningStreak, assistance);
      const clean = attempt === 1 && assistance === 0;
      const nextRound: Round = {
        ...roundRef.current,
        score: roundRef.current.score + points,
        submissions: roundRef.current.submissions + 1,
        presented: roundRef.current.presented + (attempt === 1 ? 1 : 0),
        resolved: roundRef.current.resolved + 1,
        firstTry: roundRef.current.firstTry + (clean ? 1 : 0),
        recovered: roundRef.current.recovered + (attempt > 1 ? 1 : 0),
        combo: learningStreak,
        bestCombo: Math.max(roundRef.current.bestCombo, learningStreak),
        times: [...roundRef.current.times, responseMs],
        reviewReasons: attempt > 1
          ? { ...roundRef.current.reviewReasons, [item.id]: "recovered" }
          : roundRef.current.reviewReasons,
      };
      setRoundBoth(nextRound);
      updatePracticeCommand(item.id, true, null);
      setDevice(simulation.state);
      setLines((values) => [
        ...values,
        `${currentPrompt} ${result.input}`,
        ...simulation.output,
        points
          ? `✓ +${points} learning points · ${learningStreak}x streak`
          : "✓ Reinforcement complete · revealed answer earns no points",
      ].slice(-60));
      setFeedback({
        tone: "success",
        title: points ? `Command learned · +${points}` : "Command reinforced",
        message: item.explanation,
      });
      setInput("");
      setEasyComplete(true);
      setAdvancing(true);
      tone(true);
      return;
    }

    const policy = acceptedAttemptPolicy(attempt, roundRef.current.combo);
    const timeEffect = correctAnswerEffect(activeMode, policy.combo);
    consecutiveWrong.current = timeEffect.nextConsecutiveWrong;
    const points = score(
      item.difficulty,
      policy.attempt,
      responseMs,
      policy.combo,
      false,
    );
    const nextRound: Round = {
      ...roundRef.current,
      score: roundRef.current.score + points,
      submissions: roundRef.current.submissions + 1,
      presented: roundRef.current.presented + (attempt === 1 ? 1 : 0),
      resolved: roundRef.current.resolved + 1,
      firstTry: roundRef.current.firstTry + (policy.firstTry ? 1 : 0),
      recovered: roundRef.current.recovered + (policy.firstTry ? 0 : 1),
      combo: policy.combo,
      bestCombo: Math.max(roundRef.current.bestCombo, policy.combo),
      times: [...roundRef.current.times, responseMs],
      timeGainedMs: roundRef.current.timeGainedMs + timeEffect.timeDeltaMs,
      reviewIds: uniq([...roundRef.current.reviewIds, item.id]),
      reviewReasons: policy.firstTry
        ? roundRef.current.reviewReasons
        : { ...roundRef.current.reviewReasons, [item.id]: "recovered" },
    };
    setRoundBoth(nextRound);
    updateCommand(item.id, 1, policy.firstTry, null, policy.outcome);
    setDevice(simulation.state);
    setTime((value) => value === null ? null : value + timeEffect.timeDeltaMs);
    showTimeChange(timeEffect.timeDeltaMs);
    const award = policy.firstTry
      ? `${policy.combo}x clean combination`
      : "reduced retry credit";
    setLines((values) => [
      ...values,
      `${currentPrompt} ${result.input}`,
      ...simulation.output,
      `✓ +${points} points · +${seconds(timeEffect.timeDeltaMs)}s · ${award}`,
    ].slice(-60));
    setFeedback({
      tone: "success",
      title: policy.firstTry
        ? `Command accepted · +${seconds(timeEffect.timeDeltaMs)}s`
        : `Recovered on retry · +${seconds(timeEffect.timeDeltaMs)}s`,
      message: policy.firstTry
        ? `${item.explanation} +${points} points.`
        : `${item.explanation} +${points} reduced retry points; the mastery interval did not advance.`,
    });
    setInput("");
    setAdvancing(true);
    tone(true);
    scheduleAdvance(progressRef.current.reducedMotion ? 250 : 180);
  };

  const historyKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!history.length) return;
      const next = historyAt < 0 ? history.length - 1 : Math.max(0, historyAt - 1);
      setHistoryAt(next);
      setInput(history[next]);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = historyAt + 1;
      if (historyAt < 0 || next >= history.length) {
        setHistoryAt(-1);
        setInput("");
      } else {
        setHistoryAt(next);
        setInput(history[next]);
      }
    }
  };

  const reviews = Object.fromEntries(
    Object.entries(progress.commands)
      .filter(([, value]) => value.review)
      .map(([id, value]) => [id, value.review!]),
  );
  const dueCount = due(reviews, Date.now()).length;
  const nextReview = nextDue(reviews);
  const selectedBest = selectedMode === "easy"
    ? null
    : progress.bestScores[selectedMode]
      ?? (selectedMode === "normal" ? progress.bestScore : null);

  const settings = (key: "muted" | "reducedMotion") =>
    save({ ...progressRef.current, [key]: !progressRef.current[key] });

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

  const reportHeading = report?.reason === "practice"
    ? "Practice complete."
    : report?.reason === "hardcore"
      ? "Hardcore run ended."
      : report?.reason === "early"
        ? "Run ended early."
        : `${reportRules?.label ?? "Timed"} run complete.`;

  const reportBody = report?.reason === "practice"
    ? "Your learning points and attempts are saved locally. Easy practice never advances mastery."
    : report?.reason === "hardcore"
      ? "One incorrect command ended this run. Completed attempts are saved, but the answer stays hidden because the timer did not expire."
      : report?.reason === "early"
        ? "Completed attempts were saved, but answers remain hidden because the timer did not reach zero."
        : "Your result and review schedule are saved locally. Correct answers for objectives that need review are available below.";

  return (
    <main className={`shell ${progress.reducedMotion ? "reduced" : ""}`}>
      <div className="grid-bg" />
      <header>
        <div className="brand">
          <b>CR</b>
          <span><strong>CLI RUSH</strong><small>Network Command Arena</small></span>
        </div>
        <div className="controls">
          <span className="saved">● {serverBacked ? "Docker data active" : "Saved locally"}</span>
          {screen !== "round" && (
            <button onClick={() => setScreen(screen === "manage" ? "home" : "manage")}>
              {screen === "manage" ? "Back to game" : "Manage commands"}
            </button>
          )}
          <button aria-pressed={!progress.muted} onClick={() => settings("muted")}>
            {progress.muted ? "Sound off" : "Sound on"}
          </button>
          <button
            aria-pressed={progress.reducedMotion}
            onClick={() => settings("reducedMotion")}
          >
            {progress.reducedMotion ? "Motion reduced" : "Reduce motion"}
          </button>
          {dockerUser && <button onClick={() => void logout()}>Log out</button>}
        </div>
      </header>

      {screen === "home" && (
        <section className="home">
          <div className="hero">
            <p className="eyebrow">LEARN · RECALL · BUILD SPEED</p>
            <h1>Learn the language.<em>Build command reflexes.</em></h1>
            <p className="lead">
              Start with guided, untimed practice even if every Cisco command is new.
              Move into timed recall when the patterns begin to stick.
            </p>
            <dl>
              <div><dt>{selectedMode === "easy" ? "Learning mode" : `${selectedRules.label} best`}</dt><dd>{selectedBest ?? "—"}</dd></div>
              <div><dt>Best clean combination</dt><dd>{progress.bestCombo ? `${progress.bestCombo}x` : "—"}</dd></div>
              <div><dt>Due reviews</dt><dd>{dueCount}</dd></div>
            </dl>
          </div>

          <aside>
            <div className="aside-head">SELECTED MODE <b>{selectedRules.label.toUpperCase()}</b></div>
            <div className="demo">
              <small>{selectedMode === "easy" ? "LEARNING OBJECTIVE" : "OPERATIONAL OBJECTIVE"}</small>
              <p>Display a concise summary of interface addresses and status.</p>
              <code><i>R1#</i> show ip interface brief</code>
              <span>✓ Command accepted <b>{selectedMode === "easy" ? "LEARNED" : "+TIME"}</b></span>
            </div>
            <div className="facts">
              <div><b>{selectedRules.initialTimeMs === null ? "∞" : seconds(selectedRules.initialTimeMs)}</b><span>{selectedRules.initialTimeMs === null ? "untimed" : "seconds"}</span></div>
              <div><b>{new Set(catalogue.map((command) => command.mode)).size}</b><span>CLI modes</span></div>
              <div><b>{catalogue.length}</b><span>questions</span></div>
            </div>
            <div className="queue">
              <b>↻</b>
              <span><strong>Recall queue</strong><small>{nextReview ? nextReview <= Date.now() ? "Reviews due now" : `Next review in ${Math.ceil((nextReview - Date.now()) / 60_000)} min` : "No reviews scheduled"}</small></span>
              <em>{dueCount}</em>
            </div>
          </aside>

          <div className="mode-picker">
            <div className="mode-picker-head">
              <span><small>CHOOSE YOUR GAME MODE</small><strong>Easy is recommended while commands are new.</strong></span>
              <span className="mode-rule">Rules are fixed and deterministic</span>
            </div>
            <div className="mode-grid" role="group" aria-label="Game mode">
              {(Object.keys(gameModes) as GameModeId[]).map((mode) => {
                const rules = gameModeById(mode);
                const active = selectedMode === mode;
                return (
                  <button
                    key={mode}
                    className={`mode-card ${active ? "active" : ""}`}
                    aria-pressed={active}
                    onClick={() => chooseMode(mode)}
                  >
                    <span>{mode === "easy" ? "RECOMMENDED" : "GAME MODE"}</span>
                    <strong>{rules.label}</strong>
                    <p>{rules.description}</p>
                    <small>{modeSummary(rules)}</small>
                  </button>
                );
              })}
            </div>
            <button className="primary mode-start" onClick={start}>{startLabel(selectedMode)}</button>
          </div>
        </section>
      )}

      {screen === "round" && (
        <section className={`game game-${activeMode}`}>
          <div className="game-top">
            <span>{activeRules.label.toUpperCase()} MODE<br /><b>SESSION {progress.sessions + 1}</b></span>
            <div className={`clock ${time !== null && time <= 10_000 ? "danger" : ""}`}>
              <small>{timed ? "TIME BANK" : "UNTIMED"}</small>
              <b>{time === null ? "∞" : String(Math.ceil(time / 1000)).padStart(2, "0")}</b>
              {timeChange && (
                <em key={timeChange.id} className={timeChange.deltaMs > 0 ? "gain" : "loss"} aria-live="assertive">
                  {timeChange.deltaMs > 0 ? "+" : "−"}{seconds(Math.abs(timeChange.deltaMs))}s
                </em>
              )}
            </div>
            <div className="metrics">
              <span>{activeMode === "easy" ? "LEARNING POINTS" : "SCORE"}<b>{round.score}</b></span>
              <span>{activeMode === "easy" ? "STREAK" : "COMBINATION"}<b>{round.combo}x</b></span>
            </div>
          </div>

          {timed ? (
            <div className="track" role="progressbar" aria-label="Time bank" aria-valuemin={0} aria-valuemax={Math.max(60, Math.ceil((time ?? 0) / 1000))} aria-valuenow={Math.ceil((time ?? 0) / 1000)}>
              <i style={{ width: `${Math.min(100, (time ?? 0) / 600)}%` }} />
            </div>
          ) : (
            <div className="track untimed" aria-label="Untimed Easy practice"><i /></div>
          )}

          <div className="objective">
            <p>
              {item.topic} · DIFFICULTY {item.difficulty} · {modeNames[item.mode]}
              {presentationAttempt > 1
                ? activeMode === "easy" ? ` · TRY ${presentationAttempt}` : " · RETRY · REDUCED CREDIT"
                : ""}
            </p>
            <small>OPERATIONAL OBJECTIVE</small>
            <h1 id="objective-title">{paused ? "Objective hidden while paused" : item.objective}</h1>
          </div>

          {activeMode === "easy" && !paused && (
            <section className={`learning-coach assisted-${assistance}`} aria-label="Learning coach" aria-live="polite">
              <div className="learning-copy">
                <small>LEARNING COACH · MASTERY UNCHANGED</small>
                <strong>{easyComplete ? "Lock in the pattern" : "Build the command from meaning"}</strong>
                <p>{easyComplete ? learningHints.postAnswerMnemonic : learningHints.strategy.text}</p>
                {assistance >= 1 && !easyComplete && (
                  <code ref={learningAidRef} tabIndex={-1} aria-label="Masked command shape">{learningHints.shape.text}</code>
                )}
                {assistance >= 2 && !easyComplete && (
                  <code ref={learningAidRef} tabIndex={-1} className="revealed" aria-label="Revealed command">{learningHints.reveal.text}</code>
                )}
              </div>
              <div className="learning-actions">
                {!easyComplete && assistance === 0 && (
                  <button className="secondary" onClick={() => showAssistance(1)}>Show command shape</button>
                )}
                {!easyComplete && assistance === 1 && (
                  <button className="secondary" onClick={() => showAssistance(2)}>Reveal command · no points</button>
                )}
                {!easyComplete && assistance > 0 && <span>Assisted attempt · no mastery</span>}
                {easyComplete && (
                  <button ref={nextEasyButtonRef} className="primary small" onClick={nextEasyObjective}>Next command</button>
                )}
              </div>
            </section>
          )}

          <div className="terminal">
            <div className="terminal-head">
              <span>● ● ● &nbsp; {device.hostname}{" // "}CONSOLE</span>
              {activeMode === "easy"
                ? <button onClick={() => finish("practice")}>Finish practice</button>
                : <button onClick={pauseRound} disabled={paused || advancing}>Pause</button>}
            </div>
            {paused ? (
              <div className="pause" role="group" aria-labelledby="pause-title">
                <b aria-hidden="true">Ⅱ</b>
                <h2 id="pause-title">Run paused</h2>
                <p>The clock is stopped and the objective is hidden.</p>
                <div>
                  <button ref={resumeButtonRef} className="primary small" onClick={resumeRound}>Resume run</button>
                  <button className="secondary" onClick={() => finish("early")}>End run</button>
                </div>
              </div>
            ) : (
              <>
                <div className="log" ref={logRef} role="log">
                  {lines.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}
                </div>
                <form onSubmit={submit}>
                  <label className="sr" htmlFor="command">Command input for objective: {item.objective}</label>
                  <span>{prompt(device)}</span>
                  <input
                    id="command"
                    aria-describedby="objective-title"
                    ref={inputRef}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={historyKeys}
                    onPaste={(event) => event.preventDefault()}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={256}
                    disabled={advancing}
                  />
                  <button disabled={advancing}>Run</button>
                </form>
              </>
            )}
          </div>

          {!paused && (
            <div className={`feedback ${feedback.tone}`} aria-live="polite" aria-atomic="true">
              <b aria-hidden="true">{feedback.tone === "success" ? "✓" : feedback.tone === "error" ? "!" : "i"}</b>
              <span><strong>{feedback.title}</strong><p>{feedback.message}</p></span>
            </div>
          )}
          <p className="help">
            {activeMode === "easy"
              ? "Try freely · Use staged help when stuck · Easy practice never changes mastery"
              : activeMode === "hardcore"
                ? "Enter submits · ↑/↓ command history · Correct adds 2 seconds · One incorrect command ends the run"
                : "Enter submits · ↑/↓ command history · Correct adds time · Errors remove time"}
          </p>
        </section>
      )}

      {screen === "report" && report && (
        <section className={`report report-${report.mode}`}>
          <div className="report-title">
            <p className="eyebrow">{report.reason === "hardcore" ? "HARDCORE RUN" : report.mode === "easy" ? "PRACTICE REPORT" : "RUN REPORT"}</p>
            <h1 ref={reportHeadingRef} tabIndex={-1}>{reportHeading}</h1>
            <p>{reportBody}</p>
          </div>
          <div className="final-score">
            <small>{report.mode === "easy" ? "LEARNING POINTS" : "FINAL SCORE"}</small>
            <b>{report.round.score}</b>
            {report.personalBest && <em>PERSONAL BEST</em>}
          </div>

          <div className="report-grid">
            <div><small>Commands resolved</small><b>{report.round.resolved}</b><span>{report.round.recovered} recovered</span></div>
            <div><small>Clean recall</small><b>{pct(report.round.presented ? report.round.firstTry / report.round.presented : 0)}</b><span>{report.round.firstTry} of {report.round.presented}</span></div>
            <div><small>Submission accuracy</small><b>{pct(report.round.submissions ? report.round.resolved / report.round.submissions : 0)}</b><span>{report.round.resolved} of {report.round.submissions}</span></div>
            <div><small>Best streak</small><b>{report.round.bestCombo}x</b><span>{report.mode === "easy" ? "Learning progress" : "Clean recalls"}</span></div>
            <div><small>Median response</small><b>{medianResponse === null ? "—" : `${(medianResponse / 1000).toFixed(1)}s`}</b><span>Resolved commands</span></div>
            <div><small>Time gained</small><b>{report.mode === "easy" ? "—" : `+${seconds(report.round.timeGainedMs)}s`}</b><span>Correct commands</span></div>
            <div><small>Time lost</small><b>{report.mode === "easy" || report.mode === "hardcore" ? "—" : `−${seconds(report.round.timeLostMs)}s`}</b><span>{report.mode === "hardcore" ? "One-strike rule" : "Incorrect commands"}</span></div>
            <div><small>Scheduled reviews</small><b>{uniq(report.round.reviewIds).length}</b><span>{report.round.unanswered} unanswered</span></div>
          </div>

          <div className="report-detail">
            <div>
              <small>{report.reason === "hardcore" ? "RUN-ENDING ERROR" : "MOST COMMON ERROR"}</small>
              <b>{commonError ? errorNames[commonError] : report.round.unanswered ? "Unanswered at the buzzer" : "No errors recorded"}</b>
              <p>{commonError ? "This is the clearest target for deliberate practice." : report.round.unanswered ? "The final objective has been added to the review queue." : "Spacing will test whether this recall holds."}</p>
            </div>
            <div>
              <small>RECOMMENDED NEXT ACTION</small>
              <b>{report.mode === "easy" ? "Keep practising until the command shapes feel familiar" : reportHasVisibleReview ? "Review the needs-review commands below" : reportHasHiddenMisses ? "Start another unassisted run while the error is fresh" : "Repeat after the review interval"}</b>
              <p>{report.mode === "easy" ? "Move to Normal when you can answer without the command shape." : reportHasVisibleReview ? "Incorrect, recovered and unanswered items are scheduled for another unassisted attempt." : reportHasHiddenMisses ? "The answer stays hidden until a full timer expires; another recall attempt protects the learning signal." : "Accuracy is established; let spacing test retention."}</p>
            </div>
          </div>

          {mayRevealAnswers(reportCanReveal) && report.round.missed.length > 0 && (
            <div className="answer-review">
              <div className="answer-review-head"><span>NEEDS REVIEW</span><b>{uniq(report.round.missed).length} objectives</b></div>
              {uniq(report.round.missed).map((id) => {
                const command = catalogue.find((entry) => entry.id === id);
                const reason = report.round.reviewReasons[id];
                return command ? (
                  <article key={id}>
                    <small>{modeNames[command.mode]} · {command.topic}{reason ? ` · ${reviewReasonNames[reason]}` : ""}</small>
                    <h3>{command.objective}</h3>
                    <code>{command.canonical}</code>
                    <p>{command.explanation}</p>
                  </article>
                ) : null;
              })}
            </div>
          )}

          <div className="report-actions">
            <button className="primary" onClick={start}>{report.mode === "easy" ? "Practise again" : `Run ${reportRules?.label ?? "mode"} again`}</button>
            <button className="secondary" onClick={() => setScreen("home")}>Choose another mode</button>
          </div>
        </section>
      )}

      {screen === "manage" && (
        <section className="manage">
          <div className="manage-title">
            <p className="eyebrow">CUSTOM CONTENT</p>
            <h1>Add your own commands.</h1>
            <p>Custom entries are data only. They are never executed. {serverBacked ? "They are stored under the container’s /data volume." : "They are stored in this browser until you use the Docker build."}</p>
          </div>
          <form className="command-form" onSubmit={addCustom}>
            <label>Question or objective<textarea value={customDraft.objective} onChange={(event) => setCustomDraft({ ...customDraft, objective: event.target.value })} maxLength={300} required /></label>
            <label>Correct command<input value={customDraft.canonical} onChange={(event) => setCustomDraft({ ...customDraft, canonical: event.target.value })} maxLength={256} autoComplete="off" required /></label>
            <label>Explanation or memory note<textarea value={customDraft.explanation} onChange={(event) => setCustomDraft({ ...customDraft, explanation: event.target.value })} maxLength={600} required /></label>
            <div className="form-row">
              <label>CLI mode<select value={customDraft.mode} onChange={(event) => setCustomDraft({ ...customDraft, mode: event.target.value as CliMode })}>{Object.entries(modeNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label>Type<select value={customDraft.kind} onChange={(event) => setCustomDraft({ ...customDraft, kind: event.target.value as CommandKind })}><option value="verification">Verification</option><option value="configuration">Configuration</option><option value="navigation">Navigation</option></select></label>
              <label>Difficulty<select value={customDraft.difficulty} onChange={(event) => setCustomDraft({ ...customDraft, difficulty: Number(event.target.value) as 1 | 2 | 3 })}><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
            </div>
            <label>Topic<input value={customDraft.topic} onChange={(event) => setCustomDraft({ ...customDraft, topic: event.target.value })} maxLength={80} /></label>
            <button className="primary" type="submit">Add command</button>
            <p className="custom-status" aria-live="polite">{customStatus}</p>
          </form>
          <div className="custom-list">
            <div className="answer-review-head"><span>YOUR COMMANDS</span><b>{customCommands.length}</b></div>
            {customCommands.length ? customCommands.map((command) => (
              <article key={command.id}>
                <div><small>{modeNames[command.mode]} · {command.topic}</small><h3>{command.objective}</h3><code>{command.canonical}</code></div>
                <button type="button" onClick={() => removeCustom(command.id)}>Delete</button>
              </article>
            )) : <p>No custom commands have been added.</p>}
          </div>
        </section>
      )}

      {screen !== "round" && (
        <footer>
          <span>Independent educational simulator · Not affiliated with or endorsed by Cisco</span>
          <span>IOS XE learning pack v0.1 · Simulator-tested draft</span>
        </footer>
      )}
    </main>
  );
}
