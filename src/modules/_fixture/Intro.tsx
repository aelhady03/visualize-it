/**
 * _fixture Intro — the module home primer (VizModule.Intro), PLAN.md §4
 * "Module briefing". This module is the conformance fixture, not a real
 * storage engine, and this primer says so: the same sections as the other
 * modules, kept short and honest.
 */

export function FixtureIntro() {
  return (
    <div className="flex flex-col gap-5 text-[1.0625rem] leading-[1.65]">
      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">Why it exists</h2>
        <p>
          This is not a storage engine. It is the conformance fixture: a tiny counter list that
          proves the contract, module discovery, player, conformance suite and SVG render work end
          to end. Read its files as the template for building your own module.
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
                <td className="px-3 py-2 align-top">Exercises every conformance check with real state</td>
                <td className="px-3 py-2 align-top">Teaches nothing about real storage engines</td>
              </tr>
              <tr className="bg-band/50">
                <td className="px-3 py-2 align-top">Documents module conventions by example</td>
                <td className="px-3 py-2 align-top">Deliberately trivial: append, clear, reset</td>
              </tr>
              <tr>
                <td className="px-3 py-2 align-top">Keeps the pipeline honest between modules</td>
                <td className="px-3 py-2 align-top">Not an instrument: it renders a plain list</td>
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
          <li>Does two-glob module discovery work?</li>
          <li>Can the player play, pause and step a real run?</li>
          <li>Do the seven conformance checks pass here?</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">Ask yourself</h2>
        <div className="border-b border-rule">
          <details className="border-t border-rule py-2">
            <summary className="cursor-pointer select-none font-[600]">
              Why does this module exist at all?
            </summary>
            <p className="mt-1.5 text-ink-soft">
              To prove the shared pipeline works before real engines depend on it.
            </p>
          </details>
          <details className="border-t border-rule py-2">
            <summary className="cursor-pointer select-none font-[600]">
              What does the append-then-clear arc show?
            </summary>
            <p className="mt-1.5 text-ink-soft">
              Append-only data cannot delete in place: clear resets wholesale.
            </p>
          </details>
          <details className="border-t border-rule py-2">
            <summary className="cursor-pointer select-none font-[600]">
              What should a new module author copy?
            </summary>
            <p className="mt-1.5 text-ink-soft">
              The pure state shape, kind-sequenced tests, and the conformance call.
            </p>
          </details>
        </div>
      </section>

      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">When to use it</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>As the scaffold for a new module</li>
          <li>To re-check the pipeline after a core change</li>
        </ul>
      </section>

      <section>
        <h2 className="mb-1.5 text-[1rem] font-[650] tracking-[-0.01em]">When not to use it</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>To learn storage engines: the log and SSTable modules do that</li>
          <li>As a base for real code: it is a spike, not an engine</li>
        </ul>
      </section>
    </div>
  )
}
