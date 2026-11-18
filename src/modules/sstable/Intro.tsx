/**
 * sstable Intro — the module home primer (VizModule.Intro), PLAN.md §4
 * "Module briefing": why it exists, tradeoffs, the questions it answers,
 * ask-yourself questions with expandable answers, when to use it and when
 * not to. Facts mirror the engine: WAL + MemTable + flush, seq-based
 * reconciliation, tombstones, the 16-bit teaching bloom filter, and both
 * compaction strategies behind the setting toggle.
 */

export function SstableIntro() {
  return (
    <div className="flex flex-col gap-5 text-[1.0625rem] leading-[1.65]">
      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">Why it exists</h2>
        <p>
          An <strong>LSM-tree</strong> makes writes fast and reads cheap. Writes land in a
          write-ahead log and a sorted in-memory <strong>MemTable</strong>, then flush as
          immutable <strong>SSTables</strong> with sparse index and bloom filter. Flushes run in
          the background: writes never wait on disk I/O.
        </p>
        <p className="mt-2">
          Update and delete append newer versions or tombstones; readers reconcile by sequence
          number. Compaction merges files, dropping stale versions and tombstones.
        </p>
      </section>

      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">Tradeoffs</h2>
        <div className="overflow-hidden rounded-[10px] border border-rule">
          <table className="w-full border-collapse text-[0.875rem] leading-[1.5]">
            <thead>
              <tr className="border-b border-rule">
                <th className="px-3 py-2 text-left font-[650]">Gain</th>
                <th className="px-3 py-2 text-left font-[650]">Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-3 py-2 align-top">Fast writes: WAL + MemTable, sequential flush</td>
                <td className="px-3 py-2 align-top">Write amplification: compaction rewrites bytes repeatedly</td>
              </tr>
              <tr className="bg-band/50">
                <td className="px-3 py-2 align-top">Cheap range scans: sorted runs, index, bloom</td>
                <td className="px-3 py-2 align-top">Read amplification: overlapping L0 files, more probes</td>
              </tr>
              <tr>
                <td className="px-3 py-2 align-top">Blind updates and deletes: no read-before-write</td>
                <td className="px-3 py-2 align-top">Tombstones take space until safely droppable</td>
              </tr>
              <tr className="bg-band/50">
                <td className="px-3 py-2 align-top">Leveled: one file per level per read</td>
                <td className="px-3 py-2 align-top">STCS: ~2x transient space; leveled compacts more</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">
          Questions this engine answers
        </h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>How does sorted data reach disk from random writes?</li>
          <li>How do you delete from a file you can never edit?</li>
          <li>How do you bound read amplification?</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">Ask yourself</h2>
        <div className="border-b border-rule">
          <details className="border-t border-rule py-2">
            <summary className="cursor-pointer select-none font-[600]">
              Who wins when two files hold the same key?
            </summary>
            <p className="mt-1.5 text-ink-soft">
              Highest seq; reads keep probing while newer files could still hold it.
            </p>
          </details>
          <details className="border-t border-rule py-2">
            <summary className="cursor-pointer select-none font-[600]">
              Why does the bloom filter say maybe?
            </summary>
            <p className="mt-1.5 text-ink-soft">
              The 16-bit filter collides on purpose: false positives cost a probe, never a wrong
              answer.
            </p>
          </details>
          <details className="border-t border-rule py-2">
            <summary className="cursor-pointer select-none font-[600]">
              When may compaction drop a tombstone?
            </summary>
            <p className="mt-1.5 text-ink-soft">
              Only when no older copy can exist outside the merge; drop early, data resurrects.
            </p>
          </details>
        </div>
      </section>

      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">When to use it</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Write-heavy workloads with reads and range scans</li>
          <li>Frequent updates and deletes: blind writes</li>
          <li>Watching live amplification counters</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">When not to use it</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Tiny data a hash map covers in memory</li>
          <li>Hard one-seek-per-read budgets: reads probe several files</li>
          <li>When write amplification hurts more than read latency</li>
        </ul>
      </section>
    </div>
  )
}
