/**
 * One of every callable shape the call graph can name.
 * Each reaches a different arm of `getNodeName` / `getNodeKind`.
 */

/** A plain function, with documentation for hover to find. */
export function namedFunction(value: number): number {
  return helper(value);
}

export function helper(value: number): number {
  return value * 2;
}

export class Service {
  constructor(private readonly factor: number) {
    namedFunction(factor);
  }

  method(value: number): number {
    return this.privateMethod(value);
  }

  private privateMethod(value: number): number {
    return helper(value) * this.factor;
  }
}

export const arrowInVariable = (value: number): number => helper(value);

export const functionExpression = function (value: number): number {
  return helper(value);
};

export const holder = {
  arrowInProperty: (value: number): number => helper(value),
};

export default class {
  run(): number {
    return arrowInVariable(1);
  }
}

export function callsAnonymous(): number {
  return ((value: number) => helper(value))(1);
}
