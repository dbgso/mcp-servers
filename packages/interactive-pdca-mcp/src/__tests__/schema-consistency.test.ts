/**
 * Schema Consistency Tests
 *
 * Verifies that handler schemas are properly covered by the tool's inputSchema.
 * This catches bugs where a handler requires a field that isn't exposed in the MCP tool.
 *
 * Rule: Every handler schema field MUST exist in inputSchema (plan/index.ts)
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { INPUT_SCHEMA_FIELDS } from "../tools/plan/input-schema-fields.js";
import {
  ListHandler,
  ReadHandler,
  ReadOutputHandler,
  AddHandler,
  UpdateHandler,
  DeleteHandler,
  FeedbackHandler,
  InterpretHandler,
  ClearHandler,
  GraphHandler,
  StartHandler,
  ConfirmHandler,
  RequestChangesHandler,
  BlockHandler,
} from "../tools/plan/handlers/index.js";
import { baseParamsSchema } from "../tools/plan/handlers/submit-review/index.js";

// Convert INPUT_SCHEMA_FIELDS to a Set for efficient lookup
const inputSchemaFieldSet = new Set(INPUT_SCHEMA_FIELDS);

/**
 * Extract field names from a Zod schema
 */
function getSchemaFields(schema: z.ZodObject<z.ZodRawShape>): string[] {
  return Object.keys(schema.shape);
}

/**
 * Check that all schema fields exist in inputSchema
 */
function verifySchemaFields(handlerName: string, schemaFields: string[]) {
  const missingFields: string[] = [];

  for (const field of schemaFields) {
    if (!inputSchemaFieldSet.has(field)) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    throw new Error(
      `${handlerName}: Missing fields in inputSchema: [${missingFields.join(", ")}]\n` +
        `Add these to:\n` +
        `  1. packages/interactive-pdca-mcp/src/tools/plan/index.ts (inputSchema)\n` +
        `  2. packages/interactive-pdca-mcp/src/tools/plan/input-schema-fields.ts`
    );
  }
}

describe("Schema Consistency", () => {
  describe("BaseActionHandler handlers", () => {
    // Handlers that extend BaseActionHandler and have a schema property
    const handlers = [
      new ListHandler(),
      new ReadHandler(),
      new ReadOutputHandler(),
      new AddHandler(),
      new UpdateHandler(),
      new DeleteHandler(),
      new FeedbackHandler(),
      new InterpretHandler(),
      new ClearHandler(),
      new GraphHandler(),
      new StartHandler(),
      new ConfirmHandler(),
      new RequestChangesHandler(),
      new BlockHandler(),
    ];

    for (const handler of handlers) {
      it(`${handler.action}: all schema fields exist in inputSchema`, () => {
        const schema = handler.schema as z.ZodObject<z.ZodRawShape>;
        const fields = getSchemaFields(schema);
        verifySchemaFields(handler.action, fields);
      });
    }
  });

  describe("BaseSubmitHandler handlers", () => {
    // Submit handlers use baseParamsSchema + phase-specific fields
    const baseFields = getSchemaFields(baseParamsSchema);

    it("baseParamsSchema fields exist in inputSchema", () => {
      verifySchemaFields("baseParamsSchema", baseFields);
    });

    // Phase-specific fields for each submit handler
    const phaseSpecificFields: Record<string, string[]> = {
      submit_plan: ["findings", "sources"],
      submit_do: ["design_decisions", "changes"],
      submit_check: ["test_target", "test_results", "coverage"],
      submit_act: ["feedback_addressed", "changes"],
    };

    for (const [action, fields] of Object.entries(phaseSpecificFields)) {
      it(`${action}: phase-specific fields exist in inputSchema`, () => {
        verifySchemaFields(action, fields);
      });
    }
  });

  describe("inputSchema completeness", () => {
    it("INPUT_SCHEMA_FIELDS list is not empty", () => {
      expect(INPUT_SCHEMA_FIELDS.length).toBeGreaterThan(0);
    });

    it("no duplicate fields in INPUT_SCHEMA_FIELDS", () => {
      const seen = new Set<string>();
      const duplicates: string[] = [];

      for (const field of INPUT_SCHEMA_FIELDS) {
        if (seen.has(field)) {
          duplicates.push(field);
        }
        seen.add(field);
      }

      expect(duplicates).toEqual([]);
    });
  });
});
