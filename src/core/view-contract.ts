// Frozen contract v1 (PLAN.md §3.1). Copied verbatim from PLAN.md; the only
// additions are `export` keywords and the imports below.
// DO NOT EDIT: changes go through the Phase 1 owner (PLAN.md §9, AGENTS.md).

import type * as React from 'react'
import type {
  Config,
  FieldSpec,
  Highlight,
  OpInput,
  Operation,
  RunResult,
  Scenario,
  SettingSpec,
} from './engine-contract'

// --- @core/view-contract (React types) ---

export interface RenderProps<S> {
  state: S;
  prevState?: S;              // previous snapshot, for diff-based animation
  direction: 1 | -1;          // forward / backward
  speed: number;              // 0.25–2 from the player
  reducedMotion: boolean;
  highlights: Highlight[];
  onAnimationComplete: () => void;  // call when entry animations settle;
                                    // MUST be called even when nothing animates
}

export interface VizModule<S, I extends OpInput = OpInput> {
  contractVersion: 1;
  meta: {
    id: string;               // "sstable"
    title: string;
    description: string;
    topics: string[];
    difficulty: "beginner" | "intermediate" | "advanced";
    category: string;         // sidebar grouping, e.g. "Storage Engines"
    order: number;            // sort key within category
  };
  operations: Operation[];
  settings: SettingSpec[];    // e.g. compaction strategy toggle
  scenarios: Scenario<S>[];
  engine: {
    init(config?: Config): S;
    // NOTE: config is passed to init only — S carries resolved config
    // (S.config). run does NOT take config. Changing a setting resets the
    // module to init(newConfig); switching strategy mid-state is undefined.
    run(opId: string, input: I | undefined, prev: S): RunResult<S>;
  };
  Render: React.FC<RenderProps<S>>;
  InputForm?: React.FC<{ fields: FieldSpec[]; values: OpInput; onChange: (v: OpInput) => void }>;
  Intro?: React.FC;           // module home primer
}
