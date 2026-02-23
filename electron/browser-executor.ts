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

export async function executeInPage(
  webContents: Electron.WebContents,
  action: BrowserAction
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
          (function() {
            const sel = ${sel};
            const text = ${text};
            const submit = ${JSON.stringify(action.submit || false)};
            const isFill = ${JSON.stringify(isFill)};
            const el = document.querySelector(sel);
            if (!el) return { success: false, error: "Element not found: " + sel };
            if (isFill) el.value = text;
            else el.value = (el.value || "") + text;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            if (submit) {
              const form = el.closest("form");
              if (form) form.requestSubmit();
              else el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            }
            return { success: true };
          })()
        `;
        const result = await webContents.executeJavaScript(script);
        return result || { success: true };
      }
      case "click": {
        const script = `
          (function() {
            const sel = ${sel};
            const el = document.querySelector(sel);
            if (!el) return { success: false, error: "Element not found: " + sel };
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
        const mult = dir === "up" || dir === "left" ? -1 : 1;
        const script =
          dir === "up" || dir === "down"
            ? `window.scrollBy(0, ${amt * mult}); ({ success: true })`
            : `window.scrollBy(${amt * mult}, 0); ({ success: true })`;
        await webContents.executeJavaScript(script);
        return { success: true };
      }
      case "select": {
        const script = `
          (function() {
            const sel = ${sel};
            const val = ${val};
            const el = document.querySelector(sel);
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
