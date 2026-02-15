import type { TaskStatus } from "../../../types/index.js";
import type { TaskState } from "./types.js";
import { PendingState } from "./pending-state.js";
import { InProgressState } from "./in-progress-state.js";
import { PendingReviewState } from "./pending-review-state.js";
import { CompletedState } from "./completed-state.js";
import { BlockedState } from "./blocked-state.js";
import { SkippedState } from "./skipped-state.js";

export type { TaskState, TransitionContext, TransitionResult } from "./types.js";
export { SAMPLE_COMPLETE_CALL } from "./sample-complete-call.js";

export const stateRegistry: Record<TaskStatus, TaskState> = {
  pending: new PendingState(),
  in_progress: new InProgressState(),
  pending_review: new PendingReviewState(),
  completed: new CompletedState(),
  blocked: new BlockedState(),
  skipped: new SkippedState(),
};

export const VALID_STATUSES: TaskStatus[] = Object.keys(stateRegistry) as TaskStatus[];
