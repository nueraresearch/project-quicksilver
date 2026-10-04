/**
 * Honest truncation for capped lists. A store fetches `limit + 1` rows; if the extra row came back, the cap
 * cut the result and `truncated` is true. A list that happens to hold exactly `limit` rows is not truncated.
 */
export function capRows<T>(rows: T[], limit: number): { rows: T[]; truncated: boolean } {
  return { rows: rows.slice(0, limit), truncated: rows.length > limit }
}
