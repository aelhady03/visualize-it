/**
 * MergeView — the STCS merge-sort region (PLAN.md §5.2 Compact). Lane: STCS
 * compaction. Replaces the stub; keeps the exact export signature:
 *
 *   export function MergeView(props: MergeViewProps)
 *
 * Draws, per in-flight compaction job, the merge MECHANICS inside MERGE_BAND
 * (local coordinates from (0,0)): a job header (progress in units, the
 * inputs, the merged-output chip) and the input runs it consumes — every
 * entry in key order, each run labeled with its file id. Entries the merge
 * will DROP are dimmed and struck through: stale versions get a dashed line,
 * tombstones the tombstone tone plus a cross — distinct by shape AND color.
 *
 * LayoutIds: the lead-owned JobRow in render/index.tsx already renders every
 * job's merge stream with `merge:<jobId>:<entryId>` (and its progress bar),
 * and LevelsView owns the `sstable:<fileId>` file boxes — so to keep EXACTLY
 * ONE element per layoutId per snapshot this region uses `merge:<jobId>` on
 * the job header box and no entry-level layoutIds (the stream itself lives
 * in the jobs band; this band shows the sort and the drops).
 *
 * Never calls onAnimationComplete — render/index.tsx owns completion
 * (useStepTransition + completeAfter), per the lane contract.
 */

import type { Highlight } from "@core/engine-contract";
import { Box, KeyCell, keyCellWidth } from "@core/primitives";
import type { Entry, SSTable } from "../state";
import { sstableEntries } from "../lib/derive";
import { compactionOutputId, stcsMergePlan } from "../engine/compact-stcs";
import { type MergeViewProps } from "./regions";

const HEADER_Y = 4;
const HEADER_H = 26;
const BADGE_W = 96;
const CHIP_X = 560;
const CHIP_W = 160;
const RUN_X = 216; // cells start past the header text
const RUN_Y = 38;
const ROW_H = 26;
const CELL_H = 20;
const MAX_X = 720;

interface PlacedCell {
  entry: Entry;
  x: number;
  y: number;
  w: number;
}

interface PlacedRun {
  placed: PlacedCell[];
  /** File id label positions (one per run start; repeats when a run wraps). */
  labels: Array<{ file: SSTable; x: number; y: number }>;
}

/** Wrap input-run cells inside the band; two cell rows fit under the header. */
function placeCells(files: SSTable[], startX: number): PlacedRun {
  const placed: PlacedCell[] = [];
  const labels: Array<{ file: SSTable; x: number; y: number }> = [];
  let x = startX;
  let row = 0;
  for (const file of files) {
    labels.push({ file, x, y: RUN_Y + row * ROW_H - 3 });
    for (const entry of sstableEntries(file)) {
      const w = keyCellWidth(entry.key, entry.value, entry.seq);
      if (x + w > MAX_X && x > startX) {
        row += 1;
        x = startX;
        labels.push({ file, x, y: RUN_Y + row * ROW_H - 3 });
      }
      placed.push({ entry, x, y: RUN_Y + row * ROW_H, w });
      x += w + 6;
    }
    x += 14; // a visible gap between input runs
  }
  return { placed, labels };
}

export function MergeView(props: MergeViewProps) {
  const { jobs, l0, levels, highlights, reducedMotion } = props;
  const roles = new Map<string, Highlight["role"]>(highlights.map((h) => [h.id, h.role]));
  const allFiles = [...l0, ...levels.flat()];
  const compactions = jobs.filter((job) => job.kind === "compaction");

  if (compactions.length === 0) {
    return (
      <g>
        <text x={0} y={22} fontSize={11} fill="currentColor" opacity={0.6}>
          size-tiered merge — idle: a bucket of similar-size L0 files (≥ stcsMinThreshold)
          merges into one SSTable when you run compact
        </text>
      </g>
    );
  }

  return (
    <g>
      {compactions.map((job) => {
        const inputs = job.inputs
          .map((id) => allFiles.find((f) => f.id === id))
          .filter((f): f is SSTable => f !== undefined);
        const others = allFiles.filter((f) => !job.inputs.includes(f.id));
        const plan = stcsMergePlan(inputs, others);
        const droppedIds = new Set(plan.dropped.map((e) => e.id));
        const { placed, labels } = placeCells(inputs, RUN_X);

        return (
          <g key={job.id} data-entity-id={job.id}>
            <Box
              x={0}
              y={HEADER_Y}
              width={BADGE_W}
              height={HEADER_H}
              tone="file"
              label={`merge ${job.id}`}
              layoutId={`merge:${job.id}`}
              reducedMotion={reducedMotion}
            />
            <text x={BADGE_W + 12} y={HEADER_Y + 11} fontSize={11} fill="currentColor">
              {`${job.progress}/${job.total} units · from ${job.inputs.join(" + ")}`}
            </text>
            <text
              x={BADGE_W + 12}
              y={HEADER_Y + 25}
              fontSize={10}
              fill="currentColor"
              opacity={0.75}
            >
              {`${plan.output.length} entries merge · ${plan.dropped.length} drop (stale + eligible tombstones)`}
            </text>
            <Box
              x={CHIP_X}
              y={HEADER_Y}
              width={CHIP_W}
              height={HEADER_H}
              tone="file"
              label={`→ ${compactionOutputId(job)} · ${plan.output.length} entries`}
              reducedMotion={reducedMotion}
            />

            {labels.map(({ file, x, y }) => (
              <text key={`${file.id}:${x}:${y}`} x={x} y={y} fontSize={9} fill="currentColor" opacity={0.65}>
                {file.id}
              </text>
            ))}

            {placed.map(({ entry, x, y, w }) => {
              const dropped = droppedIds.has(entry.id);
              const tomb = entry.tombstone === true;
              return (
                <g key={entry.id} data-entity-id={entry.id} opacity={dropped ? 0.5 : 1}>
                  <KeyCell
                    x={x}
                    y={y}
                    label={entry.key}
                    value={entry.value}
                    seq={entry.seq}
                    height={CELL_H}
                    tone={tomb ? "tombstone" : "file"}
                    role={roles.get(entry.id)}
                    reducedMotion={reducedMotion}
                  />
                  {dropped && !tomb && (
                    <line
                      x1={x + 4}
                      y1={y + CELL_H / 2}
                      x2={x + w - 4}
                      y2={y + CELL_H / 2}
                      stroke="currentColor"
                      strokeDasharray="3 3"
                    />
                  )}
                  {dropped && tomb && (
                    <path
                      d={`M ${x + w * 0.3} ${y + CELL_H * 0.3} L ${x + w * 0.7} ${y + CELL_H * 0.7} M ${x + w * 0.7} ${y + CELL_H * 0.3} L ${x + w * 0.3} ${y + CELL_H * 0.7}`}
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      fill="none"
                    />
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}
