import { createOperationRegistry, type Operation } from "mcp-shared";
import type { CodegenOperation, CodegenOperationContext } from "./types.js";
import { listSchemasOp } from "./list-schemas.js";
import { listTablesOp } from "./list-tables.js";
import { introspectTableOp } from "./introspect-table.js";
import { introspectAllOp } from "./introspect-all.js";
import { previewMetadataJsonOp } from "./preview-metadata-json.js";
import { previewSelectableFieldsJsonOp } from "./preview-selectable-fields-json.js";
import { validateSelectableFieldsOp } from "./validate-selectable-fields.js";

/**
 * Phase 2 ops are read-only.
 *
 * Output format note: codegen emits JSON only. The previous TS-emitting ops
 * (`preview_metadata_ts` / `preview_selectable_fields_ts`) were removed when
 * we moved to a `node`-friendly JSON wire format; `db-read-mcp` no longer
 * dynamically imports user TS modules.
 */
export const allCodegenOperations: CodegenOperation[] = [
  listSchemasOp as CodegenOperation,
  listTablesOp as CodegenOperation,
  introspectTableOp as CodegenOperation,
  introspectAllOp as CodegenOperation,
  previewMetadataJsonOp as CodegenOperation,
  previewSelectableFieldsJsonOp as CodegenOperation,
  validateSelectableFieldsOp as CodegenOperation,
];

export const codegenRegistry = createOperationRegistry<CodegenOperationContext>(
  allCodegenOperations as Operation<unknown, CodegenOperationContext>[],
);
