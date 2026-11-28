/**
 * ESLint Rule: Implement an interface with a class, not an object literal
 *
 * Polymorphism in this repo is done with classes (see the coding-rules
 * `polymorphism` document). A class puts what varies between implementations
 * in the constructor and keeps the operation's signature uniform, which is the
 * whole point: a caller can hold the interface without knowing which
 * implementation it has.
 *
 * An object literal typed as an interface has no such place. Its per-instance
 * settings end up either captured in a factory closure or, worse, added to the
 * operation's parameters — at which point the interface can no longer be
 * called through its own type.
 *
 * Examples of INVALID code:
 *   const mysqlDialect: Dialect = { quoteIdent(name) { ... } };
 *   function envSource(): SecretSource { return { fetch: async (p) => ... }; }
 *
 * Examples of VALID code:
 *   class MysqlDialect implements Dialect { quoteIdent(name) { ... } }
 *   const config: ServerConfig = { host: "localhost", port: 5432 };   // data, no behaviour
 *   const handlers = { onClick() {} };                                 // no interface claimed
 *
 * Only literals that claim an interface *and* carry behaviour are reported:
 * a config object annotated with a type is data, not an implementation.
 */

const FUNCTION_NODES = new Set([
  'FunctionExpression',
  'ArrowFunctionExpression',
]);

/** True when the literal carries behaviour, i.e. at least one function property. */
function hasBehaviour(objectExpression) {
  return objectExpression.properties.some((property) => {
    if (property.type !== 'Property') {
      return false;
    }
    // Shorthand methods (`fetch() {}`) and function-valued keys alike.
    return property.method === true || FUNCTION_NODES.has(property.value?.type);
  });
}

/** Type arguments, across the AST versions that name the field differently. */
function typeArgumentsOf(reference) {
  return reference.typeArguments?.params ?? reference.typeParameters?.params;
}

/**
 * The annotation's name, when it is a plain type reference we can report.
 *
 * An async function declares `Promise<T>`; what it implements is `T`, so the
 * wrapper is unwrapped before reporting.
 */
function typeReferenceName(typeAnnotation) {
  let reference = typeAnnotation?.typeAnnotation;
  if (reference?.type !== 'TSTypeReference' || reference.typeName?.type !== 'Identifier') {
    return undefined;
  }
  if (reference.typeName.name === 'Promise') {
    const [awaited] = typeArgumentsOf(reference) ?? [];
    if (awaited?.type !== 'TSTypeReference' || awaited.typeName?.type !== 'Identifier') {
      return undefined;
    }
    reference = awaited;
  }
  return reference.typeName.name;
}

/** Unwrap the parenthesised / asserted forms an initialiser can take. */
function objectExpressionOf(node) {
  if (node?.type === 'ObjectExpression') {
    return node;
  }
  // `{ ... } satisfies Foo` and `{ ... } as Foo`
  if (node?.type === 'TSSatisfiesExpression' || node?.type === 'TSAsExpression') {
    return objectExpressionOf(node.expression);
  }
  return undefined;
}

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Implement an interface with a class rather than an object literal',
      recommended: false,
    },
    schema: [
      {
        type: 'object',
        properties: {
          /** Type names that are data shapes, not interfaces to implement. */
          ignoreTypes: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      useClass:
        "'{{typeName}}' is implemented as an object literal. Use a class: `class X implements {{typeName}}`, so what varies between implementations is settled in the constructor.",
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const ignoreTypes = new Set(options.ignoreTypes ?? []);

    function report(params) {
      const { node, typeName } = params;
      if (typeName === undefined || ignoreTypes.has(typeName)) {
        return;
      }
      context.report({ node, messageId: 'useClass', data: { typeName } });
    }

    return {
      // const x: Foo = { ... }
      VariableDeclarator(node) {
        const literal = objectExpressionOf(node.init);
        if (literal === undefined || !hasBehaviour(literal)) {
          return;
        }
        report({ node: literal, typeName: typeReferenceName(node.id?.typeAnnotation) });
      },

      // function make(): Foo { return { ... }; }  — the factory form
      ReturnStatement(node) {
        const literal = objectExpressionOf(node.argument);
        if (literal === undefined || !hasBehaviour(literal)) {
          return;
        }
        let scope = node.parent;
        while (scope && !/Function/.test(scope.type)) {
          scope = scope.parent;
        }
        report({ node: literal, typeName: typeReferenceName(scope?.returnType) });
      },
    };
  },
};
