/**
 * Allocation.test.gs
 * ------------------
 * Run `runAllocationTests()` from the Apps Script editor (Run ▸) and read the
 * Execution log. Tests the PURE allocator only — no Sheets, no setup required.
 * This is the correctness-critical core; prove it green before anything else.
 */

function runAllocationTests() {
  var t = new TinyTest_();

  // Helper to build a range with sensible defaults.
  function R(seq, start, end, cursor, opts) {
    opts = opts || {};
    return {
      seq: seq, start: start, end: end, cursor: cursor,
      prefix: opts.prefix || '', pad: opts.pad || 0,
      status: opts.status || 'active',
    };
  }

  // 1. Simple single range.
  (function () {
    var res = planAllocation([R(1, 1, 5, 1)], 3);
    t.eq(res.ok, true, '1: ok');
    t.eqArr(res.ids, ['1', '2', '3'], '1: ids');
    t.eq(res.updates.length, 1, '1: one update');
    t.eq(res.updates[0].cursor, 4, '1: cursor advanced to 4');
    t.eq(res.updates[0].status, 'active', '1: still active');
  })();

  // 2. Batch spans two ranges (1-5 then 11-25), with a gap.
  (function () {
    var res = planAllocation([R(1, 1, 5, 1), R(2, 11, 25, 11)], 8);
    t.eq(res.ok, true, '2: ok');
    t.eqArr(res.ids, ['1', '2', '3', '4', '5', '11', '12', '13'], '2: spans gap');
    t.eq(res.updates[0].cursor, 6, '2: range1 cursor 6');
    t.eq(res.updates[0].status, 'exhausted', '2: range1 exhausted');
    t.eq(res.updates[1].cursor, 14, '2: range2 cursor 14');
    t.eq(res.updates[1].status, 'active', '2: range2 active');
  })();

  // 3. Consume a range exactly to its end → exhausted.
  (function () {
    var res = planAllocation([R(1, 1, 5, 1)], 5);
    t.eq(res.ok, true, '3: ok');
    t.eqArr(res.ids, ['1', '2', '3', '4', '5'], '3: ids');
    t.eq(res.updates[0].cursor, 6, '3: cursor 6');
    t.eq(res.updates[0].status, 'exhausted', '3: exhausted');
  })();

  // 4. Not enough IDs → all-or-nothing, allocate nothing.
  (function () {
    var res = planAllocation([R(1, 1, 5, 1)], 6);
    t.eq(res.ok, false, '4: not ok');
    t.eq(res.reason, 'INSUFFICIENT_IDS', '4: reason');
    t.eq(res.available, 5, '4: reports 5 available');
  })();

  // 5. Exhausted ranges and cursors past end are ignored.
  (function () {
    var res = planAllocation([
      R(1, 1, 5, 6, { status: 'exhausted' }),   // marked exhausted
      R(2, 11, 12, 13),                          // cursor past end (0 free)
      R(3, 20, 22, 20),                          // 3 free
    ], 2);
    t.eq(res.ok, true, '5: ok');
    t.eqArr(res.ids, ['20', '21'], '5: only from usable range');
    t.eq(res.updates.length, 1, '5: one range touched');
    t.eq(res.updates[0].seq, 3, '5: seq 3 touched');
  })();

  // 6. Real courier format: prefix "R" + 10-digit zero-padded number.
  (function () {
    var res = planAllocation(
      [R(1, 1001016868, 1001016876, 1001016868, { prefix: 'R', pad: 10 })], 3);
    t.eq(res.ok, true, '6: ok');
    t.eqArr(res.ids, ['R1001016868', 'R1001016869', 'R1001016870'], '6: formatted ids');
  })();

  // 7. Ranges supplied out of seq order are still consumed oldest-first.
  (function () {
    var res = planAllocation([R(2, 11, 15, 11), R(1, 1, 2, 1)], 3);
    t.eq(res.ok, true, '7: ok');
    t.eqArr(res.ids, ['1', '2', '11'], '7: seq order honoured');
  })();

  // 8. Invalid counts.
  (function () {
    t.eq(planAllocation([R(1, 1, 5, 1)], 0).reason, 'INVALID_COUNT', '8a: zero');
    t.eq(planAllocation([R(1, 1, 5, 1)], -2).reason, 'INVALID_COUNT', '8b: negative');
    t.eq(planAllocation([R(1, 1, 5, 1)], 2.5).reason, 'INVALID_COUNT', '8c: non-integer');
  })();

  // 9. Resume from a partially-consumed range (cursor in the middle).
  (function () {
    var res = planAllocation([R(1, 1, 10, 7)], 2);  // 7,8,9,10 free → take 7,8
    t.eq(res.ok, true, '9: ok');
    t.eqArr(res.ids, ['7', '8'], '9: resumes at cursor');
    t.eq(res.updates[0].cursor, 9, '9: cursor 9');
    t.eq(res.updates[0].status, 'active', '9: still active');
  })();

  // 10. Empty / no ranges.
  (function () {
    var res = planAllocation([], 1);
    t.eq(res.ok, false, '10: not ok');
    t.eq(res.available, 0, '10: zero available');
  })();

  // 11. Purity: input ranges are not mutated.
  (function () {
    var input = [R(1, 1, 5, 1)];
    planAllocation(input, 2);
    t.eq(input[0].cursor, 1, '11: input cursor untouched');
    t.eq(input[0].status, 'active', '11: input status untouched');
  })();

  t.summary();
  return t.failed === 0;
}

/* ----------------------------- tiny test util ----------------------------- */

function TinyTest_() {
  this.passed = 0;
  this.failed = 0;
}
TinyTest_.prototype.eq = function (got, want, label) {
  if (got === want) {
    this.passed++;
  } else {
    this.failed++;
    Logger.log('FAIL ' + label + ' — got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
  }
};
TinyTest_.prototype.eqArr = function (got, want, label) {
  this.eq(JSON.stringify(got), JSON.stringify(want), label);
};
TinyTest_.prototype.summary = function () {
  Logger.log('-----');
  Logger.log((this.failed === 0 ? 'ALL PASSED' : 'SOME FAILED') +
    ' — ' + this.passed + ' passed, ' + this.failed + ' failed.');
};
