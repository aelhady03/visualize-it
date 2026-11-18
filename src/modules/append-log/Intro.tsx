/**
 * append-log Intro — the module home primer (VizModule.Intro).
 *
 * The pedagogical briefing (PLAN.md §4 "Module briefing"): why it exists,
 * tradeoffs, the questions it answers, ask-yourself questions with
 * expandable answers, and when to use it / not to use it. Every fact here
 * mirrors the engine: write, read (backward scan), compact, and the
 * dedupe-on-compact setting.
 */

export function AppendLogIntro() {
  return (
    <div className="flex flex-col gap-5 text-[1.0625rem] leading-[1.65]">
      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">Why it exists</h2>
        <p>
          An append-only log exists for one question: how do you make writes fast and crash-safe
          when disk seeks are slow? Never seek: append every write, updates included, to the
          file&apos;s end; only a half-written tail entry can be lost in a crash.
        </p>
        <p className="mt-2">
          Reads scan backward from the tail to the newest version of a key, the trick a
          write-ahead log borrows for durability. Add a key-to-offset hash index and you get
          Bitcask.
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
                <td className="px-3 py-2 align-top">Writes are O(1): append, never seek</td>
                <td className="px-3 py-2 align-top">Reads are O(n): a miss scans everything</td>
              </tr>
              <tr className="bg-band/50">
                <td className="px-3 py-2 align-top">Recovery is cheap: only the tail entry is at risk</td>
                <td className="px-3 py-2 align-top">Stale versions waste space until compact</td>
              </tr>
              <tr>
                <td className="px-3 py-2 align-top">compact reclaims space in one pass</td>
                <td className="px-3 py-2 align-top">compact rewrites the log: I/O now, space later</td>
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
          <li>How do you make writes fast when disk seeks are slow?</li>
          <li>Why is recovery cheap without in-place edits?</li>
          <li>What does a read cost with no index?</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">Ask yourself</h2>
        <div className="border-b border-rule">
          <details className="border-t border-rule py-2">
            <summary className="cursor-pointer select-none font-[600]">
              Why is a write O(1) but a miss O(n)?
            </summary>
            <p className="mt-1.5 text-ink-soft">Appends never seek; a miss scans every entry.</p>
          </details>
          <details className="border-t border-rule py-2">
            <summary className="cursor-pointer select-none font-[600]">
              Why is an update an append, not an edit?
            </summary>
            <p className="mt-1.5 text-ink-soft">
              Appending stays sequential, keeps the old version intact, newest position wins.
            </p>
          </details>
          <details className="border-t border-rule py-2">
            <summary className="cursor-pointer select-none font-[600]">
              When does compact reclaim nothing?
            </summary>
            <p className="mt-1.5 text-ink-soft">
              With dedupe-on-compact off it copies every entry, reclaiming nothing.
            </p>
          </details>
        </div>
      </section>

      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">When to use it</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Write-heavy, durable-first data: audit logs, metrics, events</li>
          <li>When simplicity beats read speed</li>
          <li>As the write-ahead log inside a bigger engine</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">When not to use it</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Read-heavy point lookups: every read scans</li>
          <li>Range queries: entries sit in write order, not key order</li>
          <li>Tight space, frequent updates: stale versions wait for compact</li>
        </ul>
      </section>
    </div>
  )
}
