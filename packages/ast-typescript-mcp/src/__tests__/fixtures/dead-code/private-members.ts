// This file contains a class with both used and unused private members
export class MixedPrivateMembers {
  private usedProperty: number = 10;
  private unusedProperty: string = "dead";

  private usedMethod(): number {
    return this.usedProperty * 2;
  }

  private unusedMethod(): string {
    return "never called";
  }

  public compute(): number {
    return this.usedMethod();
  }
}
