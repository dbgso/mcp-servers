/**
 * Front matter read back from disk, typed with `keys` as strings -- or null
 * when any of them is missing or not a string, since such a file is not a
 * record of that kind.
 */
export function withStringFields<K extends string>(params: {
  metadata: Record<string, unknown>;
  keys: readonly K[];
}): (Record<string, unknown> & Record<K, string>) | null {
  const { metadata, keys } = params;
  if (!keys.every((key) => typeof metadata[key] === "string")) return null;
  return metadata as Record<string, unknown> & Record<K, string>;
}
