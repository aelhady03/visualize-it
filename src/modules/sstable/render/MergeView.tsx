/**
 * MergeView — STUB.
 *
 * Lane: the STCS lane replaces this file with the animated merge-sort region
 * (PLAN.md §5.2 Compact): the compaction job's merge stream (`job.output`)
 * advancing entry by entry, the input files it consumes, stale versions and
 * eligible tombstones visibly dropping out of the stream, and the merged
 * output landing back in L0. Reuse JobRow for the plain job summary and
 * layoutIds `merge:<jobId>:<entryId>` for the moving entries.
 *
 * Draws in local coordinates inside MERGE_BAND (regions.ts);
 * render/index.tsx positions the group. Keep the exact export signature:
 *   export function MergeView(props: MergeViewProps)
 */

import { Box } from "@core/primitives";
import { MERGE_BAND, type MergeViewProps } from "./regions";

export function MergeView(props: MergeViewProps) {
  const { jobs, reducedMotion } = props;
  return (
    <Box
      x={0}
      y={4}
      width={720}
      height={Math.min(40, MERGE_BAND - 8)}
      tone="file"
      label={`Merge — ${jobs.length} job(s) · STUB, STCS lane`}
      reducedMotion={reducedMotion}
    />
  );
}
