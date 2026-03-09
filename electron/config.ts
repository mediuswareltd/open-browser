/**
 * OpenBrowser - AI config from .env
 * Load .env via "dotenv/config" in main.ts before importing this
 */

export type AiProvider = "gemini" | "ollama" | "heuristic";

export interface AiConfig {
  provider: AiProvider;
  model: string;
  geminiApiKey: string;
  ollamaBaseUrl: string;
  providersAvailable: AiProvider[];
}

function getProvider(): AiProvider {
  const v = (process.env.OPENBROWSER_AI_PROVIDER || "heuristic").toLowerCase();
  if (v === "gemini" || v === "ollama" || v === "heuristic") return v as AiProvider;
  return "heuristic";
}

function getModel(): string {
  return process.env.OPENBROWSER_AI_MODEL || "gemini-2.5-flash";
}

export function getAiConfig(): AiConfig {
  const geminiApiKey = (process.env.OPENBROWSER_GEMINI_API_KEY || "").trim();
  const ollamaBaseUrl = (process.env.OPENBROWSER_OLLAMA_BASE_URL || "http://localhost:11434").trim();

  const providersAvailable: AiProvider[] = ["heuristic", "gemini", "ollama"];
  const provider = getProvider();

  return {
    provider,
    model: getModel(),
    geminiApiKey,
    ollamaBaseUrl,
    providersAvailable,
  };
}
