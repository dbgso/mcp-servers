/**
 * JsonPathReader trait — read rows by exact-match on a JSON path
 * within a whitelisted field.
 *
 * Currently only RDB has this today (findByJsonPath). If other
 * storages grow JSON-path reads (e.g. DDB expression `#col.foo.bar =
 * :v`), they implement this trait too.
 */

export interface JsonPathReader<TContainer, TRecord> {
  readByJsonPath(input: {
    container: TContainer;
    field: string;
    path: string;
    value: unknown;
    fields: readonly string[];
    limit: number;
  }): Promise<TRecord[]>;
}
