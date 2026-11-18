/**
 * JobRow — one background job's row (PLAN.md §5.1 jobs model), implemented
 * FULLY by the Wave 3 module lead. Both compaction lanes reuse it; lanes do
 * NOT edit this file.
 *
 * Renders inside its JOB_ROW_H band in local coordinates: a kind badge, the
 * job id with progress and the consumed input ids, the merge stream so far
 * (KeyCells with `merge:<jobId>:<entryId>` layoutIds — a distinct namespace
 * from the source containers, so exactly one element per layoutId exists per
 * snapshot, per the FLIP convention in PLAN.md §3.1), and a progress bar.
 */

import type { Highlight } from "@core/engine-contract";
import { Box, KeyCell, keyCellWidth } from "@core/primitives";
import { vizVar } from "@core/theme/tokens";
import type { Entry } from "../state";
import { JOB_ROW_H, type JobRowProps } from "./regions";

const BADGE_W = 92;
const STREAM_X = 212;
const BAR_W = 150;
const CELL_H = 24;

export function JobRow(props: JobRowProps) {
  const { job, memtables, l0, levels, highlights, reducedMotion } = props;
  const roles = new Map<string, Highlight["role"]>(highlights.map((h) => [h.id, h.role]));
  const kindTone = job.kind === "flush" ? "wal" : "file";
  const cellTone = job.kind === "flush" ? "memtable" : "file";

  const inputs = job.inputs.map((id) => {
    if (memtables.some((m) => m.id === id)) return `${id} (memtable)`;
    if ([...l0, ...levels.flat()].some((s) => s.id === id)) return `${id} (sstable)`;
    return id;
  });

  const cells = job.output
    .reduce(
      (acc, entry) => {
        acc.cells.push({ entry, x: acc.cursor });
        acc.cursor += keyCellWidth(entry.key, entry.value, entry.seq) + 6;
        return acc;
      },
      { cursor: STREAM_X, cells: [] as Array<{ entry: Entry; x: number }> },
    )
    .cells;

  const ratio = job.total > 0 ? Math.min(1, job.progress / job.total) : 0;

  return (
    <g data-entity-id={job.id}>
      <Box
        x={0}
        y={4}
        width={BADGE_W}
        height={26}
        tone={kindTone}
        label={job.kind}
        reducedMotion={reducedMotion}
      />
      <text x={BADGE_W + 12} y={18} fontSize={11} fill="currentColor">
        {`${job.id} · ${job.progress}/${job.total} · from ${inputs.join(", ")}`}
      </text>
      {cells.length === 0 ? (
        <text x={STREAM_X} y={18} fontSize={11} fill="currentColor" opacity={0.6}>
          merge stream empty
        </text>
      ) : (
        cells.map(({ entry, x: cx }) => (
          <KeyCell
            key={entry.id}
            x={cx}
            y={6}
            label={entry.key}
            value={entry.value}
            seq={entry.seq}
            height={CELL_H}
            layoutId={`merge:${job.id}:${entry.id}`}
            tone={cellTone}
            role={roles.get(entry.id)}
            reducedMotion={reducedMotion}
          />
        ))
      )}
      <rect
        x={STREAM_X}
        y={JOB_ROW_H - 9}
        width={BAR_W}
        height={6}
        rx={3}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      />
      <rect
        x={STREAM_X}
        y={JOB_ROW_H - 9}
        width={Math.max(2, BAR_W * ratio)}
        height={6}
        rx={3}
        fill={vizVar("active")}
      />
    </g>
  );
}
