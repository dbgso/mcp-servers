// Child class extending base
import { BaseHandler } from "./base.js";

export class ChildHandler extends BaseHandler {
  readonly name = "child";
}

// Usage of inherited method
const handler = new ChildHandler();
const result = handler.performUniqueAction({ foo: "bar" }, "test");
