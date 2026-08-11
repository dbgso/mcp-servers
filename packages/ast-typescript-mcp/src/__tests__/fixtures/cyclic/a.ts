// Cyclic dependency fixture: A -> B -> C -> A
import { funcB } from "./b.js";

export function funcA(): string {
  return `A calls ${funcB()}`;
}
