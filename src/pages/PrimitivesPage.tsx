// PrimitivesPage — '/primitives': a specimen sheet of the shared diagram
// parts (@core/primitives) in every tone and role, for module authors.
// It renders the real components, so it doubles as a visual regression check.

import { Arrow, BitArray, Box, FileShape, KeyCell } from '@core/primitives'
import type { Highlight } from '@core/engine-contract'

const ROLES: Highlight['role'][] = ['active', 'hit', 'miss', 'new', 'removed', 'stale']

function Specimen({ title, note, children, height }: { title: string; note: string; children: React.ReactNode; height: number }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-[1.0625rem] font-[650]">{title}</h2>
        <p className="max-w-[64ch] text-[0.9375rem] text-ink-soft">{note}</p>
      </div>
      <div className="viz-stage overflow-x-auto rounded-[7px] p-4 text-viz-text">
        <svg width={640} height={height} viewBox={`0 0 640 ${height}`} className="h-auto max-w-full" role="img" aria-label={title}>
          {children}
        </svg>
      </div>
    </section>
  )
}

export function PrimitivesPage() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header>
        <h1 className="text-[2.4375rem] font-[760] leading-[1.05] tracking-[-0.025em]">Diagram parts</h1>
        <p className="mt-3 max-w-[60ch] text-[1.0625rem] leading-[1.6] text-ink-soft">
          Every module draws with these five parts from <span className="voice-printed">@core/primitives</span>.
          Tones say what an entity is; roles say what just happened to it.
        </p>
      </header>

      <Specimen
        title="KeyCell"
        note="One record: the key in bold, the value after a divider, the sequence number in its own tab. A tombstone is hatched and carries a headstone, so it reads without color."
        height={150}
      >
        <KeyCell x={8} y={14} label="apple" value="red" seq={4} tone="wal" />
        <KeyCell x={150} y={14} label="kiwi" value="green" seq={7} tone="memtable" />
        <KeyCell x={300} y={14} label="plum" value="purple" seq={9} tone="file" />
        <KeyCell x={460} y={14} label="mango" seq={12} tone="tombstone" />
        {ROLES.map((role, i) => (
          <KeyCell key={role} x={8 + (i % 3) * 210} y={64 + Math.floor(i / 3) * 44} label={role} value="v1" seq={i + 1} tone="file" role={role} reducedMotion />
        ))}
      </Specimen>

      <Specimen
        title="Box"
        note="A container: a light tint of its tone with a full-strength edge. Patterns mark tombstones (hatch and headstone) and removed entities (dashed)."
        height={90}
      >
        <Box x={8} y={14} width={140} height={56} tone="wal" label="WAL segment" />
        <Box x={168} y={14} width={140} height={56} tone="memtable" label="MemTable" role="active" reducedMotion />
        <Box x={328} y={14} width={140} height={56} tone="tombstone" pattern="tombstone" label="deleted" />
        <Box x={488} y={14} width={140} height={56} tone="file" pattern="removed" label="compacted away" />
      </Specimen>

      <Specimen
        title="FileShape"
        note="An SSTable on disk: banded data blocks labelled with their first key, then index and filter blocks with a dotted edge."
        height={100}
      >
        <FileShape
          x={8}
          y={10}
          width={300}
          height={58}
          label="sst-0003"
          segments={[{ label: 'apple' }, { label: 'kiwi', role: 'hit' }, { label: 'mango' }, { label: 'plum' }]}
          footer={['index', 'filter']}
        />
        <FileShape x={340} y={10} width={180} height={58} label="sst-0004" role="new" segments={[{ label: 'a' }, { label: 'f' }]} reducedMotion />
      </Specimen>

      <Specimen
        title="BitArray"
        note="A bloom filter. Pointers show where a key's hashes land. If any pointed bit is empty, the key is definitely absent."
        height={110}
      >
        <BitArray x={8} y={24} bits={[1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0]} highlight={[2, 6, 13]} role="hit" cell={14} label="probe kiwi: maybe present" />
        <BitArray x={330} y={24} bits={[1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0]} highlight={[3, 5, 11]} role="miss" cell={14} label="probe fig: definitely absent" />
      </Specimen>

      <Specimen title="Arrow" note="Flow between parts. A role colors it; a label sits on a knocked-out background." height={70}>
        <Arrow from={{ x: 10, y: 40 }} to={{ x: 190, y: 40 }} label="flush" />
        <Arrow from={{ x: 230, y: 40 }} to={{ x: 410, y: 40 }} label="read" role="hit" />
        <Arrow from={{ x: 450, y: 40 }} to={{ x: 630, y: 40 }} label="compact" role="active" flow reducedMotion />
      </Specimen>
    </div>
  )
}
