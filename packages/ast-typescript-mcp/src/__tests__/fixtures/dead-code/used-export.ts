// This file contains exports that ARE used by other files
export function usedFunction(): string {
  return "used";
}

export class UsedClass {
  private usedPrivateMethod(): void {
    console.log("used private");
  }

  public doSomething(): void {
    this.usedPrivateMethod();
  }
}

export const USED_CONSTANT = 42;

export interface UsedInterface {
  id: number;
}

export type UsedType = string | number;
