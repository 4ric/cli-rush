"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  createAdvancedCustomCommand,
  createBasicCustomCommand,
  customCommandLimits,
  toRegistryCommand,
  validateCustomCommand,
  type ActiveCustomCommand,
  type CustomCommandRecord,
  type CustomCommandValidation,
} from "@/lib/custom-commands.ts";
import { deviceProfiles, type DeviceProfileId } from "@/lib/device-profiles.ts";
import { modeNames, type CliMode, type Command, type CommandKind } from "@/lib/engine.ts";

const cliModes: readonly CliMode[] = ["user", "privileged", "global", "interface", "router", "line", "vlan", "acl", "dhcp"];
const commandKinds: readonly CommandKind[] = ["verification", "configuration", "navigation"];

interface AuthoringFields {
  profile: DeviceProfileId;
  mode: CliMode;
  canonical: string;
  task: string;
  explanation: string;
  topic: string;
  kind: CommandKind;
  difficulty: 1 | 2 | 3;
  helpDescription: string;
  effectType: "read-only" | "state-change";
  effect: string;
  why: string;
  hints: [string, string, string];
  reveal: string;
  verification: string;
  undo: string;
  tags: string;
  prerequisites: string;
}

const emptyFields = (): AuthoringFields => ({
  profile: "router-ios-xe",
  mode: "privileged",
  canonical: "",
  task: "",
  explanation: "",
  topic: "Custom",
  kind: "verification",
  difficulty: 1,
  helpDescription: "",
  effectType: "read-only",
  effect: "",
  why: "",
  hints: ["", "", ""],
  reveal: "",
  verification: "",
  undo: "",
  tags: "",
  prerequisites: "",
});

const splitList = (value: string): string[] => value
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const validMode = (value: string): value is CliMode => cliModes.includes(value as CliMode);
const validKind = (value: string): value is CommandKind => commandKinds.includes(value as CommandKind);

const fieldsForRecord = (record: CustomCommandRecord): AuthoringFields => {
  const semantics = record.semantics;
  const effect = semantics.effect;
  return {
    profile: record.deviceProfile ?? "router-ios-xe",
    mode: validMode(record.mode) ? record.mode : "privileged",
    canonical: record.canonical,
    task: record.objective,
    explanation: record.explanation,
    topic: record.topic || "Custom",
    kind: validKind(record.kind) ? record.kind : "verification",
    difficulty: record.difficulty === 2 || record.difficulty === 3 ? record.difficulty : 1,
    helpDescription: semantics.helpDescription,
    effectType: effect?.type ?? "read-only",
    effect: effect?.type === "read-only" ? effect.result : effect?.description ?? "",
    why: semantics.why,
    hints: [
      semantics.progressiveHints[0] ?? "",
      semantics.progressiveHints[1] ?? "",
      semantics.progressiveHints[2] ?? "",
    ],
    reveal: semantics.revealExplanation,
    verification: semantics.verification ?? "",
    undo: semantics.undo ?? "",
    tags: semantics.tags.join(", "),
    prerequisites: semantics.prerequisites.join(", "),
  };
};

export interface CustomCommandManagerProps {
  records: readonly CustomCommandRecord[];
  baseCatalogue: readonly Command[];
  onPersist: (records: CustomCommandRecord[]) => Promise<boolean>;
  persistenceLabel: string;
  status: string;
}

export function CustomCommandManager({
  records,
  baseCatalogue,
  onPersist,
  persistenceLabel,
  status,
}: CustomCommandManagerProps) {
  const [fields, setFields] = useState<AuthoringFields>(emptyFields);
  const [advanced, setAdvanced] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [validation, setValidation] = useState<CustomCommandValidation | null>(null);
  const [formMessage, setFormMessage] = useState("");
  const activeCatalogue = useMemo(() => records
    .filter((record) => record.id !== editingId)
    .map(toRegistryCommand)
    .filter((command): command is Command => command !== null), [editingId, records]);

  const update = <Key extends keyof AuthoringFields,>(key: Key, value: AuthoringFields[Key]) => {
    setFields((current) => ({ ...current, [key]: value }));
    setValidation(null);
    setFormMessage("");
  };

  const draftForFields = () => {
    const shared = {
      deviceProfile: fields.profile,
      context: fields.mode,
      canonical: fields.canonical,
      task: fields.task,
      explanation: fields.explanation,
      ...(editingId ? { id: editingId } : {}),
    };
    if (!advanced) return createBasicCustomCommand(shared);
    return createAdvancedCustomCommand({
      ...shared,
      topic: fields.topic,
      kind: fields.kind,
      difficulty: fields.difficulty,
      helpDescription: fields.helpDescription,
      effect: fields.effectType === "read-only"
        ? { type: "read-only", result: fields.effect }
        : { type: "state-change", description: fields.effect },
      why: fields.why,
      progressiveHints: fields.hints.filter((hint) => hint.trim()),
      revealExplanation: fields.reveal,
      verification: fields.verification || undefined,
      undo: fields.undo || undefined,
      tags: splitList(fields.tags),
      prerequisites: splitList(fields.prerequisites),
    });
  };

  const review = (event: FormEvent) => {
    event.preventDefault();
    const result = validateCustomCommand(draftForFields(), {
      catalogue: [...baseCatalogue, ...activeCatalogue],
    });
    setValidation(result);
    if (!result.ok) {
      const needsEffect = result.errors.some((entry) => entry.code === "INVALID_EFFECT");
      if (needsEffect && !advanced) {
        setFormMessage("This command may change state. Open Advanced fields and describe its deterministic effect, verification and recovery path.");
      } else {
        setFormMessage("Resolve the specific fields below before this command can become active.");
      }
      return;
    }
    setFormMessage("Review the inferred grammar and simulator behaviour, then confirm activation.");
  };

  const confirm = async (active: ActiveCustomCommand) => {
    const next = editingId
      ? records.map((record) => record.id === editingId ? active : record)
      : [...records, active];
    if (!(await onPersist([...next]))) return;
    setFields(emptyFields());
    setAdvanced(false);
    setEditingId(null);
    setValidation(null);
    setFormMessage("");
  };

  const edit = (record: CustomCommandRecord) => {
    setFields(fieldsForRecord(record));
    setAdvanced(true);
    setEditingId(record.id);
    setValidation(null);
    setFormMessage(record.legacy
      ? "Legacy data is retained but inactive. Complete the highlighted semantic fields to activate it safely."
      : "Editing an active command. Review it again before saving changes.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (record: CustomCommandRecord) => {
    if (!window.confirm(`Delete “${record.canonical || record.objective || "this retained legacy command"}”? This cannot be undone.`)) return;
    await onPersist(records.filter((entry) => entry.id !== record.id));
    if (editingId === record.id) {
      setEditingId(null);
      setFields(emptyFields());
      setValidation(null);
    }
  };

  return <section className="manage" aria-labelledby="custom-command-title">
    <div className="manage-title">
      <p className="eyebrow">CUSTOM CONTENT</p>
      <h1 id="custom-command-title">Add commands to the same simulator.</h1>
      <p>Custom entries remain inert data. They use the shared grammar, contextual help, Tab completion and learning model, and are {persistenceLabel}.</p>
    </div>

    <form className="command-form" onSubmit={review} noValidate>
      <div className="form-row">
        <label>Virtual device
          <select value={fields.profile} onChange={(event) => update("profile", event.target.value as DeviceProfileId)}>
            {Object.values(deviceProfiles).map((profile) => <option value={profile.id} key={profile.id}>{profile.label}</option>)}
          </select>
        </label>
        <label>CLI context
          <select value={fields.mode} onChange={(event) => update("mode", event.target.value as CliMode)}>
            {cliModes.map((mode) => <option value={mode} key={mode}>{modeNames[mode]}</option>)}
          </select>
        </label>
      </div>
      <label>IOS-style command
        <input value={fields.canonical} onChange={(event) => update("canonical", event.target.value)} maxLength={customCommandLimits.canonical} autoComplete="off" spellCheck={false} required />
      </label>
      <label>Outcome-based task
        <textarea value={fields.task} onChange={(event) => update("task", event.target.value)} maxLength={customCommandLimits.objective} required />
      </label>
      <label>Explanation or memory note
        <textarea value={fields.explanation} onChange={(event) => update("explanation", event.target.value)} maxLength={customCommandLimits.explanation} required />
      </label>

      <details className="custom-advanced" open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)}>
        <summary>Advanced grammar, effect and teaching fields</summary>
        <p>Configuration commands need an explicit deterministic state effect. Read-only commands may keep the inferred Basic defaults, but you can refine them here.</p>
        <div className="form-row">
          <label>Type
            <select value={fields.kind} onChange={(event) => update("kind", event.target.value as CommandKind)}>
              {commandKinds.map((kind) => <option value={kind} key={kind}>{kind}</option>)}
            </select>
          </label>
          <label>Difficulty
            <select value={fields.difficulty} onChange={(event) => update("difficulty", Number(event.target.value) as 1 | 2 | 3)}>
              <option value="1">1</option><option value="2">2</option><option value="3">3</option>
            </select>
          </label>
          <label>Topic
            <input value={fields.topic} onChange={(event) => update("topic", event.target.value)} maxLength={customCommandLimits.topic} />
          </label>
        </div>
        <label>Contextual ? description
          <textarea value={fields.helpDescription} onChange={(event) => update("helpDescription", event.target.value)} maxLength={customCommandLimits.helpDescription} />
        </label>
        <div className="form-row">
          <label>Simulator effect
            <select value={fields.effectType} onChange={(event) => update("effectType", event.target.value as AuthoringFields["effectType"])}>
              <option value="read-only">Read-only result</option><option value="state-change">State change</option>
            </select>
          </label>
          <label>Effect or result
            <textarea value={fields.effect} onChange={(event) => update("effect", event.target.value)} maxLength={customCommandLimits.effect} />
          </label>
        </div>
        <label>Why it matters
          <textarea value={fields.why} onChange={(event) => update("why", event.target.value)} maxLength={customCommandLimits.why} />
        </label>
        <fieldset>
          <legend>Progressive hints</legend>
          {fields.hints.map((hint, index) => <label key={index}>Hint {index + 1}
            <textarea value={hint} onChange={(event) => {
              const hints = [...fields.hints] as AuthoringFields["hints"];
              hints[index] = event.target.value;
              update("hints", hints);
            }} maxLength={customCommandLimits.progressiveHint} />
          </label>)}
        </fieldset>
        <label>Reveal explanation
          <textarea value={fields.reveal} onChange={(event) => update("reveal", event.target.value)} maxLength={customCommandLimits.revealExplanation} />
        </label>
        <div className="form-row">
          <label>Verification
            <textarea value={fields.verification} onChange={(event) => update("verification", event.target.value)} maxLength={customCommandLimits.verification} />
          </label>
          <label>Undo or recovery
            <textarea value={fields.undo} onChange={(event) => update("undo", event.target.value)} maxLength={customCommandLimits.undo} />
          </label>
        </div>
        <div className="form-row">
          <label>Tags, comma separated
            <input value={fields.tags} onChange={(event) => update("tags", event.target.value)} />
          </label>
          <label>Prerequisite IDs, comma separated
            <input value={fields.prerequisites} onChange={(event) => update("prerequisites", event.target.value)} />
          </label>
        </div>
      </details>

      <div className="report-actions">
        <button className="primary" type="submit">Review command</button>
        {editingId && <button className="secondary" type="button" onClick={() => {
          setEditingId(null); setFields(emptyFields()); setValidation(null); setFormMessage(""); setAdvanced(false);
        }}>Cancel edit</button>}
      </div>
      {formMessage && <p className="custom-status" role="status">{formMessage}</p>}
      {validation && !validation.ok && <div className="custom-validation" role="alert">
        <strong>Command not ready</strong>
        <ul>{validation.errors.map((entry, index) => <li key={`${entry.field}-${entry.code}-${index}`}><b>{entry.field}:</b> {entry.message}</li>)}</ul>
      </div>}
      {validation?.ok && <div className="custom-preview" aria-label="Command parser preview">
        <p className="eyebrow">SHARED PARSER PREVIEW</p>
        <h2>{validation.active.objective}</h2>
        <dl>
          <div><dt>? help</dt><dd><code>{validation.preview.questionMark.input}?</code> → {validation.preview.questionMark.commandOption?.value ?? "No unique option"} — {validation.preview.helpDescription}</dd></div>
          <div><dt>Tab</dt><dd><code>{validation.preview.tab.input || "(start typing)"}</code> → <code>{validation.preview.tab.output.trim()}</code></dd></div>
          <div><dt>Unambiguous abbreviations</dt><dd>{validation.preview.shorthandExamples.length ? validation.preview.shorthandExamples.map((entry) => <code key={entry}>{entry}</code>) : "Use the canonical form."}</dd></div>
          <div><dt>Effect</dt><dd>{validation.active.semantics.effect.type === "read-only" ? validation.active.semantics.effect.result : validation.active.semantics.effect.description}</dd></div>
        </dl>
        {validation.warnings.map((entry) => <p className="custom-status" key={`${entry.field}-${entry.code}`}>{entry.message}</p>)}
        <button className="primary" type="button" onClick={() => void confirm(validation.active)}>{editingId ? "Save reviewed command" : "Activate command"}</button>
      </div>}
      <p className="custom-status" aria-live="polite">{status}</p>
    </form>

    <div className="custom-list">
      <div className="answer-review-head"><span>YOUR COMMANDS</span><b>{records.length}</b></div>
      {records.length ? records.map((record) => <article key={record.id} className={record.status === "incomplete" ? "custom-incomplete" : undefined}>
        <div>
          <small>{record.status === "active" ? `${deviceProfiles[record.deviceProfile].hostname} · ${modeNames[record.mode]}` : "LEGACY · INACTIVE · REVIEW REQUIRED"} · {record.topic}</small>
          <h3>{record.objective || "Untitled retained legacy command"}</h3>
          <code>{record.canonical || "No command text was supplied"}</code>
          {record.status === "incomplete" && <p>This source entry has not been deleted or activated. Complete its device, grammar, teaching, effect and verification fields first.</p>}
        </div>
        <div className="custom-list-actions">
          <button type="button" onClick={() => edit(record)}>{record.status === "incomplete" ? "Complete" : "Edit"}</button>
          <button type="button" onClick={() => void remove(record)}>Delete</button>
        </div>
      </article>) : <p>No custom commands have been added.</p>}
    </div>
  </section>;
}
