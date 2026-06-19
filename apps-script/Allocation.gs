/**
 * Allocation.gs
 * -------------
 * PURE tracking-ID allocator. No Sheets, no I/O, no locking here — so this
 * (the correctness-critical part) is fully unit-testable in isolation.
 *
 * Tracking IDs arrive as disjoint numeric ranges with a courier prefix, e.g.
 * prefix "R" + 10-digit number: R1001016868 .. R1001016876, plus separate
 * blocks like R3000724201. Each range is consumed in `seq` order (oldest first)
 * and a single batch may span several ranges.
 *
 * The two invariants that make duplicates impossible:
 *   1. All-or-nothing: if the total free count can't cover `count`, allocate
 *      NOTHING (no partial batches).
 *   2. Monotonic cursor: a range's `cursor` is the next free number; we only
 *      ever hand out cursor..end and advance the cursor. A number below the
 *      cursor can never be issued again.
 *
 * The caller (GenerateLabels.gs) runs this inside a LockService critical
 * section and persists the cursor advance, which together guarantee that no
 * two concurrent allocations can ever produce the same ID.
 */

/**
 * @param {Array<Object>} ranges  Each: {seq, prefix, start, end, pad, cursor, status}
 *   - start/end/cursor: NUMBERS (numeric part of the ID)
 *   - cursor: next unused number in the range (initialised to `start`)
 *   - status: 'active' | 'exhausted'
 *   - prefix/pad: format the ID as prefix + String(n).padStart(pad, '0')
 * @param {number} count  IDs to allocate (= number of packets/orders).
 * @return {Object}
 *   success: {ok:true, ids:[String,...], updates:[{seq, cursor, status}, ...]}
 *   failure: {ok:false, reason:'INVALID_COUNT'|'INSUFFICIENT_IDS', available:Number}
 */
function planAllocation(ranges, count) {
  if (!Number.isInteger(count) || count <= 0) {
    return { ok: false, reason: 'INVALID_COUNT', available: 0 };
  }

  // Active ranges only, oldest first.
  var active = (ranges || [])
    .filter(function (r) { return r && String(r.status).trim() === 'active'; })
    .slice()
    .sort(function (a, b) { return Number(a.seq) - Number(b.seq); });

  // 1) Availability check FIRST → all-or-nothing, never a partial allocation.
  var totalAvailable = 0;
  active.forEach(function (r) { totalAvailable += freeInRange_(r); });
  if (totalAvailable < count) {
    return { ok: false, reason: 'INSUFFICIENT_IDS', available: totalAvailable };
  }

  // 2) Walk and take, possibly spanning multiple ranges.
  var ids = [];
  var updates = [];
  var remaining = count;
  for (var i = 0; i < active.length && remaining > 0; i++) {
    var r = active[i];
    var avail = freeInRange_(r);
    if (avail <= 0) continue;

    var take = Math.min(remaining, avail);
    for (var k = 0; k < take; k++) {
      ids.push(formatTrackingId_(r, r.cursor + k));
    }
    var newCursor = r.cursor + take;            // next free number
    var newStatus = newCursor > r.end ? 'exhausted' : 'active';
    updates.push({ seq: r.seq, cursor: newCursor, status: newStatus });
    remaining -= take;
  }

  // remaining is guaranteed 0 here, because totalAvailable >= count.
  return { ok: true, ids: ids, updates: updates };
}

/** Free numbers left in a range. cursor = next free; if cursor > end, none. */
function freeInRange_(r) {
  var c = Number(r.cursor);
  var e = Number(r.end);
  if (!isFinite(c) || !isFinite(e)) return 0;
  return Math.max(0, e - c + 1);
}

/** Format the numeric id `n` for a range: prefix + zero-padded number. */
function formatTrackingId_(r, n) {
  var prefix = (r.prefix == null) ? '' : String(r.prefix);
  var pad = Number.isInteger(r.pad) ? r.pad : 0;
  return prefix + String(n).padStart(pad, '0');
}
