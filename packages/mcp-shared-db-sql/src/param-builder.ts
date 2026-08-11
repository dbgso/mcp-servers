/**
 * Sequential placeholder allocator backing the builder layer.
 *
 * The dialect decides what each placeholder string looks like (`$N`, `?`,
 * etc.); this class only owns the value array and 1-based index sequencing.
 */
import type { Dialect, ParamBuilder } from "./dialect.js";

export class ParamBuilderImpl implements ParamBuilder {
  private readonly values: unknown[] = [];

  constructor(private readonly dialect: Dialect) {}

  add(value: unknown): string {
    this.values.push(value);
    return this.dialect.placeholder(this.values.length);
  }

  build(): unknown[] {
    return this.values;
  }
}
