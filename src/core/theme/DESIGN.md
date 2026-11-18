# Visualize It: design plan

**Concept: a run printout on a lab bench.** Storage engines are logs, sorted tables and
files of blocks. Their native artifact is the *printout*: fan-fold green-bar paper where
every line is a record, read with a highlighter in one hand and a blue pen in the other.
The app shows the engine as an instrument (the diagram) and its narration as that
printout, with the current line highlighted and the "why" written in pen.

## Color (light / dark)

| Name        | Light     | Dark      | Role                                                |
| ----------- | --------- | --------- | --------------------------------------------------- |
| Paper       | `#f3f6f2` | `#151c27` | Page. Cool and slightly green, never cream.         |
| Green bar   | `#e1ece0` | `#1b2533` | Alternate rows of the run log and the module table. |
| Ribbon ink  | `#1c2537` | `#e2e7ee` | Text and diagram strokes. A navy ribbon, not #111.  |
| Pen blue    | `#2443a6` | `#93abff` | Actions, links, focus rings, and "new" entities.    |
| Highlighter | `#f2e45c` | `#5b5222` | Only the current step: the line you are reading.    |
| Bezel       | `#dfe5e4` | `#0f141d` | The instrument well around the diagram.             |

Entity tokens (`--viz-*`) keep Okabe-Ito hue order, so they stay colorblind-safe, and are
retuned to sit on the paper: WAL ochre, MemTable plum, file steel blue, tombstone graphite
with a cross glyph (shape and color). Primitives fill with a 16–22% tint and stroke at
full strength, so ribbon-ink text stays readable inside every cell.

## Type

One variable family, **Recursive**, used in two voices through its axes (no second family):

- *Printed* (`MONO 1, CASL 0`): data. Keys, values, seq numbers, step kinds, the step counter.
- *Read* (`MONO 0, CASL 0`): UI and narration prose.
- *Pen* (`MONO 0, CASL 1`): only the "why this matters" note, the human annotation.

Scale (1.25, 16px base): 12.8 / 14 / 16 / 20 / 25 / 31 / 39. Narration 17px/1.6 at most
62ch wide. Headings are sentence case at weight 650 with -0.01em tracking. No all-caps labels.

## Layout

Viewer: the instrument on the left, the printout on the right, with the transport bolted
under the instrument.

```
┌ modules ┐┌ Append-only log      (Guided|Sandbox)  [Write] [Read] [Compact] ┐
│ Storage ││ ┌ well: dot grid, ruler ticks ────────────┐ ┌ run log ─────────┐  │
│  engines││ │ wal.append                  step 5 / 14 │ │ 3  ...           │  │
│  · log  ││ │                                          │ │ 4  ...           │  │
│         ││ │        diagram, scaled to fit            │ │▓5  current line▓ │  │
│         ││ ├──────────────────────────────────────────┤ │ ✎ why (pen)      │  │
│         ││ │ |◀ ▶ ▶| ⏭  ━━━┿━━━●━━┿━━━━━   1×  undo  │ │ metrics table    │  │
└─────────┘└─┴──────────────────────────────────────────┴─┴──────────────────┴──┘
```
Below 1280px the run log stacks under the instrument and the module list becomes a top strip.

Module list: the index *is* a sorted table. One row per module on green-bar bands, keyed by
id in the printed voice, title and plain description in the read voice. Above it, the only
orchestrated motion in the app: five keys append in write order, then slide into sorted
order (log, then sort: the idea every module builds on). Reduced motion shows the end state.

Alignment: everything left-aligned to one text edge; numbers right-aligned in tables.

## Principles

1. The diagram is the hero. The shell is paper and ink so entity colors are the only color.
2. Color has one meaning each: pen blue = you can act / newly written, highlighter = now.
3. Data looks printed, prose looks read, explanation looks handwritten.
4. Radius follows hierarchy: well 10px, controls 6px, cells 3px. No drop shadows; the
   well is inset.
5. Motion answers the player: steps slide in the playback direction, the highlighter
   moves with the current line. Nothing loops except an active highlight pulse.

## Pass 2: critique against the generic tells

- *Cream + terracotta*: first draft used a warm `#f5f1e6` paper. Revised to cool `#f3f6f2`
  (green-bar stock) with pen blue as the accent.
- *Dark + single acid accent*: an oscilloscope-green dark mode was the obvious "instrument".
  Dropped; dark mode is the same printout on navy, with the same two accents.
- *Monospace for small labels*: kept for data only (keys, kinds, counts), because those are
  records. UI labels and buttons use the read voice.
- *Identical rounded cards*: the module list was cards; now table rows. Panels are not cards:
  the well is inset, the run log is paper with bands, no shared shadow.
- *ALL-CAPS eyebrows, 'A · B · C' meta, '→' on links*: removed ("NARRATION", "METRICS",
  "Open the lab →", "1 operation · 1 setting"). Meta becomes table columns.
- *Hairline broadsheet rules*: rules appear only where the paper metaphor needs them
  (row bands, tear line between steps), never as decoration.
