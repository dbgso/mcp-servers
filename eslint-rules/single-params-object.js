/**
 * ESLint Rule: Enforce single params object for function arguments
 *
 * This rule enforces that functions with multiple parameters should use a single
 * object parameter (typically named `params`) instead of multiple positional arguments.
 *
 * Examples of INVALID code:
 * function createUser(name: string, age: number) { }
 * async createMessage(title: string, content: string): Promise<void> { }
 * const fn = (a: string, b: number) => { }
 *
 * Examples of VALID code:
 * function createUser(params: { name: string; age: number }) { }
 * async createMessage(params: CreateMessageParams): Promise<void> { }
 * const fn = (params: { a: string; b: number }) => { }
 * function greet(name: string) { }  // single primitive param is OK
 * function noArgs() { }  // no args is OK
 *
 * Auto-exempted callback patterns (signature is dictated by the consumer):
 * - new Promise((resolve, reject) => ...)
 * - Array iteration: sort/toSorted/map/filter/reduce/reduceRight/forEach/find/
 *   findIndex/findLast/findLastIndex/some/every/flatMap callbacks
 * - String#replace / String#replaceAll callbacks
 * - addEventListener / removeEventListener callbacks
 * - Node.js callbacks: exec/execFile/spawn/fork
 * - Timer callbacks: setTimeout/setInterval/setImmediate
 */

// Methods that take a callback whose signature is fixed by the API.
// Matches by the rightmost identifier in the call expression's callee.
const EXTERNAL_CALLBACK_METHODS = new Set([
  // Array iteration
  'sort',
  'toSorted',
  'map',
  'filter',
  'reduce',
  'reduceRight',
  'forEach',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'some',
  'every',
  'flatMap',
  // String
  'replace',
  'replaceAll',
  // DOM
  'addEventListener',
  'removeEventListener',
]);

// Free functions that take a callback whose signature is fixed by the API.
const EXTERNAL_CALLBACK_FUNCTIONS = new Set([
  // Node.js child_process
  'exec',
  'execFile',
  'spawn',
  'fork',
  // Timers
  'setTimeout',
  'setInterval',
  'setImmediate',
]);

// Constructors whose first argument is a callback with a fixed signature.
const EXTERNAL_CALLBACK_CONSTRUCTORS = new Set(['Promise']);

/**
 * Check whether the given function node is being passed as an argument
 * to an API whose callback signature we cannot control.
 */
function isExternalCallback(node) {
  const parent = node.parent;
  if (!parent) {
    return false;
  }

  // (a, b) => ... passed to foo.method(...)
  if (
    parent.type === 'CallExpression' &&
    parent.arguments.includes(node) &&
    parent.callee.type === 'MemberExpression' &&
    parent.callee.property &&
    parent.callee.property.type === 'Identifier' &&
    EXTERNAL_CALLBACK_METHODS.has(parent.callee.property.name)
  ) {
    return true;
  }

  // (a, b) => ... passed to foo(...)
  if (
    parent.type === 'CallExpression' &&
    parent.arguments.includes(node) &&
    parent.callee.type === 'Identifier' &&
    EXTERNAL_CALLBACK_FUNCTIONS.has(parent.callee.name)
  ) {
    return true;
  }

  // new Promise((resolve, reject) => ...)
  if (
    parent.type === 'NewExpression' &&
    parent.arguments.includes(node) &&
    parent.callee.type === 'Identifier' &&
    EXTERNAL_CALLBACK_CONSTRUCTORS.has(parent.callee.name)
  ) {
    return true;
  }

  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Enforce functions with multiple parameters to use a single params object',
      category: 'Best Practices',
      recommended: false,
    },
    messages: {
      useParamsObject:
        'Functions with multiple parameters should use a single params object. Change to: {{ suggestion }}',
    },
    schema: [
      {
        type: 'object',
        properties: {
          maxParams: {
            type: 'integer',
            minimum: 1,
            default: 1,
            description:
              'Maximum number of parameters allowed before requiring a params object',
          },
          ignoreConstructors: {
            type: 'boolean',
            default: true,
            description: 'Whether to ignore class constructors',
          },
          ignoreArrowFunctions: {
            type: 'boolean',
            default: false,
            description: 'Whether to ignore arrow functions',
          },
          ignoreMethods: {
            type: 'array',
            items: { type: 'string' },
            default: [],
            description: 'Method/property names to ignore',
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options = context.options[0] || {};
    const maxParams = options.maxParams ?? 1;
    const ignoreConstructors = options.ignoreConstructors ?? true;
    const ignoreArrowFunctions = options.ignoreArrowFunctions ?? false;
    const ignoreMethods = options.ignoreMethods ?? [];

    /**
     * Get function name for error messages
     */
    function getFunctionName(node) {
      if (node.id && node.id.name) {
        return node.id.name;
      }

      if (node.parent) {
        if (
          node.parent.type === 'MethodDefinition' &&
          node.parent.key &&
          node.parent.key.name
        ) {
          return node.parent.key.name;
        }

        if (
          node.parent.type === 'Property' &&
          node.parent.key &&
          node.parent.key.name
        ) {
          return node.parent.key.name;
        }

        if (
          node.parent.type === 'VariableDeclarator' &&
          node.parent.id &&
          node.parent.id.name
        ) {
          return node.parent.id.name;
        }
      }

      return 'anonymous';
    }

    /**
     * Check if the function is a constructor
     */
    function isConstructor(node) {
      return (
        node.parent &&
        node.parent.type === 'MethodDefinition' &&
        node.parent.kind === 'constructor'
      );
    }

    /**
     * Check if the method should be ignored
     */
    function shouldIgnoreMethod(node) {
      const name = getFunctionName(node);
      return ignoreMethods.includes(name);
    }

    /**
     * Generate suggestion for params object
     */
    function generateSuggestion(params) {
      const paramNames = params
        .map((p) => {
          if (p.type === 'Identifier') {
            return p.name;
          }
          if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') {
            return p.left.name;
          }
          if (p.type === 'RestElement' && p.argument.type === 'Identifier') {
            return `...${p.argument.name}`;
          }
          return '?';
        })
        .join(', ');

      return `(params: { ${paramNames.replace(/,\s*/g, '; ')} })`;
    }

    /**
     * Check function parameters
     */
    function checkFunction(node) {
      // Skip if no parameters or within limit
      if (!node.params || node.params.length <= maxParams) {
        return;
      }

      // Skip constructors if configured
      if (ignoreConstructors && isConstructor(node)) {
        return;
      }

      // Skip ignored methods
      if (shouldIgnoreMethod(node)) {
        return;
      }

      // Skip callbacks whose signature is fixed by the API receiving them
      if (isExternalCallback(node)) {
        return;
      }

      // Report the issue
      context.report({
        node,
        messageId: 'useParamsObject',
        data: {
          suggestion: generateSuggestion(node.params),
        },
      });
    }

    const handlers = {
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      // For MethodDefinition, we check the value (FunctionExpression) node
    };

    if (!ignoreArrowFunctions) {
      handlers.ArrowFunctionExpression = checkFunction;
    }

    return handlers;
  },
};
