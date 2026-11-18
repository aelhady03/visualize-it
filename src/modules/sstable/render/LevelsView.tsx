/**
 * LevelsView — the L0 + levels region (PLAN.md §5.1, §5.2 Compact — leveled).
 *
 * Lane: LEVELED lane (replaces the stub).
 *
 * Drawing (all in LOCAL coordinates inside LEVELS_BAND, x ≤ 720):
 * - Every file is placed on a shared KEY-RANK axis: distinct keys are ranked
 *   lexicographically and mapped onto the horizontal axis, so a file's
 *   x-span IS its key range. L0 files get one row each (oldest at the top —
 *   L0 is age-ordered) and their overlapping ranges show up as overlapping
 *   x-spans; each L1+ level gets one row where files sit side by side —
 *   disjoint ranges are visible as non-overlapping spans.
 * - Each file is a FileShape with the sparse index as segments (first key
 *   per block), one entry mark per entry (tombstones get a cross — shape AND
 *   color), and a mini bloom strip when the file is wide enough.
 * - Namespaced layoutIds per PLAN.md §3.1: entries `sstable:<fileId>:<entryId>`
 *   (exactly one element per layoutId per snapshot), bloom cells
 *   `sstable:<fileId>:bloom:b<i>`.
 * - Overlap highlight: when ≥2 files carry role "active" (a compaction just
 *   picked them), the intersection of their ranges is drawn as an accent
 *   band behind them.
 * - Under stcs `levels` is [] and every file lives in l0 — drawn the same
 *   way, labeled as unordered sorted runs.
 * - NEVER calls onAnimationComplete (render/index.tsx owns completion).
 */

import { motion, useReducedMotion } from "motion/react";
import type { Highlight } from "@core/engine-contract";
import { BitArray, Box, FileShape, type FileSegment } from "@core/primitives";
import { roleVar, vizVar } from "@core/theme/tokens";
import type { Block, Entry, SSTable } from "../state";
import { sstableEntries, sstableMaxKey, sstableMinKey } from "../lib/derive";
import { LEVELS_BAND, type LevelsViewProps } from "./regions";

const W = 720;
const GUTTER_W = 60;
const AXIS_X = GUTTER_W + 8;
const AXIS_W = W - AXIS_X - 8;
const HEADER_H = 16;
const MIN_FILE_W = 26;
const MIN_ROW_H = 18;
const MAX_FILE_H = 26;
const ENTRY_H = 9;

interface RankAxis {
  count: number;
  xFor: (key: string) => number;
}

/** Map the distinct keys of every file onto the horizontal axis by rank. */
function rankAxis(files: SSTable[]): RankAxis {
  const keys = new Set<string>();
  for (const file of files) for (const entry of sstableEntries(file)) keys.add(entry.key);
  const sorted = [...keys].sort();
  const rank = new Map<string, number>(sorted.map((key, i) => [key, i]));
  return {
    count: sorted.length,
    xFor: (key: string) => {
      const r = rank.get(key) ?? 0;
      if (sorted.length <= 1) return AXIS_X;
      return AXIS_X + (r / (sorted.length - 1)) * AXIS_W;
    },
  };
}

/** One entry mark inside a file: tiny cell, cross for tombstones, role pulse. */
function EntryMark(props: {
  entry: Entry;
  x: number;
  y: number;
  size: number;
  role?: Highlight["role"];
  layoutId?: string;
  reducedMotion?: boolean;
}) {
  const systemReduced = useReducedMotion();
  const reduced = props.reducedMotion ?? systemReduced ?? false;
  const roleColor = props.role ? roleVar(props.role) : undefined;
  const layoutId = reduced ? undefined : props.layoutId;
  const size = Math.max(2, props.size);
  return (
    <motion.g layoutId={layoutId} data-layout-id={layoutId}>
      <rect
        x={props.x}
        y={props.y}
        width={size}
        height={ENTRY_H}
        rx={1}
        fill={props.entry.tombstone === true ? vizVar("tombstone") : vizVar("file")}
        stroke={roleColor ?? "currentColor"}
        strokeWidth={roleColor ? 1.5 : 1}
      />
      {props.entry.tombstone === true && (
        <path
          d={`M ${props.x + 2} ${props.y + 2} L ${props.x + size - 2} ${props.y + ENTRY_H - 2} M ${props.x + size - 2} ${props.y + 2} L ${props.x + 2} ${props.y + ENTRY_H - 2}`}
          stroke="currentColor"
          strokeWidth={1}
          fill="none"
        />
      )}
      {roleColor && (
        <motion.rect
          x={props.x}
          y={props.y}
          width={size}
          height={ENTRY_H}
          rx={1}
          fill="none"
          stroke={roleColor}
          strokeWidth={1.5}
          style={{ pointerEvents: "none" }}
          animate={reduced ? undefined : { opacity: [0.2, 0.7, 0.2] }}
          transition={reduced ? undefined : { duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
    </motion.g>
  );
}

/** One SSTable file glyph at its rank-axis position, with its contents. */
function FileGlyph(props: {
  file: SSTable;
  x: number;
  width: number;
  y: number;
  height: number;
  roles: Map<string, Highlight["role"]>;
  reducedMotion: boolean;
}) {
  const { file, roles, reducedMotion } = props;
  const segments: FileSegment[] = file.blocks.map((block: Block) => {
    const first = block.entries[0]?.key;
    const hit = block.entries.find((entry) => roles.has(entry.id));
    const role = hit ? roles.get(hit.id) : undefined;
    return first !== undefined ? { label: first, ...(role ? { role } : {}) } : {};
  });

  const entries = sstableEntries(file);
  const cellW =
    entries.length > 0 ? Math.min(14, Math.max(4, (props.width - 8) / entries.length)) : 0;

  return (
    <g data-file-id={file.id}>
      <FileShape
        x={props.x}
        y={props.y}
        width={props.width}
        height={props.height}
        role={roles.get(file.id)}
        segments={segments}
        reducedMotion={reducedMotion}
      >
        <text x={props.x + 4} y={props.y + 11} fontSize={8} fill="currentColor">
          {`${file.id} · #${file.seq}`}
        </text>
        {entries.map((entry, i) => (
          <EntryMark
            key={entry.id}
            entry={entry}
            x={props.x + 4 + i * cellW}
            y={props.y + 3}
            size={cellW - 1.5}
            role={roles.get(entry.id)}
            layoutId={`sstable:${file.id}:${entry.id}`}
            reducedMotion={reducedMotion}
          />
        ))}
        {props.width >= 64 && props.height >= 20 && (
          <BitArray
            x={props.x + 4}
            y={props.y + props.height - 12}
            bits={file.bloom}
            cell={2}
            gap={1}
            layoutId={`sstable:${file.id}:bloom`}
            reducedMotion={reducedMotion}
          />
        )}
      </FileShape>
    </g>
  );
}

export function LevelsView(props: LevelsViewProps) {
  const { l0, levels, strategy, highlights, reducedMotion } = props;
  const roles = new Map<string, Highlight["role"]>(highlights.map((h) => [h.id, h.role]));
  const files = [...l0, ...levels.flat()];

  if (files.length === 0) {
    return (
      <Box
        x={0}
        y={4}
        width={W}
        height={Math.min(40, LEVELS_BAND - 8)}
        tone="file"
        label="No SSTables yet — flushes land in L0 first"
        reducedMotion={reducedMotion}
      />
    );
  }

  const axis = rankAxis(files);
  const rows = l0.length + levels.length;
  const rowH = Math.max(MIN_ROW_H, Math.floor((LEVELS_BAND - HEADER_H - 4) / rows));
  const fileH = Math.min(MAX_FILE_H, rowH - 4);

  const place = (file: SSTable, rowIndex: number) => {
    const min = sstableMinKey(file);
    const max = sstableMaxKey(file);
    const left = min === null ? AXIS_X : axis.xFor(min);
    const right = max === null ? left : axis.xFor(max);
    return {
      x: left,
      width: Math.max(MIN_FILE_W, right - left),
      y: HEADER_H + rowIndex * rowH + (rowH - fileH) / 2,
    };
  };

  // Overlap band: ≥2 files picked as "active" → highlight their shared range.
  let overlap: { x: number; width: number; top: number; bottom: number } | null = null;
  const activeFiles = files.filter((f) => roles.get(f.id) === "active");
  if (activeFiles.length >= 2) {
    let overlapMin: string | null = null;
    let overlapMax: string | null = null;
    for (const f of activeFiles) {
      const min = sstableMinKey(f);
      const max = sstableMaxKey(f);
      if (min === null || max === null) continue;
      if (overlapMin === null || min > overlapMin) overlapMin = min;
      if (overlapMax === null || max < overlapMax) overlapMax = max;
    }
    if (overlapMin !== null && overlapMax !== null && overlapMin <= overlapMax) {
      let top = Number.POSITIVE_INFINITY;
      let bottom = 0;
      for (const f of activeFiles) {
        const l0Row = l0.indexOf(f);
        const levelIndex = levels.findIndex((level) => level.includes(f));
        const rowIndex = l0Row >= 0 ? l0Row : levelIndex >= 0 ? l0.length + levelIndex : -1;
        if (rowIndex < 0) continue;
        const y = HEADER_H + rowIndex * rowH;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y + fileH);
      }
      overlap = {
        x: axis.xFor(overlapMin),
        width: Math.max(MIN_FILE_W, axis.xFor(overlapMax) - axis.xFor(overlapMin)),
        top,
        bottom,
      };
    }
  }

  const header =
    strategy === "leveled"
      ? `L0 (${l0.length}) · overlapping ranges · oldest first · L1+ disjoint, one run per level`
      : `L0 (${l0.length}) · unordered sorted runs (stcs)`;

  return (
    <g>
      <text x={0} y={11} fontSize={10} fill="currentColor">
        {header}
      </text>

      {overlap && (
        <rect
          data-overlap-band="true"
          x={overlap.x - 3}
          y={overlap.top}
          width={overlap.width + 6}
          height={overlap.bottom - overlap.top}
          fill={vizVar("active")}
          opacity={0.14}
          stroke={vizVar("active")}
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )}

      {l0.length > 0 && (
        <text
          x={0}
          y={HEADER_H + (rowH - fileH) / 2 + fileH / 2 + 3}
          fontSize={9}
          fill="currentColor"
          opacity={0.75}
        >
          L0
        </text>
      )}

      {l0.map((file, i) => {
        const at = place(file, i);
        return (
          <FileGlyph
            key={file.id}
            file={file}
            x={at.x}
            width={at.width}
            y={at.y}
            height={fileH}
            roles={roles}
            reducedMotion={reducedMotion}
          />
        );
      })}

      {levels.map((level, li) => (
        <g key={`L${li + 1}`}>
          <text
            x={0}
            y={HEADER_H + (l0.length + li) * rowH + (rowH - fileH) / 2 + fileH / 2 + 3}
            fontSize={9}
            fill="currentColor"
            opacity={0.75}
          >
            {`L${li + 1}`}
          </text>
          {level.map((file) => {
            const at = place(file, l0.length + li);
            return (
              <FileGlyph
                key={file.id}
                file={file}
                x={at.x}
                width={at.width}
                y={at.y}
                height={fileH}
                roles={roles}
                reducedMotion={reducedMotion}
              />
            );
          })}
        </g>
      ))}
    </g>
  );
}
