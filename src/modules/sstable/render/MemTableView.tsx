/**
 * MemTableView — the MemTables region (PLAN.md §5.2): one row per MemTable
 * (active first, then immutable tables being flushed), each an entry list
 * sorted by key with layoutIds `memtable:<mtId>:<entryId>`. Tombstone
 * entries differ by shape AND color (Box cross pattern + tombstone tone,
 * AGENTS.md §6.7). The active/immutable distinction is a state chip that
 * crossfades when a table flips during `memtable.freeze`.
 *
 * Draws in local coordinates inside `memtables.length * MEMTABLE_ROW_H`
 * (regions.ts); render/index.tsx positions the group. Never calls
 * `onAnimationComplete` — render/index.tsx owns completion (WAVE3-REPORT §1).
 */

import { motion } from "motion/react";
import type { Highlight } from "@core/engine-contract";
import { Box, KeyCell, keyCellWidth } from "@core/primitives";
import { vizVar } from "@core/theme/tokens";
import type { Entry } from "../state";
import { MEMTABLE_ROW_H, type MemTableViewProps } from "./regions";

const BADGE_W = 56;
const CHIP_X = 64;
const CHIP_W = 76;
// Header (badge + state chip + caption) occupies y 0–18; cells sit below it
// with a 4px gap and end at 44, inside MEMTABLE_ROW_H (46).
const HEADER_H = 18;
const CELLS_Y = HEADER_H + 4;
const CELL_H = 22;
const CELL_GAP = 6;

interface PlacedEntry {
  entry: Entry;
  x: number;
  w: number;
}

export function MemTableView(props: MemTableViewProps) {
  const { memtables, highlights, speed, reducedMotion } = props;
  const roles = new Map<string, Highlight["role"]>(highlights.map((h) => [h.id, h.role]));

  return (
    <g>
      {memtables.map((mt, row) => {
        let cursor = 0;
        const cells: PlacedEntry[] = mt.entries.map((entry) => {
          const w = keyCellWidth(
            entry.key,
            entry.tombstone === true ? undefined : entry.value,
            entry.seq,
          );
          const placed = { entry, x: cursor, w };
          cursor += w + CELL_GAP;
          return placed;
        });
        const rowY = row * MEMTABLE_ROW_H;
        const midY = CELLS_Y + CELL_H / 2;
        const chip = (
          <g>
            <rect
              x={CHIP_X}
              y={0}
              width={CHIP_W}
              height={HEADER_H}
              rx={4}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.25}
            />
            <circle
              cx={CHIP_X + 10}
              cy={HEADER_H / 2}
              r={3.5}
              fill={mt.state === "active" ? vizVar("active") : "none"}
              stroke={mt.state === "active" ? "none" : "currentColor"}
              strokeWidth={1.25}
            />
            <text x={CHIP_X + 18} y={HEADER_H / 2} dominantBaseline="central" fontSize={10} fill="currentColor">
              {mt.state}
            </text>
          </g>
        );

        return (
          <g key={mt.id} transform={`translate(0, ${rowY})`} data-entity-id={mt.id}>
            <Box
              x={0}
              y={0}
              width={BADGE_W}
              height={HEADER_H}
              tone="memtable"
              label={mt.id}
              role={roles.get(mt.id)}
              reducedMotion={reducedMotion}
            />
            {reducedMotion ? (
              chip
            ) : (
              <motion.g
                key={mt.state}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25 / (speed > 0 ? speed : 1) }}
              >
                {chip}
              </motion.g>
            )}
            <text x={CHIP_X + CHIP_W + 8} y={HEADER_H / 2} dominantBaseline="central" fontSize={10} fill="currentColor" opacity={0.75}>
              {`${mt.entries.length} entr${mt.entries.length === 1 ? "y" : "ies"} · WAL ${mt.walSegment}`}
            </text>

            {cells.length === 0 ? (
              <text x={0} y={midY + 3} fontSize={11} fill="currentColor" opacity={0.6}>
                empty table
              </text>
            ) : (
              cells.map(({ entry, x, w }) => {
                const layoutId = `memtable:${mt.id}:${entry.id}`;
                const role = roles.get(entry.id);
                if (entry.tombstone === true) {
                  return (
                    <Box
                      key={entry.id}
                      x={x}
                      y={CELLS_Y}
                      width={w}
                      height={CELL_H}
                      layoutId={layoutId}
                      tone="tombstone"
                      role={role}
                      pattern="tombstone"
                      label={entry.key}
                      reducedMotion={reducedMotion}
                    >
                      <text
                        x={x + w - 5}
                        y={CELLS_Y + 3.5}
                        textAnchor="end"
                        fontSize={8}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                        fill="currentColor"
                        opacity={0.65}
                      >
                        #{entry.seq}
                      </text>
                    </Box>
                  );
                }
                return (
                  <KeyCell
                    key={entry.id}
                    x={x}
                    y={CELLS_Y}
                    label={entry.key}
                    value={entry.value}
                    seq={entry.seq}
                    height={CELL_H}
                    layoutId={layoutId}
                    tone="memtable"
                    role={role}
                    reducedMotion={reducedMotion}
                  />
                );
              })
            )}
          </g>
        );
      })}
    </g>
  );
}
