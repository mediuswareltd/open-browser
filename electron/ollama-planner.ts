/**
 * OpenBrowser - Ollama Planner
 * Uses local Ollama for browser execution plans (no API key needed)
 */

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

export async function planWithOllama(
  goal: string,
  baseUrl: string,
  model: string
): Promise<PlanStep[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/generate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || "llama3.2",
      prompt: PLAN_PROMPT + goal,
      stream: false,
      options: { temperature: 0.2, num_predict: 2048 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as { response?: string };
  const text = data.response;
  if (!text) throw new Error("Empty response from Ollama");

  let jsonStr = text.trim();
  const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
  if (jsonMatch) jsonStr = jsonMatch[0];

  const raw = JSON.parse(jsonStr);
  if (!Array.isArray(raw)) throw new Error("Ollama did not return an array");

  return raw.map((item): PlanStep => {
    if (item?.action) return item as PlanStep;
    return { action: item, requiresApproval: item.requiresApproval };
  });
}
