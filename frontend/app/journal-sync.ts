export type JournalSyncResult = { created: number; closed?: number; more?: boolean };

export function parseJournalSyncResult(body: unknown): JournalSyncResult {
  if (!body || typeof body !== "object" || !("created" in body)
      || typeof body.created !== "number" || !Number.isInteger(body.created) || body.created < 0
      || ("closed" in body && (typeof body.closed !== "number" || !Number.isInteger(body.closed) || body.closed < 0))
      || ("more" in body && typeof body.more !== "boolean")) {
    throw new Error("Journal sync returned an invalid response.");
  }
  return {
    created: body.created,
    closed: "closed" in body && typeof body.closed === "number" ? body.closed : undefined,
    more: "more" in body && typeof body.more === "boolean" ? body.more : undefined,
  };
}
