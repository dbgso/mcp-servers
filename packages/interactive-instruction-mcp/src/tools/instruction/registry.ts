import { ActionRegistry } from "mcp-shared";
import type { InstructionContext } from "./types.js";

// All v2 native handlers
import {
  ListHandler,
  ReadHandler,
  AddHandler,
  UpdateHandler,
  DeleteHandler,
  ApproveHandler,
  RenameHandler,
  ApplyHandler,
  CancelHandler,
  LinkAddHandler,
  LinkRemoveHandler,
  LintHandler,
  SetStatusHandler,
  UpdateMetaHandler,
} from "./handlers/index.js";

export { ActionRegistry };

/**
 * Create and initialize the action registry with all handlers.
 */
export function createActionRegistry(): ActionRegistry<InstructionContext> {
  const registry = new ActionRegistry<InstructionContext>();

  registry.registerAll([
    new ListHandler(),
    new ReadHandler(),
    new AddHandler(),
    new UpdateHandler(),
    new DeleteHandler(),
    new ApproveHandler(),
    new RenameHandler(),
    new ApplyHandler(),
    new CancelHandler(),
    new LinkAddHandler(),
    new LinkRemoveHandler(),
    new LintHandler(),
    new SetStatusHandler(),
    new UpdateMetaHandler(),
  ]);

  return registry;
}

let registryInstance: ActionRegistry<InstructionContext> | null = null;

/**
 * Get the singleton action registry instance.
 */
export function getActionRegistry(): ActionRegistry<InstructionContext> {
  if (!registryInstance) {
    registryInstance = createActionRegistry();
  }
  return registryInstance;
}
