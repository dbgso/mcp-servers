import { ActionRegistry } from "mcp-shared";
import type { LabContext } from "./types.js";
import {
  StartHandler,
  CallHandler,
  ToolsHandler,
  LogsHandler,
  ListHandler,
  StopHandler,
} from "./handlers/index.js";

/**
 * Every action, in one place. The action names in the describe text are read
 * off these rather than restated, so an action cannot be documented into
 * existence or renamed in only one of the two places.
 */
export const HANDLERS = [
  new StartHandler(),
  new CallHandler(),
  new ToolsHandler(),
  new LogsHandler(),
  new ListHandler(),
  new StopHandler(),
] as const;

export type LabAction = (typeof HANDLERS)[number]["action"];

let registry: ActionRegistry<LabContext> | null = null;

export function getActionRegistry(): ActionRegistry<LabContext> {
  if (registry === null) {
    registry = new ActionRegistry<LabContext>();
    registry.registerAll([...HANDLERS]);
  }
  return registry;
}
