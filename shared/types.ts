/**
 * Shared types for OpenBrowser
 */

import type { BrowserAction, PagePerception, ActionResult } from "./schemas";

export type { BrowserAction, PagePerception, ActionResult, ElementRef } from "./schemas";

export type ExecutorState =
  | "idle"
  | "perceiving"
  | "planning"
  | "waiting_approval"
  | "executing"
  | "verifying"
  | "recovering"
  | "completed"
  | "failed";

export interface TraceEntry {
  timestamp: number;
  state: ExecutorState;
  action?: BrowserAction;
  result?: ActionResult;
  perception?: PagePerception;
  message?: string;
}

export interface ExecutionPlan {
  goal: string;
  steps: Array<{ action: BrowserAction; requiresApproval?: boolean }>;
}
