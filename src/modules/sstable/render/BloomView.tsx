/**
 * BloomView — the READ lane's bloom filter region (PLAN.md §5.2 Read).
 *
 * Props are FROZEN in render/regions.ts: { l0, levels, highlights, speed,
 * reducedMotion } — there is no op input and no metrics here, so everything
 * this region shows is derived from the state files plus the read steps'
 * highlights:
 *
 * - The read key comes from a synthetic highlight the read op emits on every
 *   step: `{ id: "readkey:<key>", role: "active" }` (see engine/read.ts, same
 *   constant duplicated there by design — engine/** is pure and may not
 *   import render/**). No "readkey:" highlight → this is not a read step and
 *   the region renders nothing.
 * - The probed files are the highlighted file entities (role hit/miss) among
 *   l0 + levels; the engine highlights exactly the file whose bloom filter
 *   the current step consulted. One file per read.l0 / read.level /
 *   read.bloom-false-positive step; read.done re-highlights the winning file.
 * - Hash → bit positions are computed with lib/bloom's hashPositions over the
 *   read key (the two k=2 positions), and the verdict is DERIVED, not stored:
 *   role hit → "maybe → hit"; role miss + maybe() → a false positive; role
 *   miss + !maybe() → "definitely not".
 *
 * Draws in LOCAL coordinates inside BLOOM_BAND (regions.ts); render/index.tsx
 * positions the group. BitArray cells get namespaced layoutIds
 * `bloom:<fileId>:b<i>` — the `bloom:` namespace keeps them distinct from the
 * LevelsView lane's `sstable:` strips (one element per layoutId per snapshot).
 * This region NEVER calls onAnimationComplete — render/index.tsx owns it.
 *
 * Keep the exact export signature:
 *   export function BloomView(props: BloomViewProps)
 */

import { BitArray } from "@core/primitives";
import type { Highlight } from "@core/engine-contract";
import type { SSTable } from "../state";
import { hashPositions, maybe } from "../lib/bloom";
import { BLOOM_BAND, type BloomViewProps } from "./regions";

/** See engine/read.ts — the read op carries its key through a highlight id. */
const READKEY_PREFIX = "readkey:";

/** Row height per probed file inside the band. */
const ROW_H = 34;

export function BloomView(props: BloomViewProps) {
  const { l0, levels, highlights, reducedMotion } = props;

  const probe = highlights.find((h) => h.id.startsWith(READKEY_PREFIX));
  if (probe === undefined) return null; // not a read step
  const key = probe.id.slice(READKEY_PREFIX.length);

  // The probed files: highlighted file entities (role hit/miss), de-duplicated
  // by id so read.done's recap (entry + file highlights) stays one row.
  const files = [...l0, ...levels.flat()];
  const probed = new Map<string, { file: SSTable; role: Highlight["role"] }>();
  for (const hl of highlights) {
    if (hl.role !== "hit" && hl.role !== "miss") continue;
    const file = files.find((f) => f.id === hl.id);
    if (file !== undefined) probed.set(file.id, { file, role: hl.role });
  }
  if (probed.size === 0) return null; // memtable probes: no bloom consulted yet

  const positions = hashPositions(key);
  const maxRows = Math.max(1, Math.floor((BLOOM_BAND - 8) / ROW_H));

  return (
    <g aria-label={`Bloom filter probes for "${key}"`}>
      {[...probed.values()].slice(0, maxRows).map(({ file, role }, i) => {
        const isMaybe = maybe(file.bloom, key);
        const verdict =
          role === "hit"
            ? "maybe → hit"
            : isMaybe
              ? "maybe, scan found nothing — false positive"
              : "definitely not";
        return (
          <BitArray
            key={file.id}
            x={0}
            y={4 + i * ROW_H}
            bits={file.bloom}
            cell={9}
            gap={2}
            highlight={positions}
            role={role === "hit" ? "hit" : "miss"}
            layoutId={`bloom:${file.id}`}
            label={`${file.id} · "${key}": ${verdict}`}
            reducedMotion={reducedMotion}
          />
        );
      })}
    </g>
  );
}
