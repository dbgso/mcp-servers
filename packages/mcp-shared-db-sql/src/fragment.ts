/**
 * Typed building blocks for the SQL a dialect contributes to a statement.
 *
 * Two things here used to be conventions written in JSDoc and checked, if at
 * all, at run time:
 *
 * - "`columnSql` is already quoted" -- now `QuotedIdent`, a string only a
 *   dialect's `quoteIdent` produces.
 * - "`sql` holds exactly one more element than `values`" -- now a property of
 *   how a `SqlFragment` is made. The only way to get one is the `sqlFragment`
 *   tag, and a template literal always has one more string than it has
 *   substitutions, so a fragment whose parts and values disagree cannot be
 *   written down.
 */

declare const quotedIdentBrand: unique symbol;

/**
 * An identifier that has already been quoted for its engine. At run time it is
 * an ordinary string; the brand exists so that a raw table or column name
 * cannot be passed where quoted SQL is expected.
 */
export type QuotedIdent = string & { readonly [quotedIdentBrand]: true };

/**
 * Mark the output of a dialect's quoting as a `QuotedIdent`. Meant to be
 * called from `Dialect.quoteIdent` and nowhere else -- every other caller gets
 * its identifiers from there.
 */
export function asQuotedIdent(quoted: string): QuotedIdent {
  return quoted as QuotedIdent;
}

/**
 * A quoted identifier to splice into a fragment's SQL text rather than bind.
 * Substitutions in `sqlFragment` are bound values by default, which is the
 * safe default; an identifier cannot be bound, so it has to say so.
 */
export class RawIdent {
  readonly text: QuotedIdent;

  private constructor(text: QuotedIdent) {
    this.text = text;
  }

  static of(quoted: QuotedIdent): RawIdent {
    return new RawIdent(quoted);
  }
}

/** Splice an already-quoted identifier into a `sqlFragment` as SQL text. */
export function ident(quoted: QuotedIdent): RawIdent {
  return RawIdent.of(quoted);
}

/**
 * Literal SQL interleaved with the values to bind, in the order they appear:
 * `sql.length === values.length + 1`, by construction. The builder walks the
 * two in step, so the binding order is the textual order.
 */
export class SqlFragment {
  readonly sql: readonly string[];
  readonly values: readonly unknown[];

  private constructor(sql: readonly string[], values: readonly unknown[]) {
    this.sql = sql;
    this.values = values;
  }

  /** Build from a template literal; see `sqlFragment`. */
  static fromTemplate(params: {
    strings: TemplateStringsArray;
    substitutions: readonly unknown[];
  }): SqlFragment {
    const sql: string[] = [params.strings[0]];
    const values: unknown[] = [];
    for (const [i, sub] of params.substitutions.entries()) {
      const next = params.strings[i + 1];
      if (sub instanceof RawIdent) {
        // Joined onto the text either side, so it costs no slot.
        sql[sql.length - 1] += sub.text + next;
        continue;
      }
      values.push(sub);
      sql.push(next);
    }
    return new SqlFragment(sql, values);
  }
}

/**
 * Tag for a dialect's SQL fragment. Every substitution is a value to bind,
 * except an `ident(...)`, which is spliced in as text:
 *
 *   sqlFragment`JSON_UNQUOTE(JSON_EXTRACT(${ident(column)}, ${path})) = ${value}`
 */
export function sqlFragment(
  strings: TemplateStringsArray,
  ...substitutions: unknown[]
): SqlFragment {
  return SqlFragment.fromTemplate({ strings, substitutions });
}
