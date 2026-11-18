/**
 * _fixture Render — a minimal SVG view of the append-only list.
 *
 * The list is drawn as rows: committed items in insertion order plus a dashed
 * "staged" ghost while `pending` is set. Highlights color rows by role using
 * the semantic `--viz-*` tokens.
 *
 * `onAnimationComplete()` is called from an effect on every snapshot change:
 * the fixture's transitions are fast and autoplay pacing is dominated by the
 * narration reading time, so reporting completion immediately is honest here.
 * It also guarantees the callback fires when there is nothing to animate
 * (an empty list), as the contract requires.
 */

import { useEffect } from "react";
import { motion } from "motion/react";
import type { RenderProps } from "@core/view-contract";
import type { FixtureItem, FixtureState } from "../state";

// Rows are tinted at TINT opacity with a full-strength stroke, and text
// sits in `--viz-text` (ribbon ink), so cells stay legible in both light
// and dark without painting ink over a solid fill (DESIGN.md "Color").
const TINT = 0.18;

const ROLE_FILLS: Record<string, string> = {
  active: "var(--viz-active)",
  hit: "var(--viz-hit)",
  miss: "var(--viz-miss)",
  removed: "var(--viz-removed)",
  new: "var(--viz-new)",
};

const ROW_H = 36;
const ROW_Y = (index: number) => 16 + index * ROW_H;

interface RowProps {
  item: FixtureItem;
  index: number;
  role?: string;
  ghost?: boolean;
  direction: 1 | -1;
  speed: number;
  reducedMotion: boolean;
}

function Row({ item, index, role, ghost, direction, speed, reducedMotion }: RowProps) {
  const y = ROW_Y(index);
  const fill = (role && ROLE_FILLS[role]) || "var(--viz-memtable)";
  const content = (
    <>
      <rect
        x={24}
        y={y}
        width={352}
        height={28}
        rx={6}
        fill={fill}
        fillOpacity={TINT}
        stroke={ghost ? "var(--viz-tombstone)" : fill}
        strokeOpacity={1}
        strokeWidth={1}
        strokeDasharray={ghost ? "4 3" : undefined}
      />
      <text x={36} y={y + 19} fontSize={13} fill="var(--viz-text)">
        {ghost ? `+ ${item.value} (staged)` : item.value}
      </text>
      <text x={352} y={y + 19} textAnchor="end" fontSize={11} fill="var(--viz-text)" fillOpacity={0.62}>
        seq {item.seq}
      </text>
    </>
  );
  if (reducedMotion) return <g key={item.id}>{content}</g>;
  return (
    <motion.g
      key={item.id}
      initial={{ opacity: 0, x: 12 * direction }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35 / speed }}
    >
      {content}
    </motion.g>
  );
}

export function FixtureRender(props: RenderProps<FixtureState>) {
  const { state, direction, speed, reducedMotion, highlights, onAnimationComplete } = props;

  // Report the transition settled on every snapshot change (see header note).
  useEffect(() => {
    onAnimationComplete();
  }, [state, onAnimationComplete]);

  const roleFor = new Map(highlights.map((highlight) => [highlight.id, highlight.role]));
  const rowCount = state.items.length + (state.pending ? 1 : 0);
  const height = 48 + Math.max(rowCount, 1) * ROW_H;

  return (
    <svg
      width={400}
      height={height}
      viewBox={`0 0 400 ${height}`}
      role="img"
      aria-label="Append-only list"
    >
      <rect x={0} y={0} width={400} height={height} rx={8} fill="var(--viz-surface)" />
      <text x={12} y={16} fontSize={11} fill="var(--viz-text)" fillOpacity={0.7}>
        append-only list · capacity {state.capacity}
      </text>
      {rowCount === 0 ? (
        <text
          x={200}
          y={height / 2 + 5}
          textAnchor="middle"
          fontSize={14}
          fill="var(--viz-text)"
          fillOpacity={0.7}
        >
          empty list
        </text>
      ) : (
        state.items.map((item, index) => (
          <Row
            key={item.id}
            item={item}
            index={index}
            role={roleFor.get(item.id)}
            direction={direction}
            speed={speed}
            reducedMotion={reducedMotion}
          />
        ))
      )}
      {state.pending ? (
        <Row
          item={state.pending}
          index={state.items.length}
          role="new"
          ghost
          direction={direction}
          speed={speed}
          reducedMotion={reducedMotion}
        />
      ) : null}
    </svg>
  );
}
