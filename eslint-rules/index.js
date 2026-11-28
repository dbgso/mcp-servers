/**
 * MCP Servers custom lint rules.
 *
 * Loaded by both ESLint (legacy) and oxlint (`jsPlugins`). The `meta.name`
 * field is what oxlint uses as the rule prefix — `custom/single-params-object`.
 */

module.exports = {
  meta: {
    name: 'custom',
    version: '1.0.0',
  },
  rules: {
    'single-params-object': require('./single-params-object'),
    'implement-interface-with-class': require('./implement-interface-with-class'),
    'no-branching-literal': require('./no-branching-literal'),
    'no-strict-scalar-in-untyped-args': require('./no-strict-scalar-in-untyped-args'),
    'no-arrow-class-method': require('./no-arrow-class-method'),
    'no-discriminant-chain': require('./no-discriminant-chain'),
    'no-repeated-comparison': require('./no-repeated-comparison'),
  },
};
