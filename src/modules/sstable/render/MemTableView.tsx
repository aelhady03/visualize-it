/**
 * MemTableView — STUB.
 *
 * Lane: the CRASH/BULK lane replaces this file with the real MemTables
 * region: the active table plus any immutable tables being flushed (one per
 * `memtables` entry), KeyCells per entry with layoutIds `memtable:<id>:
 * <entryId>`, the active/immutable distinction, and the freeze animation
 * when the active table flips to immutable (PLAN.md §5.2 Write).
 *
 * Draws in local coordinates inside `memtables.length * MEMTABLE_ROW_H`
 * (regions.ts); render/index.tsx positions the group. Keep the exact export
 * signature:
 *   export function MemTableView(props: MemTableViewProps)
 */

import { Box } from "@core/primitives";
import { MEMTABLE_ROW_H, type MemTableViewProps } from "./regions";

export function MemTableView(props: MemTableViewProps) {
  const { memtables, reducedMotion } = props;
  return (
    <Box
      x={0}
      y={4}
      width={720}
      height={MEMTABLE_ROW_H - 4}
      tone="memtable"
      label={`MemTables — ${memtables.length} table(s) · STUB, crash/bulk lane`}
      reducedMotion={reducedMotion}
    />
  );
}
