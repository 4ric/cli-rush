import {
  buildCommandRegistry,
  grammarTokensForCommand,
  parseRegistryInput,
  profileIdsForCommand,
  productionAvailableInContext,
  type CommandRegistry,
  type CommandProduction,
  type RegistryCommand,
  type RegistryContext,
  type RegistryToken,
} from "./command-registry.ts";
import { getDeviceProfile, type DeviceProfileId } from "./device-profiles.ts";
import { grammarTokenMatches, type CliGrammarToken } from "./cli-grammar.ts";

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

// The supported simulator catalogue is intentionally bounded. IOS-style `?`
// returns the complete current branch rather than silently hiding options.
export const maxVisibleCliOptions = 512;

/**
 * Generate a small set of useful IOS shorthand examples and prove every one
 * against the same registry used by the simulator.  This deliberately avoids
 * hand-written abbreviations drifting away from the parser.
 */
export const parserProvenShorthandExamples = (
  command: RegistryCommand,
  catalogue: readonly RegistryCommand[],
  profileId?: DeviceProfileId,
  maximum = 3,
): string[] => {
  const effectiveProfileId = profileId ?? profileIdsForCommand(command)[0] ?? "router-ios-xe";
  const filtered = catalogue.filter((entry) => entry.id !== command.id);
  const combined = [...filtered, command];
  const registry = buildCommandRegistry(combined, getDeviceProfile(effectiveProfileId), {
    includeSupplemental: usesSimulatorRegistry(combined),
  });
  const grammar = grammarTokensForCommand(command);
  const source = grammar.map((token) => token.source);
  const candidates = new Set<string>();
  const valid = (value: string): boolean => {
    const parsed = parseRegistryInput(registry, value, command.mode as RegistryContext);
    return parsed.status === "valid" && parsed.event.command.id === command.id;
  };
  const add = (values: readonly string[]) => {
    const value = values.join(" ");
    if (lower(value) !== lower(command.canonical) && valid(value)) candidates.add(value);
  };

  for (let tokenAt = 0; tokenAt < grammar.length; tokenAt += 1) {
    const token = grammar[tokenAt];
    if (token.kind !== "keyword" || token.source.length < 2) continue;
    for (let length = 1; length < token.source.length; length += 1) {
      const values = [...source];
      values[tokenAt] = token.source.slice(0, length);
      if (valid(values.join(" "))) {
        add(values);
        break;
      }
    }
  }

  const greedilyShorten = (order: readonly number[]) => {
    const values = [...source];
    for (const tokenAt of order) {
      const token = grammar[tokenAt];
      if (token.kind !== "keyword" || token.source.length < 2) continue;
      for (let length = 1; length < token.source.length; length += 1) {
        const attempt = [...values];
        attempt[tokenAt] = token.source.slice(0, length);
        if (valid(attempt.join(" "))) {
          values[tokenAt] = attempt[tokenAt];
          break;
        }
      }
    }
    add(values);
  };
  const positions = grammar.map((_, index) => index);
  greedilyShorten(positions);
  greedilyShorten([...positions].reverse());

  return [...candidates]
    .sort((left, right) => left.length - right.length || left.localeCompare(right, "en-GB"))
    .slice(0, Math.max(0, Math.min(3, maximum)));
};

const lower = (value: string): string => value.toLocaleLowerCase("en-GB");
const wordsOf = (value: string): string[] => value.trim().split(/\s+/u).filter(Boolean);

const toGrammarToken = (token: RegistryToken): CliGrammarToken => token.kind === "keyword"
  ? { ...token }
  : {
      ...token,
      argumentKind: token.argumentKind,
      caseSensitive: token.caseSensitive,
      rest: token.rest,
    };

const usesSimulatorRegistry = (catalogue: readonly RegistryCommand[]): boolean =>
  catalogue.some((command) => command.id === "nav.enable")
  && catalogue.some((command) => command.id === "nav.configure");

const assistanceRegistryCache = new WeakMap<object, Map<string, CommandRegistry>>();

const cachedRegistry = (
  catalogue: readonly RegistryCommand[],
  profileId?: DeviceProfileId,
): CommandRegistry => {
  const key = profileId ?? "all-profiles";
  let byProfile = assistanceRegistryCache.get(catalogue);
  if (!byProfile) {
    byProfile = new Map();
    assistanceRegistryCache.set(catalogue, byProfile);
  }
  const cached = byProfile.get(key);
  if (cached) return cached;
  const registry = buildCommandRegistry(catalogue, getDeviceProfile(profileId), {
    includeSupplemental: usesSimulatorRegistry(catalogue),
    allProfiles: profileId === undefined,
  });
  byProfile.set(key, registry);
  return registry;
};

const productionsFor = (
  context: RegistryContext,
  catalogue: readonly RegistryCommand[],
  profileId?: DeviceProfileId,
): CommandProduction[] => {
  const registry = cachedRegistry(catalogue, profileId);
  const direct = registry.productions.filter((production) =>
    productionAvailableInContext(registry, production, context));
  if (context === "user" || context === "privileged") return direct;

  // The parser treats `do` as an EXEC escape. Mirror that executable branch in
  // help and Tab so it is discoverable instead of being a hidden special case.
  const doToken: RegistryToken = {
    kind: "keyword",
    source: "do",
    display: "do",
    description: "Run a supported EXEC command without leaving configuration",
  };
  const execEscapes = registry.productions
    .filter((production) => productionAvailableInContext(registry, production, "privileged"))
    .map((production): CommandProduction => ({
      ...production,
      context,
      tokens: [doToken, ...production.tokens],
      signature: `${context}:do/${production.signature}`,
      aliases: [],
    }));
  return [...direct, ...execEscapes];
};

interface WalkResult {
  matched: boolean;
  complete: boolean;
  nextToken?: RegistryToken;
  tokenForLastWord?: RegistryToken;
}

/** Walk words through a production while treating a rest argument as one CLI node. */
const walk = (
  production: CommandProduction,
  words: readonly string[],
): WalkResult => {
  let wordAt = 0;
  let tokenForLastWord: RegistryToken | undefined;
  for (const token of production.tokens) {
    if (wordAt >= words.length) {
      return { matched: true, complete: false, nextToken: token, tokenForLastWord };
    }
    const grammar = toGrammarToken(token);
    if (token.kind === "argument" && token.rest) {
      const rest = words.slice(wordAt).join(" ");
      if (!grammarTokenMatches(grammar, rest)) return { matched: false, complete: false };
      return { matched: true, complete: true, tokenForLastWord: token };
    }
    if (!grammarTokenMatches(grammar, words[wordAt])) return { matched: false, complete: false };
    tokenForLastWord = token;
    wordAt += 1;
  }
  return {
    matched: wordAt === words.length,
    complete: wordAt === words.length,
    tokenForLastWord,
  };
};

const narrowExactKeywords = (
  candidates: readonly CommandProduction[],
  words: readonly string[],
): CommandProduction[] => {
  let narrowed = [...candidates];
  for (let wordAt = 0; wordAt < words.length; wordAt += 1) {
    const exact = narrowed.filter((candidate) => {
      const prefix = walk(candidate, words.slice(0, wordAt + 1));
      const token = prefix.tokenForLastWord;
      return prefix.matched && token?.kind === "keyword" && lower(token.source) === lower(words[wordAt]);
    });
    if (exact.length) narrowed = exact;
  }
  return narrowed;
};

const matchingProductions = (
  candidates: readonly CommandProduction[],
  words: readonly string[],
): CommandProduction[] => narrowExactKeywords(
  candidates.filter((candidate) => walk(candidate, words).matched),
  words,
);

const uniqueKeywords = (
  candidates: readonly CommandProduction[],
  words: readonly string[],
): string[] => {
  const values = new Map<string, string>();
  for (const candidate of candidates) {
    const token = walk(candidate, words).tokenForLastWord;
    if (token?.kind === "keyword" && !values.has(lower(token.source))) {
      values.set(lower(token.source), token.source);
    }
  }
  return [...values.values()].sort((left, right) => left.localeCompare(right, "en-GB"));
};

const commonPrefix = (values: readonly string[]): string => {
  if (!values.length) return "";
  let prefix = values[0];
  for (const value of values.slice(1)) {
    while (prefix && !lower(value).startsWith(lower(prefix))) prefix = prefix.slice(0, -1);
  }
  return prefix;
};

/**
 * Complete only the token immediately before the caret. Earlier abbreviations
 * and spacing are preserved, and argument values are never reconstructed.
 */
export const completeCliInput = (
  raw: string,
  context: RegistryContext,
  catalogue: readonly RegistryCommand[],
  profileId?: DeviceProfileId,
): CliCompletion => {
  const words = wordsOf(raw);
  if (!words.length) {
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

  const candidates = matchingProductions(
    productionsFor(context, catalogue, profileId),
    words,
  );
  if (!candidates.length) {
    return {
      input: raw,
      changed: false,
      assisted: false,
      matchingCommands: 0,
      message: "No command in this CLI context matches that prefix.",
    };
  }

  const current = words.at(-1) ?? "";
  const options = uniqueKeywords(candidates, words);
  const argumentCanMatch = candidates.some((candidate) =>
    walk(candidate, words).tokenForLastWord?.kind === "argument");
  if (!options.length) {
    return {
      input: raw,
      changed: false,
      assisted: false,
      matchingCommands: new Set(candidates.map((candidate) => candidate.command.id)).size,
      message: "Tab does not complete variable values; press ? to view the expected syntax.",
    };
  }
  if (argumentCanMatch) {
    return {
      input: raw,
      changed: false,
      assisted: false,
      matchingCommands: new Set(candidates.map((candidate) => candidate.command.id)).size,
      message: "That text can be a keyword or a variable value; type another character or press ? for options.",
    };
  }

  const completion = options.length === 1 ? options[0] : commonPrefix(options);
  const usefulCompletion = completion.length > current.length && lower(completion).startsWith(lower(current));
  const normalisesCase = options.length === 1 && lower(options[0]) === lower(current) && options[0] !== current;
  const candidateContinues = candidates.some((candidate) => !walk(candidate, words).complete);
  const completionCanEnd = candidates.some((candidate) => walk(candidate, words).complete);
  const addSpace = options.length === 1 && candidateContinues && !completionCanEnd;

  if (!usefulCompletion && !normalisesCase && !addSpace) {
    return {
      input: raw,
      changed: false,
      assisted: false,
      matchingCommands: new Set(candidates.map((candidate) => candidate.command.id)).size,
      message: options.length > 1
        ? "That keyword is still ambiguous; type another character or press ? for options."
        : "No further keyword completion is available.",
    };
  }

  const replacement = options.length === 1 ? options[0] : completion;
  const tokenStart = raw.length - current.length;
  const input = `${raw.slice(0, tokenStart)}${replacement}${addSpace ? " " : ""}`;
  return {
    input,
    changed: input !== raw,
    assisted: input !== raw,
    matchingCommands: new Set(candidates.map((candidate) => candidate.command.id)).size,
    message: "Current keyword completed; earlier text was left unchanged.",
  };
};

const optionDescription = (descriptions: ReadonlySet<string>): string =>
  [...descriptions].sort((left, right) => left.localeCompare(right, "en-GB")).join(" / ");

/** Return the complete executable next-token branch for the current context. */
export const cliHelp = (
  raw: string,
  context: RegistryContext,
  catalogue: readonly RegistryCommand[],
  profileId?: DeviceProfileId,
): CliHelp => {
  const trailingSpace = /\s$/u.test(raw);
  const words = wordsOf(raw);
  const completedWords = trailingSpace ? words : words.slice(0, -1);
  const partial = words.length === 0 || trailingSpace ? "" : words.at(-1) ?? "";
  const candidates = productionsFor(context, catalogue, profileId);
  const pathCandidates = matchingProductions(candidates, completedWords);

  const optionCandidates: Array<{ production: CommandProduction; token: RegistryToken }> = [];
  for (const production of pathCandidates) {
    const state = walk(production, completedWords);
    const token = state.nextToken;
    if (token && (!partial || grammarTokenMatches(toGrammarToken(token), partial))) {
      optionCandidates.push({ production, token });
    }
  }

  const groups = new Map<string, { value: string; descriptions: Set<string> }>();
  for (const { token } of optionCandidates) {
    const key = lower(token.display);
    const group = groups.get(key) ?? { value: token.display, descriptions: new Set<string>() };
    group.descriptions.add(token.description);
    groups.set(key, group);
  }
  const options: CliHelpOption[] = [...groups.values()]
    .sort((left, right) => left.value.localeCompare(right.value, "en-GB"))
    .map((group) => ({ value: group.value, description: optionDescription(group.descriptions) }));

  const returnCandidates = trailingSpace
    ? matchingProductions(candidates, words).filter((candidate) => walk(candidate, words).complete)
    : [];
  if (returnCandidates.length) {
    options.unshift({ value: "<cr>", description: "Submit this syntactically complete command" });
  }

  const visible = options.slice(0, maxVisibleCliOptions);
  const matchingCommands = new Set([
    ...optionCandidates.map(({ production }) => production.command.id),
    ...returnCandidates.map((candidate) => candidate.command.id),
  ]).size;
  return {
    options: visible,
    assisted: visible.length > 0,
    matchingCommands,
    hiddenOptions: Math.max(0, options.length - visible.length),
    message: visible.length > 0
      ? `${options.length} context option${options.length === 1 ? "" : "s"} available.`
      : "No matching options in this CLI context.",
  };
};
