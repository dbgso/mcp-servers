/**
 * Codemod module - comby-style pattern matching and transformation.
 */

export {
  parsePattern,
  applyCaptures,
  type PatternToken,
  type ParsedPattern,
} from "./pattern-parser.js";

export {
  findMatches,
  transform,
  type Match,
  type MatchResult,
} from "./pattern-matcher.js";

export {
  transformFiles,
  type FileChange,
  type TransformResult,
  type TransformParams,
} from "./transformer.js";

export {
  classToObject,
  type ClassToObjectOptions,
  type ClassToObjectResult,
  type PropertyMapping,
  type MethodMapping,
  type ClassAdditions,
  type TransformedClass,
} from "./ast-transform.js";
