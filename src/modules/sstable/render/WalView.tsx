/**
 * WalView — STUB.
 *
 * Lane: the CRASH/BULK lane replaces this file with the real WAL region:
 * one row per WAL segment (KeyCells per entry, layoutIds `wal:<segmentId>:
 * <entryId>`), truncation tombstones after a flush, and the per-segment
 * replay highlights after a crash (PLAN.md §5.2 Crash).
 *
 * Draws in local coordinates inside `wal.length * WAL_ROW_H` (regions.ts);
 * render/index.tsx positions the group. Keep the exact export signature:
 *   export function WalView(props: WalViewProps)
 */

import { Box } from "@core/primitives";
import { WAL_ROW_H, type WalViewProps } from "./regions";

export function WalView(props: WalViewProps) {
  const { wal, reducedMotion } = props;
  return (
    <Box
      x={0}
      y={4}
      width={720}
      height={WAL_ROW_H - 4}
      tone="wal"
      label={`WAL — ${wal.length} segment(s) · STUB, crash/bulk lane`}
      reducedMotion={reducedMotion}
    />
  );
}
