/**
 * hash-index Intro — the module home primer (VizModule.Intro).
 *
 * The pedagogical briefing (PLAN.md §4 "Module briefing"): why it exists,
 * tradeoffs, the questions it answers, ask-yourself questions with
 * expandable answers, and when to use it / not to use it. Every fact here
 * mirrors the engine: write (append + index set), read (lookup → seek),
 * compact (drop stale versions, rebuild the index).
 */

export function HashIndexIntro() {
  return (
    <div className="flex flex-col gap-5 text-[1.0625rem] leading-[1.65]">
      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">Why it exists</h2>
        <p>
          An append-only log makes writes fast but reads slow: every read scans from the tail. A
          hash index (the Bitcask idea) keeps the fast appends and fixes the reads by remembering,
          in RAM, where each key lives — key → byte offset. A read is then one hash lookup plus one
          disk seek, O(1) no matter how long the file grows.
        </p>
        <p className="mt-2">
          The price is paid twice: the whole index must fit in memory, and after a restart it is
          gone — it gets rebuilt by scanning the entire file once before the first query.
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
                <td className="px-3 py-2 align-top">Point reads are O(1): one lookup, one seek</td>
                <td className="px-3 py-2 align-top">The whole index lives in RAM, key by key</td>
              </tr>
              <tr className="bg-band/50">
                <td className="px-3 py-2 align-top">Misses cost zero disk I/O</td>
                <td className="px-3 py-2 align-top">
                  Restart rebuilds the index: an O(n) file scan
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2 align-top">Writes stay sequential appends</td>
                <td className="px-3 py-2 align-top">Stale versions waste space until compact</td>
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
          <li>How do you get constant-time point reads from an append-only file?</li>
          <li>What is the real cost of an index that lives in memory?</li>
          <li>Why does an update append a new version instead of editing in place?</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">Ask yourself</h2>
        <div className="border-b border-rule">
          <details className="border-t border-rule py-2">
            <summary className="cursor-pointer select-none font-[600]">
              Why is a read two steps, not a scan?
            </summary>
            <p className="mt-1.5 text-ink-soft">
              The index turns the key into an offset; the disk is touched once, at exactly that
              offset.
            </p>
          </details>
          <details className="border-t border-rule py-2">
            <summary className="cursor-pointer select-none font-[600]">
              Why does an update leave the old value behind?
            </summary>
            <p className="mt-1.5 text-ink-soft">
              Files are append-only; the index just repoints the key at the new offset and the old
              bytes wait for compaction.
            </p>
          </details>
          <details className="border-t border-rule py-2">
            <summary className="cursor-pointer select-none font-[600]">
              Why is restart expensive?
            </summary>
            <p className="mt-1.5 text-ink-soft">
              The index exists only in RAM; rebuilding it means reading every record in the file
              once before the first query.
            </p>
          </details>
        </div>
      </section>

      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">When to use it</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Few distinct keys, so the index stays small in RAM</li>
          <li>High write and read rates on point lookups — appends + one seek each</li>
          <li>Values larger than the index overhead per key</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">When not to use it</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Huge key counts: the index outgrows available memory</li>
          <li>Range scans: the file is in write order, not key order</li>
          <li>Restarts must be instant: rebuilding the index scans the whole file</li>
        </ul>
      </section>
    </div>
  )
}
