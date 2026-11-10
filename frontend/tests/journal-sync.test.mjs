import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJournalSyncResult } from "../app/journal-sync.ts";

test("journal sync accepts current and legacy response shapes", () => {
  assert.deepEqual(parseJournalSyncResult({ created: 2, closed: 0, more: true }), { created: 2, closed: 0, more: true });
  assert.deepEqual(parseJournalSyncResult({ created: 0 }), { created: 0, closed: undefined, more: undefined });
});

test("journal sync rejects malformed counts and backlog indicators", () => {
  for (const body of [null, {}, { created: "2" }, { created: -1 }, { created: 0.5 }, { created: 0, closed: -1 }, { created: 0, more: "false" }]) {
    assert.throws(() => parseJournalSyncResult(body), /invalid response/);
  }
});
