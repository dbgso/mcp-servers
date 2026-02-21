/**
 * Cursor-based pagination utilities for MCP responses.
 *
 * Cursor format: base64 encoded offset (opaque to clients)
 */

/**
 * Pagination parameters accepted by paginated tools.
 */
export interface PaginationParams {
  /** Opaque cursor from previous response */
  cursor?: string;
  /** Maximum items to return. If not specified, returns all items. */
  limit?: number;
}

/**
 * Paginated response wrapper.
 */
export interface PaginatedResponse<T> {
  /** The data items for this page */
  data: T[];
  /** Total number of items (before pagination) */
  total: number;
  /** Cursor for the next page (undefined if no more items) */
  nextCursor?: string;
  /** Whether there are more items after this page */
  hasMore: boolean;
}

/**
 * Encode an offset into an opaque cursor string.
 */
export function encodeCursor(offset: number): string {
  return Buffer.from(`offset:${offset}`).toString("base64");
}

/**
 * Decode a cursor string back to an offset.
 * Returns 0 if cursor is invalid or undefined.
 */
export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;

  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    const match = decoded.match(/^offset:(\d+)$/);
    if (match) {
      return parseInt(match[1], 10);
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Apply pagination to an array of items.
 *
 * @param params.items - Full array of items to paginate
 * @param params.pagination - Pagination parameters (cursor and limit)
 * @returns Paginated response with data, total, nextCursor, and hasMore
 *
 * @example
 * ```typescript
 * const allItems = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
 *
 * // First page
 * const page1 = paginate({ items: allItems, pagination: { limit: 3 } });
 * // { data: [1, 2, 3], total: 10, nextCursor: "b2Zmc2V0OjM=", hasMore: true }
 *
 * // Next page
 * const page2 = paginate({ items: allItems, pagination: { cursor: page1.nextCursor, limit: 3 } });
 * // { data: [4, 5, 6], total: 10, nextCursor: "b2Zmc2V0OjY=", hasMore: true }
 *
 * // All items (no limit)
 * const all = paginate({ items: allItems, pagination: {} });
 * // { data: [1, 2, 3, ...], total: 10, hasMore: false }
 * ```
 */
export function paginate<T>(params: {
  items: T[];
  pagination: PaginationParams;
}): PaginatedResponse<T> {
  const { items, pagination } = params;
  const total = items.length;
  const offset = decodeCursor(pagination.cursor);

  // If no limit, return all items from offset
  if (pagination.limit === undefined) {
    const data = items.slice(offset);
    return {
      data,
      total,
      hasMore: false,
    };
  }

  const limit = pagination.limit;
  const data = items.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;

  return {
    data,
    total,
    nextCursor: hasMore ? encodeCursor(nextOffset) : undefined,
    hasMore,
  };
}
