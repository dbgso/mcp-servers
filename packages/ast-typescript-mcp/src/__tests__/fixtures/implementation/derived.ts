import { BaseService } from "./abstract.js";

export class ConcreteService extends BaseService {
  execute(): string {
    return "done";
  }
}
