/**
 * sstable Render — the full composition the five lanes plug into (PLAN.md
 * §6). Written ONCE by the Wave 3 module lead (lane: lead).
 *
 * Owns: the layout grid (header, WAL + MemTables on top, background Jobs in
 * the middle, L0/levels at the bottom, merge + bloom strips below), the
 * section band math (constants from ./regions.ts), and the completion wiring.
 * Lanes replace the region stubs (WalView, MemTableView, LevelsView,
 * MergeView, BloomView) against the FROZEN props in ./regions.ts; they do
 * NOT edit this file or regions.ts — escalate instead.
 *
 * Completion (contract §3.1): `useStepTransition` auto-calls
 * `onAnimationComplete()` when there is nothing to animate (identical
 * snapshots, reduced motion). When the snapshot changed, the region
 * layoutIds FLIP-animate and `completeAfter` reports completion once the
 * entry/FLIP duration has passed — so the player can never hang.
 */

import { useEffect } from "react";
import type { RenderProps } from "@core/view-contract";
import { BASE_DURATION, completeAfter, useStepTransition } from "@core/useStepTransition";
import { resolveStrategy } from "../lib/config";
import type { EngineState } from "../state";
import { WalView } from "./WalView";
import { MemTableView } from "./MemTableView";
import { LevelsView } from "./LevelsView";
import { MergeView } from "./MergeView";
import { BloomView } from "./BloomView";
import { JobRow } from "./JobRow";
import {
  BLOOM_BAND,
  JOB_ROW_H,
  LEVELS_BAND,
  MEMTABLE_ROW_H,
  MERGE_BAND,
  WAL_ROW_H,
} from "./regions";

const W = 800;
const MARGIN = 16;
const HEADER_H = 44;
const GAP = 16;

export function SstableRender(props: RenderProps<EngineState>) {
  const { state, prevState, direction, speed, reducedMotion, highlights, onAnimationComplete } =
    props;
  const { nothingToAnimate } = useStepTransition({
    state,
    prevState,
    speed,
    direction,
    reducedMotion,
    onAnimationComplete,
  });

  // When something animates (FLIP moves via layoutId), report completion
  // after the entry duration. The hook already auto-completes the
  // nothing-to-animate cases — arming this then would double-advance.
  useEffect(() => {
    if (nothingToAnimate) return;
    return completeAfter(BASE_DURATION * 1000, speed, reducedMotion, onAnimationComplete);
  }, [state, nothingToAnimate, speed, reducedMotion, onAnimationComplete]);

  const strategy = resolveStrategy(state.config.strategy);

  const walBand = state.wal.length * WAL_ROW_H;
  const memBand = state.memtables.length * MEMTABLE_ROW_H;
  const jobBand = state.jobs.length > 0 ? state.jobs.length * JOB_ROW_H + GAP : 0;

  const walY = HEADER_H;
  const memY = walY + walBand + GAP;
  const jobY = memY + memBand + GAP;
  const levelsY = jobY + jobBand;
  const mergeY = levelsY + LEVELS_BAND + GAP;
  const bloomY = mergeY + MERGE_BAND + GAP;
  const height = bloomY + BLOOM_BAND + MARGIN;

  const levelsLabel =
    state.levels.length > 0 ? ` · ${state.levels.length} level(s)` : "";

  return (
    <svg
      width={W}
      height={height}
      viewBox={`0 0 ${W} ${height}`}
      role="img"
      aria-label={`SSTable LSM-tree diagram: ${state.l0.length} L0 files, ${state.memtables.length} memtable(s), ${state.jobs.length} job(s)`}
    >
      <text x={MARGIN} y={24} fontSize={13} fontWeight={600} fill="currentColor">
        {`LSM-tree · strategy ${strategy} · L0 ${state.l0.length} file(s)${levelsLabel} · next seq ${state.seq}`}
      </text>

      <g transform={`translate(${MARGIN}, ${walY})`}>
        <WalView
          wal={state.wal}
          seq={state.seq}
          highlights={highlights}
          speed={speed}
          reducedMotion={reducedMotion}
        />
      </g>

      <g transform={`translate(${MARGIN}, ${memY})`}>
        <MemTableView
          memtables={state.memtables}
          highlights={highlights}
          speed={speed}
          reducedMotion={reducedMotion}
        />
      </g>

      {state.jobs.length > 0 && (
        <g transform={`translate(${MARGIN}, ${jobY})`}>
          {state.jobs.map((job, i) => (
            <g key={job.id} transform={`translate(0, ${i * JOB_ROW_H})`}>
              <JobRow
                job={job}
                memtables={state.memtables}
                l0={state.l0}
                levels={state.levels}
                highlights={highlights}
                speed={speed}
                reducedMotion={reducedMotion}
              />
            </g>
          ))}
        </g>
      )}

      <g transform={`translate(${MARGIN}, ${levelsY})`}>
        <LevelsView
          l0={state.l0}
          levels={state.levels}
          strategy={strategy}
          highlights={highlights}
          speed={speed}
          reducedMotion={reducedMotion}
        />
      </g>

      <g transform={`translate(${MARGIN}, ${mergeY})`}>
        <MergeView
          jobs={state.jobs}
          l0={state.l0}
          levels={state.levels}
          highlights={highlights}
          speed={speed}
          reducedMotion={reducedMotion}
        />
      </g>

      <g transform={`translate(${MARGIN}, ${bloomY})`}>
        <BloomView
          l0={state.l0}
          levels={state.levels}
          highlights={highlights}
          speed={speed}
          reducedMotion={reducedMotion}
        />
      </g>
    </svg>
  );
}
