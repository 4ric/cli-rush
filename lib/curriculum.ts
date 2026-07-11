import type { Command } from "./engine.ts";
import type { Review } from "./scheduler.ts";

export type CurriculumStageId =
  | "cli-navigation"
  | "verification"
  | "interfaces-ipv4"
  | "vlans"
  | "routing"
  | "access-control"
  | "dhcp"
  | "nat";

export interface CurriculumChapter {
  id: string;
  stageId: CurriculumStageId;
  title: string;
  description: string;
  sequence: number;
  prerequisiteIds: string[];
  commandIds: string[];
}

export interface BeginnerCurriculum {
  chapters: CurriculumChapter[];
  includedCommandIds: string[];
  /** Built-in or custom library material deliberately left outside this path. */
  libraryCommandIds: string[];
}

export interface CurriculumChapterState {
  chapter: CurriculumChapter;
  complete: boolean;
  unlocked: boolean;
  cleanRecallCount: number;
  commandCount: number;
}

interface StageDefinition {
  id: CurriculumStageId;
  title: string;
  description: string;
  includes: (command: Command) => boolean;
}

const ipv6Signal = /ipv6|[0-9a-f]{0,4}:[0-9a-f:]+/iu;
const isIpv6 = (command: Command): boolean =>
  ipv6Signal.test(`${command.canonical} ${command.objective} ${command.topic}`);

const topicIs = (command: Command, ...topics: string[]): boolean =>
  topics.includes(command.topic);

const foundationalNavigation = new Set([
  "enable",
  "disable",
  "configure terminal",
  "exit",
  "end",
  "logout",
]);

/** Ordered teaching bands. Command counts are always derived from the catalogue. */
export const beginnerStages: readonly Omit<StageDefinition, "includes">[] = [
  {
    id: "cli-navigation",
    title: "CLI navigation",
    description: "Read the prompt and move safely between the foundational IOS XE command contexts.",
  },
  {
    id: "verification",
    title: "Verification foundations",
    description: "Inspect device, software and configuration state before making a change.",
  },
  {
    id: "interfaces-ipv4",
    title: "Interfaces and IPv4",
    description: "Configure, enable and verify an IPv4 interface, then test reachability.",
  },
  {
    id: "vlans",
    title: "VLANs and switching",
    description: "Build access and trunk VLAN configuration and verify the Layer 2 result.",
  },
  {
    id: "routing",
    title: "IPv4 routing",
    description: "Read the routing table, configure routes and build foundational OSPF recall.",
  },
  {
    id: "access-control",
    title: "IPv4 access control",
    description: "Create, apply and verify IPv4 access-control rules in the correct context.",
  },
  {
    id: "dhcp",
    title: "IPv4 DHCP",
    description: "Build and verify a DHCP pool, exclusions and client-facing options.",
  },
  {
    id: "nat",
    title: "IPv4 NAT",
    description: "Assign NAT roles, configure translations and verify the resulting state.",
  },
];

const stageDefinitions: readonly StageDefinition[] = [
  {
    ...beginnerStages[0],
    includes: (command) =>
      topicIs(command, "CLI navigation")
      && ["user", "privileged", "global"].includes(command.mode)
      && foundationalNavigation.has(command.canonical.toLocaleLowerCase("en-GB")),
  },
  {
    ...beginnerStages[1],
    includes: (command) =>
      command.kind === "verification"
      && topicIs(
        command,
        "CLI and system",
        "Device verification",
        "Configuration management",
      ),
  },
  {
    ...beginnerStages[2],
    includes: (command) => !isIpv6(command) && (
      topicIs(
        command,
        "Interface configuration",
        "Interface verification",
        "Connectivity",
        "Neighbour discovery",
      )
      || (command.mode === "global" && /^interface\s/iu.test(command.canonical))
      || (command.mode === "interface" && /^(?:exit|end)$/iu.test(command.canonical))
    ),
  },
  {
    ...beginnerStages[3],
    includes: (command) =>
      topicIs(command, "VLANs", "Layer 2 switching")
      || command.mode === "vlan",
  },
  {
    ...beginnerStages[4],
    includes: (command) => !isIpv6(command) && (
      topicIs(command, "Routing", "OSPF")
      || command.mode === "router"
    ),
  },
  {
    ...beginnerStages[5],
    includes: (command) => !isIpv6(command) && (
      topicIs(command, "Access control")
      || command.mode === "acl"
    ),
  },
  {
    ...beginnerStages[6],
    includes: (command) => topicIs(command, "DHCP") || command.mode === "dhcp",
  },
  {
    ...beginnerStages[7],
    includes: (command) => topicIs(command, "NAT"),
  },
];

const modeOrder: Readonly<Record<Command["mode"], number>> = {
  user: 0,
  privileged: 1,
  global: 2,
  interface: 3,
  vlan: 4,
  router: 5,
  acl: 6,
  dhcp: 7,
  line: 8,
};

const kindOrder: Readonly<Record<Command["kind"], number>> = {
  navigation: 0,
  verification: 1,
  configuration: 2,
};

const compareCommands = (left: Command, right: Command): number =>
  left.difficulty - right.difficulty
  || modeOrder[left.mode] - modeOrder[right.mode]
  || kindOrder[left.kind] - kindOrder[right.kind]
  || left.canonical.localeCompare(right.canonical, "en-GB")
  || left.id.localeCompare(right.id);

const chunks = <T>(values: readonly T[], size: number): T[][] => {
  if (!values.length) return [];
  const chunkCount = Math.ceil(values.length / size);
  const baseSize = Math.floor(values.length / chunkCount);
  const largerChunks = values.length % chunkCount;
  const result: T[][] = [];
  let at = 0;
  for (let index = 0; index < chunkCount; index += 1) {
    const chunkSize = baseSize + (index < largerChunks ? 1 : 0);
    result.push(values.slice(at, at + chunkSize));
    at += chunkSize;
  }
  return result;
};

/**
 * Creates a linear beginner path from catalogue metadata. The path deliberately
 * exposes small chapters instead of the whole command library at once.
 */
export const buildBeginnerCurriculum = (
  catalogue: readonly Command[],
  maxChapterSize = 6,
): BeginnerCurriculum => {
  const chapterSize = Math.max(1, Math.floor(maxChapterSize));
  const assigned = new Set<string>();
  const chapters: CurriculumChapter[] = [];
  let prerequisiteId: string | null = null;

  for (const stage of stageDefinitions) {
    const stageCommands = catalogue
      .filter((command) => !assigned.has(command.id) && stage.includes(command))
      .sort(compareCommands);
    for (const command of stageCommands) assigned.add(command.id);

    const stageChunks = chunks(stageCommands, chapterSize);
    for (let index = 0; index < stageChunks.length; index += 1) {
      const id = `${stage.id}-${index + 1}`;
      const chapter: CurriculumChapter = {
        id,
        stageId: stage.id,
        title: stageChunks.length === 1 ? stage.title : `${stage.title} ${index + 1}`,
        description: stage.description,
        sequence: chapters.length,
        prerequisiteIds: prerequisiteId ? [prerequisiteId] : [],
        commandIds: stageChunks[index].map((command) => command.id),
      };
      chapters.push(chapter);
      prerequisiteId = id;
    }
  }

  return {
    chapters,
    includedCommandIds: chapters.flatMap((chapter) => chapter.commandIds),
    libraryCommandIds: catalogue
      .filter((command) => !assigned.has(command.id))
      .map((command) => command.id),
  };
};

const hasCleanEvidence = (review: Review | undefined): boolean =>
  Boolean(review && (
    (review.cleanRecalls ?? 0) > 0
    // Compatibility with reviews persisted before cleanRecalls was introduced.
    || review.outcome === "firstTry"
    || review.bestStage > 0
  ));

/** Derives chapter locks and completion from clean recall evidence only. */
export const curriculumProgress = (
  curriculum: BeginnerCurriculum,
  reviews: Readonly<Record<string, Review>>,
): CurriculumChapterState[] => {
  const completeIds = new Set<string>();
  return curriculum.chapters.map((chapter) => {
    const cleanRecallCount = chapter.commandIds
      .filter((id) => hasCleanEvidence(reviews[id]))
      .length;
    const unlocked = chapter.prerequisiteIds.every((id) => completeIds.has(id));
    const complete = unlocked
      && chapter.commandIds.length > 0
      && cleanRecallCount === chapter.commandIds.length;
    if (complete) completeIds.add(chapter.id);
    return {
      chapter,
      complete,
      unlocked,
      cleanRecallCount,
      commandCount: chapter.commandIds.length,
    };
  });
};

export const nextCurriculumChapter = (
  curriculum: BeginnerCurriculum,
  reviews: Readonly<Record<string, Review>>,
): CurriculumChapterState | null =>
  curriculumProgress(curriculum, reviews)
    .find((state) => state.unlocked && !state.complete) ?? null;
