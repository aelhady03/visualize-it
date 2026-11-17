// Frozen contract v1 (PLAN.md §3.1). Copied verbatim from PLAN.md; the only
// additions are `export` keywords.
// DO NOT EDIT: changes go through the Phase 1 owner (PLAN.md §9, AGENTS.md).

// --- @core/engine-contract (no React) ---

export type OpInput = Record<string, string | number | boolean>;
export type Config = Record<string, string | number | boolean>;

export interface Highlight {
  id: string;                 // stable entity id in the state snapshot
  role: "active" | "hit" | "miss" | "removed" | "new";
}

export interface Metrics { [name: string]: number | string }

export interface Step<S> {
  kind: string;               // stable tag: "wal.append", "flush.build-index", ...
  state: S;                   // full snapshot of engine state at this step
  narration: string;          // 1–2 sentences: what happened and WHY
  why?: string;               // "why this matters" callout
  highlights?: Highlight[];
  metrics?: Metrics;          // e.g. filesProbed, bytesWritten
  extras?: Record<string, unknown>;  // escape hatch for experiments
}

export interface RunResult<S> {
  steps: Step<S>[];           // may be [] if the op no-ops with an error
  result: S;                  // committed state; when steps exist,
                              // invariant: result DEEP-EQUALS steps.at(-1).state
                              // (deep equality, not reference equality — the
                              // conformance suite round-trips through JSON)
  error?: string;             // INVALID INPUT ONLY (empty key, unknown op id).
                              // A read that finds nothing is a normal,
                              // step-emitting operation — not an error.
}

export interface FieldSpec {
  id: string;
  label: string;
  type: "text" | "number" | "select" | "boolean";
  required?: boolean;
  options?: string[];         // for select
  default?: string | number | boolean;
  hint?: string;
}

export interface Operation {
  id: string;                 // "write" | "read" | "update" | "delete" | "compact" | "crash"
  label: string;
  description: string;
  mode: "guided" | "sandbox" | "both";
  inputSchema?: FieldSpec[];  // REQUIRED when mode includes "sandbox"
}

export interface SettingSpec {
  id: string;
  label: string;
  type: "select" | "boolean" | "number";
  options?: string[];
  default: string | number | boolean;
  hint?: string;
}

export interface ScenarioOp {
  opId: string;
  input?: OpInput;
}

export interface Scenario<S> {
  id: string;
  title: string;
  description: string;
  seedState?: S;              // optional pre-built starting state
  ops: ScenarioOp[];          // chained operations (write → update → read)
}
