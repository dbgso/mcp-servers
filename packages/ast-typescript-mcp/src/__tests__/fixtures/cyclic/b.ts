// Cyclic dependency fixture: A -> B -> C -> A
import { funcC } from "./c.js";

export function funcB(): string {
  return `B calls ${funcC()}`;
}
