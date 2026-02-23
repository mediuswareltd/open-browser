/**
 * OpenBrowser - Strict action and perception schemas
 * Structured contracts for AI-controlled browser execution
 */

import { z } from "zod";

// ─── Element Perception ──────────────────────────────────────────────────────

export const ElementRefSchema = z.object({
  id: z.string(),
  tagName: z.string().toLowerCase(),
  type: z.string().optional(),
  role: z.string().optional(),
  text: z.string().optional(),
  placeholder: z.string().optional(),
  href: z.string().optional(),
  selector: z.string(),
  rect: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  isVisible: z.boolean().optional(),
  isInteractable: z.boolean().optional(),
});

export type ElementRef = z.infer<typeof ElementRefSchema>;

export const PagePerceptionSchema = z.object({
  url: z.string(),
  title: z.string(),
  timestamp: z.number(),
  elements: z.array(ElementRefSchema),
  riskSignals: z.array(z.string()).optional(),
});

export type PagePerception = z.infer<typeof PagePerceptionSchema>;

// ─── Action Schema ───────────────────────────────────────────────────────────

export const ActionTypeSchema = z.enum([
  "click",
  "type",
  "fill",
  "scroll",
  "select",
  "navigate",
  "screenshot",
]);

export type ActionType = z.infer<typeof ActionTypeSchema>;

export const BaseActionSchema = z.object({
  id: z.string(),
  type: ActionTypeSchema,
});

export const ClickActionSchema = BaseActionSchema.extend({
  type: z.literal("click"),
  selector: z.string(),
  elementId: z.string().optional(),
});

export const TypeActionSchema = BaseActionSchema.extend({
  type: z.literal("type"),
  selector: z.string(),
  elementId: z.string().optional(),
  text: z.string(),
  submit: z.boolean().optional(),
});

export const FillActionSchema = BaseActionSchema.extend({
  type: z.literal("fill"),
  selector: z.string(),
  elementId: z.string().optional(),
  text: z.string(),
});

export const ScrollActionSchema = BaseActionSchema.extend({
  type: z.literal("scroll"),
  direction: z.enum(["up", "down", "left", "right"]),
  amount: z.number().optional(),
  selector: z.string().optional(),
});

export const SelectActionSchema = BaseActionSchema.extend({
  type: z.literal("select"),
  selector: z.string(),
  elementId: z.string().optional(),
  value: z.string(),
});

export const NavigateActionSchema = BaseActionSchema.extend({
  type: z.literal("navigate"),
  url: z.string().url(),
});

export const ScreenshotActionSchema = BaseActionSchema.extend({
  type: z.literal("screenshot"),
});

export const BrowserActionSchema = z.discriminatedUnion("type", [
  ClickActionSchema,
  TypeActionSchema,
  FillActionSchema,
  ScrollActionSchema,
  SelectActionSchema,
  NavigateActionSchema,
  ScreenshotActionSchema,
]);

export type BrowserAction = z.infer<typeof BrowserActionSchema>;

// ─── Action Result ───────────────────────────────────────────────────────────

export const ActionResultSchema = z.object({
  actionId: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
  perception: PagePerceptionSchema.optional(),
  screenshotBase64: z.string().optional(),
});

export type ActionResult = z.infer<typeof ActionResultSchema>;

// ─── Risk Signals ───────────────────────────────────────────────────────────

export const RISK_SIGNALS = [
  "password",
  "captcha",
  "payment",
  "checkout",
  "login",
  "signin",
  "credit_card",
  "billing",
] as const;
