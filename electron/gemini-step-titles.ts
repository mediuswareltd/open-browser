import { GoogleGenAI } from "@google/genai";

type PlanAction = {
  type?: unknown;
  url?: unknown;
  selector?: unknown;
  text?: unknown;
  direction?: unknown;
  value?: unknown;
};

type PlanStep = {
  action?: PlanAction;
};

export interface FriendlyStepTitles {
  introTitle: string;
  actionTitles: string[];
  outroTitle: string;
}

const TITLE_PROMPT = `You rewrite browser automation step titles to be user-friendly.

Rules:
- Keep titles short and realistic (3 to 8 words).
- Use plain language, not technical selector language.
- Keep one title per action in the same order.
- Do not invent actions not present in input.
- Return ONLY valid JSON with this shape:
{"introTitle":"...","actionTitles":["..."],"outroTitle":"..."}
`;

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : trimmed);
}

function sanitizeTitle(value: unknown, fallback: string): string {
  const raw = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return fallback;
  return raw.length > 90 ? raw.slice(0, 90).trim() : raw;
}

function actionHint(step: PlanStep): string {
  const action = (step?.action || {}) as PlanAction;
  const type = String(action.type || "action");
  if (type === "navigate") return `navigate to ${String(action.url || "")}`;
  if (type === "fill" || type === "type")
    return `enter text into ${String(action.selector || "input field")}`;
  if (type === "click") return `click ${String(action.selector || "element")}`;
  if (type === "select")
    return `choose option in ${String(action.selector || "dropdown")}`;
  if (type === "scroll")
    return `scroll ${String(action.direction || "page direction")}`;
  return `perform ${type}`;
}

export async function generateFriendlyStepTitles(
  goal: string,
  plan: PlanStep[],
  apiKey: string,
  model = "gemini-2.5-flash",
): Promise<FriendlyStepTitles> {
  const ai = new GoogleGenAI({ apiKey });
  const input = {
    goal,
    actions: Array.isArray(plan) ? plan.map((step) => actionHint(step)) : [],
  };

  const response = await ai.models.generateContent({
    model,
    contents: `${TITLE_PROMPT}\nInput:\n${JSON.stringify(input)}`,
  });

  const text = (response as { text?: string }).text;
  if (!text) throw new Error("Empty response from Gemini");
  const parsed = parseJsonObject(text) as {
    introTitle?: unknown;
    actionTitles?: unknown;
    outroTitle?: unknown;
  };

  const actionTitlesRaw = Array.isArray(parsed?.actionTitles)
    ? parsed.actionTitles
    : [];
  const actionTitles = actionTitlesRaw.map((title, idx) =>
    sanitizeTitle(title, `Step ${idx + 1}`),
  );

  return {
    introTitle: sanitizeTitle(parsed?.introTitle, "Preparing task"),
    actionTitles,
    outroTitle: sanitizeTitle(parsed?.outroTitle, "Wrap up task"),
  };
}
