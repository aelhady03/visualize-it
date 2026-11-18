/**
 * WalView — the WAL region (PLAN.md §5.2): one row per WAL segment, drawn as
 * an append-only tape of record cells with layoutIds
 * `wal:<segmentId>:<entryId>`. Tombstone records render with the Box cross
 * pattern AND the tombstone tone — they differ by shape and color
 * (AGENTS.md §6.7). The newest segment (the one the active MemTable appends
 * to) carries an "append" arrow at its tail and shows the next seq number.
 *
 * Draws in local coordinates inside `wal.length * WAL_ROW_H` (regions.ts);
 * render/index.tsx positions the group. Never calls `onAnimationComplete` —
 * render/index.tsx owns completion (WAVE3-REPORT §1).
 */

import type { Highlight } from "@core/engine-contract";
import { Arrow, Box, KeyCell, keyCellWidth } from "@core/primitives";
import type { Entry } from "../state";
import { WAL_ROW_H, type WalViewProps } from "./regions";

const BADGE_W = 56;
const CELLS_X = 88;
const CELL_H = 24;
const CELL_GAP = 6;
const CELL_Y = 1;

interface PlacedCell {
  entry: Entry;
  x: number;
  w: number;
}

export function WalView(props: WalViewProps) {
  const { wal, seq, highlights, reducedMotion } = props;
  const roles = new Map<string, Highlight["role"]>(highlights.map((h) => [h.id, h.role]));
  const lastIndex = wal.length - 1;

  return (
    <g>
      {wal.map((segment, row) => {
        const isActive = row === lastIndex;

        let cursor = CELLS_X;
        const cells: PlacedCell[] = segment.entries.map((entry) => {
          const w = keyCellWidth(
            entry.key,
            entry.tombstone === true ? undefined : entry.value,
            entry.seq,
          );
          const placed = { entry, x: cursor, w };
          cursor += w + CELL_GAP;
          return placed;
        });
        const tailX = cells.length > 0 ? cells[cells.length - 1].x + cells[cells.length - 1].w + CELL_GAP : CELLS_X;
        const rowY = row * WAL_ROW_H;
        const midY = CELL_Y + CELL_H / 2;

        return (
          <g key={segment.id} transform={`translate(0, ${rowY})`} data-entity-id={segment.id}>
            <Box
              x={0}
              y={2}
              width={BADGE_W}
              height={22}
              tone="wal"
              label={segment.id}
              role={roles.get(segment.id)}
              reducedMotion={reducedMotion}
            />
            <text x={BADGE_W + 10} y={14} fontSize={10} fill="currentColor" opacity={0.75}>
              {isActive
                ? `active · next #${seq}`
                : `${segment.entries.length} record(s) · replayable after a crash`}
            </text>

            {cells.length === 0 ? (
              <text x={CELLS_X} y={midY + 3} fontSize={11} fill="currentColor" opacity={0.6}>
                empty segment
              </text>
            ) : (
              cells.map(({ entry, x, w }) => {
                const layoutId = `wal:${segment.id}:${entry.id}`;
                const role = roles.get(entry.id);
                if (entry.tombstone === true) {
                  return (
                    <Box
                      key={entry.id}
                      x={x}
                      y={CELL_Y}
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
                        y={CELL_Y + 3.5}
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
                    y={CELL_Y}
                    label={entry.key}
                    value={entry.value}
                    seq={entry.seq}
                    height={CELL_H}
                    layoutId={layoutId}
                    tone="wal"
                    role={role}
                    reducedMotion={reducedMotion}
                  />
                );
              })
            )}

            {isActive && (
              <Arrow
                from={{ x: tailX + 34, y: midY }}
                to={{ x: tailX + 8, y: midY }}
                label="append"
                layoutId="wal:tail"
                reducedMotion={reducedMotion}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}
