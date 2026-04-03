import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Browser } from "@playwright/test";
import { chromium } from "@playwright/test";

export type PlaywrightTaskInput = {
  url?: string;
  prompt: string;
};

export type PlaywrightTaskResult = {
  logs: string[];
  result: string;
  success: boolean;
  screenshotPath?: string;
  error?: string;
};

function buildSearchQuery(
  prompt: string,
  fallbackTarget: "youtube" | "google",
): string {
  const cleaned = prompt
    .replace(/\b(open|go to|search|for|on|in)\b/gi, " ")
    .replace(/\byoutube\b/gi, fallbackTarget === "youtube" ? " " : "youtube")
    .replace(/\bgoogle\b/gi, fallbackTarget === "google" ? " " : "google")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || "OpenAI";
}

export async function runPlaywrightTask(
  input: PlaywrightTaskInput,
): Promise<PlaywrightTaskResult> {
  const logs: string[] = [];
  const target: "youtube" | "google" = /youtube/i.test(input.prompt)
    ? "youtube"
    : "google";
  const defaultUrl =
    target === "youtube" ? "https://www.youtube.com" : "https://www.google.com";
  const navigationUrl = input.url?.trim() || defaultUrl;
  const query = buildSearchQuery(input.prompt, target);
  const screenshotsDir = path.join(process.cwd(), "test-results", "playwright");
  const screenshotPath = path.join(
    screenshotsDir,
    `playwright-${Date.now()}.png`,
  );
  const headless =
    (process.env.PLAYWRIGHT_HEADLESS || "").trim().toLowerCase() === "true";
  const envExecutablePath = String(
    process.env.PLAYWRIGHT_EXECUTABLE_PATH || "",
  ).trim();
  const envChannel = String(process.env.PLAYWRIGHT_CHANNEL || "").trim();

  const launchAttempts: Array<{
    label: string;
    options: Record<string, unknown>;
  }> = [];
  if (envExecutablePath) {
    launchAttempts.push({
      label: `executablePath=${envExecutablePath}`,
      options: { headless, executablePath: envExecutablePath },
    });
  }
  launchAttempts.push({ label: "bundled Chromium", options: { headless } });
  if (envChannel) {
    launchAttempts.push({
      label: `channel=${envChannel}`,
      options: { headless, channel: envChannel },
    });
  } else {
    launchAttempts.push(
      { label: "channel=chrome", options: { headless, channel: "chrome" } },
      { label: "channel=msedge", options: { headless, channel: "msedge" } },
    );
  }
  let browser: Browser | null = null;
  const launchErrors: string[] = [];
  for (const attempt of launchAttempts) {
    try {
      logs.push(`launching browser (${attempt.label})`);
      browser = await chromium.launch(
        attempt.options as Parameters<typeof chromium.launch>[0],
      );
      break;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      launchErrors.push(`[${attempt.label}] ${msg}`);
    }
  }
  if (!browser) {
    return {
      logs,
      result: "",
      success: false,
      error: `Unable to launch a Playwright browser. ${launchErrors.join(" | ")}`,
    };
  }

  try {
    logs.push("creating context");
    const context = await browser.newContext();
    const page = await context.newPage();

    logs.push(`navigating: ${navigationUrl}`);
    await page.goto(navigationUrl, { waitUntil: "domcontentloaded" });

    if (target === "youtube") {
      logs.push("typing in youtube search input");
      const searchInput = page
        .locator('input[name="search_query"], input#search')
        .first();
      await searchInput.waitFor({ state: "visible", timeout: 15000 });
      await searchInput.click();
      await searchInput.fill(query);
      logs.push("clicking/enter on youtube search");
      await page.keyboard.press("Enter");
    } else {
      logs.push("typing in google search input");
      const searchInput = page
        .locator('textarea[name="q"], input[name="q"]')
        .first();
      await searchInput.waitFor({ state: "visible", timeout: 15000 });
      await searchInput.click();
      await searchInput.fill(query);
      logs.push("clicking/enter on google search");
      await page.keyboard.press("Enter");
    }

    await page.waitForLoadState("domcontentloaded");
    logs.push("extracting result");
    const title = await page.title();
    const currentUrl = page.url();

    logs.push("capturing screenshot");
    await mkdir(screenshotsDir, { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });

    await context.close();
    await browser.close();

    return {
      logs,
      result: `Title: ${title} | URL: ${currentUrl}`,
      success: true,
      screenshotPath,
    };
  } catch (error) {
    await browser.close();
    return {
      logs,
      result: "",
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
