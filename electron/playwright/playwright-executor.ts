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

type SearchSummary = {
  channels: string[];
  videos: string[];
};

export class PlaywrightExecutionSession {
  private static parsePositiveInt(value: string, fallback: number): number {
    const raw = Number.parseInt(value, 10);
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }

  private static readonly LOCATOR_TIMEOUT_MS = (() => {
    return PlaywrightExecutionSession.parsePositiveInt(
      String(process.env.PLAYWRIGHT_LOCATOR_TIMEOUT_MS || "15000"),
      15000,
    );
  })();

  private static readonly ACTION_TIMEOUT_MS = (() => {
    return PlaywrightExecutionSession.parsePositiveInt(
      String(process.env.PLAYWRIGHT_ACTION_TIMEOUT_MS || "12000"),
      12000,
    );
  })();

  private static readonly NAVIGATION_TIMEOUT_MS = (() => {
    return PlaywrightExecutionSession.parsePositiveInt(
      String(process.env.PLAYWRIGHT_NAV_TIMEOUT_MS || "30000"),
      30000,
    );
  })();

  private static readonly RETRY_COUNT = (() => {
    return PlaywrightExecutionSession.parsePositiveInt(
      String(process.env.PLAYWRIGHT_ACTION_RETRY_COUNT || "2"),
      2,
    );
  })();

  private static readonly POST_ACTION_SETTLE_MS = (() => {
    return PlaywrightExecutionSession.parsePositiveInt(
      String(process.env.PLAYWRIGHT_POST_ACTION_SETTLE_MS || "220"),
      220,
    );
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

  private credentialFieldsFilled = false;

  private didNavigate = false;

  private didFillEmail = false;

  private didFillPassword = false;

  private didClickLogin = false;

  private loginProgressState: "unknown" | "processing" | "redirected" =
    "unknown";

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
    this.credentialFieldsFilled = false;
    this.didNavigate = false;
    this.didFillEmail = false;
    this.didFillPassword = false;
    this.didClickLogin = false;
    this.loginProgressState = "unknown";

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

  private selectorIndicatesEmail(selector: string): boolean {
    return /\bemail\b/i.test(String(selector || ""));
  }

  private selectorIndicatesPassword(selector: string): boolean {
    return /\bpassword|passcode|pin\b/i.test(String(selector || ""));
  }

  private selectorIndicatesLogin(selector: string): boolean {
    return /\blog[ -]?in\b|\bsign[ -]?in\b|\bsubmit\b/i.test(
      String(selector || ""),
    );
  }

  private async pickFirstVisible(
    candidates: Locator[],
  ): Promise<Locator | null> {
    for (const candidate of candidates) {
      let count = 0;
      try {
        count = await candidate.count();
      } catch {
        continue;
      }
      const limit = Math.min(count, 8);
      for (let i = 0; i < limit; i += 1) {
        const item = candidate.nth(i);
        try {
          if (await item.isVisible()) return item;
        } catch {
          // Continue scanning.
        }
      }
    }
    return null;
  }

  private loginFormLocator(): Locator {
    const page = this.page as Page;
    return page
      .locator(
        'form:has(input[type="password"]), form:has(input[name*="password" i]), form:has(input[id*="password" i])',
      )
      .first();
  }

  private async resolveCredentialLocator(
    kind: "email" | "password",
  ): Promise<Locator> {
    const page = this.page as Page;
    const form = this.loginFormLocator();
    const candidates: Locator[] = [];

    if (kind === "email") {
      candidates.push(
        form.locator(
          'input[type="email"], input[name*="email" i], input[id*="email" i], input[placeholder*="email" i]',
        ),
        page.getByLabel(/email/i),
        page.getByPlaceholder(/email/i),
        page.locator(
          'input[type="email"], input[name*="email" i], input[id*="email" i], input[placeholder*="email" i]',
        ),
      );
    } else {
      candidates.push(
        form.locator(
          'input[type="password"], input[name*="password" i], input[id*="password" i], input[placeholder*="password" i]',
        ),
        page.getByLabel(/password/i),
        page.getByPlaceholder(/password/i),
        page.locator(
          'input[type="password"], input[name*="password" i], input[id*="password" i], input[placeholder*="password" i]',
        ),
      );
    }

    const picked = await this.pickFirstVisible(candidates);
    if (picked) return picked;
    throw new Error(`Unable to resolve ${kind} field on current page.`);
  }

  private async resolveLoginButtonLocator(selector?: string): Promise<Locator> {
    const page = this.page as Page;
    const form = this.loginFormLocator();
    const selectorCandidates: Locator[] = [];
    if (selector) {
      try {
        selectorCandidates.push(await this.requireVisibleLocator(selector));
      } catch {
        // Ignore and continue to robust fallbacks.
      }
    }
    const fallbacks: Locator[] = [
      form.locator(
        'button:has-text("Log in"), button:has-text("Login"), button:has-text("Sign in"), button[type="submit"], input[type="submit"]',
      ),
      page.getByRole("button", { name: /log in|login|sign in/i }),
      page.locator(
        'button:has-text("Log in"), button:has-text("Login"), button:has-text("Sign in"), button[type="submit"], input[type="submit"]',
      ),
    ];
    const picked = await this.pickFirstVisible([
      ...selectorCandidates,
      ...fallbacks,
    ]);
    if (picked) return picked;
    throw new Error("Unable to resolve a visible login button.");
  }

  private static normalizeText(value: string): string {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private addContainsCandidates(selector: string, candidates: string[]): void {
    const containsRegex =
      /^\s*([a-z0-9_-]+)?\s*:contains\(\s*(['"]?)(.*?)\2\s*\)\s*$/i;
    const match = selector.match(containsRegex);
    if (!match) return;
    const tag = PlaywrightExecutionSession.normalizeText(match[1] || "");
    const text = PlaywrightExecutionSession.normalizeText(match[3] || "");
    if (!text) return;

    if (tag) {
      candidates.push(`${tag}:has-text("${text}")`);
      candidates.push(`${tag}:has-text("${text}"):visible`);
    }
    candidates.push(`text=${text}`);
    candidates.push(`:has-text("${text}")`);
  }

  private buildSelectorCandidates(selector: string): string[] {
    const trimmed = selector.trim();
    const candidates: string[] = [];
    this.addContainsCandidates(trimmed, candidates);

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
          `[data-qa="${value}"]`,
        );
      }
    }

    const isLikelyInputIntent =
      /search|query|input|field|textbox|combobox|name=|id=/.test(
        trimmed.toLowerCase(),
      );
    const isLikelyEmailIntent = this.selectorIndicatesEmail(trimmed);
    const isLikelyPasswordIntent = this.selectorIndicatesPassword(trimmed);
    const isLikelyLoginIntent = this.selectorIndicatesLogin(trimmed);

    if (isLikelyEmailIntent) {
      candidates.push(
        'input[type="email"]:visible',
        'input[name*="email" i]:visible',
        'input[id*="email" i]:visible',
        'input[placeholder*="email" i]:visible',
      );
    }
    if (isLikelyPasswordIntent) {
      candidates.push(
        'input[type="password"]:visible',
        'input[name*="password" i]:visible',
        'input[id*="password" i]:visible',
        'input[placeholder*="password" i]:visible',
      );
    }
    if (isLikelyLoginIntent) {
      candidates.push(
        'button[type="submit"]:visible',
        'input[type="submit"]:visible',
        'button:has-text("Login"):visible',
        'button:has-text("Log in"):visible',
        'button:has-text("Sign in"):visible',
        '[aria-label*="login" i]:visible',
        '[aria-label*="sign in" i]:visible',
      );
    }
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

    const isLikelySearchIntent = this.isLikelySearchSelector(trimmed);
    if (isLikelySearchIntent && !isLikelyInputIntent) {
      candidates.push(
        'button[aria-label*="Search" i]:visible',
        'button[title*="Search" i]:visible',
        "#search-icon-legacy button:visible",
        "#search-icon-legacy:visible",
        'ytd-searchbox button[aria-label*="Search" i]:visible',
        '[role="button"][aria-label*="Search" i]:visible',
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

  private isLikelySearchSelector(selector: string): boolean {
    return /search|query|magnify|icon/i.test(String(selector || ""));
  }

  private async settleAfterInteraction(previousUrl?: string): Promise<void> {
    const page = this.page;
    if (!page) return;
    const normalizedPrevious = previousUrl
      ? PlaywrightExecutionSession.normalizeUrl(previousUrl)
      : "";

    if (normalizedPrevious) {
      await page
        .waitForURL(
          (url) =>
            PlaywrightExecutionSession.normalizeUrl(url.toString()) !==
            normalizedPrevious,
          {
            timeout: 2500,
          },
        )
        .catch(() => {});
    }

    await page
      .waitForLoadState("domcontentloaded", {
        timeout: 4000,
      })
      .catch(() => {});

    await page
      .waitForLoadState("networkidle", {
        timeout: 1200,
      })
      .catch(() => {});

    await page
      .waitForTimeout(PlaywrightExecutionSession.POST_ACTION_SETTLE_MS)
      .catch(() => {});
  }

  private async runActionWithRetry(
    action: BrowserAction,
    runner: (attempt: number) => Promise<void>,
  ): Promise<void> {
    const maxAttempts = Math.max(1, PlaywrightExecutionSession.RETRY_COUNT);
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await runner(attempt);
        if (attempt > 1) {
          this.log?.(
            `action ${action.type} succeeded on retry ${attempt}/${maxAttempts}`,
          );
        }
        return;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        this.log?.(
          `action ${action.type} attempt ${attempt}/${maxAttempts} failed: ${message}`,
        );
        if (attempt < maxAttempts) {
          await this.page?.waitForTimeout(160 + attempt * 120).catch(() => {});
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError || "Action failed"));
  }

  private async assertInputValue(
    locator: Locator,
    action: BrowserAction,
  ): Promise<void> {
    if (action.type !== "fill" && action.type !== "type") return;
    const expected = String((action as { text?: unknown }).text || "");
    const value = await locator.inputValue().catch(() => "");
    if (!value) {
      throw new Error("Input value is still empty after fill.");
    }

    if (this.selectorIndicatesEmail(action.selector)) {
      if (!value.includes("@")) {
        throw new Error(
          `Email field was not populated correctly (value="${value}").`,
        );
      }
      this.credentialFieldsFilled = true;
      this.didFillEmail = true;
      return;
    }

    if (this.selectorIndicatesPassword(action.selector)) {
      if (value.length < Math.min(4, Math.max(1, expected.length))) {
        throw new Error("Password field was not populated correctly.");
      }
      this.credentialFieldsFilled = true;
      this.didFillPassword = true;
      return;
    }

    if (
      expected &&
      !value.includes(expected.slice(0, Math.min(expected.length, 6)))
    ) {
      throw new Error("Filled value does not match expected text.");
    }
  }

  private async verifyLoginProgress(beforeUrl: string): Promise<void> {
    const page = this.page;
    if (!page) return;
    await this.settleAfterInteraction(beforeUrl);

    const before = PlaywrightExecutionSession.normalizeUrl(beforeUrl);
    const beforePath = (() => {
      try {
        return new URL(beforeUrl).pathname.toLowerCase();
      } catch {
        return String(beforeUrl || "").toLowerCase();
      }
    })();

    const readLoginState = async () => {
      const after = PlaywrightExecutionSession.normalizeUrl(page.url());
      const afterPath = (() => {
        try {
          return new URL(page.url()).pathname.toLowerCase();
        } catch {
          return String(page.url() || "").toLowerCase();
        }
      })();

      const state = await page
        .evaluate(() => {
          const doc = (globalThis as { document?: unknown }).document as
            | {
                querySelector: (selector: string) => unknown;
                querySelectorAll: (selector: string) => unknown[];
                body?: { innerText?: string };
              }
            | undefined;
          if (!doc) {
            return {
              hasLoginForm: false,
              hasErrorSignals: false,
              looksSubmitting: false,
            };
          }

          const hasPasswordInput = Boolean(
            doc.querySelector(
              'input[type="password"], input[name*="password" i], input[id*="password" i]',
            ),
          );
          const hasEmailInput = Boolean(
            doc.querySelector(
              'input[type="email"], input[name*="email" i], input[id*="email" i], input[placeholder*="email" i]',
            ),
          );
          const hasSubmit = Boolean(
            doc.querySelector(
              'button[type="submit"], input[type="submit"], button[aria-label*="login" i], button[aria-label*="sign in" i]',
            ),
          );
          const submitLike = doc.querySelector(
            'button[type="submit"], button[aria-label*="login" i], button[aria-label*="sign in" i], input[type="submit"]',
          ) as {
            textContent?: string;
            getAttribute?: (name: string) => string | null;
          } | null;
          const submitText = String(submitLike?.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
          const submitAriaBusy = String(
            submitLike?.getAttribute?.("aria-busy") || "",
          ).toLowerCase();
          const bodyText = String(doc.body?.innerText || "")
            .replace(/\s+/g, " ")
            .toLowerCase();
          const invalidInputsCount = Array.from(
            doc.querySelectorAll("input:invalid"),
          ).length;
          const hasErrorSignals =
            /(required|invalid|incorrect|wrong password|password is required|email is required)/i.test(
              bodyText,
            ) || invalidInputsCount > 0;
          const looksSubmitting =
            /logging in|signing in|processing|please wait/.test(submitText) ||
            submitAriaBusy === "true";
          return {
            hasLoginForm: Boolean(
              hasPasswordInput && (hasEmailInput || hasSubmit),
            ),
            hasErrorSignals,
            looksSubmitting,
          };
        })
        .catch(() => ({
          hasLoginForm: false,
          hasErrorSignals: false,
          looksSubmitting: false,
        }));

      return { ...state, after, afterPath };
    };

    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const state = await readLoginState();
      const movedAwayFromLogin =
        state.after !== before && !/\/login\b/i.test(state.afterPath);
      if (
        movedAwayFromLogin ||
        (state.afterPath !== beforePath && !/\/login\b/i.test(state.afterPath))
      ) {
        this.loginProgressState = "redirected";
        return;
      }
      if (state.looksSubmitting) {
        this.loginProgressState = "processing";
        return;
      }
      if (state.hasLoginForm && state.hasErrorSignals) {
        throw new Error(
          "Login form still shows validation/authentication errors.",
        );
      }
      if (!state.hasLoginForm && state.after !== before) {
        this.loginProgressState = "redirected";
        return;
      }
      await page.waitForTimeout(350).catch(() => {});
    }
    throw new Error("Login did not progress; still on login form.");
  }

  async summarizePage(maxItems = 8): Promise<string | null> {
    const page = this.page;
    if (!page) return null;
    const currentUrl = page.url();
    const title = await page.title().catch(() => "");
    const safeMaxItems = Math.max(1, Math.min(maxItems, 12));

    const looksLikeLoginFlow =
      this.didClickLogin ||
      this.didFillEmail ||
      this.didFillPassword ||
      /\/login\b/i.test(currentUrl);
    if (looksLikeLoginFlow) {
      const lines: string[] = [];
      lines.push("Done! Login automation steps completed:");
      lines.push(
        `${this.didNavigate ? "✅" : "⚪"} Navigated to the login page`,
      );
      lines.push(`${this.didFillEmail ? "✅" : "⚪"} Filled email field`);
      lines.push(`${this.didFillPassword ? "✅" : "⚪"} Filled password field`);
      lines.push(`${this.didClickLogin ? "✅" : "⚪"} Clicked \"Log in\"`);
      if (this.loginProgressState === "redirected") {
        lines.push("The page has started moving away from the login route.");
      } else if (this.loginProgressState === "processing") {
        lines.push(
          'The login button indicates processing (e.g., "Logging in..."). Redirect may happen shortly.',
        );
      } else {
        lines.push(
          "Login submission was attempted, but no clear redirect/progress signal was detected yet.",
        );
      }
      if (title) lines.push(`Current page title: ${title}`);
      if (currentUrl) lines.push(`Current URL: ${currentUrl}`);
      return lines.join("\n");
    }

    if (/youtube\.com\/results/i.test(currentUrl)) {
      const details = (await page
        .evaluate((limit) => {
          const doc = (globalThis as { document?: unknown }).document as
            | { querySelectorAll: (selector: string) => unknown[] }
            | undefined;
          if (!doc) return { channels: [], videos: [] };
          const pickText = (el: unknown) =>
            String((el as { textContent?: string } | null)?.textContent || "")
              .replace(/\s+/g, " ")
              .trim();

          const channels = Array.from(
            doc.querySelectorAll(
              "ytd-channel-renderer #text a, ytd-channel-renderer a#main-link, ytd-channel-renderer #channel-title a",
            ),
          )
            .map((el) => pickText(el))
            .filter(Boolean)
            .slice(0, limit);

          const videos = Array.from(
            doc.querySelectorAll(
              "ytd-video-renderer #video-title, ytd-rich-item-renderer #video-title",
            ),
          )
            .map((el) => pickText(el))
            .filter(Boolean)
            .slice(0, limit);

          return { channels, videos };
        }, safeMaxItems)
        .catch(() => ({ channels: [], videos: [] }))) as SearchSummary;

      const lines: string[] = [];
      lines.push(`Done! Search finished on YouTube.`);
      if (details.channels.length) {
        lines.push(`Channels found:`);
        details.channels.forEach((name) => lines.push(`- ${name}`));
      }
      if (details.videos.length) {
        lines.push(`Videos found:`);
        details.videos.forEach((name) => lines.push(`- ${name}`));
      }
      lines.push(`You can now browse the results on the current tab.`);
      return lines.join("\n");
    }

    const topHeadings = await page
      .evaluate((limit) => {
        const doc = (globalThis as { document?: unknown }).document as
          | { querySelectorAll: (selector: string) => unknown[] }
          | undefined;
        if (!doc) return [];
        return Array.from(doc.querySelectorAll("h1, h2, h3"))
          .map((el) =>
            String((el as { textContent?: string } | null)?.textContent || "")
              .replace(/\s+/g, " ")
              .trim(),
          )
          .filter(Boolean)
          .slice(0, limit);
      }, safeMaxItems)
      .catch(() => [] as string[]);

    const lines: string[] = [];
    lines.push(`Done! Execution completed.`);
    if (title) lines.push(`Title: ${title}`);
    if (currentUrl) lines.push(`URL: ${currentUrl}`);
    if (topHeadings.length) {
      lines.push(`Top page headings:`);
      topHeadings.forEach((heading) => lines.push(`- ${heading}`));
    }
    return lines.join("\n");
  }

  async executeAction(action: BrowserAction): Promise<PlaywrightActionResult> {
    const pageOrError = this.ensurePage(action.id);
    if ("success" in pageOrError) return pageOrError;
    const page = pageOrError;

    try {
      switch (action.type) {
        case "navigate": {
          this.log?.(`action navigate: ${action.url}`);
          await this.runActionWithRetry(action, async () => {
            await page.goto(action.url, {
              waitUntil: "domcontentloaded",
              timeout: PlaywrightExecutionSession.NAVIGATION_TIMEOUT_MS,
            });
            await this.settleAfterInteraction();
          });
          this.didNavigate = true;
          return { actionId: action.id, success: true };
        }

        case "click": {
          this.log?.(`action click: ${action.selector}`);
          await this.runActionWithRetry(action, async (attempt) => {
            const beforeUrl = page.url();
            const shouldVerifyLogin =
              this.selectorIndicatesLogin(action.selector) ||
              this.credentialFieldsFilled;
            if (shouldVerifyLogin) this.didClickLogin = true;
            const locator = shouldVerifyLogin
              ? await this.resolveLoginButtonLocator(action.selector)
              : await this.requireVisibleLocator(action.selector);
            try {
              await locator.click({
                timeout: PlaywrightExecutionSession.ACTION_TIMEOUT_MS,
              });
            } catch {
              await locator.click({
                force: true,
                timeout: PlaywrightExecutionSession.ACTION_TIMEOUT_MS,
              });
            }

            if (attempt === 1 && this.isLikelySearchSelector(action.selector)) {
              await this.settleAfterInteraction(beforeUrl);
              return;
            }
            if (shouldVerifyLogin) {
              await this.verifyLoginProgress(beforeUrl);
              this.credentialFieldsFilled = false;
              return;
            }
            await this.settleAfterInteraction(beforeUrl);
          });
          return { actionId: action.id, success: true };
        }

        case "type": {
          this.log?.(`action type: ${action.selector}`);
          await this.runActionWithRetry(action, async () => {
            const beforeUrl = page.url();
            const locator = this.selectorIndicatesEmail(action.selector)
              ? await this.resolveCredentialLocator("email")
              : this.selectorIndicatesPassword(action.selector)
                ? await this.resolveCredentialLocator("password")
                : await this.requireInputLocator(action.selector);
            await locator
              .click({
                force: true,
                timeout: PlaywrightExecutionSession.ACTION_TIMEOUT_MS,
              })
              .catch(() => {});
            await locator.type(action.text, {
              timeout: PlaywrightExecutionSession.ACTION_TIMEOUT_MS,
            });
            const submit = Boolean((action as { submit?: unknown }).submit);
            if (submit) {
              await locator
                .press("Enter")
                .catch(() => page.keyboard.press("Enter"));
            }
            await this.assertInputValue(locator, action);
            await this.settleAfterInteraction(submit ? beforeUrl : undefined);
          });
          return { actionId: action.id, success: true };
        }

        case "fill": {
          this.log?.(`action fill: ${action.selector}`);
          await this.runActionWithRetry(action, async () => {
            const beforeUrl = page.url();
            const locator = this.selectorIndicatesEmail(action.selector)
              ? await this.resolveCredentialLocator("email")
              : this.selectorIndicatesPassword(action.selector)
                ? await this.resolveCredentialLocator("password")
                : await this.requireInputLocator(action.selector);
            await locator
              .click({
                force: true,
                timeout: PlaywrightExecutionSession.ACTION_TIMEOUT_MS,
              })
              .catch(() => {});
            await locator
              .press("Control+A")
              .catch(() => locator.press("Meta+A").catch(() => {}));
            await locator.press("Backspace").catch(() => {});
            const looksSensitive =
              this.selectorIndicatesEmail(action.selector) ||
              this.selectorIndicatesPassword(action.selector);
            if (looksSensitive) {
              await locator.type(action.text, {
                delay: 35,
                timeout: PlaywrightExecutionSession.ACTION_TIMEOUT_MS,
              });
            } else {
              await locator.fill(action.text, {
                timeout: PlaywrightExecutionSession.ACTION_TIMEOUT_MS,
              });
            }
            const submit = Boolean((action as { submit?: unknown }).submit);
            if (submit) {
              await locator
                .press("Enter")
                .catch(() => page.keyboard.press("Enter"));
            }
            await this.assertInputValue(locator, action);
            await this.settleAfterInteraction(submit ? beforeUrl : undefined);
          });
          return { actionId: action.id, success: true };
        }

        case "select": {
          this.log?.(`action select: ${action.selector}`);
          await this.runActionWithRetry(action, async () => {
            const locator = await this.requireVisibleLocator(action.selector);
            await locator.selectOption(action.value, {
              timeout: PlaywrightExecutionSession.ACTION_TIMEOUT_MS,
            });
            await this.settleAfterInteraction();
          });
          return { actionId: action.id, success: true };
        }

        case "scroll": {
          this.log?.(`action scroll: ${action.direction}`);
          await this.runActionWithRetry(action, async () => {
            const amount = action.amount ?? 300;
            const direction = action.direction;
            const x =
              direction === "left"
                ? -amount
                : direction === "right"
                  ? amount
                  : 0;
            const y =
              direction === "up" ? -amount : direction === "down" ? amount : 0;
            await page.mouse.wheel(x, y);
            await this.settleAfterInteraction();
          });
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
