/**
 * Direct execution in BrowserView via webContents.executeJavaScript
 * Bypasses extension when extension can't reach the tab (Electron tab mapping)
 */

export interface BrowserAction {
  id: string;
  type: string;
  url?: string;
  selector?: string;
  text?: string;
  submit?: boolean;
  direction?: string;
  amount?: number;
  value?: string;
}

/**
 * Tries to find an element using the given selector, then falls back to
 * a set of semantic alternatives (placeholder, aria-label, name, id, type).
 * Returns the element or null.
 */
const FIND_ELEMENT_FN = `
function findElement(rawSel) {
  // Try each comma-separated selector individually (document.querySelector doesn't support multi-selector lists reliably in all contexts)
  const parts = rawSel.split(",").map(s => s.trim()).filter(Boolean);
  for (const s of parts) {
    try { const el = document.querySelector(s); if (el) return el; } catch(_) {}
  }

  // If caller provided an explicit selector and nothing matched, fail fast.
  // Blind fallback here can cause false positives (e.g. filling a random search box).
  if (parts.length > 0) return null;

  // Semantic fallbacks for common input patterns
  const fallbacks = [
    'input[type="search"]',
    'input[name="search"]',
    'input[name="q"]',
    'textarea[name="q"]',
    'input[aria-label*="Search" i]',
    'input[placeholder*="Search" i]',
    'input[id*="search" i]',
    '[role="searchbox"] input',
    '[role="combobox"][aria-label*="Search" i]',
    'ytd-searchbox input',
    'form[role="search"] input',
    'form[role="search"] textarea',
    'input[type="text"]:not([aria-hidden="true"])',
  ];
  for (const s of fallbacks) {
    try { const el = document.querySelector(s); if (el) return el; } catch(_) {}
  }
  return null;
}
`;

/**
 * Waits up to maxMs for an element to appear, checking every intervalMs.
 */
const WAIT_FOR_ELEMENT_FN = `
async function waitForElement(rawSel, maxMs, intervalMs) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const el = findElement(rawSel);
    if (el) return el;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}
`;

const HELPERS = `${FIND_ELEMENT_FN}\n${WAIT_FOR_ELEMENT_FN}`;

export async function executeInPage(
  webContents: Electron.WebContents,
  action: BrowserAction,
): Promise<{ success: boolean; error?: string }> {
  const sel = JSON.stringify(action.selector || "");
  const text = JSON.stringify(action.text || "");
  const val = JSON.stringify(action.value || "");

  try {
    switch (action.type) {
      case "type":
      case "fill": {
        const isFill = action.type === "fill";
        const script = `
          (async function() {
            ${HELPERS}
            const sel = ${sel};
            const text = ${text};
            const submit = ${JSON.stringify(action.submit || false)};
            const isFill = ${JSON.stringify(isFill)};
            const el = await waitForElement(sel, 5000, 200);
            if (!el) return { success: false, error: "Element not found: " + sel };
            el.focus();
            if (isFill) {
              el.value = text;
            } else {
              el.value = (el.value || "") + text;
            }
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            if (submit) {
              await new Promise(r => setTimeout(r, 150));
              const form = el.closest("form");
              if (form) {
                form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
                try { form.requestSubmit(); } catch(_) {}
              }
              el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
              el.dispatchEvent(new KeyboardEvent("keyup",  { key: "Enter", keyCode: 13, bubbles: true }));
            }
            return { success: true };
          })()
        `;
        const result = await webContents.executeJavaScript(script);
        return result || { success: true };
      }

      case "click": {
        const script = `
          (async function() {
            ${HELPERS}
            const sel = ${sel};
            const el = await waitForElement(sel, 5000, 200);
            if (!el) return { success: false, error: "Element not found: " + sel };
            el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            el.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true }));
            el.click();
            return { success: true };
          })()
        `;
        const result = await webContents.executeJavaScript(script);
        return result || { success: true };
      }

      case "scroll": {
        const dir = action.direction || "down";
        const amt = action.amount || 300;
        const multiplier = dir === "up" || dir === "left" ? -1 : 1;
        const script =
          dir === "up" || dir === "down"
            ? `window.scrollBy(0, ${amt * multiplier}); ({ success: true })`
            : `window.scrollBy(${amt * multiplier}, 0); ({ success: true })`;
        await webContents.executeJavaScript(script);
        return { success: true };
      }

      case "select": {
        const script = `
          (async function() {
            ${HELPERS}
            const sel = ${sel};
            const val = ${val};
            const el = await waitForElement(sel, 5000, 200);
            if (!el) return { success: false, error: "Element not found: " + sel };
            el.value = val;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return { success: true };
          })()
        `;
        const result = await webContents.executeJavaScript(script);
        return result || { success: true };
      }

      default:
        return { success: false, error: `Unknown action: ${action.type}` };
    }
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
