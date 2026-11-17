/**
 * append-log Intro — the module home primer (VizModule.Intro).
 */

export function AppendLogIntro() {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed">
      <p>
        An <strong>append-only log</strong> is a file you only ever add to. Every write, including
        an update to an existing key, goes to the end of the file. Nothing is edited in place.
      </p>
      <p>
        It is the simplest storage engine there is. Writes are as fast as the disk can go, because
        they are purely sequential. Crash recovery is easy, because a half-written tail entry is the
        only thing that can be damaged. The cost lands on reads: with no index, finding a key means
        scanning backward from the tail until its newest version turns up, and a miss scans the
        whole file.
      </p>
      <p>
        Two fixes build on this design. <strong>Compaction</strong> rewrites the log and keeps only
        the newest version of each key, so stale versions stop wasting space. A{' '}
        <strong>hash index</strong> keeps each key&apos;s latest offset in memory, so a read jumps
        straight to it. That pairing is Bitcask, the storage engine of Riak. Sorting the log instead
        gives you SSTables and LSM trees.
      </p>
    </div>
  )
}
