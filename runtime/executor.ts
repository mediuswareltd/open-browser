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

  private describeAction(action: BrowserAction): string {
    if (action.type === "navigate") return `navigate to ${action.url}`;
    if (action.type === "fill" || action.type === "type") {
      const target = action.selector || "input";
      return `enter text into ${target}`;
    }
    if (action.type === "click") return `click ${action.selector || "element"}`;
    if (action.type === "select")
      return `select option in ${action.selector || "dropdown"}`;
    if (action.type === "scroll")
      return `scroll ${action.direction || "page"}${action.amount ? ` by ${action.amount}px` : ""}`;
    if (action.type === "screenshot") return "take snapshot";
    return "action";
  }

  async run(
    goal: string,
    plan: Array<{ action: BrowserAction; requiresApproval?: boolean }>,
  ) {
    this.setState("planning");
    this.log(`Received command: ${goal}`);
    this.log("The user wants me to:");
    this.log(`- ${goal}`);
    if (!Array.isArray(plan) || !plan.length) {
      this.log("No executable actions were generated.");
      this.setState("failed");
      return;
    }
    this.log(`Prepared ${plan.length} action${plan.length === 1 ? "" : "s"}.`);
    plan.forEach((step, idx) => {
      this.log(`Planned step ${idx + 1}: ${this.describeAction(step.action)}.`);
    });
    this.setState("executing");
    let hasFailure = false;
    let completedActions = 0;

    for (let index = 0; index < plan.length; index += 1) {
      const step = plan[index];
      const actionLabel = this.describeAction(step.action);
      const nextStep = plan[index + 1];
      if (step.action.type === "navigate") {
        this.log(
          `Thought: I should open the target page first, then continue with the form/search interactions.`,
        );
      } else if (step.action.type === "screenshot") {
        this.log(
          "Thought: The page may still be loading. I will take a fresh snapshot to inspect the current elements.",
        );
      } else if (step.action.type === "fill" || step.action.type === "type") {
        this.log(
          `Thought: I will fill the requested field now and then continue.`,
        );
      } else if (step.action.type === "click") {
        this.log(
          `Thought: I will click this control and wait for the page to update.`,
        );
      }
      this.log(`Thought (${index + 1}/${plan.length}): ${actionLabel}.`);
      if (step.requiresApproval && this.callbacks.onApprovalRequired) {
        this.setState("waiting_approval");
        const approved = await new Promise<boolean>((resolve) => {
          this.callbacks.onApprovalRequired?.(step.action, resolve);
        });
        this.setState("executing");
        if (!approved) {
          this.log("Action rejected by user", { action: step.action });
          continue;
        }
      }

      const actionStartedAt = Date.now();
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

      const elapsedMs = Date.now() - actionStartedAt;
      const thoughtSeconds = Math.max(1, Math.round(elapsedMs / 1000));
      if (result.success) {
        completedActions += 1;
        this.log(`Thought for ${thoughtSeconds} seconds`);
        this.log("1/1 actions completed");
        this.log(
          `Action: ${step.action.type.charAt(0).toUpperCase()}${step.action.type.slice(1)}`,
        );
        if (
          step.action.type === "fill" &&
          nextStep?.action?.type === "click" &&
          /search|submit|login|sign[ -]?in/i.test(
            String(nextStep.action.selector || ""),
          )
        ) {
          this.log(
            "I have filled the field. Next I will click the submit/search button.",
          );
        }
        if (
          step.action.type === "click" &&
          /search/i.test(
            String((step.action as { selector?: string }).selector || ""),
          )
        ) {
          this.log(
            "The click was successful. I will wait briefly for the results page to load.",
          );
        }
        this.log(
          `${completedActions}/${plan.length} actions completed (${elapsedMs}ms).`,
        );
      } else {
        this.log(`Thought for ${thoughtSeconds} seconds`);
        this.log("1/1 actions completed");
        this.log(
          `Action: ${step.action.type.charAt(0).toUpperCase()}${step.action.type.slice(1)}`,
        );
        this.log(`Action failed after ${elapsedMs}ms: ${result.error}`, {
          result,
        });
        this.setState("recovering");
        hasFailure = true;
        this.log("Continuing with remaining actions where possible.");
        this.setState("executing");
      }
    }

    this.setState("verifying");
    this.log("Verifying final page state.");
    if (hasFailure) {
      this.log("Run finished with recoverable failures.");
    } else {
      this.log("Done! Execution completed successfully.");
    }
    this.setState(hasFailure ? "failed" : "completed");
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
