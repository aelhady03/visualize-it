/**
 * sstable Intro — the module home primer (VizModule.Intro), PLAN.md §6.
 * Written ONCE by the Wave 3 module lead (lane: lead).
 */

export function SstableIntro() {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed">
      <p>
        An <strong>SSTable</strong> (Sorted Strings Table) is an immutable, sorted file that
        carries its own sparse index and bloom filter, so a read can skip almost all of it.
        An <strong>LSM-tree</strong> (log-structured merge-tree) chains those files behind an
        in-memory <strong>MemTable</strong>: every write is made durable in a write-ahead log,
        then inserted into the MemTable, and when the table fills it is flushed to disk as a new
        SSTable — sorted data reaches disk for free, and writes never wait on disk I/O.
      </p>
      <p>
        Because files never change, an update or delete appends a newer version (or a{' '}
        <em>tombstone</em>) instead of editing anything; readers reconcile the newest version by
        sequence number. Reads probe newest data first — the bloom filter usually answers
        &quot;definitely not here&quot; without touching a block, and occasionally says
        &quot;maybe&quot; for a key that is not there.
      </p>
      <p>
        <strong>Compaction</strong> merges files to drop stale versions and tombstones, keeping
        reads and space bounded. This module simulates both strategies — size-tiered buckets and
        leveled disjoint ranges — and the trade-offs surface as live write, read and space
        amplification counters.
      </p>
    </div>
  );
}
