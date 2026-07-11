import type { Command } from "./engine.ts";

export type LabValidationStatus = "pending-licensed-image" | "verified-on-image";
export type DocumentationStatus = "target-assigned" | "syntax-cross-checked";

export interface NamedLabTarget {
  id: string;
  label: string;
  family: "router" | "switch";
  sourceUrl: string;
}

export const namedLabTargets: readonly NamedLabTarget[] = [
  {
    id: "cml-iosv-15.9-3-m9",
    label: "Cisco CML IOSv 15.9(3)M9",
    family: "router",
    sourceUrl: "https://developer.cisco.com/docs/modeling-labs/reference-platforms-and-images/",
  },
  {
    id: "cml-iosvl2-15.2",
    label: "Cisco CML IOSvL2 15.2",
    family: "switch",
    sourceUrl: "https://developer.cisco.com/docs/modeling-labs/iosvl2/",
  },
  {
    id: "cml-cat8000v-17.15.01a",
    label: "Cisco CML Catalyst 8000V IOS XE 17.15.01a",
    family: "router",
    sourceUrl: "https://developer.cisco.com/docs/modeling-labs/reference-platforms-and-images/",
  },
  {
    id: "cml-iol-l2-17.15.01",
    label: "Cisco CML IOL L2 IOS XE 17.15.01",
    family: "switch",
    sourceUrl: "https://developer.cisco.com/docs/modeling-labs/reference-platforms-and-images/",
  },
] as const;

const switchingTopics = new Set([
  "Layer 2 switching",
  "VLANs",
  "Spanning Tree",
  "EtherChannel",
  "Switch security",
]);

const routerTargets = namedLabTargets.filter((target) => target.family === "router").map((target) => target.id);
const switchTargets = namedLabTargets.filter((target) => target.family === "switch").map((target) => target.id);

const documentedScenarioCommands = new Set([
  "nav.enable",
  "nav.configure",
  "nav.interface",
  "interface.ipv4",
  "interface.no-shutdown",
  "nav.end-interface",
  "show.ip-interface-brief",
  "config.save",
]);

export const officialSyntaxSources = {
  scenario:
    "https://www.cisco.com/c/en/us/td/docs/switches/lan/c9000/infra/interface-characteristics/interface-characteristics-configuration-guide.html",
  cli:
    "https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9500/software/release/17-12/command_reference/b_1712_9500_cr.pdf",
  c8000v:
    "https://www.cisco.com/c/en/us/td/docs/routers/C8000V/Release-Notes/c8000v-releasenotes-17-12.html",
} as const;

export interface CommandValidationRecord {
  commandId: string;
  targetIds: readonly string[];
  documentationStatus: DocumentationStatus;
  documentationUrl: string | null;
  labStatus: LabValidationStatus;
  note: string;
}

/**
 * Assigns every built-in command to named legal CML target images. A command is
 * never marked image-verified by source code alone: that requires a captured
 * run on the licensed image and an explicit future manifest change.
 */
export const validationFor = (command: Pick<Command, "id" | "topic">): CommandValidationRecord => {
  const switchCommand = switchingTopics.has(command.topic);
  const documentationChecked = documentedScenarioCommands.has(command.id);
  return {
    commandId: command.id,
    targetIds: switchCommand ? switchTargets : routerTargets,
    documentationStatus: documentationChecked ? "syntax-cross-checked" : "target-assigned",
    documentationUrl: documentationChecked ? officialSyntaxSources.scenario : null,
    labStatus: "pending-licensed-image",
    note: documentationChecked
      ? "Syntax is cross-checked against the named Cisco IOS XE configuration guide; execution on a licensed CML image remains pending."
      : "A named CML target is assigned, but documentation and licensed-image execution are still required before technical-review claims.",
  };
};

export const catalogueValidationSummary = (catalogue: readonly Command[]) => {
  const records = catalogue.filter((command) => !command.custom).map(validationFor);
  return {
    total: records.length,
    targetAssigned: records.filter((record) => record.targetIds.length > 0).length,
    documentationChecked: records.filter((record) => record.documentationStatus === "syntax-cross-checked").length,
    imageVerified: records.filter((record) => record.labStatus === "verified-on-image").length,
  };
};
