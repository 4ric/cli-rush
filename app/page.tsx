/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
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
  validate,
  validateOperational,
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
  acceptedCommandContext,
  learningHintsFor,
  learningPoints,
  safeCommandContext,
  type AssistanceLevel,
} from "@/lib/learning.ts";
import {
  cliHelp,
  completeCliInput,
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
  classifyRoundRecord,
  failureFeedback,
  mayRevealAnswers,
  shouldRecordTimedOutObjective,
  type RoundRecordClass,
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
  catalogueValidationSummary,
  namedLabTargets,
} from "@/lib/platform-validation.ts";
import {
  createIpv4Scenario,
  getIpv4ScenarioHint,
  getIpv4ScenarioChoices,
  getIpv4ScenarioObjective,
  ipv4ScenarioPrompt,
  restoreIpv4ScenarioState,
  runIpv4ScenarioCommand,
  submitIpv4ScenarioInterpretation,
  type Ipv4ScenarioActionResult,
  type Ipv4ScenarioChoiceId,
  type Ipv4ScenarioState,
} from "@/lib/ipv4-scenario.ts";
import { navigateCommandHistory } from "@/lib/command-history.ts";

type Screen = "home" | "round" | "report" | "manage" | "scenario" | "scenario-report";
type FinishReason = "timer" | "early" | "hardcore" | "practice" | "partial" | "complete";
type ReviewReason = "incorrect" | "recovered" | "unanswered";
type SessionKind = "practice" | "chapter" | "daily" | "rush";

interface CommandProgress {
  attempts: number;
  correct: number;
  firstTry: number;
  lastError: string | null;
  assisted?: number;
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
  reducedMotion: boolean;
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

const storageKey = "cli-rush-progress-v1";
const customStorageKey = "cli-rush-custom-commands-v1";
const scenarioStorageKey = "cli-rush-ipv4-scenario-v1";

const blankProgress = (): Progress => ({
  bestScore: null,
  bestScores: {},
  bestFieldScores: {},
  bestCombo: 0,
  rounds: 0,
  sessions: 0,
  commands: {},
  muted: false,
  reducedMotion: false,
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

const scenarioAssistanceCatalogue = (state: Ipv4ScenarioState): Command[] => {
  const p = state.parameters;
  const entries: Array<[string, CliMode, string]> = [
    ["enable", "user", "enable"],
    ["configure", "privileged", "configure terminal"],
    ["show-interface", "privileged", "show ip interface brief"],
    ["show-route", "privileged", "show ip route"],
    ["ping", "privileged", `ping ${p.remoteTarget}`],
    ["save", "privileged", "copy running-config startup-config"],
    ["interface", "global", `interface ${p.interfaceName}`],
    ["route", "global", `ip route 0.0.0.0 0.0.0.0 ${p.gateway}`],
    ["remove-route", "global", `no ip route 0.0.0.0 0.0.0.0 ${p.gateway}`],
    ["remove-wrong-route", "global", `no ip route 0.0.0.0 0.0.0.0 ${p.wrongGateway}`],
    ["exit-global", "global", "exit"],
    ["end-global", "global", "end"],
    ["address", "interface", `ip address ${p.localAddress} ${p.subnetMask}`],
    ["enable-interface", "interface", "no shutdown"],
    ["disable-interface", "interface", "shutdown"],
    ["remove-address", "interface", "no ip address"],
    ["exit-interface", "interface", "exit"],
    ["end-interface", "interface", "end"],
  ];
  return entries.map(([id, mode, canonical]) => ({
    id: `scenario.${id}`,
    mode,
    canonical,
    objective: "Use the current lab objective and prompt to choose the operation.",
    explanation: "Bounded IPv4 lab command grammar.",
    topic: "IPv4 field lab",
    difficulty: 1,
    kind: canonical.startsWith("show ") || canonical.startsWith("ping ")
      ? "verification"
      : canonical === "enable" || canonical === "exit" || canonical === "end" || canonical.startsWith("configure ") || canonical.startsWith("interface ")
        ? "navigation"
        : "configuration",
  }));
};

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
          {index > 0 && <i aria-hidden="true">→</i>}
          <span className={stage.modes.includes(mode) ? "active" : ""}>
            <small>{stage.label}</small><code>{stage.prompt}</code>
          </span>
        </div>
      ))}
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

export default function GameClient() {
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
  const [scenarioPersistenceReady, setScenarioPersistenceReady] = useState(false);
  const [scenarioSavedAt, setScenarioSavedAt] = useState<number | null>(null);
  const [scenarioHintLevel, setScenarioHintLevel] = useState<0 | 1 | 2>(0);

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
  const roundHadCliAssistance = useRef(false);
  const assistanceRecorded = useRef({ assisted: false, revealed: false });
  const timeChangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerLastTick = useRef<number | null>(null);
  const pausedAt = useRef<number | null>(null);

  const [queue, setQueue] = useState(() => commands.map((command) => command.id));
  const [cursor, setCursor] = useState(0);
  const [device, setDevice] = useState<DeviceState>(initialDevice);
  const [time, setTime] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(-1);
  const [historyDraft, setHistoryDraft] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [advancing, setAdvancing] = useState(false);
  const [presentationAttempt, setPresentationAttempt] = useState(1);
  const [assistance, setAssistance] = useState<AssistanceLevel>(0);
  const [cliAssistanceUsed, setCliAssistanceUsed] = useState(false);
  const [easyComplete, setEasyComplete] = useState(false);
  const [timeChange, setTimeChange] = useState<TimeChange | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());

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
  const scenarioInputRef = useRef<HTMLInputElement>(null);
  const scenarioLogRef = useRef<HTMLDivElement>(null);

  const catalogue = useMemo(
    () => [...commands, ...customCommands],
    [customCommands],
  );
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
  const validationSummary = useMemo(() => catalogueValidationSummary(catalogue), [catalogue]);
  const scenarioChoices = useMemo(() => getIpv4ScenarioChoices(scenario), [scenario]);
  const scenarioCliCatalogue = useMemo(() => scenarioAssistanceCatalogue(scenario), [scenario]);
  const scenarioHint = useMemo(
    () => scenarioHintLevel === 0 ? null : getIpv4ScenarioHint(scenario, scenarioHintLevel),
    [scenario, scenarioHintLevel],
  );
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

    try {
      const scenarioRaw = localStorage.getItem(scenarioStorageKey);
      if (scenarioRaw) {
        const saved = JSON.parse(scenarioRaw) as Partial<SavedScenarioSession>;
        const restored = saved.version === 1 ? restoreIpv4ScenarioState(saved.state) : null;
        if (restored) {
          const restoredLines = Array.isArray(saved.lines)
            ? saved.lines.filter((line): line is string => typeof line === "string").map((line) => line.slice(0, 500)).slice(-120)
            : [];
          const restoredHistory = Array.isArray(saved.history)
            ? saved.history.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.slice(0, 256)).slice(-20)
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
    if (lockInQueued.current.delete(item.id)) {
      roundAttempts.current.delete(item.id);
      reviewBaselines.current.delete(item.id);
      retried.current.delete(item.id);
    }
    setPresentationAttempt((roundAttempts.current.get(item.id) ?? 0) + 1);
    setAssistance(0);
    cliAssisted.current = false;
    assistanceRecorded.current = { assisted: false, revealed: false };
    setCliAssistanceUsed(false);
    setEasyComplete(false);
    setDevice((current) => prepare(current, item));
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
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [screen]);

  useEffect(() => {
    if (screen !== "home" && screen !== "report") return;
    setClockNow(Date.now());
    const id = setInterval(() => setClockNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [screen]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  useEffect(() => {
    scenarioLogRef.current?.scrollTo({ top: scenarioLogRef.current.scrollHeight });
  }, [scenarioLines]);

  useEffect(() => {
    if (!scenarioPersistenceReady || !scenarioSessionAvailable) return;
    const id = setTimeout(() => {
      const savedAt = Date.now();
      const session: SavedScenarioSession = {
        version: 1,
        state: scenario,
        lines: scenarioLines.slice(-120),
        history: scenarioHistory.slice(-20),
        input: scenarioInput.slice(0, 256),
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
    setScenarioHintLevel(0);
  }, [scenario.phase]);

  useEffect(() => {
    if (screen !== "round" || paused || advancing) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      const end = inputRef.current?.value.length ?? 0;
      inputRef.current?.setSelectionRange(end, end);
    });
    return () => cancelAnimationFrame(id);
  }, [advancing, cursor, paused, screen]);

  useEffect(() => {
    if (screen === "scenario" && scenarioChoices.length === 0) {
      setTimeout(() => scenarioInputRef.current?.focus(), 0);
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
          review: clean
            ? reviewForRoundOutcome(id, old?.review, "firstTry", responseMs)
            : correct
              ? old?.review
              : reviewForRoundOutcome(id, old?.review, "failed", responseMs),
        },
      },
    });
  }, [reviewForRoundOutcome, save]);

  const updateAssistedCommand = useCallback((id: string, responseMs?: number) => {
    const current = progressRef.current;
    const old = current.commands[id];
    save({
      ...current,
      commands: {
        ...current.commands,
        [id]: {
          ...old,
          attempts: (old?.attempts ?? 0) + 1,
          correct: (old?.correct ?? 0) + 1,
          firstTry: old?.firstTry ?? 0,
          lastError: null,
          ...(responseMs === undefined ? {} : {
            lastResponseMs: responseMs,
            averageResponseMs: old?.averageResponseMs === undefined
              ? responseMs
              : Math.round(old.averageResponseMs * 0.75 + responseMs * 0.25),
          }),
          review: old?.review,
        },
      },
    });
  }, [save]);

  const recordCommandAssistance = useCallback((
    id: string,
    kind: "assisted" | "revealed",
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
        { limit: Math.min(20, remaining.length) },
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
    setInput("");
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
      { limit: 6 },
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
      { limit: Math.min(10, pool.length) },
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
      "Manual mode navigation · configure · interpret · diagnose · verify · save · roll back",
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
      result.accepted ? "✓ Step accepted" : `% ${result.explanation}`,
    ].slice(-120));
    setScenarioInput("");
  };

  const submitScenarioCommand = (event: FormEvent) => {
    event.preventDefault();
    if (!scenarioInput.trim() || scenarioChoices.length > 0 || scenario.phase === "complete") return;
    const entered = scenarioInput;
    const result = runIpv4ScenarioCommand(scenario, entered);
    setScenarioHistory((values) => [...values, entered.trim()].slice(-20));
    setScenarioHistoryAt(-1);
    setScenarioHistoryDraft("");
    recordScenarioResult(result, `${ipv4ScenarioPrompt(scenario)} ${entered.trim()}`);
  };

  const chooseScenarioInterpretation = (choice: Ipv4ScenarioChoiceId, label: string) => {
    const result = submitIpv4ScenarioInterpretation(scenario, choice);
    recordScenarioResult(result, `[interpretation] ${label}`);
  };

  const focusScenarioInputAtEnd = () => {
    setTimeout(() => {
      const commandInput = scenarioInputRef.current;
      if (!commandInput) return;
      commandInput.focus();
      const end = commandInput.value.length;
      commandInput.setSelectionRange(end, end);
    }, 0);
  };

  const completeScenarioInput = (value = scenarioInput) => {
    const completion = completeCliInput(value, scenario.mode, scenarioCliCatalogue);
    if (completion.changed) setScenarioInput(completion.input);
    setScenarioLines((values) => [
      ...values,
      `% Tab: ${completion.message}`,
    ].slice(-120));
    focusScenarioInputAtEnd();
  };

  const showScenarioCliOptions = (value = scenarioInput) => {
    const result = cliHelp(value, scenario.mode, scenarioCliCatalogue);
    const optionLines = result.options.map((option) =>
      `  ${option.value.padEnd(18)} ${option.description}`);
    if (result.hiddenOptions) optionLines.push(`  … ${result.hiddenOptions} more options`);
    setScenarioLines((values) => [
      ...values,
      `${ipv4ScenarioPrompt(scenario)} ${value}?`,
      ...(optionLines.length ? optionLines : ["  % No matching options"]),
    ].slice(-120));
    focusScenarioInputAtEnd();
  };

  const changeScenarioInput = (value: string) => {
    if (value.endsWith("?")) {
      const withoutQuestionMark = value.slice(0, -1);
      setScenarioInput(withoutQuestionMark);
      showScenarioCliOptions(withoutQuestionMark);
      return;
    }
    setScenarioHistoryAt(-1);
    setScenarioHistoryDraft(value);
    setScenarioInput(value);
  };

  const recallScenarioHistory = (direction: "older" | "newer") => {
    const recalled = navigateCommandHistory(
      scenarioHistory,
      scenarioInput,
      scenarioHistoryAt,
      scenarioHistoryDraft,
      direction,
    );
    setScenarioInput(recalled.value);
    setScenarioHistoryAt(recalled.index);
    setScenarioHistoryDraft(recalled.draft);
    focusScenarioInputAtEnd();
  };

  const scenarioCommandKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      completeScenarioInput(event.currentTarget.value);
      return;
    }
    if (event.key === "?" || event.code === "Slash" && event.shiftKey) {
      event.preventDefault();
      showScenarioCliOptions(event.currentTarget.value);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      recallScenarioHistory("older");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      recallScenarioHistory("newer");
    }
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

  const markCliAssisted = () => {
    recordCommandAssistance(item.id, "assisted");
    cliAssisted.current = true;
    roundHadCliAssistance.current = true;
    setCliAssistanceUsed(true);
  };

  const focusInputAtEnd = () => {
    setTimeout(() => {
      const commandInput = inputRef.current;
      if (!commandInput) return;
      commandInput.focus();
      const end = commandInput.value.length;
      commandInput.setSelectionRange(end, end);
    }, 0);
  };

  const completeCommandInput = (value = input) => {
    const completion = completeCliInput(value, device.mode, catalogue);
    if (completion.assisted) markCliAssisted();
    if (completion.changed) {
      setInput(completion.input);
      setHistoryAt(-1);
    }
    setFeedback({
      tone: "neutral",
      title: completion.changed ? "Tab completion · no penalty" : "No unique completion",
      message: `${completion.message} No score or time-bank adjustment was made.`,
    });
    focusInputAtEnd();
    return completion.changed;
  };

  const showCliOptions = (value = input) => {
    const result = cliHelp(value, device.mode, catalogue);
    if (result.assisted) markCliAssisted();
    const optionLines = result.options.map((option) =>
      `  ${option.value.padEnd(18)} ${option.description}`);
    if (result.hiddenOptions) {
      optionLines.push(`  … ${result.hiddenOptions} more options; type another character to narrow the list.`);
    }
    setLines((values) => [
      ...values,
      `${prompt(device)} ${value}?`,
      ...(optionLines.length ? optionLines : ["  % No matching options"]),
    ].slice(-60));
    setFeedback({
      tone: "neutral",
      title: result.assisted ? "Context help · no penalty" : "No context options",
      message: `${result.message} No score or time-bank adjustment was made; timed clocks continue normally.`,
    });
    focusInputAtEnd();
  };

  const insertClipboardText = (
    clipboardText: string,
    currentValue: string,
    selectionStart: number,
    selectionEnd: number,
  ) => {
    const clean = clipboardText.replace(/\s+/gu, " ").trim();
    if (!clean) return;
    const before = currentValue.slice(0, selectionStart);
    const after = currentValue.slice(selectionEnd);
    const next = `${before}${clean}${after}`.slice(0, 256);
    const caret = Math.min(next.length, before.length + clean.length);
    setInput(next);
    setHistoryAt(-1);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    }, 0);
  };

  const pasteCommand = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const clipboardText = event.clipboardData.getData("text");
    if (clipboardText.trim()) markCliAssisted();
    insertClipboardText(
      clipboardText,
      event.currentTarget.value,
      event.currentTarget.selectionStart ?? event.currentTarget.value.length,
      event.currentTarget.selectionEnd ?? event.currentTarget.value.length,
    );
  };

  const pasteCommandOnRightClick = async (event: ReactMouseEvent<HTMLInputElement>) => {
    event.preventDefault();
    const currentValue = event.currentTarget.value;
    const selectionStart = event.currentTarget.selectionStart ?? currentValue.length;
    const selectionEnd = event.currentTarget.selectionEnd ?? currentValue.length;
    try {
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText.trim()) markCliAssisted();
      insertClipboardText(clipboardText, currentValue, selectionStart, selectionEnd);
      setFeedback({
        tone: "neutral",
        title: "Clipboard pasted",
        message: "Right-click paste is active, matching the usual PuTTY workflow.",
      });
    } catch {
      setFeedback({
        tone: "error",
        title: "Clipboard permission blocked",
        message: "Use Ctrl+V, or allow clipboard access for this local site and right-click again.",
      });
    }
  };

  const insertScenarioClipboardText = (
    clipboardText: string,
    currentValue: string,
    selectionStart: number,
    selectionEnd: number,
  ) => {
    const clean = clipboardText.replace(/\s+/gu, " ").trim();
    if (!clean) return;
    const before = currentValue.slice(0, selectionStart);
    const next = `${before}${clean}${currentValue.slice(selectionEnd)}`.slice(0, 256);
    const caret = Math.min(next.length, before.length + clean.length);
    setScenarioInput(next);
    setTimeout(() => {
      scenarioInputRef.current?.focus();
      scenarioInputRef.current?.setSelectionRange(caret, caret);
    }, 0);
  };

  const pasteScenarioCommand = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    insertScenarioClipboardText(
      event.clipboardData.getData("text"),
      event.currentTarget.value,
      event.currentTarget.selectionStart ?? event.currentTarget.value.length,
      event.currentTarget.selectionEnd ?? event.currentTarget.value.length,
    );
  };

  const pasteScenarioOnRightClick = async (event: ReactMouseEvent<HTMLInputElement>) => {
    event.preventDefault();
    const currentValue = event.currentTarget.value;
    const start = event.currentTarget.selectionStart ?? currentValue.length;
    const end = event.currentTarget.selectionEnd ?? currentValue.length;
    try {
      insertScenarioClipboardText(await navigator.clipboard.readText(), currentValue, start, end);
    } catch {
      setScenarioLesson({
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
    }
  };

  const copySelectionFrom = (container: HTMLDivElement | null) => {
    const selection = window.getSelection();
    const selectedText = selection?.toString() ?? "";
    if (!selectedText.trim() || !selection || !container) return;
    const selectionIsInLog = [selection.anchorNode, selection.focusNode]
      .every((node) => node && container.contains(node));
    if (!selectionIsInLog) return;
    void navigator.clipboard.writeText(selectedText).then(() => {
      setFeedback({
        tone: "neutral",
        title: "Terminal selection copied",
        message: "The selected terminal text is now on the clipboard; paste it with Ctrl+V or right-click.",
      });
    }).catch(() => {});
  };

  const copyTerminalSelection = () => copySelectionFrom(logRef.current);
  const copyScenarioSelection = () => copySelectionFrom(scenarioLogRef.current);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (paused || advancing || time === 0) return;
    let result = validate(input, device.mode, item.id, catalogue);
    if (!result.ok) {
      const operational = validateOperational(input, device.mode, item.id, catalogue);
      if (operational.ok) {
        result = operational;
        markCliAssisted();
      }
    }
    if (!result.input) {
      if (!result.ok) {
        setFeedback({ tone: "error", title: "Nothing entered", message: result.message });
      }
      return;
    }

    submittedForCurrentObjective.current = true;
    const attempt = (roundAttempts.current.get(item.id) ?? 0) + 1;
    const usedCliAssistance = cliAssisted.current;
    roundAttempts.current.set(item.id, attempt);
    const currentPrompt = prompt(device);
    const safeContext = safeCommandContext(item);
    const safeContextLine = `Why: ${safeContext.explanation} Use case: ${safeContext.useCase}`;
    setHistory((values) => [...values, result.input].slice(-20));
    setHistoryAt(-1);
    setHistoryDraft("");

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
          reviewIds: uniq([...roundRef.current.reviewIds, item.id]),
          reviewReasons: {
            ...roundRef.current.reviewReasons,
            [item.id]: "incorrect",
          },
        };
        setRoundBoth(nextRound);
        updatePracticeCommand(item.id, false, code);
        if (assistance === 0) recordCommandAssistance(item.id, "assisted");
        setLines((values) => [
          ...values,
          `${currentPrompt} ${result.input}`,
          `% ${result.message}`,
          safeContextLine,
          "Learning coach opened the semantic structure. Try the same objective again.",
        ].slice(-60));
        setInput("");
        setAssistance((level) => level === 0 ? 1 : level);
        setPresentationAttempt(attempt + 1);
        setFeedback({
          tone: "error",
          title: errorNames[code] ?? "Keep learning",
          message: `${result.message} ${safeContext.explanation} ${safeContext.useCase} Stay on this objective and try again; mastery is unchanged.`,
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
        `${currentPrompt} ${result.input}`,
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
      scheduleAdvance(progressRef.current.reducedMotion ? 250 : 700);
      return;
    }

    const responseMs = Math.max(0, performance.now() - startedAt);
    const simulation = applyCommand(device, item);
    const acceptedContext = acceptedCommandContext(item);
    const acceptedContextLine = `Why: ${acceptedContext.explanation} Use case: ${acceptedContext.useCase}`;

    if (activeMode === "easy") {
      const clean = attempt === 1 && assistance === 0 && !usedCliAssistance;
      const assistedRecall = assistance > 0 || usedCliAssistance;
      const learningStreak = clean ? roundRef.current.combo + 1 : 0;
      const points = learningPoints(item.difficulty, attempt, Math.max(1, learningStreak), assistance);
      const nextRound: Round = {
        ...roundRef.current,
        score: roundRef.current.score + points,
        submissions: roundRef.current.submissions + 1,
        presented: roundRef.current.presented + (attempt === 1 ? 1 : 0),
        resolved: roundRef.current.resolved + 1,
        firstTry: roundRef.current.firstTry + (clean ? 1 : 0),
        recovered: roundRef.current.recovered + (attempt > 1 ? 1 : 0),
        assisted: roundRef.current.assisted + (assistedRecall ? 1 : 0),
        combo: learningStreak,
        bestCombo: Math.max(roundRef.current.bestCombo, learningStreak),
        times: [...roundRef.current.times, responseMs],
        reviewIds: clean
          ? uniq([...roundRef.current.reviewIds, item.id])
          : roundRef.current.reviewIds,
        reviewReasons: attempt > 1
          ? { ...roundRef.current.reviewReasons, [item.id]: "recovered" }
          : roundRef.current.reviewReasons,
      };
      setRoundBoth(nextRound);
      updatePracticeCommand(item.id, true, null, clean, responseMs);
      if (assistedRecall) queueLockIn(item.id);
      setDevice(simulation.state);
      setLines((values) => [
        ...values,
        `${currentPrompt} ${result.input}`,
        ...simulation.output,
        acceptedContextLine,
        points
          ? `✓ +${points} learning points · ${clean ? `${learningStreak}x clean streak · review scheduled` : "operational solve"}`
          : "✓ Reinforcement complete · revealed answer earns no points",
      ].slice(-60));
      setFeedback({
        tone: "success",
        title: clean ? `Recalled independently · +${points}` : points ? `Assisted operational solve · +${points}` : "Command reinforced",
        message: `${acceptedContext.explanation} ${acceptedContext.useCase} ${clean ? "This clean recall now contributes to the spaced-review schedule." : "Assistance is recorded separately and does not advance memory mastery."}`,
      });
      setInput("");
      setEasyComplete(true);
      setAdvancing(true);
      tone(true);
      return;
    }

    const policy = acceptedAttemptPolicy(attempt, roundRef.current.combo, usedCliAssistance);
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
      firstTry: roundRef.current.firstTry + (policy.masteryEligible ? 1 : 0),
      recovered: roundRef.current.recovered + (policy.firstTry ? 0 : 1),
      assisted: roundRef.current.assisted + (usedCliAssistance ? 1 : 0),
      combo: policy.combo,
      bestCombo: Math.max(roundRef.current.bestCombo, policy.combo),
      times: [...roundRef.current.times, responseMs],
      timeGainedMs: roundRef.current.timeGainedMs + timeEffect.timeDeltaMs,
      reviewIds: usedCliAssistance
        ? roundRef.current.reviewIds
        : uniq([...roundRef.current.reviewIds, item.id]),
      reviewReasons: policy.firstTry
        ? roundRef.current.reviewReasons
        : { ...roundRef.current.reviewReasons, [item.id]: "recovered" },
    };
    setRoundBoth(nextRound);
    if (usedCliAssistance) {
      updateAssistedCommand(item.id, responseMs);
      queueLockIn(item.id);
    }
    else updateCommand(item.id, 1, policy.firstTry, null, policy.outcome, responseMs);
    setDevice(simulation.state);
    setTime((value) => value === null ? null : value + timeEffect.timeDeltaMs);
    showTimeChange(timeEffect.timeDeltaMs);
    const award = usedCliAssistance
      ? "CLI-assisted recall · mastery unchanged"
      : policy.firstTry
      ? `${policy.combo}x clean combination`
      : "reduced retry credit";
    setLines((values) => [
      ...values,
      `${currentPrompt} ${result.input}`,
      ...simulation.output,
      acceptedContextLine,
      `✓ +${points} points · +${seconds(timeEffect.timeDeltaMs)}s · ${award}`,
    ].slice(-60));
    setFeedback({
      tone: "success",
      title: policy.firstTry
        ? `Command accepted · +${seconds(timeEffect.timeDeltaMs)}s`
        : `Recovered on retry · +${seconds(timeEffect.timeDeltaMs)}s`,
      message: usedCliAssistance
        ? `${acceptedContext.explanation} ${acceptedContext.useCase} +${points} points with the full time reward; CLI assistance leaves mastery unchanged.`
        : policy.firstTry
        ? `${acceptedContext.explanation} ${acceptedContext.useCase} +${points} points.`
        : `${acceptedContext.explanation} ${acceptedContext.useCase} +${points} reduced retry points; the mastery interval did not advance.`,
    });
    setInput("");
    setAdvancing(true);
    tone(true);
    scheduleAdvance(progressRef.current.reducedMotion ? 250 : 180);
  };

  const commandKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      completeCommandInput(event.currentTarget.value);
      return;
    }
    if (event.key === "?" || event.code === "Slash" && event.shiftKey) {
      event.preventDefault();
      showCliOptions(event.currentTarget.value);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const recalled = navigateCommandHistory(history, input, historyAt, historyDraft, "older");
      if (recalled.index >= 0 && !cliAssisted.current) markCliAssisted();
      setHistoryAt(recalled.index);
      setHistoryDraft(recalled.draft);
      setInput(recalled.value);
      focusInputAtEnd();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const recalled = navigateCommandHistory(history, input, historyAt, historyDraft, "newer");
      if (recalled.index >= 0 && !cliAssisted.current) markCliAssisted();
      setHistoryAt(recalled.index);
      setHistoryDraft(recalled.draft);
      setInput(recalled.value);
      focusInputAtEnd();
    }
  };

  const changeCommandInput = (value: string) => {
    if (value.endsWith("?")) {
      const withoutQuestionMark = value.slice(0, -1);
      setInput(withoutQuestionMark);
      showCliOptions(withoutQuestionMark);
      return;
    }
    setHistoryAt(-1);
    setHistoryDraft(value);
    setInput(value);
  };

  const dueCount = due(reviews, clockNow).length;
  const nextReview = nextDue(reviews);
  const selectedBest = selectedMode === "easy"
    ? null
    : progress.bestScores[selectedMode]
      ?? (selectedMode === "normal" ? progress.bestScore : null);
  const selectedFieldBest = selectedMode === "easy"
    ? null
    : progress.bestFieldScores[selectedMode] ?? null;

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

  return (
    <main className={`shell screen-${screen} ${progress.reducedMotion ? "reduced" : ""}`}>
      <div className="grid-bg" />
      <header>
        <button className="brand brand-link" type="button" onClick={goHome} aria-label="Return to CLI RUSH home">
          <b>CR</b>
          <span><strong>CLI RUSH</strong><small>Network Command Arena</small></span>
        </button>
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
              Start with small prerequisite chapters even if every Cisco command is new.
              Return for due recall, then apply the knowledge in a stateful IPv4 lab.
              Timed modes remain available when the patterns begin to stick.
            </p>
            <dl>
              <div><dt>{selectedMode === "easy" ? "Learning mode" : `${selectedRules.label} clean best`}</dt><dd>{selectedBest ?? "—"}</dd></div>
              <div><dt>{selectedMode === "easy" ? "Best clean streak" : `${selectedRules.label} Field CLI best`}</dt><dd>{selectedMode === "easy" ? progress.bestCombo ? `${progress.bestCombo}x` : "—" : selectedFieldBest ?? "—"}</dd></div>
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
              <span><strong>Recall queue</strong><small>{nextReview ? nextReview <= clockNow ? "Reviews due now" : `Next review in ${Math.ceil((nextReview - clockNow) / 60_000)} min` : "No reviews scheduled"}</small></span>
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

          <section className="learning-dashboard" aria-label="Learning path and practical labs">
            <article className="dashboard-card daily-card">
              <small>DAILY RECALL · ABOUT {Math.max(1, Math.ceil(Math.min(10, dueCount) * 0.35))} MIN</small>
              <h2>{dueCount ? `${dueCount} review${dueCount === 1 ? " is" : "s are"} due` : "Memory is secured for now"}</h2>
              <p>Only commands whose spaced-review time has arrived appear here. Clean recall can lengthen the interval; Tab and question-mark help remain valid field practice without being counted as memory mastery.</p>
              {dueCount > 0
                ? <button className="primary small" onClick={startDailyRecall}>Recall up to {Math.min(10, dueCount)} due commands</button>
                : <span className="dashboard-status">{nextReview ? `Next review in ${Math.max(1, Math.ceil((nextReview - clockNow) / 60_000))} min` : "Complete a clean beginner-path recall to schedule the first review."}</span>}
            </article>

            <article className="dashboard-card curriculum-card">
              <small>BEGINNER PATH · {curriculumStates.filter((state) => state.complete).length}/{curriculumStates.length} CHAPTERS</small>
              <h2>{nextChapterState?.chapter.title ?? "Beginner path complete"}</h2>
              <p>{nextChapterState?.chapter.description ?? "Every prerequisite chapter has independent recall evidence. Use Daily Recall and the field lab to retain and apply it."}</p>
              {nextChapterState && (
                <div className="chapter-progress">
                  <span>{nextChapterState.cleanRecallCount}/{nextChapterState.commandCount} independently recalled</span>
                  <i><b style={{ width: `${nextChapterState.commandCount ? (nextChapterState.cleanRecallCount / nextChapterState.commandCount) * 100 : 0}%` }} /></i>
                </div>
              )}
              <button className="secondary" onClick={() => {
                chooseMode("easy");
                startBeginnerPath();
              }}>{nextChapterState ? `Learn ${nextChapterState.chapter.commandIds.length} commands` : "Run adaptive Easy practice"}</button>
            </article>

            <article className="dashboard-card lab-card">
              <small>STATEFUL IPV4 LAB · NO CLOCK</small>
              <h2>Bring up, diagnose and roll back a branch interface</h2>
              <p>Start at <code>R1&gt;</code>, navigate every mode yourself, configure addressing, interpret interface and route output, repair a seeded reachability fault, save and then verify a complete rollback.</p>
              {scenarioSessionAvailable ? (
                <>
                  <span className="dashboard-status">Saved at step {scenario.acceptedActions} · {scenario.phase === "complete" ? "lab complete" : getIpv4ScenarioObjective(scenario)}</span>
                  <div className="lab-card-actions">
                    <button className="primary small" onClick={resumeIpv4Lab}>{scenario.phase === "complete" ? "View completed lab" : "Resume IPv4 field lab"}</button>
                    <button className="secondary small" onClick={restartIpv4Lab}>Restart lab</button>
                  </div>
                  {scenarioSavedAt && <small className="saved-lab-note">AUTOSAVED LOCALLY</small>}
                </>
              ) : <button className="primary small" onClick={startIpv4Lab}>Start IPv4 field lab</button>}
            </article>

            <article className="dashboard-card validation-card">
              <small>CONTENT TRUST · DERIVED STATUS</small>
              <h2>{validationSummary.documentationChecked}/{validationSummary.total} syntax items cross-checked</h2>
              <p>All {validationSummary.targetAssigned} built-in objectives are assigned to named CML targets. {validationSummary.imageVerified} are currently marked verified on a licensed image, so the pack remains a simulator-tested draft rather than claiming review it has not received.</p>
              <details>
                <summary>Named validation targets</summary>
                <ul>{namedLabTargets.map((target) => <li key={target.id}><a href={target.sourceUrl} target="_blank" rel="noreferrer">{target.label}</a></li>)}</ul>
              </details>
            </article>
          </section>
        </section>
      )}

      {screen === "round" && (
        <section className={`game game-${activeMode}`}>
          <div className="game-top">
            <span>{sessionKind === "daily" ? "DAILY RECALL" : sessionKind === "chapter" ? "BEGINNER PATH" : `${activeRules.label.toUpperCase()} MODE`}<br /><b>SESSION {progress.sessions + 1}</b></span>
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
              {cliAssistanceUsed ? " · CLI HELP USED · NO MASTERY" : ""}
            </p>
            <small>{sessionKind === "daily" ? "DUE RETRIEVAL" : sessionKind === "chapter" ? "CHAPTER OBJECTIVE" : "OPERATIONAL OBJECTIVE"}</small>
            <h1 id="objective-title">{paused ? "Objective hidden while paused" : item.objective}</h1>
          </div>

          {activeMode === "easy" && !paused && (
            <section className={`learning-coach assisted-${assistance}`} aria-label="Learning coach" aria-live="polite">
              <div className="learning-copy">
                <small>LEARNING COACH · CLEAN RECALL ADVANCES SPACING</small>
                <strong>{easyComplete ? "Understand it, verify it, reverse it" : "Build the command from meaning"}</strong>
                <p>{easyComplete ? learningHints.postAnswerMnemonic : learningHints.strategy.text}</p>
                {assistance >= 1 && !easyComplete && (
                  <code ref={learningAidRef} tabIndex={-1} aria-label="Semantic command structure">{learningHints.structure.text}</code>
                )}
                {assistance >= 2 && !easyComplete && (
                  <code ref={learningAidRef} tabIndex={-1} aria-label="Command family hint">{learningHints.family.text}</code>
                )}
                {assistance >= 3 && !easyComplete && (
                  <code ref={learningAidRef} tabIndex={-1} className="revealed" aria-label="Revealed command">{learningHints.reveal.text}</code>
                )}
                {item.topic === "CLI navigation" && <CliModeMap mode={device.mode} />}
                {easyComplete && (
                  <div className="teaching-card">
                    <div><small>WHY IT MATTERS</small><p>{currentTeaching.purpose}</p></div>
                    <div><small>WHEN TO USE IT</small><p>{currentTeaching.whenToUse}</p></div>
                    <div><small>MENTAL MODEL</small><p>{currentTeaching.mentalModel}</p></div>
                    <div><small>WORKED EXAMPLE</small><p>{currentTeaching.workedExample}</p></div>
                    <div><small>SYNTAX</small><code>{currentTeaching.syntax}</code></div>
                    <div><small>EXPECTED</small><p>{currentTeaching.expected}</p></div>
                    <div><small>VERIFY</small><p>{currentTeaching.verify}</p></div>
                    <div><small>COMMON TRAP</small><p>{currentTeaching.commonTrap}</p></div>
                    <div><small>ROLLBACK</small><p>{currentTeaching.rollback}</p></div>
                    <div><small>RISK</small><p>{currentTeaching.risk}</p></div>
                  </div>
                )}
              </div>
              <div className="learning-actions">
                {!easyComplete && assistance === 0 && (
                  <button className="secondary" onClick={() => showAssistance(1)}>Show semantic structure</button>
                )}
                {!easyComplete && assistance === 1 && (
                  <button className="secondary" onClick={() => showAssistance(2)}>Reveal command family</button>
                )}
                {!easyComplete && assistance === 2 && (
                  <button className="secondary" onClick={() => showAssistance(3)}>Reveal command · no points</button>
                )}
                {!easyComplete && (assistance > 0 || cliAssistanceUsed) && <span>Assisted attempt · no mastery</span>}
                {easyComplete && (
                  <button ref={nextEasyButtonRef} className="primary small" onClick={nextEasyObjective}>Next command</button>
                )}
              </div>
            </section>
          )}

          {activeMode !== "easy" && !paused && (
            <section className={`timed-nudge assisted-${assistance}`} aria-label="Timed mode hint" aria-live="polite">
              <div>
                <small>STUCK? · HINTS DO NOT CHANGE THE CLOCK</small>
                <strong>{assistance === 0 ? "Use a progressive nudge without revealing the answer" : assistance === 1 ? "Translate the objective into command structure" : "Use the command family, then supply the task values"}</strong>
                {assistance >= 1 && <code>{learningHints.structure.text}</code>}
                {assistance >= 2 && <code>{learningHints.family.text}</code>}
              </div>
              {assistance === 0
                ? <button className="secondary" onClick={() => showAssistance(1)}>Give me a hint</button>
                : assistance === 1
                  ? <button className="secondary" onClick={() => showAssistance(2)}>Show command family</button>
                  : <span>Assisted Field CLI · clean mastery disabled</span>}
            </section>
          )}

          <div className="terminal">
            <div className="terminal-head">
              <span>● ● ● &nbsp; {device.hostname}{" // "}CONSOLE</span>
              {activeMode === "easy"
                ? sessionKind === "practice"
                  ? <button onClick={() => finish("partial")}>Finish practice</button>
                  : <button onClick={goHome}>{sessionKind === "daily" ? "Back to home" : "Back to learning path"}</button>
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
                <div className="log" ref={logRef} role="log" onMouseUp={copyTerminalSelection} title="Highlight to copy">
                  {lines.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}
                </div>
                <form onSubmit={submit}>
                  <label className="sr" htmlFor="command">Command input for objective: {item.objective}</label>
                  <span>{prompt(device)}</span>
                  <input
                    id="command"
                    aria-describedby="objective-title"
                    aria-keyshortcuts="Tab ? ArrowUp ArrowDown Enter"
                    ref={inputRef}
                    value={input}
                    onChange={(event) => changeCommandInput(event.target.value)}
                    onKeyDown={commandKeys}
                    onPaste={pasteCommand}
                    onContextMenu={(event) => void pasteCommandOnRightClick(event)}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={256}
                    disabled={advancing}
                  />
                  <button className="cli-assist" type="button" onClick={() => completeCommandInput(input)} disabled={advancing} aria-label="Complete command with Tab">Tab</button>
                  <button className="cli-assist" type="button" onClick={() => showCliOptions(input)} disabled={advancing} aria-label="Show context options with question mark">?</button>
                  <button type="submit" disabled={advancing}>Run</button>
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
              ? "Tab/? stay at the prompt · Up/Down recalls commands · Highlight to copy · Right-click or Ctrl+V pastes · Clean unaided recall advances spacing"
              : activeMode === "hardcore"
                ? "Tab/? stay at the prompt · Up/Down recalls commands · Highlight to copy · Right-click or Ctrl+V pastes · One incorrect submission ends the run"
                : "Tab/? stay at the prompt · Up/Down recalls commands · Highlight to copy · Right-click or Ctrl+V pastes · Enter submits"}
          </p>
        </section>
      )}

      {screen === "scenario" && (
        <section className="game field-lab">
          <div className="game-top">
            <span>IPV4 FIELD LAB<br /><b>STATEFUL SCENARIO</b></span>
            <div className="clock"><small>STEPS COMPLETED</small><b>{scenario.acceptedActions}</b></div>
            <div className="metrics">
              <span>CLI MODE<b>{scenario.mode.toUpperCase()}</b></span>
              <span>LAB PHASE<b>{scenario.phase === "complete" ? "DONE" : "ACTIVE"}</b></span>
            </div>
          </div>
          <div className="track untimed" aria-label="Untimed stateful IPv4 lab"><i /></div>

          <div className="objective">
            <p>BRANCH IPV4 · MANUAL MODE NAVIGATION · SEE, DECIDE, CHANGE, VERIFY</p>
            <small>{scenarioChoices.length ? "INTERPRET THE EVIDENCE" : "OPERATIONAL OBJECTIVE"}</small>
            <h1>{getIpv4ScenarioObjective(scenario)}</h1>
            <div className="scenario-ticket" aria-label="Branch change ticket">
              <span>INTERFACE <b>{scenario.parameters.interfaceName}</b></span>
              <span>LAN ADDRESS <b>{scenario.parameters.localAddress}/{scenario.parameters.prefixLength}</b></span>
              <span>GATEWAY <b>{scenario.parameters.gateway}</b></span>
              <span>TEST TARGET <b>{scenario.parameters.remoteTarget}</b></span>
            </div>
            <ScenarioTopology state={scenario} />
          </div>

          {scenario.phase !== "complete" && (
            <section className={`scenario-hint ${scenarioHint ? `focus-${scenarioHint.visualFocus}` : ""}`} aria-live="polite">
              <div>
                <small>FIELD ENGINEER COACH · PROGRESSIVE HELP</small>
                <strong>{scenarioHint?.heading ?? "Stuck on the next step?"}</strong>
                <p>{scenarioHint?.explanation ?? "Start with a reasoning hint. If that is not enough, reveal a worked command using the exact values from this saved work order."}</p>
                {scenarioHint?.example && <code>{ipv4ScenarioPrompt(scenario)} {scenarioHint.example}</code>}
              </div>
              {scenarioHintLevel < 2
                ? <button className="secondary" type="button" onClick={() => setScenarioHintLevel((level) => level === 0 ? 1 : 2)}>{scenarioHintLevel === 0 ? "Give me a hint" : "Show worked command"}</button>
                : <span className="hint-complete">Worked command shown · try it at the prompt</span>}
            </section>
          )}

          <div className="terminal scenario-terminal">
            <div className="terminal-head">
              <span>● ● ● &nbsp; R1 // CONSOLE // ISOLATED SIMULATOR</span>
              <div className="terminal-head-actions">
                <button onClick={restartIpv4Lab}>Restart lab</button>
                <button onClick={goHome}>Leave lab</button>
              </div>
            </div>
            <div
              className="log"
              ref={scenarioLogRef}
              role="log"
              onMouseUp={copyScenarioSelection}
              title="Highlight to copy"
            >
              {scenarioLines.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)}
            </div>
            {scenarioChoices.length ? (
              <div className="scenario-choices" role="group" aria-label="Interpret the displayed evidence">
                {scenarioChoices.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    onClick={() => chooseScenarioInterpretation(choice.id, choice.label)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            ) : scenario.phase === "complete" ? (
              <div className="scenario-complete-action">
                <button className="primary small" onClick={() => setScreen("scenario-report")}>View lab report</button>
              </div>
            ) : (
              <form onSubmit={submitScenarioCommand}>
                <label className="sr" htmlFor="scenario-command">Command for the current IPv4 lab objective</label>
                <span>{ipv4ScenarioPrompt(scenario)}</span>
                <input
                  id="scenario-command"
                  ref={scenarioInputRef}
                  value={scenarioInput}
                  onChange={(event) => changeScenarioInput(event.target.value)}
                  onKeyDown={scenarioCommandKeys}
                  onPaste={pasteScenarioCommand}
                  onContextMenu={(event) => void pasteScenarioOnRightClick(event)}
                  aria-keyshortcuts="Tab ? ArrowUp ArrowDown Enter"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={256}
                />
                <button className="cli-assist" type="button" onClick={() => completeScenarioInput()} aria-label="Complete scenario command with Tab">Tab</button>
                <button className="cli-assist" type="button" onClick={() => showScenarioCliOptions()} aria-label="Show scenario context options with question mark">?</button>
                <button type="submit">Run</button>
              </form>
            )}
          </div>

          {scenarioLesson && (
            <section className={`scenario-lesson ${scenarioLesson.accepted ? "accepted" : "rejected"}`} aria-live="polite">
              <div><small>{scenarioLesson.accepted ? "WHY IT WORKED" : "WHY IT DID NOT WORK"}</small><p>{scenarioLesson.explanation}</p></div>
              <div><small>REAL USE</small><p>{scenarioLesson.useCase}</p></div>
              <div><small>VERIFY</small><p>{scenarioLesson.verification}</p></div>
              <div><small>ROLLBACK</small><p>{scenarioLesson.rollback}</p></div>
              {scenarioLesson.example && <div className="lesson-example"><small>WORKED EXAMPLE</small><code>{scenarioLesson.example}</code></div>}
            </section>
          )}
          <p className="help">Manual prompts · Up/Down recalls commands · Output must be interpreted · Highlight to copy · Right-click or Ctrl+V pastes · Input never leaves the simulator</p>
        </section>
      )}

      {screen === "scenario-report" && (
        <section className="report scenario-report">
          <div className="report-title">
            <p className="eyebrow">IPV4 FIELD LAB COMPLETE</p>
            <h1>You completed the whole change lifecycle.</h1>
            <p>You navigated CLI modes, configured an interface, interpreted operational output, diagnosed a seeded routing fault, repaired and verified reachability, saved the working state, then rolled everything back and verified it again.</p>
          </div>
          <div className="final-score">
            <small>ACCEPTED ACTIONS</small>
            <b>{scenario.acceptedActions}</b>
            <em>STATEFUL LAB</em>
          </div>
          <div className="report-detail">
            <div><small>ADDRESSING PLAN</small><b>{scenario.parameters.interfaceName} · {scenario.parameters.localAddress}/{scenario.parameters.prefixLength}</b><p>Gateway {scenario.parameters.gateway} · remote test target {scenario.parameters.remoteTarget}</p></div>
            <div><small>OPERATIONAL PRACTICE</small><b>Configure → inspect → diagnose → repair → verify → save → roll back</b><p>The final startup snapshot matches the verified rollback state rather than the temporary working configuration.</p></div>
          </div>
          <div className="report-actions">
            <button className="primary" onClick={startIpv4Lab}>Run a new seeded lab</button>
            <button className="secondary" onClick={() => setScreen("home")}>Return home</button>
          </div>
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

          {mayRevealAnswers(reportCanReveal) && report.round.missed.length > 0 && (
            <div className="answer-review">
              <div className="answer-review-head"><span>NEEDS REVIEW</span><b>{uniq(report.round.missed).length} objectives</b></div>
              {uniq(report.round.missed).map((id) => {
                const command = catalogue.find((entry) => entry.id === id);
                const reason = report.round.reviewReasons[id];
                if (!command) return null;
                const teaching = teachingFor(command);
                return (
                  <article key={id}>
                    <small>{modeNames[command.mode]} · {command.topic}{reason ? ` · ${reviewReasonNames[reason]}` : ""}</small>
                    <h3>{command.objective}</h3>
                    <code>{command.canonical}</code>
                    <p><b>Why:</b> {teaching.purpose}</p>
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

      {screen !== "round" && screen !== "scenario" && (
        <footer>
          <span>Independent educational simulator · Not affiliated with or endorsed by Cisco</span>
          <span>IOS XE learning pack v0.1 · Simulator-tested draft</span>
        </footer>
      )}
    </main>
  );
}
