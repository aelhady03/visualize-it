/**
 * BloomView — STUB.
 *
 * Lane: the READ lane replaces this file with the bloom filter region
 * (PLAN.md §5.2 Read): for the files the current read probed, the 16-bit
 * k=2 bit array (core primitive: BitArray) with the hash → bit positions
 * lit for the read key; "definitely not" vs "maybe" verdicts, and the
 * deliberate false-positive branch (bloom says maybe, scan finds nothing).
 * Decide which file's filter to show from the highlights (hit/miss roles).
 *
 * Draws in local coordinates inside BLOOM_BAND (regions.ts);
 * render/index.tsx positions the group. Keep the exact export signature:
 *   export function BloomView(props: BloomViewProps)
 */

import { Box } from "@core/primitives";
import { BLOOM_BAND, type BloomViewProps } from "./regions";

export function BloomView(props: BloomViewProps) {
  const { l0, levels, reducedMotion } = props;
  return (
    <Box
      x={0}
      y={4}
      width={720}
      height={Math.min(40, BLOOM_BAND - 8)}
      tone="memtable"
      label={`Bloom filters — ${l0.length + levels.length} file(s) · STUB, read lane`}
      reducedMotion={reducedMotion}
    />
  );
}
