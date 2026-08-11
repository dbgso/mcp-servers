// Interface for handlers
export interface IHandler {
  performUniqueAction(rawParams: unknown, context: string): string;
}

// Base class with a method
export abstract class BaseHandler implements IHandler {
  abstract readonly name: string;

  performUniqueAction(rawParams: unknown, context: string): string {
    return `${this.name}: ${JSON.stringify(rawParams)} in ${context}`;
  }
}
