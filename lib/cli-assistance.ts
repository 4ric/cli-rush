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

const tokensOf = (value: string): string[] =>
  value.trim().split(/\s+/u).filter(Boolean);

const lower = (value: string): string => value.toLocaleLowerCase("en-GB");

const commandTokens = (command: Command): string[] => tokensOf(command.canonical);

const inMode = (
  mode: CliMode,
  catalogue: readonly Command[],
): Command[] => catalogue.filter((command) => command.mode === mode);

const matchesTypedTokens = (
  canonical: readonly string[],
  typed: readonly string[],
): boolean => typed.every((token, index) =>
  canonical[index] !== undefined && lower(canonical[index]).startsWith(lower(token)));

const uniqueTokensAt = (
  candidates: readonly Command[],
  index: number,
): string[] => {
  const byLowercase = new Map<string, string>();
  for (const command of candidates) {
    const token = commandTokens(command)[index];
    if (token !== undefined && !byLowercase.has(lower(token))) {
      byLowercase.set(lower(token), token);
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
 * Completes only prefixes supported by commands in the current simulated CLI
 * mode. Blank tokens are never guessed, so Tab cannot disclose an entire
 * command without the player supplying at least one character per keyword.
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

  const candidates = inMode(mode, catalogue)
    .filter((command) => matchesTypedTokens(commandTokens(command), typed));
  if (!candidates.length) {
    return {
      input: raw,
      changed: false,
      assisted: false,
      matchingCommands: 0,
      message: "No command in this CLI mode matches that prefix.",
    };
  }

  let changed = false;
  let lastTokenWasUnique = false;
  const completed = typed.map((token, index) => {
    const options = uniqueTokensAt(candidates, index);
    const completion = options.length === 1 ? options[0] : commonPrefix(options);
    const usefulCompletion = completion.length > token.length
      && lower(completion).startsWith(lower(token));
    const exactUniqueToken = options.length === 1 && lower(options[0]) === lower(token);
    if (index === typed.length - 1) lastTokenWasUnique = options.length === 1;
    if (usefulCompletion || exactUniqueToken && options[0] !== token) {
      changed = true;
      return options.length === 1 ? options[0] : completion;
    }
    return token;
  });

  const candidateContinues = candidates.some((command) =>
    commandTokens(command).length > typed.length);
  const completionIsCommand = candidates.some((command) =>
    lower(command.canonical) === lower(completed.join(" ")));
  const addSpace = lastTokenWasUnique && candidateContinues && !completionIsCommand;
  const input = `${completed.join(" ")}${addSpace ? " " : ""}`;
  changed ||= input !== raw;

  return {
    input: changed ? input : raw,
    changed,
    assisted: changed,
    matchingCommands: candidates.length,
    message: changed
      ? "Unique command text completed."
      : "That prefix is still ambiguous; type another character or press ? for options.",
  };
};

const descriptionFor = (commands: readonly Command[]): string => {
  if (commands.length === 1) return commands[0].objective;
  const topics = [...new Set(commands.map((command) => command.topic))]
    .sort((left, right) => left.localeCompare(right, "en-GB"));
  const topicSummary = topics.slice(0, 2).join(" · ");
  const remainder = topics.length > 2 ? ` +${topics.length - 2} topics` : "";
  return `${topicSummary}${remainder} · ${commands.length} matching commands`;
};

/** Returns the deterministic next-token menu for IOS-style inline `?` help. */
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
  const candidates = inMode(mode, catalogue).filter((command) => {
    const canonical = commandTokens(command);
    return matchesTypedTokens(canonical, completedTokens)
      && canonical[optionIndex] !== undefined
      && lower(canonical[optionIndex]).startsWith(lower(partial));
  });

  const groups = new Map<string, { value: string; commands: Command[] }>();
  for (const command of candidates) {
    const value = commandTokens(command)[optionIndex];
    const key = lower(value);
    const group = groups.get(key) ?? { value, commands: [] };
    group.commands.push(command);
    groups.set(key, group);
  }

  const options: CliHelpOption[] = [...groups.values()]
    .sort((left, right) => left.value.localeCompare(right.value, "en-GB"))
    .map((group) => ({
      value: group.value,
      description: descriptionFor(group.commands),
    }));

  const normalised = typed.join(" ");
  const acceptsReturn = hasTrailingSpace && inMode(mode, catalogue).some((command) =>
    lower(command.canonical) === lower(normalised));
  if (acceptsReturn) {
    options.unshift({ value: "<cr>", description: "Submit this complete command" });
  }

  const visible = options.slice(0, maxVisibleCliOptions);
  const hiddenOptions = Math.max(0, options.length - visible.length);
  const assisted = visible.length > 0;

  return {
    options: visible,
    assisted,
    matchingCommands: candidates.length,
    hiddenOptions,
    message: assisted
      ? `${options.length} context option${options.length === 1 ? "" : "s"} available.`
      : "No matching options in this CLI mode.",
  };
};
