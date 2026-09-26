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
  ReadMetaHandler,
  GraphHandler,
} from "./handlers/index.js";

export { ActionRegistry };

/**
 * Every action this tool has, in one place.
 *
 * `InstructionAction` is derived from it below, and the next-action
 * suggestions are typed against that -- so an action name can only be
 * suggested if a handler for it is registered here, and a rename is a compile
 * error everywhere it was not applied rather than a broken example a caller
 * finds at runtime.
 */
const HANDLERS = [
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
  new ReadMetaHandler(),
  new GraphHandler(),
] as const;

/** The action names, read off the handlers rather than restated. */
export type InstructionAction = (typeof HANDLERS)[number]["action"];

/**
 * Create and initialize the action registry with all handlers.
 */
export function createActionRegistry(): ActionRegistry<InstructionContext> {
  const registry = new ActionRegistry<InstructionContext>();

  registry.registerAll([...HANDLERS]);

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
