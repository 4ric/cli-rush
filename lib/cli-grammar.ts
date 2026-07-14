import {
  grammarTokensForCommand,
  type RegistryArgumentKind,
  type RegistryCommand,
} from "./command-registry.ts";

export type CliGrammarTokenKind = "keyword" | "argument";

export interface CliGrammarToken {
  /** The catalogue token used by deterministic matching. Never render this for arguments. */
  source: string;
  /** IOS-style text safe to render in context help. */
  display: string;
  description: string;
  kind: CliGrammarTokenKind;
  argumentKind?: RegistryArgumentKind;
  name?: string;
  caseSensitive?: boolean;
  rest?: boolean;
}

const lower = (value: string): string => value.toLocaleLowerCase("en-GB");

/** Compatibility view over the one typed command registry grammar. */
export const commandGrammarTokens = (command: RegistryCommand): CliGrammarToken[] =>
  grammarTokensForCommand(command).flatMap((token) => token.kind === "argument" && token.rest
    ? token.source.split(/\s+/u).map((source) => ({
        source,
        display: token.display,
        description: token.description,
        kind: token.kind,
        argumentKind: token.argumentKind,
        name: token.name,
        caseSensitive: token.caseSensitive,
        rest: true,
      } satisfies CliGrammarToken))
    : [token.kind === "keyword"
    ? {
        source: token.source,
        display: token.display,
        description: token.description,
        kind: token.kind,
      }
    : {
        source: token.source,
        display: token.display,
        description: token.description,
        kind: token.kind,
        argumentKind: token.argumentKind,
        name: token.name,
        caseSensitive: token.caseSensitive,
        rest: token.rest,
      }]);

const isIPv4Shape = (typed: string): boolean => /^[\d.]+$/u.test(typed);

/**
 * A lightweight prefix check for tree traversal. Final argument validation is
 * performed by the registry parser against the selected device profile.
 */
export const grammarTokenMatches = (
  token: CliGrammarToken,
  typed: string,
): boolean => {
  if (!typed) return false;
  if (token.kind === "keyword") return lower(token.source).startsWith(lower(typed));

  switch (token.argumentKind) {
    case "ipv4":
    case "subnet-mask":
    case "wildcard-mask": return isIPv4Shape(typed);
    case "interface": return /^[a-z][\w./:-]*$/iu.test(typed);
    case "interface-range": return /^[a-z][\w./:\s-]*$/iu.test(typed);
    case "vlan":
    case "number": return /^\d+$/u.test(typed);
    case "vlan-list": return /^[\d,-]+$/u.test(typed);
    case "line": return typed.length > 0;
    case "secret":
    case "word": return /^\S+$/u.test(typed);
    default:
      if (token.display === "A.B.C.D") return isIPv4Shape(typed);
      if (token.display.startsWith("X:X::X")) return /^[\da-f:/]+$/iu.test(typed);
      if (token.display === "INTERFACE") return /^[a-z][\w./:-]*$/iu.test(typed);
      if (token.display.startsWith("<")) return /^\d+$/u.test(typed);
      return /^\S+$/u.test(typed);
  }
};
