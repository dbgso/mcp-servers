// This file imports and uses exports from used-export.ts
import { usedFunction, UsedClass, USED_CONSTANT } from "./used-export.js";
import type { UsedInterface, UsedType } from "./used-export.js";

const result = usedFunction();
console.log(result);

const instance = new UsedClass();
instance.doSomething();

const value: UsedType = USED_CONSTANT;
console.log(value);

const obj: UsedInterface = { id: 1 };
console.log(obj);

export { value };
