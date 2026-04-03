import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { chromium } from "@playwright/test";
import type { BrowserAction } from "../../shared/schemas";

export type PlaywrightActionResult = {
  actionId: string;
  success: boolean;
  error?: string;
  screenshotPath?: string;
};

type PlaywrightExecutionSessionOptions = {
  headless?: boolean;
  log?: (message: string) => void;
  cdpEndpointUrl?: string;
  targetUrlHint?: string;
  allowLaunchFallback?: boolean;
};

export class PlaywrightExecutionSession {
  private static readonly LOCATOR_TIMEOUT_MS = (() => {
    const raw = Number.parseInt(
      String(process.env.PLAYWRIGHT_LOCATOR_TIMEOUT_MS || "15000"),
      10,
    );
    return Number.isFinite(raw) && raw > 0 ? raw : 15000;
  })();

  private readonly headless: boolean;

  private readonly log?: (message: string) => void;

  private readonly cdpEndpointUrl: string;

  private readonly targetUrlHint: string;

  private readonly allowLaunchFallback: boolean;

  private browser: Browser | null = null;

  private context: BrowserContext | null = null;

  private page: Page | null = null;

  private attachedViaCdp = false;

  constructor(options: PlaywrightExecutionSessionOptions = {}) {
    this.headless =
      options.headless ??
      (process.env.PLAYWRIGHT_HEADLESS || "").trim().toLowerCase() === "true";
    this.log = options.log;
    this.cdpEndpointUrl = String(options.cdpEndpointUrl || "").trim();
    this.targetUrlHint = String(options.targetUrlHint || "").trim();
    this.allowLaunchFallback = options.allowLaunchFallback ?? true;
  }

  private static normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    } catch {
      return String(url || "")
        .trim()
        .replace(/\/$/, "");
    }
  }

  private pickAttachedPage(contexts: BrowserContext[]): Page | null {
    const pages = contexts.flatMap((ctx) => ctx.pages());
    if (!pages.length) return null;

    const target = PlaywrightExecutionSession.normalizeUrl(this.targetUrlHint);
    const exactMatch = target
      ? pages.find(
          (page) =>
            PlaywrightExecutionSession.normalizeUrl(page.url()) === target,
        )
      : null;
    if (exactMatch) return exactMatch;

    const httpPages = pages.filter((page) => /^https?:/i.test(page.url()));
    if (httpPages.length) return httpPages[0];

    const nonUiPages = pages.filter((page) => {
      const url = page.url();
      return !/^file:|^devtools:|^chrome:|^chrome-extension:/i.test(url);
    });
    if (nonUiPages.length) return nonUiPages[0];

    return pages[0] || null;
  }

  private async attachViaCdp(): Promise<boolean> {
    if (!this.cdpEndpointUrl) return false;
    this.log?.(`connecting over CDP: ${this.cdpEndpointUrl}`);
    this.browser = await chromium.connectOverCDP(this.cdpEndpointUrl);
    this.attachedViaCdp = true;

    let page = this.pickAttachedPage(this.browser.contexts());
    if (!page) {
      // Give targets a moment to populate after connection.
      for (let i = 0; i < 5 && !page; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        page = this.pickAttachedPage(this.browser.contexts());
      }
    }

    if (!page) {
      const contexts = this.browser.contexts();
      throw new Error(
        `Connected to CDP but no attachable page was found (contexts=${contexts.length}).`,
      );
    }

    this.context = page.context();
    this.page = page;
    this.log?.(`attached to existing page: ${page.url() || "about:blank"}`);
    await page.bringToFront().catch(() => {});
    return true;
  }

  private async launchBrowser(): Promise<Browser> {
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
        options: { headless: this.headless, executablePath: envExecutablePath },
      });
    }

    launchAttempts.push({
      label: "bundled Chromium",
      options: { headless: this.headless },
    });

    if (envChannel) {
      launchAttempts.push({
        label: `channel=${envChannel}`,
        options: { headless: this.headless, channel: envChannel },
      });
    } else {
      launchAttempts.push(
        {
          label: "channel=chrome",
          options: { headless: this.headless, channel: "chrome" },
        },
        {
          label: "channel=msedge",
          options: { headless: this.headless, channel: "msedge" },
        },
      );
    }

    const errors: string[] = [];
    for (const attempt of launchAttempts) {
      try {
        this.log?.(`launching browser (${attempt.label})`);
        return await chromium.launch(
          attempt.options as Parameters<typeof chromium.launch>[0],
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`[${attempt.label}] ${msg}`);
      }
    }

    throw new Error(
      `Unable to launch a Playwright browser. ${errors.join(" | ")}`,
    );
  }

  async start(initialUrl = "https://www.google.com"): Promise<void> {
    if (this.cdpEndpointUrl) {
      try {
        const attached = await this.attachViaCdp();
        if (attached) return;
      } catch (error) {
        if (!this.allowLaunchFallback) throw error;
        const msg = error instanceof Error ? error.message : String(error);
        this.log?.(`CDP attach failed, falling back to launch: ${msg}`);
      }
    }

    this.browser = await this.launchBrowser();
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
    this.log?.(`navigating: ${initialUrl}`);
    await this.page.goto(initialUrl, { waitUntil: "domcontentloaded" });
  }

  async close(): Promise<void> {
    const context = this.context;
    const browser = this.browser;
    const attachedViaCdp = this.attachedViaCdp;
    this.page = null;
    this.context = null;
    this.browser = null;
    this.attachedViaCdp = false;

    // When attached to Electron's existing Chromium over CDP, do not close the shared context.
    if (!attachedViaCdp && context) await context.close();
    if (browser) await browser.close();
  }

  private ensurePage(actionId: string): Page | PlaywrightActionResult {
    if (!this.page) {
      return {
        actionId,
        success: false,
        error: "Playwright page is not initialized",
      };
    }
    return this.page;
  }

  private selectorLooksLikeCss(selector: string): boolean {
    const trimmed = selector.trim();
    if (!trimmed) return false;
    const nonCssPrefixes = ["text=", "xpath=", "role=", "id=", "data-test-id="];
    return !nonCssPrefixes.some((prefix) => trimmed.startsWith(prefix));
  }

  private splitSelectorParts(selector: string): string[] {
    return selector
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  private buildSelectorCandidates(selector: string): string[] {
    const trimmed = selector.trim();
    const candidates: string[] = [];

    if (this.selectorLooksLikeCss(trimmed)) {
      const parts = this.splitSelectorParts(trimmed);
      for (const part of parts) {
        candidates.push(part.includes(":visible") ? part : `${part}:visible`);
        candidates.push(part);
      }
    }
    candidates.push(trimmed);

    const idEngine = /^id=(.+)$/i.exec(trimmed);
    if (idEngine?.[1]) {
      const id = idEngine[1].trim().replace(/^["']|["']$/g, "");
      if (id) {
        candidates.push(`#${id}`, `[id="${id}"]`);
      }
    }

    const nameEngine = /^name=(.+)$/i.exec(trimmed);
    if (nameEngine?.[1]) {
      const name = nameEngine[1].trim().replace(/^["']|["']$/g, "");
      if (name) {
        candidates.push(
          `[name="${name}"]`,
          `input[name="${name}"]`,
          `textarea[name="${name}"]`,
          `select[name="${name}"]`,
        );
      }
    }

    const testIdEngine = /^data-test-id=(.+)$/i.exec(trimmed);
    if (testIdEngine?.[1]) {
      const value = testIdEngine[1].trim().replace(/^["']|["']$/g, "");
      if (value) {
        candidates.push(
          `[data-test-id="${value}"]`,
          `[data-testid="${value}"]`,
          `[data-testid="${value}"]`,
        );
      }
    }

    const isLikelyInputIntent =
      /search|query|input|field|textbox|combobox|name=|id=/.test(
        trimmed.toLowerCase(),
      );
    if (isLikelyInputIntent) {
      candidates.push(
        'input[type="search"]:visible',
        'input[type="text"]:visible',
        "textarea:visible",
        '[role="searchbox"]:visible',
        '[role="textbox"]:visible',
        '[role="combobox"]:visible',
      );
    }

    return Array.from(new Set(candidates.filter(Boolean)));
  }

  private async probeCandidate(
    candidate: string,
    requireEditable: boolean,
  ): Promise<Locator | null> {
    const page = this.page as Page;
    const locator = page.locator(candidate);

    let count = 0;
    try {
      count = await locator.count();
    } catch {
      return null;
    }

    const limit = Math.min(count, 12);
    for (let i = 0; i < limit; i += 1) {
      const item = locator.nth(i);
      try {
        if (requireEditable) {
          if (await item.isEditable()) return item;
          if ((await item.isVisible()) && (await item.isEnabled())) return item;
        } else if (await item.isVisible()) {
          return item;
        }
      } catch {
        // Keep scanning.
      }
    }

    return null;
  }

  private async resolveLocator(
    selector: string,
    requireEditable: boolean,
  ): Promise<Locator> {
    const page = this.page as Page;
    const candidates = this.buildSelectorCandidates(selector);
    const deadline = Date.now() + PlaywrightExecutionSession.LOCATOR_TIMEOUT_MS;

    while (Date.now() < deadline) {
      for (const candidate of candidates) {
        const locator = await this.probeCandidate(candidate, requireEditable);
        if (locator) return locator;
      }
      await page.waitForTimeout(120);
    }

    throw new Error(
      `${requireEditable ? "No editable input" : "No visible element"} found for selector "${selector}". Tried: ${candidates.join(" | ")}`,
    );
  }

  private async requireVisibleLocator(selector: string) {
    return this.resolveLocator(selector, false);
  }

  private async requireInputLocator(selector: string) {
    return this.resolveLocator(selector, true);
  }

  async executeAction(action: BrowserAction): Promise<PlaywrightActionResult> {
    const pageOrError = this.ensurePage(action.id);
    if ("success" in pageOrError) return pageOrError;
    const page = pageOrError;

    try {
      switch (action.type) {
        case "navigate": {
          this.log?.(`action navigate: ${action.url}`);
          await page.goto(action.url, { waitUntil: "domcontentloaded" });
          return { actionId: action.id, success: true };
        }

        case "click": {
          this.log?.(`action click: ${action.selector}`);
          const locator = await this.requireVisibleLocator(action.selector);
          try {
            await locator.click();
          } catch {
            await locator.click({ force: true });
          }
          return { actionId: action.id, success: true };
        }

        case "type": {
          this.log?.(`action type: ${action.selector}`);
          const locator = await this.requireInputLocator(action.selector);
          await locator.click({ force: true }).catch(() => {});
          await locator.type(action.text);
          const submit = Boolean((action as { submit?: unknown }).submit);
          if (submit) {
            await locator
              .press("Enter")
              .catch(() => page.keyboard.press("Enter"));
            await page
              .waitForLoadState("domcontentloaded", { timeout: 10000 })
              .catch(() => {});
          }
          return { actionId: action.id, success: true };
        }

        case "fill": {
          this.log?.(`action fill: ${action.selector}`);
          const locator = await this.requireInputLocator(action.selector);
          await locator.fill(action.text);
          const submit = Boolean((action as { submit?: unknown }).submit);
          if (submit) {
            await locator
              .press("Enter")
              .catch(() => page.keyboard.press("Enter"));
            await page
              .waitForLoadState("domcontentloaded", { timeout: 10000 })
              .catch(() => {});
          }
          return { actionId: action.id, success: true };
        }

        case "select": {
          this.log?.(`action select: ${action.selector}`);
          const locator = await this.requireVisibleLocator(action.selector);
          await locator.selectOption(action.value);
          return { actionId: action.id, success: true };
        }

        case "scroll": {
          this.log?.(`action scroll: ${action.direction}`);
          const amount = action.amount ?? 300;
          const direction = action.direction;
          const x =
            direction === "left" ? -amount : direction === "right" ? amount : 0;
          const y =
            direction === "up" ? -amount : direction === "down" ? amount : 0;
          await page.mouse.wheel(x, y);
          return { actionId: action.id, success: true };
        }

        case "screenshot": {
          this.log?.("action screenshot");
          const screenshotsDir = path.join(
            process.cwd(),
            "test-results",
            "playwright",
          );
          const screenshotPath = path.join(
            screenshotsDir,
            `executor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
          );
          await mkdir(screenshotsDir, { recursive: true });
          await page.screenshot({ path: screenshotPath, fullPage: false });
          return { actionId: action.id, success: true, screenshotPath };
        }

        default:
          return {
            actionId: (action as { id: string }).id,
            success: false,
            error: `Unsupported action for Playwright: ${(action as { type: string }).type}`,
          };
      }
    } catch (error) {
      return {
        actionId: action.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
