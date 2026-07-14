import type { CliControlKey, CliMode } from "./engine.ts";

export interface GoodToKnowLesson {
  id: string;
  title: string;
  summary: string;
  task: string;
  mode: CliMode;
  command: string;
  why: string;
  verification: string;
  recovery: string;
  destructive: boolean;
  /** Simulator-only preparation, executed through the shared command engine. */
  fixture?: readonly string[];
  control?: Extract<CliControlKey, "Ctrl+C" | "Ctrl+Z">;
  initialDraft?: string;
  confirmation?: "accept-default" | "confirm" | "decline";
  acknowledgement?: string;
}

export interface GoodToKnowDistinction {
  id: string;
  title: string;
  detail: string;
}

export const goodToKnowDistinctions: readonly GoodToKnowDistinction[] = [
  {
    id: "running-startup",
    title: "Running is live; startup is saved",
    detail: "Running configuration affects the device now. Startup configuration is the saved state loaded at boot. Inspecting or saving one does not prove it is correct.",
  },
  {
    id: "targeted-broad",
    title: "Exact no is targeted; default interface is broad",
    detail: "The no form removes one matching statement. Defaulting an interface can remove several settings, so inspect the whole interface and protect your recovery path first.",
  },
  {
    id: "exit-end",
    title: "Exit is one level; end returns to EXEC",
    detail: "Neither exit nor end saves or undoes configuration. They only change the current CLI context.",
  },
  {
    id: "cancel-controls",
    title: "Ctrl+C abandons; Ctrl+Z may execute",
    detail: "On the declared training profile, Ctrl+C abandons the unfinished line and ends configuration. Ctrl+Z may execute a valid draft before returning to Privileged EXEC.",
  },
  {
    id: "merge-replace",
    title: "Copy merges; configure replace replaces",
    detail: "Copying startup into running merges saved statements and can leave unrelated unsaved lines behind. Configure replace is a broader supported-platform operation and receives a simulator recovery checkpoint.",
  },
  {
    id: "reload",
    title: "Reload is disruption, not an undo button",
    detail: "Reload interrupts forwarding and remote access. Declining to save may discard unsaved changes, but a bad startup configuration can still return after boot.",
  },
];

/**
 * Ordered hands-on activities for the local IOS XE training-router profile.
 * Answers are intentionally data, not rendered until the learner asks to
 * reveal them. Fixture commands pass through the same deterministic parser.
 */
export const goodToKnowLessons: readonly GoodToKnowLesson[] = [
  {
    id: "inspect-running",
    title: "Inspect what is active",
    summary: "Running configuration is the state affecting the virtual router now.",
    task: "Display the complete active configuration.",
    mode: "privileged",
    command: "show running-config",
    why: "This is the source of truth for current simulated behaviour, including changes that have not yet been saved for a restart.",
    verification: "Find the baseline interface description in the running output.",
    recovery: "This is read-only, so no recovery action is required.",
    destructive: false,
  },
  {
    id: "inspect-startup",
    title: "Inspect what will load",
    summary: "Startup configuration is the saved boot-time state.",
    task: "Display the saved startup configuration.",
    mode: "privileged",
    command: "show startup-config",
    why: "Reading the saved state separately prevents the common mistake of assuming an active change will survive a restart.",
    verification: "Confirm the same baseline description exists in startup output.",
    recovery: "This is read-only, so no recovery action is required.",
    destructive: false,
  },
  {
    id: "compare-running-startup",
    title: "Compare live and saved state",
    summary: "A clean comparison means the two snapshots match; it does not certify the design.",
    task: "Compare startup and running configurations for differences.",
    mode: "privileged",
    command: "show archive config differences nvram:startup-config system:running-config",
    why: "A difference identifies active unsaved work or a saved statement no longer present in running configuration without changing either copy.",
    verification: "The baseline fixture should report that running and startup configurations match.",
    recovery: "This is read-only, so no recovery action is required.",
    destructive: false,
  },
  {
    id: "make-unsaved-description",
    title: "Make a harmless unsaved change",
    summary: "The simulator has opened the training interface for this one-line change.",
    task: "Set the temporary description supplied in the work note.",
    mode: "interface",
    command: "description UNSAVED LAB NOTE",
    fixture: ["configure terminal", "interface GigabitEthernet0/0/1"],
    why: "A description changes operational documentation immediately but does not change packet forwarding, making the running/startup boundary safe to observe.",
    verification: "A later configuration comparison should show the description only on the running side.",
    recovery: "Remove exactly this interface statement with its no form.",
    destructive: false,
  },
  {
    id: "undo-description",
    title: "Undo only the intended line",
    summary: "A targeted no form leaves the interface address and administrative state alone.",
    task: "Remove only the temporary interface description.",
    mode: "interface",
    command: "no description",
    why: "Exact negation is safer than resetting the interface because it limits the change to the description in the current interface context.",
    verification: "The interface remains selected and only its description returns to empty.",
    recovery: "Reapply the intended description if the removal was accidental.",
    destructive: false,
  },
  {
    id: "make-verified-change",
    title: "Create the change you intend to keep",
    summary: "Make one known change, then inspect it before saving.",
    task: "Set the verified training-link description from the work note.",
    mode: "interface",
    command: "description VERIFIED TRAINING LINK",
    why: "Separating the intended statement from the earlier disposable note makes the verification and save decision explicit.",
    verification: "The interface description should contain VERIFIED TRAINING LINK and no temporary note.",
    recovery: "Use no description if this line is not the approved description.",
    destructive: false,
  },
  {
    id: "verify-change",
    title: "Verify before saving",
    summary: "Saving preserves mistakes too, so inspect the affected state first.",
    task: "Display the interface description summary.",
    mode: "privileged",
    command: "show interfaces description",
    fixture: ["end"],
    why: "A focused read-only check confirms the intended description is active before the complete running configuration is copied to startup storage.",
    verification: "GigabitEthernet0/0/1 should show VERIFIED TRAINING LINK.",
    recovery: "Return to the interface and correct the line before saving if the evidence is wrong.",
    destructive: false,
  },
  {
    id: "save-verified-change",
    title: "Save the verified running state",
    summary: "The clearest save form has an interactive destination prompt.",
    task: "Copy the active configuration into startup storage.",
    mode: "privileged",
    command: "copy running-config startup-config",
    confirmation: "accept-default",
    why: "Only after the default destination is accepted does the simulator update its startup snapshot; issuing the copy line alone is not a completed save.",
    verification: "Press Enter at the destination prompt, look for [OK], then compare running and startup state again.",
    recovery: "Correct running configuration, verify it and save again if the wrong state was copied.",
    destructive: false,
  },
  {
    id: "save-alternative",
    title: "Recognise a common save alternative",
    summary: "The simulator accepts write memory, write and an unambiguous wr.",
    task: "Save again using the common write-style alternative.",
    mode: "privileged",
    command: "write memory",
    why: "Operators often use write memory or its legal abbreviations, while the explicit copy form makes source and destination easiest to reason about.",
    verification: "The simulator should print Building configuration and [OK].",
    recovery: "A save is not an undo; correct and verify running state, then save the corrected snapshot.",
    destructive: false,
  },
  {
    id: "exit-one-context",
    title: "Move back one context",
    summary: "The fixture has opened interface configuration beneath global configuration.",
    task: "Return exactly one configuration level.",
    mode: "interface",
    command: "exit",
    fixture: ["configure terminal", "interface GigabitEthernet0/0/1"],
    why: "Exit changes only the prompt hierarchy: from interface configuration it returns to global configuration without saving or undoing anything.",
    verification: "The prompt should change from R1(config-if)# to R1(config)#.",
    recovery: "Re-enter the interface if you left the context too soon.",
    destructive: false,
  },
  {
    id: "end-to-exec",
    title: "Return directly to Privileged EXEC",
    summary: "The fixture has reopened interface configuration.",
    task: "Leave all configuration contexts in one command.",
    mode: "interface",
    command: "end",
    fixture: ["interface GigabitEthernet0/0/1"],
    why: "End returns directly to Privileged EXEC regardless of configuration depth; it still does not save or reverse configuration.",
    verification: "The prompt should become R1# rather than R1(config)#.",
    recovery: "Use configure terminal to resume configuration work.",
    destructive: false,
  },
  {
    id: "cancel-with-control-c",
    title: "Abandon an unfinished line",
    summary: "An incomplete hostname draft is already on the input line.",
    task: "Use the safer control key to abandon the draft and end configuration.",
    mode: "global",
    command: "Ctrl+C",
    control: "Ctrl+C",
    initialDraft: "hostname",
    fixture: ["configure terminal"],
    why: "Ctrl+C does not execute the unfinished draft. On this declared profile it also ends configuration and returns to Privileged EXEC.",
    verification: "The hostname remains R1 and the prompt becomes R1#.",
    recovery: "Re-enter configuration if cancellation was accidental; there is no command to undo because the draft never ran.",
    destructive: false,
  },
  {
    id: "leave-with-control-z",
    title: "See why Ctrl+Z is different",
    summary: "A valid hostname draft is already on the input line.",
    task: "Use the control key that may execute a valid draft before leaving.",
    mode: "global",
    command: "Ctrl+Z",
    control: "Ctrl+Z",
    initialDraft: "hostname Z-DRAFT-RAN",
    fixture: ["configure terminal"],
    why: "The declared IOS XE behaviour may execute valid text already on the line before Ctrl+Z returns to Privileged EXEC, unlike Ctrl+C.",
    verification: "The prompt should become Z-DRAFT-RAN#, proving the valid draft ran before the context changed.",
    recovery: "Return to global configuration and restore the intended hostname if the draft was not meant to run.",
    destructive: false,
  },
  {
    id: "merge-startup-running",
    title: "Prove that startup-to-running is a merge",
    summary: "The fixture added an unsaved description that is absent from startup configuration.",
    task: "Merge the saved startup configuration into running configuration.",
    mode: "privileged",
    command: "copy startup-config running-config",
    fixture: ["configure terminal", "interface GigabitEthernet0/0/0", "description MERGE SURVIVES", "end"],
    why: "Copying startup to running applies saved statements but is not a clean rollback; unrelated running-only statements can remain after the merge.",
    verification: "Inspect GigabitEthernet0/0/0 afterwards: MERGE SURVIVES should still be present.",
    recovery: "Use exact no commands for targeted correction or a verified configure replace when full replacement is intended and supported.",
    destructive: false,
  },
  {
    id: "verify-merge",
    title: "Inspect the merge result",
    summary: "Do not infer rollback from a successful copy message.",
    task: "Display interface descriptions and find the running-only line.",
    mode: "privileged",
    command: "show interfaces description",
    why: "Observable evidence is the safeguard against assuming that a startup-to-running merge removed every unsaved statement.",
    verification: "GigabitEthernet0/0/0 should still show MERGE SURVIVES.",
    recovery: "Leave the line in place for the next replacement exercise.",
    destructive: false,
  },
  {
    id: "restore-saved-snapshot",
    title: "Replace running with the saved snapshot",
    summary: "Advanced operation · declared IOS XE training-router profile only.",
    task: "Replace running configuration with the verified startup snapshot.",
    mode: "privileged",
    command: "configure replace nvram:startup-config force",
    why: "Configure replace targets the whole running configuration, not only the last line. The simulator creates a recovery checkpoint before applying it.",
    verification: "Compare running and startup state and verify that MERGE SURVIVES disappeared.",
    recovery: "Use the visible simulator Restore checkpoint control if this broad replacement was not intended.",
    destructive: true,
    acknowledgement: "I understand this replaces the whole running configuration on the declared simulator profile.",
  },
  {
    id: "verify-replacement",
    title: "Verify the broad replacement",
    summary: "A success message is not enough evidence by itself.",
    task: "Compare running and startup state after replacement.",
    mode: "privileged",
    command: "show archive config differences nvram:startup-config system:running-config",
    why: "The comparison should now be clean because configure replace used the verified startup snapshot rather than merging it into running state.",
    verification: "The output should say that running configuration matches startup configuration.",
    recovery: "The simulator checkpoint remains available until it is deliberately restored or the exercise restarts.",
    destructive: false,
  },
  {
    id: "default-interface",
    title: "Recognise a broad interface reset",
    summary: "This affects more than one exact line and therefore needs deliberate scope.",
    task: "Return the training interface towards its profile defaults.",
    mode: "global",
    command: "default interface GigabitEthernet0/0/1",
    confirmation: "confirm",
    fixture: ["configure terminal"],
    why: "Defaulting an interface can clear its description, address, switching and administrative settings together; it is broader than a targeted no command.",
    verification: "Inspect the full interface afterwards rather than checking only the description.",
    recovery: "Reapply the verified interface configuration or restore a known-good checkpoint before losing remote access on a real device.",
    destructive: true,
    acknowledgement: "I understand that default interface can remove several settings at once.",
  },
  {
    id: "understand-disruptive-reset",
    title: "Stop before a disruptive reload",
    summary: "The fixture returns to Privileged EXEC, but the simulated reload will be declined.",
    task: "Open the reload confirmation, then decline it instead of using reload as an undo.",
    mode: "privileged",
    command: "reload",
    fixture: ["end"],
    confirmation: "decline",
    why: "A real reload interrupts forwarding and management sessions. Unsaved work may be lost, while a faulty startup configuration may simply load again.",
    verification: "Decline the prompt and confirm the current session and state remain available.",
    recovery: "Use console or out-of-band access, a verified saved state and an approved outage before a real reload.",
    destructive: true,
    acknowledgement: "I understand that reload is disruptive and is not the normal correction for one mistaken command.",
  },
];
