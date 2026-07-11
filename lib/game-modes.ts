export type GameModeId = "easy" | "normal" | "hard" | "hardcore";
export type WrongPenaltyTier = 1 | 2 | 3;

export interface GameModeRules {
  id: GameModeId;
  label: string;
  description: string;
  initialTimeMs: number | null;
  wrongPenaltiesMs: readonly [number, number, number];
  correctBonusMs: number;
  comboBonusMs: number | null;
  comboThreshold: number | null;
  wrongEndsRound: boolean;
}

export interface GameModeEffect {
  timeDeltaMs: number;
  terminalFailure: boolean;
  nextConsecutiveWrong: number;
}

const seconds = (value: number): number => value * 1_000;

export const gameModes: Readonly<Record<GameModeId, GameModeRules>> = {
  easy: {
    id: "easy",
    label: "Easy",
    description: "Untimed recall practice with no clock pressure.",
    initialTimeMs: null,
    wrongPenaltiesMs: [0, 0, 0],
    correctBonusMs: 0,
    comboBonusMs: null,
    comboThreshold: null,
    wrongEndsRound: false,
  },
  normal: {
    id: "normal",
    label: "Normal",
    description: "Clean recall adds time; consecutive errors cost up to five seconds.",
    initialTimeMs: seconds(60),
    wrongPenaltiesMs: [seconds(1), seconds(3), seconds(5)],
    correctBonusMs: seconds(3),
    comboBonusMs: seconds(5),
    comboThreshold: 3,
    wrongEndsRound: false,
  },
  hard: {
    id: "hard",
    label: "Hard",
    description: "Every correct answer adds time; consecutive errors cost up to fifteen seconds.",
    initialTimeMs: seconds(60),
    wrongPenaltiesMs: [seconds(5), seconds(10), seconds(15)],
    correctBonusMs: seconds(3),
    comboBonusMs: null,
    comboThreshold: null,
    wrongEndsRound: false,
  },
  hardcore: {
    id: "hardcore",
    label: "Hardcore",
    description: "One wrong answer ends the round; correct answers add two seconds.",
    initialTimeMs: seconds(60),
    wrongPenaltiesMs: [0, 0, 0],
    correctBonusMs: seconds(2),
    comboBonusMs: null,
    comboThreshold: null,
    wrongEndsRound: true,
  },
};

export const gameModeById = (mode: GameModeId): GameModeRules => gameModes[mode];

export const initialTimeMs = (mode: GameModeId): number | null => gameModeById(mode).initialTimeMs;

export const nextConsecutiveWrong = (previous: number): WrongPenaltyTier =>
  previous >= 2 ? 3 : previous >= 1 ? 2 : 1;

export const wrongAnswerEffect = (mode: GameModeId, previousConsecutiveWrong: number): GameModeEffect => {
  const rules = gameModeById(mode);
  const nextWrong = nextConsecutiveWrong(previousConsecutiveWrong);
  const penalty = rules.wrongPenaltiesMs[nextWrong - 1];

  return {
    timeDeltaMs: penalty === 0 ? 0 : -penalty,
    terminalFailure: rules.wrongEndsRound,
    nextConsecutiveWrong: nextWrong,
  };
};

export const correctAnswerEffect = (mode: GameModeId, cleanComboAfterAnswer: number): GameModeEffect => {
  const rules = gameModeById(mode);
  const earnsComboBonus =
    rules.comboBonusMs !== null &&
    rules.comboThreshold !== null &&
    cleanComboAfterAnswer >= rules.comboThreshold;

  return {
    timeDeltaMs: earnsComboBonus ? (rules.comboBonusMs ?? rules.correctBonusMs) : rules.correctBonusMs,
    terminalFailure: false,
    nextConsecutiveWrong: 0,
  };
};
