/**
 * Small AST helpers shared by the custom rules.
 *
 * Carried over from dbgso/private-static-site (`tools/oxlint-plugin/utils.ts`),
 * keeping only what the rules here use. oxlint hands JS plugins an ESTree AST
 * (TS-ESTree for TypeScript) with `node.parent` available.
 */

/** `a.b` / `a["b"]` -> "b". null when the name is not static. */
function propertyName(member) {
  if (member.type !== "MemberExpression") return null;
  const p = member.property;
  if (!member.computed && p.type === "Identifier") return p.name;
  if (member.computed && p.type === "Literal" && typeof p.value === "string") return p.value;
  if (member.computed && p.type === "TemplateLiteral" && p.expressions.length === 0) {
    return p.quasis[0].value.cooked;
  }
  return null;
}

/** Strip TS wrappers around an expression (`x!`, `x as T`, `(x)`, `x?.y`). */
function unwrap(n) {
  let cur = n;
  while (
    cur.type === "TSNonNullExpression" ||
    cur.type === "TSAsExpression" ||
    cur.type === "TSSatisfiesExpression" ||
    cur.type === "TSTypeAssertion" ||
    cur.type === "ParenthesizedExpression" ||
    cur.type === "ChainExpression"
  ) {
    cur = cur.expression;
  }
  return cur;
}

/** `a.b.c` -> "a.b.c". null when any part is dynamic. `this` is "this". */
function dottedName(n) {
  const e = unwrap(n);
  if (e.type === "Identifier") return e.name;
  if (e.type === "ThisExpression") return "this";
  if (e.type === "MemberExpression") {
    const obj = dottedName(e.object);
    const prop = propertyName(e);
    return obj !== null && prop !== null ? `${obj}.${prop}` : null;
  }
  return null;
}

/** Drop a leading `window.` / `globalThis.` / `self.`. */
function stripGlobalObject(name) {
  return name.replace(/^(?:window|globalThis|self)\./, "");
}

/**
 * Every Identifier and static property name inside an expression, not
 * descending into functions. Object keys count: `{ password: x }` is logged
 * under that name whatever x is.
 */
function collectNames(root) {
  const out = [];
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.type === "Identifier") {
      out.push({ node: n, name: n.name });
      return;
    }
    if (n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") return;
    if (n.type === "MemberExpression") {
      walk(n.object);
      if (n.computed && n.property.type === "Literal" && typeof n.property.value === "string") {
        out.push({ node: n.property, name: n.property.value });
      } else if (n.computed) {
        walk(n.property);
      } else {
        out.push({ node: n.property, name: n.property.name });
      }
      return;
    }
    if (n.type === "Property") {
      if (!n.computed && n.key.type === "Identifier") out.push({ node: n.key, name: n.key.name });
      else walk(n.key);
      // `{ token }` is one name, not a key and a value that both say "token".
      if (!n.shorthand) walk(n.value);
      return;
    }
    for (const key of Object.keys(n)) {
      if (key === "parent" || key === "range" || key === "loc" || key === "typeAnnotation") continue;
      const v = n[key];
      if (Array.isArray(v)) for (const c of v) walk(c);
      else if (v && typeof v === "object" && typeof v.type === "string") walk(v);
    }
  }
  walk(root);
  return out;
}

/** Split camelCase / snake_case / SCREAMING_CASE into lower-case words. */
function words(name) {
  const parts = name === name.toUpperCase() ? name.split(/[_\W]+/) : name.split(/[_\W]+|(?=[A-Z])/);
  return parts.filter(Boolean).map((w) => w.toLowerCase());
}

module.exports = { propertyName, unwrap, dottedName, stripGlobalObject, collectNames, words };
