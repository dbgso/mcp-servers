// This file contains exports that are NOT used by other files
export function unusedFunction(): string {
  return "unused";
}

export class UnusedClass {
  private unusedPrivateMethod(): void {
    console.log("unused private");
  }

  public doSomething(): void {
    // Note: unusedPrivateMethod is never called, so it's dead code
    console.log("doing something");
  }
}

export const UNUSED_CONSTANT = 99;

export interface UnusedInterface {
  name: string;
}

export type UnusedType = boolean;
