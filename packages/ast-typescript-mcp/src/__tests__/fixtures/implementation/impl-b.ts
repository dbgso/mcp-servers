import { Handler } from "./interface.js";

export class HandlerB implements Handler {
  handle(): void {
    console.log("B");
  }
}
