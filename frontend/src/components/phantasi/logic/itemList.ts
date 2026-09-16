/** Keyset continuations are opaque server tokens. Page offset is first-request only. */

export function itemListHasMore(
  nextCursor: string | null | undefined,
  itemCount: number,
  perPage: number,
): boolean {
  if (nextCursor !== undefined) return Boolean(nextCursor)
  return perPage > 0 && itemCount >= perPage
}

export function itemListRequest(input: {
  cursor?: string | null
  page?: number
  perPage: number
}): { cursor?: string; page?: number; per_page: number } {
  const cursor = input.cursor?.trim()
  if (cursor) {
    return { cursor, per_page: input.perPage }
  }
  return {
    page: input.page,
    per_page: input.perPage,
  }
}
