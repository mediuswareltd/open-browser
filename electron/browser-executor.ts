/**
 * Direct execution in BrowserView via webContents.executeJavaScript
 * Bypasses extension when extension can't reach the tab (Electron tab mapping)
 */
import type { WebContents } from "electron";

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

  // If caller provided an explicit selector and nothing matched, usually fail fast.
  // Exception: allow search-like selectors to fall back to safe search inputs.
  const looksLikeSearch = /search|\\bq\\b/i.test(rawSel);
  if (parts.length > 0 && !looksLikeSearch) return null;

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
  webContents: WebContents,
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
            const isMediuswareDailyUpdate =
              window.location.href.includes(
                "hr.mediusware.xyz/admin/project_management/dailyprojectupdate/add/"
              );
            const sel = ${sel};
            const text = ${text};
            const submit = ${JSON.stringify(action.submit || false)};
            const isFill = ${JSON.stringify(isFill)};
            function normalizeValue(v) {
              if (v === null || v === undefined) return "";
              return String(v).trim();
            }
            function normalizeLabelText(value) {
              return String(value || "")
                .replace(/:/g, "")
                .trim()
                .toLowerCase();
            }
            function findFieldRow(labelText) {
              const target = normalizeLabelText(labelText);
              const label = Array.from(document.querySelectorAll("label, th, td, span, div"))
                .find((el) => el.textContent && normalizeLabelText(el.textContent) === target);
              if (!label) return null;
              return label.closest("tr, .form-group, .form-row, .row, .field-row") || label.parentElement;
            }
            function findInputByPlaceholder(placeholderText) {
              return document.querySelector(
                'input[placeholder="'+placeholderText+'"], textarea[placeholder="'+placeholderText+'"]'
              );
            }
            async function selectOptionByLabel(selectEl, label) {
              if (!selectEl) return false;
              const rawTarget = normalizeValue(label);
              const target = rawTarget.toLowerCase();
              if (!rawTarget) return false;
              const canonicalize = (v) =>
                normalizeValue(v)
                  .toLowerCase()
                  .replace(/\(.*?\)/g, " ")
                  .replace(/[^a-z0-9]+/g, " ")
                  .replace(/\b(select|choose|set|as|manager|lead|from|list)\b/g, " ")
                  .replace(/\s+/g, " ")
                  .trim();
              const canonicalTarget = canonicalize(rawTarget);
              const options = Array.from(selectEl.options || []);
              const byValue = options.find(
                (opt) => String(opt.value || "") === rawTarget
              );
              const byExact = options.find(
                (opt) => normalizeValue(opt.text).toLowerCase() === target
              );
              const byCanonical = options.find(
                (opt) => canonicalize(opt.text) === canonicalTarget
              );
              const fuzzy = options.filter((opt) => {
                const text = normalizeValue(opt.text).toLowerCase();
                const canonical = canonicalize(opt.text);
                return (
                  text.includes(target) ||
                  target.includes(text) ||
                  canonical.includes(canonicalTarget) ||
                  canonicalTarget.includes(canonical)
                );
              });
              const match = byValue || byExact || byCanonical || (fuzzy.length === 1 ? fuzzy[0] : null);
              if (!match) return false;
              selectEl.value = match.value;
              selectEl.dispatchEvent(new Event("input", { bubbles: true }));
              selectEl.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
            async function selectOptionByLabelWithSelect2(selectEl, label) {
              if (!selectEl) return false;
              const target = normalizeValue(label).toLowerCase();
              if (!target) return false;
              const canonicalize = (v) =>
                normalizeValue(v)
                  .toLowerCase()
                  .replace(/\(.*?\)/g, " ")
                  .replace(/[^a-z0-9]+/g, " ")
                  .replace(/\s+/g, " ")
                  .trim();
              const lookupTarget = canonicalize(target);
              const rawTarget = normalizeValue(label);
              const fieldHint = String(
                selectEl.getAttribute("id") || selectEl.getAttribute("name") || ""
              ).toLowerCase();
              const isProjectField = fieldHint.includes("project");
              function pickBestCandidate(items, getText) {
                if (!items || !items.length) return null;
                const exact = items.find(
                  (item) => normalizeValue(getText(item)).toLowerCase() === target
                );
                if (exact) return exact;
                const canonicalExact = items.find(
                  (item) => canonicalize(getText(item)) === lookupTarget
                );
                if (canonicalExact) return canonicalExact;
                const partial = items.filter((item) => {
                  const text = normalizeValue(getText(item)).toLowerCase();
                  const canonical = canonicalize(getText(item));
                  return (
                    text.includes(target) ||
                    target.includes(text) ||
                    canonical.includes(lookupTarget) ||
                    lookupTarget.includes(canonical)
                  );
                });
                if (partial.length === 1) return partial[0];
                return null;
              }
              function applySelectValue(optionValue, optionText) {
                if (!optionValue) return false;
                let nativeOption = Array.from(selectEl.options || []).find(
                  (opt) => String(opt.value || "") === String(optionValue)
                );
                if (!nativeOption) {
                  nativeOption = new Option(normalizeValue(optionText || rawTarget), String(optionValue), true, true);
                  selectEl.add(nativeOption);
                }
                selectEl.value = String(optionValue);
                selectEl.dispatchEvent(new Event("input", { bubbles: true }));
                selectEl.dispatchEvent(new Event("change", { bubbles: true }));
                if (window.jQuery && typeof window.jQuery === "function") {
                  window.jQuery(selectEl).trigger("change.select2");
                }
                return true;
              }
              async function fetchAdminAutocompleteOption() {
                const baseUrl = selectEl.getAttribute("data-ajax--url");
                if (!baseUrl) return null;
                const params = new URLSearchParams();
                params.set("term", rawTarget);
                const appLabel = selectEl.getAttribute("data-app-label");
                const modelName = selectEl.getAttribute("data-model-name");
                const fieldName = selectEl.getAttribute("data-field-name");
                if (appLabel) params.set("app_label", appLabel);
                if (modelName) params.set("model_name", modelName);
                if (fieldName) params.set("field_name", fieldName);
                const reqUrl = baseUrl + (baseUrl.includes("?") ? "&" : "?") + params.toString();
                try {
                  const res = await fetch(reqUrl, {
                    credentials: "include",
                    headers: { "X-Requested-With": "XMLHttpRequest" },
                  });
                  if (!res.ok) return null;
                  const data = await res.json();
                  const results = Array.isArray(data?.results) ? data.results : [];
                  const match = pickBestCandidate(results, (item) => item?.text || "");
                  if (match) return match;
                  if (isProjectField) return null;
                  return results[0] || null;
                } catch (_) {
                  return null;
                }
              }

              // Try native select first.
              const nativeOk = await selectOptionByLabel(selectEl, label);
              if (nativeOk) return true;

              // Select2 fallback: open dropdown and click matching result.
              const selectId = selectEl.getAttribute("id");
              const rendered = selectId
                ? document.querySelector("#select2-" + selectId + "-container")
                : null;
              const container =
                rendered?.closest(".select2-selection") ||
                selectEl.closest(".related-widget-wrapper")?.querySelector(".select2-selection");
              if (!container) return false;
              container.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
              container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
              container.click();

              const resultsId = selectId ? "select2-" + selectId + "-results" : "";
              const searchInput = await waitFor(() => {
                if (!resultsId) return null;
                return document.querySelector(
                  '.select2-container--open .select2-search__field[aria-controls="' + resultsId + '"]'
                );
              }, 1500, 100);
              if (searchInput) {
                searchInput.focus();
                searchInput.value = normalizeValue(label);
                searchInput.dispatchEvent(new Event("input", { bubbles: true }));
                searchInput.dispatchEvent(new Event("change", { bubbles: true }));
                searchInput.dispatchEvent(new KeyboardEvent("keyup", { key: "e", bubbles: true }));
              }

              const option = await (async function waitOptionWithPagination() {
                const deadline = Date.now() + 7000;
                const scopedSelector = resultsId
                  ? "#" + resultsId + " .select2-results__option"
                  : ".select2-results__option";
                while (Date.now() < deadline) {
                  const results = Array.from(document.querySelectorAll(scopedSelector)).filter(
                    (el) =>
                      !el.classList.contains("select2-results__message") &&
                      !el.classList.contains("select2-results__option--load-more")
                  );
                  const picked = pickBestCandidate(results, (el) => el.textContent || "");
                  if (picked) return picked;

                  const loadMore = resultsId
                    ? document.querySelector("#" + resultsId + " .select2-results__option--load-more")
                    : document.querySelector(".select2-results__option--load-more");
                  if (loadMore) {
                    const list = loadMore.closest(".select2-results__options");
                    if (list) list.scrollTop = list.scrollHeight;
                  }
                  await new Promise((r) => setTimeout(r, 180));
                }
                return null;
              })();
              if (option) {
                option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
                option.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
                option.click();
              } else {
                const remoteMatch = await fetchAdminAutocompleteOption();
                if (!remoteMatch) return false;
                applySelectValue(remoteMatch.id, remoteMatch.text);
              }

              const pickedOk = await waitFor(() => {
                if (!selectId) return false;
                const selectedText = normalizeValue(
                  document.querySelector("#select2-" + selectId + "-container")?.textContent || ""
                ).toLowerCase();
                if (isProjectField) {
                  return canonicalize(selectedText) === lookupTarget;
                }
                return (
                  selectedText === target ||
                  selectedText.includes(target) ||
                  target.includes(selectedText)
                );
              }, 1500, 100);
              return !!pickedOk;
            }
            function setInputValue(inputEl, value) {
              if (!inputEl) return false;
              inputEl.focus();
              inputEl.value = "";
              inputEl.value = normalizeValue(value);
              inputEl.dispatchEvent(new Event("input", { bubbles: true }));
              inputEl.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
            async function waitFor(getter, maxMs = 5000, intervalMs = 200) {
              const deadline = Date.now() + maxMs;
              while (Date.now() < deadline) {
                const el = getter();
                if (el) return el;
                await new Promise(r => setTimeout(r, intervalMs));
              }
              return null;
            }
            function resolveMediuswareSelector(rawSelector) {
              const normalized = String(rawSelector || "").trim().toLowerCase();
              const aliasMap = {
                "#id_clickup_link":
                  'input[name="clickup_task-0-link"], #id_clickup_task-0-link',
                "input#id_clickup_link":
                  'input[name="clickup_task-0-link"], #id_clickup_task-0-link',
                'input[name="clickup_link"]':
                  'input[name="clickup_task-0-link"], #id_clickup_task-0-link, input[name="clickup_link"], #id_clickup_link',
                "#clickup_link":
                  'input[name="clickup_task-0-link"], #id_clickup_task-0-link, input[name="clickup_link"], #id_clickup_link',
                "input#clickup_link":
                  'input[name="clickup_task-0-link"], #id_clickup_task-0-link, input[name="clickup_link"], #id_clickup_link',
                "#id_note":
                  'input[name="clickup_task-0-note"], #id_clickup_task-0-note',
                "input#id_note":
                  'input[name="clickup_task-0-note"], #id_clickup_task-0-note',
                "textarea#id_note":
                  'input[name="clickup_task-0-note"], #id_clickup_task-0-note',
                "#id_task_title":
                  'input[name="clickup_task-0-title"], #id_clickup_task-0-title',
                "input#id_task_title":
                  'input[name="clickup_task-0-title"], #id_clickup_task-0-title',
                'input[name="clickuplink"]':
                  'input[name="clickup_task-0-link"], #id_clickup_task-0-link, input[name="clickup_link"], #id_clickup_link',
                'textarea[name="note"]':
                  'input[name="clickup_task-0-note"], #id_clickup_task-0-note',
                'input[name="note"]':
                  'input[name="clickup_task-0-note"], #id_clickup_task-0-note',
                "#id_manager": 'select[name="manager"], #id_manager',
                "input#id_manager": 'select[name="manager"], #id_manager',
                "#id_project": 'select[name="project"], #id_project',
                "input#id_project": 'select[name="project"], #id_project',
                'input[name="tasktitle"]':
                  'input[name="clickup_task-0-title"], #id_clickup_task-0-title',
                'input[name="task_title"]':
                  'input[name="clickup_task-0-title"], #id_clickup_task-0-title',
                "#task_title":
                  'input[name="clickup_task-0-title"], #id_clickup_task-0-title',
                "input#task_title":
                  'input[name="clickup_task-0-title"], #id_clickup_task-0-title',
              };
              if (aliasMap[normalized]) return aliasMap[normalized];
              if (normalized.includes("select2") && normalized.includes("id_project")) {
                return 'select[name="project"], #id_project';
              }
              if (normalized.includes("select2") && normalized.includes("id_manager")) {
                return 'select[name="manager"], #id_manager';
              }
              if (normalized.includes("project")) return 'select[name="project"], #id_project';
              if (normalized.includes("manager")) return 'select[name="manager"], #id_manager';
              if (normalized.includes("task") && normalized.includes("title")) {
                return 'input[name="clickup_task-0-title"], #id_clickup_task-0-title';
              }
              return rawSelector;
            }
            async function handleMediuswareDailyUpdate(data) {
              const manager = data.manager || data.Manager;
              const project = data.project || data.Project;
              const hours = data.hours || data.Hours;
              const taskTitle = data.taskTitle || data["Task Title"] || data.task;
              const clickupLink = data.clickupLink || data["ClickUp Link"] || data.clickup;
              const note = data.note || data.Note;

              const details = [];
              const managerSelect = await waitFor(() => {
                const row = findFieldRow("Manager:");
                return row ? row.querySelector("select") : null;
              });
              const projectSelect = await waitFor(() => {
                const row = findFieldRow("Project:");
                return row ? row.querySelector("select") : null;
              });
              const hoursInput = await waitFor(() => {
                const row = findFieldRow("Hours:");
                return row ? row.querySelector('input, textarea') : null;
              });
              const taskTitleInput = await waitFor(() =>
                document.querySelector('input[name="clickup_task-0-title"]') ||
                findInputByPlaceholder("Task title")
              );
              const clickupInput = await waitFor(() =>
                document.querySelector('input[name="clickup_task-0-link"]') ||
                document.querySelector('input[name="clickup_link"]') ||
                document.querySelector("#id_clickup_link") ||
                findInputByPlaceholder("ClickUp link")
              );
              const noteInput = await waitFor(() =>
                document.querySelector('input[name="clickup_task-0-note"]') ||
                findInputByPlaceholder("Note")
              );

              const managerOk =
                manager !== undefined && manager !== null
                  ? await selectOptionByLabel(managerSelect, manager)
                  : false;
              if (manager) details.push(managerOk ? "Manager: ok" : "Manager: not found");

              const projectOk =
                project !== undefined && project !== null
                  ? await selectOptionByLabelWithSelect2(projectSelect, project)
                  : false;
              if (project) details.push(projectOk ? "Project: ok" : "Project: not found");

              const hoursOk =
                hours !== undefined ? setInputValue(hoursInput, hours) : false;
              if (hours !== undefined)
                details.push(hoursOk ? "Hours: ok" : "Hours: not found");

              const taskOk = taskTitle ? setInputValue(taskTitleInput, taskTitle) : false;
              if (taskTitle)
                details.push(taskOk ? "Task Title: ok" : "Task Title: not found");

              const clickupOk =
                clickupLink ? setInputValue(clickupInput, clickupLink) : false;
              if (clickupLink)
                details.push(clickupOk ? "ClickUp Link: ok" : "ClickUp Link: not found");

              const noteOk = note ? setInputValue(noteInput, note) : false;
              if (note) details.push(noteOk ? "Note: ok" : "Note: not found");

              const ok = details.some((item) => item.endsWith("ok"));
              return ok
                ? { success: true, details }
                : {
                    success: false,
                    error: "Daily update form fields not found",
                    details,
                  };
            }
            if (isMediuswareDailyUpdate && text && text.trim().startsWith("{")) {
              try {
                const data = JSON.parse(text);
                const handled = await handleMediuswareDailyUpdate(data || {});
                if (handled?.success) return handled;
              } catch (_) {}
            }
            const resolvedSel = isMediuswareDailyUpdate
              ? resolveMediuswareSelector(sel)
              : sel;
            const el = await waitForElement(resolvedSel, 5000, 200);
            if (!el) return { success: false, error: "Element not found: " + sel };
            if (el.tagName && el.tagName.toLowerCase() === "select") {
              const target = normalizeValue(text).toLowerCase();
              const options = Array.from(el.options || []);
              const direct = options.find((opt) => String(opt.value || "") === String(text || "").trim());
              const exact = options.find((opt) => normalizeValue(opt.text).toLowerCase() === target);
              const fuzzy = options.find((opt) => {
                const a = normalizeValue(opt.text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
                const b = target.replace(/[^a-z0-9]+/g, " ").trim();
                return a === b || a.includes(b) || b.includes(a);
              });
              const picked = direct || exact || fuzzy;
              if (!picked) return { success: false, error: "Option not found: " + text };
              el.value = picked.value;
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              return { success: true };
            }
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
            const isMediuswareDailyUpdate =
              window.location.href.includes(
                "hr.mediusware.xyz/admin/project_management/dailyprojectupdate/add/"
              );
            const sel = ${sel};
            const val = ${val};
            function normalizeValue(v) {
              if (v === null || v === undefined) return "";
              return String(v).trim();
            }
            function normalizeLookup(v) {
              return normalizeValue(v)
                .toLowerCase()
                .replace(/\(.*?\)/g, " ")
                .replace(/[^a-z0-9]+/g, " ")
                .replace(/\b(select|choose|set|as|manager|project)\b/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            }
            function resolveMediuswareSelector(rawSelector) {
              const normalized = String(rawSelector || "").trim().toLowerCase();
              const aliasMap = {
                "#id_manager": 'select[name="manager"], #id_manager',
                'select[name="manager"]': 'select[name="manager"], #id_manager',
                "#manager": 'select[name="manager"], #id_manager',
                "#id_project": 'select[name="project"], #id_project',
                'select[name="project"]': 'select[name="project"], #id_project',
                "#project": 'select[name="project"], #id_project',
              };
              if (aliasMap[normalized]) return aliasMap[normalized];
              if (normalized.includes("select2") && normalized.includes("id_project")) {
                return 'select[name="project"], #id_project';
              }
              if (normalized.includes("select2") && normalized.includes("id_manager")) {
                return 'select[name="manager"], #id_manager';
              }
              if (normalized.includes("manager")) return 'select[name="manager"], #id_manager';
              if (normalized.includes("project")) return 'select[name="project"], #id_project';
              return rawSelector;
            }
            async function selectByValueOrLabel(selectEl, target) {
              if (!selectEl) return false;
              const normalizedTarget = normalizeValue(target);
              if (!normalizedTarget) return false;
              const lookupTarget = normalizeLookup(normalizedTarget);
              const fieldHint = String(
                selectEl.getAttribute("id") || selectEl.getAttribute("name") || ""
              ).toLowerCase();
              const isProjectField = fieldHint.includes("project");

              // 1) direct value match
              const byValue = Array.from(selectEl.options || []).find(
                (opt) => String(opt.value || "") === normalizedTarget
              );
              if (byValue) {
                selectEl.value = byValue.value;
                selectEl.dispatchEvent(new Event("input", { bubbles: true }));
                selectEl.dispatchEvent(new Event("change", { bubbles: true }));
                return true;
              }

              // 2) visible label exact (case-insensitive)
              const lowerTarget = normalizedTarget.toLowerCase();
              const byLabel = Array.from(selectEl.options || []).find(
                (opt) => normalizeValue(opt.text).toLowerCase() === lowerTarget
              );
              if (byLabel) {
                selectEl.value = byLabel.value;
                selectEl.dispatchEvent(new Event("input", { bubbles: true }));
                selectEl.dispatchEvent(new Event("change", { bubbles: true }));
                return true;
              }

              // 3) canonical exact (handles punctuation/spacing variations)
              const byCanonical = Array.from(selectEl.options || []).find((opt) => {
                const optionLookup = normalizeLookup(opt.text);
                return optionLookup === lookupTarget;
              });
              if (byCanonical) {
                selectEl.value = byCanonical.value;
                selectEl.dispatchEvent(new Event("input", { bubbles: true }));
                selectEl.dispatchEvent(new Event("change", { bubbles: true }));
                return true;
              }

              // 4) fuzzy fallback for non-project selects only (avoid wrong project picks)
              if (isProjectField) return false;
              const fuzzyMatches = Array.from(selectEl.options || []).filter((opt) => {
                const optionLookup = normalizeLookup(opt.text);
                return (
                  optionLookup.includes(lookupTarget) ||
                  lookupTarget.includes(optionLookup)
                );
              });
              if (fuzzyMatches.length !== 1) return false;
              const byFuzzy = fuzzyMatches[0];
              if (byFuzzy) {
                selectEl.value = byFuzzy.value;
                selectEl.dispatchEvent(new Event("input", { bubbles: true }));
                selectEl.dispatchEvent(new Event("change", { bubbles: true }));
                return true;
              }
              return false;
            }
            async function selectBySelect2Label(selectEl, target) {
              const selectId = selectEl?.getAttribute("id");
              if (!selectId) return false;
              const rawTarget = normalizeValue(target);
              const fieldHint = String(
                selectEl.getAttribute("id") || selectEl.getAttribute("name") || ""
              ).toLowerCase();
              const isProjectField = fieldHint.includes("project");
              const rendered = document.querySelector("#select2-" + selectId + "-container");
              const container =
                rendered?.closest(".select2-selection") ||
                selectEl.closest(".related-widget-wrapper")?.querySelector(".select2-selection");
              if (!container) return false;
              function pickBestCandidate(items, getText, lookupTarget, lowerTarget) {
                if (!items || !items.length) return null;
                const exact = items.find((item) =>
                  normalizeValue(getText(item)).toLowerCase() === lowerTarget
                );
                if (exact) return exact;
                const canonicalExact = items.find((item) => {
                  const lookup = normalizeLookup(getText(item));
                  return lookup === lookupTarget;
                });
                if (canonicalExact) return canonicalExact;
                const fuzzy = items.filter((item) => {
                  const lookup = normalizeLookup(getText(item));
                  return (
                    lookup.includes(lookupTarget) ||
                    lookupTarget.includes(lookup)
                  );
                });
                if (fuzzy.length === 1) return fuzzy[0];
                return null;
              }
              function applySelectValue(optionValue, optionText) {
                if (!optionValue) return false;
                let nativeOption = Array.from(selectEl.options || []).find(
                  (opt) => String(opt.value || "") === String(optionValue)
                );
                if (!nativeOption) {
                  nativeOption = new Option(normalizeValue(optionText || rawTarget), String(optionValue), true, true);
                  selectEl.add(nativeOption);
                }
                selectEl.value = String(optionValue);
                selectEl.dispatchEvent(new Event("input", { bubbles: true }));
                selectEl.dispatchEvent(new Event("change", { bubbles: true }));
                if (window.jQuery && typeof window.jQuery === "function") {
                  window.jQuery(selectEl).trigger("change.select2");
                }
                return true;
              }
              async function fetchAdminAutocompleteOption(lookupTarget, lowerTarget) {
                const baseUrl = selectEl.getAttribute("data-ajax--url");
                if (!baseUrl) return null;
                const params = new URLSearchParams();
                params.set("term", rawTarget);
                const appLabel = selectEl.getAttribute("data-app-label");
                const modelName = selectEl.getAttribute("data-model-name");
                const fieldName = selectEl.getAttribute("data-field-name");
                if (appLabel) params.set("app_label", appLabel);
                if (modelName) params.set("model_name", modelName);
                if (fieldName) params.set("field_name", fieldName);
                const reqUrl = baseUrl + (baseUrl.includes("?") ? "&" : "?") + params.toString();
                try {
                  const res = await fetch(reqUrl, {
                    credentials: "include",
                    headers: { "X-Requested-With": "XMLHttpRequest" },
                  });
                  if (!res.ok) return null;
                  const data = await res.json();
                  const results = Array.isArray(data?.results) ? data.results : [];
                  const match = pickBestCandidate(results, (item) => item?.text || "", lookupTarget, lowerTarget);
                  if (match) return match;
                  if (isProjectField) return null;
                  return results[0] || null;
                } catch (_) {
                  return null;
                }
              }

              container.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
              container.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
              container.click();

              // For remote data source, type query in select2 search field.
              const resultsId = "select2-" + selectId + "-results";
              const searchInput = await waitForElement(
                '.select2-container--open .select2-search__field[aria-controls="' + resultsId + '"]',
                3000,
                100
              );
              if (searchInput) {
                searchInput.focus();
                searchInput.value = normalizeValue(target);
                searchInput.dispatchEvent(new Event("input", { bubbles: true }));
                searchInput.dispatchEvent(new Event("change", { bubbles: true }));
                searchInput.dispatchEvent(new KeyboardEvent("keyup", { key: "e", bubbles: true }));
              }

              const lowerTarget = normalizeValue(target).toLowerCase();
              const lookupTarget = normalizeLookup(target);
              const option = await (async function waitOption() {
                const deadline = Date.now() + 5000;
                while (Date.now() < deadline) {
                  const options = Array.from(
                    document.querySelectorAll("#" + resultsId + " .select2-results__option")
                  )
                    .filter((el) => !el.classList.contains("select2-results__message"));
                  const picked = pickBestCandidate(options, (el) => el.textContent || "", lookupTarget, lowerTarget);
                  if (picked) return picked;
                  const loadMore = document.querySelector(
                    "#" + resultsId + " .select2-results__option--load-more"
                  );
                  if (loadMore) {
                    const list = loadMore.closest(".select2-results__options");
                    if (list) list.scrollTop = list.scrollHeight;
                  }
                  await new Promise((r) => setTimeout(r, 120));
                }
                return null;
              })();
              if (option) {
                option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
                option.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
                option.click();
              } else {
                const remoteMatch = await fetchAdminAutocompleteOption(lookupTarget, lowerTarget);
                if (!remoteMatch) return false;
                applySelectValue(remoteMatch.id, remoteMatch.text);
              }

              const selectedOk = await (async function waitSelected() {
                const deadline = Date.now() + 1500;
                while (Date.now() < deadline) {
                  const shown = normalizeValue(
                    document.querySelector("#select2-" + selectId + "-container")?.textContent || ""
                  );
                  const shownLookup = normalizeLookup(shown);
                  if (
                    shownLookup &&
                    lookupTarget &&
                    (isProjectField
                      ? shownLookup === lookupTarget
                      : (
                        shownLookup === lookupTarget ||
                        shownLookup.includes(lookupTarget) ||
                        lookupTarget.includes(shownLookup)
                      ))
                  ) {
                    return true;
                  }
                  await new Promise((r) => setTimeout(r, 100));
                }
                return false;
              })();
              return selectedOk;
            }
            const resolvedSel = isMediuswareDailyUpdate
              ? resolveMediuswareSelector(sel)
              : sel;
            const el = await waitForElement(resolvedSel, 5000, 200);
            if (!el) return { success: false, error: "Element not found: " + sel };
            const selectEl = el;
            const ok = await selectByValueOrLabel(selectEl, val);
            if (ok) return { success: true };
            if (isMediuswareDailyUpdate) {
              const okSelect2 = await selectBySelect2Label(selectEl, val);
              if (okSelect2) return { success: true };
              const selectId = selectEl?.getAttribute("id") || "";
              if (selectId && /project/i.test(selectId)) {
                const normalizeLookup = (v) =>
                  normalizeValue(v)
                    .toLowerCase()
                    .replace(/\(.*?\)/g, " ")
                    .replace(/[^a-z0-9]+/g, " ")
                    .replace(/\b(select|choose|set|as|manager|project)\b/g, " ")
                    .replace(/\s+/g, " ")
                    .trim();
                const targetLookup = normalizeLookup(val);
                const matched = await (async function waitProjectSelection() {
                  const deadline = Date.now() + 1200;
                  while (Date.now() < deadline) {
                    const rendered = document.querySelector(
                      "#select2-" + selectId + "-container"
                    );
                    const shown =
                      normalizeValue(
                        rendered?.getAttribute("title") ||
                          rendered?.textContent ||
                          ""
                      ) ||
                      normalizeValue(
                        selectEl.options?.[selectEl.selectedIndex]?.text || ""
                      );
                    const shownLookup = normalizeLookup(shown);
                    if (
                      shownLookup &&
                      targetLookup &&
                      shownLookup === targetLookup
                    ) {
                      return true;
                    }
                    await new Promise((r) => setTimeout(r, 100));
                  }
                  return false;
                })();
                if (matched) {
                  return { success: true };
                }
              }
            }
            return { success: false, error: "Option not found: " + val };
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
