import { Handler } from "./interface.js";

export class HandlerA implements Handler {
  handle(): void {
    console.log("A");
  }
}
