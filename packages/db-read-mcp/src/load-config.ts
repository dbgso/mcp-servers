/**
 * Loaders for the user-supplied `metadata` and `selectable-fields` config.
 *
 * **Preferred format: JSON.** When the launcher is distributed as a `node`
 * binary it can't load `.ts` files, so the production wire format is
 * `metadata.json` + `selectable-fields.json`. Generate them with the
 * `db-codegen-mcp` `preview_metadata_json` / `preview_selectable_fields_json`
 * ops, then add `pii: true` + `piiReason: "..."` flags by hand on the
 * selectable-fields side.
 *
 * `.ts` / `.js` paths are still accepted for in-repo dev (vitest / tsx
 * environments where dynamic import works). The loader picks a code path
 * based purely on the file extension:
 *
 *   - `.json`          → `fs.readFileSync` + `JSON.parse`
 *   - `.ts` / `.tsx`   → dynamic `import()` (requires a TS-aware loader)
 *   - `.js` / `.mjs` / `.cjs` → dynamic `import()`
 *   - any other ext    → falls back to dynamic `import()` (best-effort)
 *
 * **Security note:** dynamic `import()` executes the loaded module — anyone
 * who can choose the `--metadata` / `--selectable-fields` path can run
 * arbitrary code in the MCP process. Treat those paths as you would a
 * `--script` flag. Production deployments should always use `.json`, which
 * is parsed as data and runs no code.
 *
 * Path normalisation rules (apply to both code paths):
 *   - `~`        → current user's home directory
 *   - `~/foo`    → `<home>/foo`
 *   - relative paths are resolved against `process.cwd()`
 *   - existing `file://` URLs pass through verbatim
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { TableMetadataMap, SelectableFieldsMap } from "mcp-shared-db";

/** Loader fn type — visible for test injection. */
export type DynamicImport = (specifier: string) => Promise<unknown>;
export type JsonReader = (filePath: string) => Promise<string>;

const defaultImporter: DynamicImport = (specifier) => import(specifier);
const defaultJsonReader: JsonReader = (p) => readFile(p, "utf8");

/**
 * Expand a leading `~` to the current user's home directory. Pure helper —
 * no I/O, no env access beyond `os.homedir()`.
 */
export function expandHome(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return path.join(homedir(), input.slice(2));
  return input;
}

/**
 * Convert a user-supplied path into something `import()` accepts. Already-
 * absolute file URLs pass through. Anything else is resolved against
 * `process.cwd()` and converted to a `file://` URL so dynamic import works
 * uniformly across ESM resolvers.
 */
export function toImportSpecifier(input: string): string {
  if (input.startsWith("file://")) return input;
  const expanded = expandHome(input);
  const absolute = path.isAbsolute(expanded)
    ? expanded
    : path.resolve(process.cwd(), expanded);
  return pathToFileURL(absolute).href;
}

/**
 * Resolve a user-supplied path to an absolute on-disk path for `fs` reads.
 * Mirrors `toImportSpecifier`'s normalisation but emits a plain path because
 * `fs.readFile` does not accept `file://` URLs in older Node versions.
 */
export function toFsPath(input: string): string {
  if (input.startsWith("file://")) return fileURLToPath(input);
  const expanded = expandHome(input);
  return path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded);
}

interface ModuleWithExport<TKey extends string, TValue> {
  // Index signature so we can type-narrow without casting through any.
  [key: string]: TValue | unknown;
  default?: { [k in TKey]?: TValue } | TValue;
}

interface PickExportParams<T> {
  mod: unknown;
  named: string;
  importPath: string;
  what: string;
  fallback: T;
}

function pickExport<T>(params: PickExportParams<T>): T {
  const { mod, named, importPath, what } = params;
  if (mod === null || typeof mod !== "object") {
    throw new Error(
      `Failed to load ${what} from ${importPath}: module did not return an object`,
    );
  }
  const m = mod as ModuleWithExport<string, T>;
  // Prefer the named export. Fall back to `default.<named>` (default-export
  // wrapping is common when authors use `export default { tableMetadata }`).
  if (named in m) {
    return m[named] as T;
  }
  if (m.default && typeof m.default === "object" && named in m.default) {
    const fromDefault = (m.default as { [k: string]: T })[named];
    return fromDefault ?? params.fallback;
  }
  throw new Error(
    `Module ${importPath} does not export '${named}' — required for ${what}`,
  );
}

export interface LoadConfigParams {
  /** Path to the user-supplied JSON / TS / JS file. */
  filePath: string;
  /** Test seam: override the dynamic importer (for non-JSON paths). */
  importer?: DynamicImport;
  /** Test seam: override the JSON reader (for `.json` paths). */
  jsonReader?: JsonReader;
}

function isJsonExt(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === ".json";
}

interface LoadJsonParams<T> {
  filePath: string;
  jsonReader: JsonReader;
  what: string;
}

async function loadJson<T>(params: LoadJsonParams<T>): Promise<T> {
  const { filePath, jsonReader, what } = params;
  const fsPath = toFsPath(filePath);
  let raw: string;
  try {
    raw = await jsonReader(fsPath);
  } catch (err) {
    throw new Error(
      `Failed to read ${what} from ${filePath}: ${(err as Error).message}`,
    );
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse ${what} JSON from ${filePath}: ${(err as Error).message}`,
    );
  }
}

interface LoadModuleParams<T> {
  filePath: string;
  importer: DynamicImport;
  named: string;
  what: string;
  fallback: T;
}

async function loadFromModule<T>(params: LoadModuleParams<T>): Promise<T> {
  const { filePath, importer, named, what, fallback } = params;
  // Whoever can swap this path can run code in the MCP process. Surface
  // it on stderr so a misconfigured `--metadata path/to/foo.ts` doesn't
  // slip past quietly. Production deployments should use `.json` instead.
  console.error(
    `[db-read-mcp] WARNING: loading ${what} from ${filePath} via dynamic import — code in this file will execute. Use a .json path in production.`,
  );
  const spec = toImportSpecifier(filePath);
  const mod = await importer(spec);
  return pickExport<T>({ mod, named, importPath: filePath, what, fallback });
}

/**
 * Load `tableMetadata` from a JSON or TS/JS module path.
 *
 * - `.json`: parsed directly. The file's contents must be the
 *   `tableMetadata` object itself (not wrapped in `{ tableMetadata: ... }`),
 *   matching the output of `preview_metadata_json`.
 * - `.ts` / `.js`: dynamic-imported, must export a `tableMetadata` named
 *   export (or a default whose `.tableMetadata` is the map).
 */
export async function loadMetadata(params: LoadConfigParams): Promise<TableMetadataMap> {
  if (isJsonExt(params.filePath)) {
    return loadJson<TableMetadataMap>({
      filePath: params.filePath,
      jsonReader: params.jsonReader ?? defaultJsonReader,
      what: "tableMetadata",
    });
  }
  return loadFromModule<TableMetadataMap>({
    filePath: params.filePath,
    importer: params.importer ?? defaultImporter,
    named: "tableMetadata",
    what: "tableMetadata",
    fallback: {},
  });
}

/**
 * Load `selectableFields` from a JSON or TS/JS module path.
 *
 * Same shape rules as `loadMetadata` — JSON files contain the map directly.
 */
export async function loadSelectableFields(
  params: LoadConfigParams,
): Promise<SelectableFieldsMap> {
  if (isJsonExt(params.filePath)) {
    return loadJson<SelectableFieldsMap>({
      filePath: params.filePath,
      jsonReader: params.jsonReader ?? defaultJsonReader,
      what: "selectableFields",
    });
  }
  return loadFromModule<SelectableFieldsMap>({
    filePath: params.filePath,
    importer: params.importer ?? defaultImporter,
    named: "selectableFields",
    what: "selectableFields",
    fallback: {},
  });
}
