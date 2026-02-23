/**
 * OpenBrowser Extension - Content Script
 * DOM perception, stable element IDs, action execution
 */

interface ElementRef {
  id: string;
  tagName: string;
  type?: string;
  role?: string;
  text?: string;
  placeholder?: string;
  href?: string;
  selector: string;
  rect?: { x: number; y: number; width: number; height: number };
  isVisible?: boolean;
  isInteractable?: boolean;
}

interface PagePerception {
  url: string;
  title: string;
  timestamp: number;
  elements: ElementRef[];
  riskSignals?: string[];
}

function generateStableId(el: Element, index: number): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const classes = el.className && typeof el.className === "string"
    ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
    : "";
  const role = el.getAttribute("role") || "";
  const name = el.getAttribute("name");
  const part = [tag, id, classes, role, name].filter(Boolean).join("").replace(/[^a-z0-9_-]/gi, "_") || "el";
  return `ob-${part}-${index}`;
}

function buildSelector(el: Element, index: number): string {
  if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) return `#${el.id}`;
  const tag = el.tagName.toLowerCase();
  const name = el.getAttribute("name");
  if (tag === "input" && name) return `input[name="${name}"]`;
  if (tag === "textarea" && name) return `textarea[name="${name}"]`;
  const openBrowserId = generateStableId(el, index);
  (el as HTMLElement).dataset.openBrowserId = openBrowserId;
  return `[data-openbrowser-id="${openBrowserId}"]`;
}

function getInteractables(): Element[] {
  const selector = [
    "a[href]", "button", "input:not([type=hidden])", "textarea", "select",
    "[role=button]", "[role=link]", "[role=tab]", "[onclick]", "[contenteditable=true]",
  ].join(", ");
  return Array.from(document.querySelectorAll(selector));
}

function perceive(): PagePerception {
  const elements: ElementRef[] = [];
  const interactables = getInteractables();
  const riskSignals: string[] = [];

  interactables.forEach((el, i) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const isVisible =
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      style.opacity !== "0";

    const tag = el.tagName.toLowerCase();
    const type = (el as HTMLInputElement).type;
    const isPassword = type === "password" || (el as HTMLInputElement).name?.toLowerCase().includes("password");
    if (isPassword) riskSignals.push("password");

    const selector = buildSelector(el, i);
    const text = (el.textContent || (el as HTMLInputElement).placeholder || (el as HTMLInputElement).value || "").trim().slice(0, 100);
    const role = el.getAttribute("role") || "";
    const placeholder = (el as HTMLInputElement).placeholder;
    const href = (el as HTMLAnchorElement).href;

    elements.push({
      id: generateStableId(el, i),
      tagName: tag,
      type: type || undefined,
      role: role || undefined,
      text: text || undefined,
      placeholder: placeholder || undefined,
      href: href || undefined,
      selector,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      isVisible,
      isInteractable: isVisible,
    });
  });

  return {
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    elements,
    riskSignals: riskSignals.length ? riskSignals : undefined,
  };
}

function resolveElement(selector: string, elementId?: string): Element | null {
  if (elementId) {
    const byData = document.querySelector(`[data-openbrowser-id="${elementId}"]`);
    if (byData) return byData;
  }
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function executeAction(action: Record<string, unknown>): { success: boolean; error?: string; perception?: PagePerception } {
  const type = action.type as string;
  const selector = action.selector as string;
  const elementId = action.elementId as string | undefined;

  const el = resolveElement(selector || "body", elementId);
  if (!el && type !== "navigate" && type !== "scroll") {
    return { success: false, error: `Element not found: ${selector}` };
  }

  try {
    switch (type) {
      case "navigate": {
        const url = action.url as string;
        if (url) window.location.href = url;
        return { success: true };
      }
      case "click": {
        (el as HTMLElement).click();
        break;
      }
      case "type":
      case "fill": {
        const text = (action.text as string) ?? "";
        const input = el as HTMLInputElement | HTMLTextAreaElement;
        if (type === "fill") input.value = text;
        else input.value += text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        if (action.submit) {
          const form = input.closest("form");
          if (form) form.requestSubmit();
          else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        }
        break;
      }
      case "scroll": {
        const dir = (action.direction as string) || "down";
        const amount = (action.amount as number) || 300;
        const mult = dir === "up" || dir === "left" ? -1 : 1;
        if (dir === "up" || dir === "down") {
          window.scrollBy(0, amount * mult);
        } else {
          window.scrollBy(amount * mult, 0);
        }
        break;
      }
      case "select": {
        const sel = el as HTMLSelectElement;
        sel.value = action.value as string;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        break;
      }
      default:
        return { success: false, error: `Unknown action: ${type}` };
    }
    return { success: true, perception: perceive() };
  } catch (e) {
    return { success: false, error: String(e), perception: perceive() };
  }
}

chrome.runtime.onMessage.addListener(
  (
    msg: { type: string; action?: Record<string, unknown> },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (r: unknown) => void
  ) => {
    if (msg.type === "perceive") {
      sendResponse(perceive());
      return true;
    }
    if (msg.type === "execute" && msg.action) {
      const result = executeAction(msg.action);
      sendResponse(result);
      return true;
    }
    return false;
  }
);
