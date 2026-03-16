/**
 * OpenBrowser - Google result extractor
 * Extracts a useful text answer/snippet from current Google results page.
 */

import type { WebContents } from "electron";

export interface GoogleExtractResult {
  aiText: string;
  title: string;
  url: string;
  source: string;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function extractGoogleResult(
  webContents: WebContents,
): Promise<GoogleExtractResult> {
  const title = webContents.getTitle() || "Untitled";
  const url = webContents.getURL() || "";

  try {
    const raw = (await webContents.executeJavaScript(
      `(() => {
        const clean = (v) => (v || "").replace(/\\s+/g, " ").trim();

        const pickTextFromSelectors = (selectors) => {
          for (const selector of selectors) {
            const node = document.querySelector(selector);
            const text = clean(node?.textContent || "");
            if (text && text.length > 24) return text;
          }
          return "";
        };

        const aiOverviewSelectors = [
          'div[jsname="yEVEwb"]',
          'div[jsname="U8S5sf"]',
          '[data-attrid="wa:/description"]',
          '.kno-rdesc span',
        ];

        let aiText = pickTextFromSelectors(aiOverviewSelectors);
        let source = aiText ? "google-ai-overview" : "";

        const firstTitleNode = document.querySelector("div#search a h3");
        const firstTitle = clean(firstTitleNode?.textContent || "");
        const firstLink = firstTitleNode?.closest("a")?.href || "";
        const firstCard = firstTitleNode?.closest("div");
        const firstSnippet = clean(
          firstCard?.querySelector("div.VwiC3b, span.aCOpRe, div[data-sncf]")?.textContent || "",
        );

        if (!aiText) {
          aiText = firstSnippet || firstTitle;
          source = firstSnippet ? "first-result-snippet" : "first-result-title";
        }

        return {
          aiText: clean(aiText),
          source,
          firstTitle: clean(firstTitle),
          firstLink: clean(firstLink),
          firstSnippet: clean(firstSnippet),
        };
      })();`,
      true,
    )) as {
      aiText?: unknown;
      source?: unknown;
      firstTitle?: unknown;
      firstLink?: unknown;
      firstSnippet?: unknown;
    };

    const aiText =
      toText(raw?.aiText) || toText(raw?.firstSnippet) || toText(raw?.firstTitle);
    return {
      aiText: aiText || "No extractable text found on this page.",
      title: toText(raw?.firstTitle) || title,
      url: toText(raw?.firstLink) || url,
      source: toText(raw?.source) || "page-title",
    };
  } catch {
    return {
      aiText: title || "No extractable text found on this page.",
      title,
      url,
      source: "page-title",
    };
  }
}
