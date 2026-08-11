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
  },
};
