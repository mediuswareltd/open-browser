/**
 * OpenBrowser - Gemini AI Planner
 * Uses Gemini to generate structured browser execution plans from natural language goals
 */

import { GoogleGenAI } from "@google/genai";

const PLAN_PROMPT = `You are a browser automation planner. Given a user goal, output a JSON array of browser actions.

Available action types:
- navigate: { "type": "navigate", "url": "https://..." }
- click: { "type": "click", "selector": "css selector" }
- type: { "type": "type", "selector": "css selector", "text": "string", "submit": true/false }
- fill: { "type": "fill", "selector": "css selector", "text": "string" }
- scroll: { "type": "scroll", "direction": "up"|"down"|"left"|"right", "amount": number }
- select: { "type": "select", "selector": "css selector", "value": "option value" }

Each action MUST have a unique "id" field (e.g. "a-1", "a-2").
Set "requiresApproval": true for risky actions (login, payment, checkout, password input).

Output ONLY a valid JSON array, no markdown or explanation. Example:
[{"action":{"id":"a-1","type":"navigate","url":"https://www.google.com"}},{"action":{"id":"a-2","type":"type","selector":"textarea[name=q], input[name=q]","text":"weather","submit":true}}]

User goal:`;

export interface PlanStep {
  action: {
    id: string;
    type: string;
    url?: string;
    selector?: string;
    text?: string;
    submit?: boolean;
    direction?: string;
    amount?: number;
    value?: string;
    elementId?: string;
  };
  requiresApproval?: boolean;
}

export async function planWithGemini(
  goal: string,
  apiKey: string,
  model = "gemini-2.0-flash"
): Promise<PlanStep[]> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: PLAN_PROMPT + goal,
  });

  const text = (response as { text?: string }).text;
  if (!text) throw new Error("Empty response from Gemini");

  let jsonStr = text.trim();
  const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (jsonMatch) jsonStr = jsonMatch[0];

  const raw = JSON.parse(jsonStr);
  if (!Array.isArray(raw)) throw new Error("Gemini did not return an array");

  return raw.map((item): PlanStep => {
    if (item?.action) return item as PlanStep;
    return { action: item, requiresApproval: item.requiresApproval };
  });
}
