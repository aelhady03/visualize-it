/**
 * LevelsView — STUB.
 *
 * Lane: the LEVELED lane replaces this file with the real L0 + levels region
 * (PLAN.md §5.1, §5.2 Compact): L0 as overlapping files ordered by age,
 * L1+ as levels of disjoint-range files whose target sizes grow ~fanout per
 * level. File primitives: Box/FileShape with the sparse index and bloom
 * strip per file; layoutIds `sstable:<id>:` for FLIP moves into and out of
 * merges. Under stcs, draw the `l0` files as unordered sorted runs (levels
 * stays []).
 *
 * Draws in local coordinates inside LEVELS_BAND (regions.ts); wrap file rows
 * inside it. render/index.tsx positions the group. Keep the exact export
 * signature:
 *   export function LevelsView(props: LevelsViewProps)
 */

import { Box } from "@core/primitives";
import { LEVELS_BAND, type LevelsViewProps } from "./regions";

export function LevelsView(props: LevelsViewProps) {
  const { l0, levels, strategy, reducedMotion } = props;
  return (
    <Box
      x={0}
      y={4}
      width={720}
      height={Math.min(40, LEVELS_BAND - 8)}
      tone="file"
      label={`L0 + levels — ${l0.length} L0 file(s), ${levels.length} level(s), ${strategy} · STUB, leveled lane`}
      reducedMotion={reducedMotion}
    />
  );
}
