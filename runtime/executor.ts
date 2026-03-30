/**
 * OpenBrowser Runtime - Executor Loop
 * Perceive → Decide → Act → Verify (simplified MVP)
 */

import type {
  BrowserAction,
  PagePerception,
  ActionResult,
} from "../shared/schemas";
import type { TraceEntry, ExecutorState } from "../shared/types";

export type ExecutorCallbacks = {
  onStateChange?: (state: ExecutorState) => void;
  onTrace?: (entry: TraceEntry) => void;
  onApprovalRequired?: (
    action: BrowserAction,
    resolve: (approved: boolean) => void,
  ) => void;
  executeAction?: (action: BrowserAction) => Promise<ActionResult>;
  perceive?: () => Promise<PagePerception | null>;
};

export class Executor {
  private state: ExecutorState = "idle";
  private trace: TraceEntry[] = [];
  private callbacks: ExecutorCallbacks;

  constructor(callbacks: ExecutorCallbacks = {}) {
    this.callbacks = callbacks;
  }

  getState(): ExecutorState {
    return this.state;
  }

  getTrace(): TraceEntry[] {
    return [...this.trace];
  }

  private pushTrace(entry: TraceEntry) {
    this.trace.push(entry);
    this.callbacks.onTrace?.(entry);
  }

  private setState(s: ExecutorState) {
    this.state = s;
    this.pushTrace({ timestamp: Date.now(), state: s });
    this.callbacks.onStateChange?.(s);
  }

  private log(message: string, data?: Partial<TraceEntry>) {
    this.pushTrace({
      timestamp: Date.now(),
      state: this.state,
      message,
      ...data,
    });
  }

  async run(
    goal: string,
    plan: Array<{ action: BrowserAction; requiresApproval?: boolean }>,
  ) {
    this.setState("executing");
    this.log(`Started goal: ${goal}`);

    for (const step of plan) {
      if (step.requiresApproval && this.callbacks.onApprovalRequired) {
        this.setState("waiting_approval");
        const approved = await new Promise<boolean>((resolve) => {
          this.callbacks.onApprovalRequired?.(step.action, resolve);
        });
        if (!approved) {
          this.log("Action rejected by user", { action: step.action });
          continue;
        }
      }

      this.pushTrace({
        timestamp: Date.now(),
        state: this.state,
        action: step.action,
      });

      const result = (await this.callbacks.executeAction?.(step.action)) ?? {
        actionId: step.action.id,
        success: false,
        error: "No executeAction callback",
      };

      this.pushTrace({
        timestamp: Date.now(),
        state: this.state,
        action: step.action,
        result,
      });

      if (!result.success) {
        this.log(`Action failed: ${result.error}`, { result });
        this.setState("recovering");
      }
    }

    this.setState("completed");
  }
}

function genId() {
  return "a-" + Math.random().toString(36).slice(2, 12);
}

export function createAction(
  type: "click" | "type" | "fill" | "navigate" | "scroll",
  params: Record<string, unknown>,
): BrowserAction {
  return {
    id: genId(),
    type,
    ...params,
  } as BrowserAction;
}
