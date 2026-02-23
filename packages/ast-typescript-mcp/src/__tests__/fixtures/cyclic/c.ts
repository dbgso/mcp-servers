// Cyclic dependency fixture: A -> B -> C -> A
import { funcA } from "./a.js";

export function funcC(): string {
  return `C calls ${funcA()}`;
}
