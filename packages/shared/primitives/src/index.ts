// mcp-shared-primitives — backend-agnostic whitelist-gated read primitives.
// Spec: docs/specs/whitelist-abstraction.md · Design: docs/designs/whitelist-abstraction.md

export * from "./errors.js";

// Core + optional trait interfaces
export * from "./interfaces/whitelist.js";
export * from "./interfaces/readers.js";
export * from "./interfaces/redactor.js";
export * from "./interfaces/query-guard.js";
export * from "./interfaces/projection.js";
export * from "./interfaces/limit-policy.js";
export * from "./interfaces/container-resolver.js";
export * from "./interfaces/explainer.js";
export * from "./interfaces/inspector.js";
export * from "./interfaces/introspector.js";
export * from "./interfaces/json-path-reader.js";

// Context + operation (how traits reach ops)
export * from "./interfaces/context.js";
export * from "./interfaces/operation.js";

// Helpers
export * from "./helpers/default-clamp.js";
export * from "./helpers/merge-whitelist.js";
export * from "./helpers/default-respond.js";

// Op factories
export * from "./ops/index.js";
