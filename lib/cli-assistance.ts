import {
  commandGrammarTokens,
  grammarTokenMatches,
  type CliGrammarToken,
} from "./cli-grammar.ts";
import type { CliMode, Command } from "./engine.ts";

export interface CliCompletion {
  input: string;
  changed: boolean;
  assisted: boolean;
  matchingCommands: number;
  message: string;
}

export interface CliHelpOption {
  value: string;
  description: string;
}

export interface CliHelp {
  options: CliHelpOption[];
  assisted: boolean;
  matchingCommands: number;
  hiddenOptions: number;
  message: string;
}

export const maxVisibleCliOptions = 24;

interface GrammarCandidate {
  command: Command;
  grammar: CliGrammarToken[];
}

const tokensOf = (value: string): string[] =>
  value.trim().split(/\s+/u).filter(Boolean);

const lower = (value: string): string => value.toLocaleLowerCase("en-GB");

const inMode = (
  mode: CliMode,
  catalogue: readonly Command[],
): GrammarCandidate[] => catalogue
  .filter((command) => command.mode === mode)
  .map((command) => ({ command, grammar: commandGrammarTokens(command) }));

const matchesTypedTokens = (
  grammar: readonly CliGrammarToken[],
  typed: readonly string[],
): boolean => typed.every((token, index) =>
  grammar[index] !== undefined && grammarTokenMatches(grammar[index], token));

const matchingCandidates = (
  candidates: readonly GrammarCandidate[],
  typed: readonly string[],
): GrammarCandidate[] => {
  let matches = candidates.filter((candidate) => matchesTypedTokens(candidate.grammar, typed));
  for (const [index, typedToken] of typed.entries()) {
    const hasExactKeyword = matches.some((candidate) => {
      const grammarToken = candidate.grammar[index];
      return grammarToken?.kind === "keyword"
        && lower(grammarToken.source) === lower(typedToken);
    });
    if (hasExactKeyword) {
      matches = matches.filter((candidate) => {
        const grammarToken = candidate.grammar[index];
        return grammarToken?.kind === "keyword"
          && lower(grammarToken.source) === lower(typedToken);
      });
    }
  }
  return matches;
};

const uniqueKeywordTokensAt = (
  candidates: readonly GrammarCandidate[],
  index: number,
): string[] => {
  const byLowercase = new Map<string, string>();
  for (const candidate of candidates) {
    const token = candidate.grammar[index];
    if (token?.kind === "keyword" && !byLowercase.has(lower(token.source))) {
      byLowercase.set(lower(token.source), token.source);
    }
  }
  return [...byLowercase.values()].sort((left, right) => left.localeCompare(right, "en-GB"));
};

const commonPrefix = (values: readonly string[]): string => {
  if (!values.length) return "";
  let prefix = values[0];
  for (const value of values.slice(1)) {
    while (prefix && !lower(value).startsWith(lower(prefix))) {
      prefix = prefix.slice(0, -1);
    }
  }
  return prefix;
};

/**
 * Completes only the token immediately before the caret at the end of input.
 * Existing abbreviations and spacing are preserved byte-for-byte. Arguments
 * and blank tokens are never guessed from task-specific catalogue values.
 */
export const completeCliInput = (
  raw: string,
  mode: CliMode,
  catalogue: readonly Command[],
): CliCompletion => {
  const typed = tokensOf(raw);
  if (!typed.length) {
    return {
      input: raw,
      changed: false,
      assisted: false,
      matchingCommands: 0,
      message: "Type at least one character before pressing Tab.",
    };
  }
  if (/\s$/u.test(raw)) {
    return {
      input: raw,
      changed: false,
      assisted: false,
      matchingCommands: 0,
      message: "Type the first character of the next keyword, then press Tab.",
    };
  }

  const candidates = matchingCandidates(inMode(mode, catalogue), typed);
  if (!candidates.length) {
    return {
      input: raw,
      changed: false,
      assisted: false,
      matchingCommands: 0,
      message: "No command in this CLI mode matches that prefix.",
    };
  }

  const currentIndex = typed.length - 1;
  const currentToken = typed[currentIndex];
  const options = uniqueKeywordTokensAt(candidates, currentIndex);
  const argumentCanMatch = candidates.some((candidate) =>
    candidate.grammar[currentIndex]?.kind === "argument");
  if (!options.length) {
    return {
      input: raw,
      changed: false,
      assisted: false,
      matchingCommands: candidates.length,
      message: "Tab does not complete variable values; press ? to view the expected syntax.",
    };
  }
  if (argumentCanMatch) {
    return {
      input: raw,
      changed: false,
      assisted: false,
      matchingCommands: candidates.length,
      message: "That text can be a keyword or a variable value; type another character or press ? for options.",
    };
  }

  const completion = options.length === 1 ? options[0] : commonPrefix(options);
  const usefulCompletion = completion.length > currentToken.length
    && lower(completion).startsWith(lower(currentToken));
  const normalisesCase = options.length === 1
    && lower(options[0]) === lower(currentToken)
    && options[0] !== currentToken;
  const candidateContinues = candidates.some((candidate) =>
    candidate.grammar.length > typed.length);
  const completionCanEnd = candidates.some((candidate) =>
    candidate.grammar.length === typed.length);
  const addSpace = options.length === 1 && candidateContinues && !completionCanEnd;

  if (!usefulCompletion && !normalisesCase && !addSpace) {
    return {
      input: raw,
      changed: false,
      assisted: false,
      matchingCommands: candidates.length,
      message: options.length > 1
        ? "That keyword is still ambiguous; type another character or press ? for options."
        : "No further keyword completion is available.",
    };
  }

  const replacement = options.length === 1 ? options[0] : completion;
  const tokenStart = raw.length - currentToken.length;
  const input = `${raw.slice(0, tokenStart)}${replacement}${addSpace ? " " : ""}`;

  return {
    input,
    changed: input !== raw,
    assisted: input !== raw,
    matchingCommands: candidates.length,
    message: "Current keyword completed; earlier text was left unchanged.",
  };
};

const optionDescription = (descriptions: ReadonlySet<string>): string =>
  [...descriptions].sort((left, right) => left.localeCompare(right, "en-GB")).join(" / ");

/** Returns a deterministic, parser-like next-token menu for IOS inline `?` help. */
export const cliHelp = (
  raw: string,
  mode: CliMode,
  catalogue: readonly Command[],
): CliHelp => {
  const hasTrailingSpace = /\s$/u.test(raw);
  const typed = tokensOf(raw);
  const optionIndex = typed.length === 0
    ? 0
    : hasTrailingSpace ? typed.length : typed.length - 1;
  const completedTokens = hasTrailingSpace ? typed : typed.slice(0, -1);
  const partial = typed.length === 0 || hasTrailingSpace ? "" : typed.at(-1) ?? "";

  const pathCandidates = matchingCandidates(inMode(mode, catalogue), completedTokens);
  const optionCandidates = pathCandidates.filter((candidate) => {
    const token = candidate.grammar[optionIndex];
    return token !== undefined && (!partial || grammarTokenMatches(token, partial));
  });

  const groups = new Map<string, {
    value: string;
    descriptions: Set<string>;
  }>();
  for (const candidate of optionCandidates) {
    const token = candidate.grammar[optionIndex];
    const key = lower(token.display);
    const group = groups.get(key) ?? {
      value: token.display,
      descriptions: new Set<string>(),
    };
    group.descriptions.add(token.description);
    groups.set(key, group);
  }

  const options: CliHelpOption[] = [...groups.values()]
    .sort((left, right) => left.value.localeCompare(right.value, "en-GB"))
    .map((group) => ({
      value: group.value,
      description: optionDescription(group.descriptions),
    }));

  const returnCandidates = hasTrailingSpace
    ? matchingCandidates(inMode(mode, catalogue), typed).filter((candidate) =>
      candidate.grammar.length === typed.length)
    : [];
  if (returnCandidates.length > 0) {
    options.unshift({ value: "<cr>", description: "Submit this syntactically complete command" });
  }

  const visible = options.slice(0, maxVisibleCliOptions);
  const hiddenOptions = Math.max(0, options.length - visible.length);
  const assisted = visible.length > 0;
  const matchingCommands = new Set([
    ...optionCandidates.map((candidate) => candidate.command.id),
    ...returnCandidates.map((candidate) => candidate.command.id),
  ]).size;

  return {
    options: visible,
    assisted,
    matchingCommands,
    hiddenOptions,
    message: assisted
      ? `${options.length} context option${options.length === 1 ? "" : "s"} available.`
      : "No matching options in this CLI mode.",
  };
};
