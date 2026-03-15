/**
 * OpenBrowser - Sidebar Renderer
 * Handles UI, connects to bridge, displays status and action log
 */

const aiProviderSelect = document.getElementById("ai-provider-select");
const apiKeyInput = document.getElementById("api-key-input");
const apiKeyLabel = document.getElementById("api-key-label");
const goalInput = document.getElementById("goal-input");
const btnExecute = document.getElementById("btn-execute");
const statusState = document.getElementById("status-state");
const statusExtension = document.getElementById("status-extension");
const actionLog = document.getElementById("action-log");
const approvalSection = document.getElementById("approval-section");
const approvalMessage = document.getElementById("approval-message");
const btnApprove = document.getElementById("btn-approve");
const btnReject = document.getElementById("btn-reject");
const urlBar = document.getElementById("url-bar");
const btnGo = document.getElementById("btn-go");
const projectNameInput = document.getElementById("project-name-input");
const btnSaveProject = document.getElementById("btn-save-project");
const btnNewProject = document.getElementById("btn-new-project");
const projectList = document.getElementById("project-list");
const welcomeBlock = document.getElementById("welcome-block");
const btnDismissWelcome = document.getElementById("btn-dismiss-welcome");
const actionLogEmpty = document.getElementById("action-log-empty");
const projectsPrompt = document.getElementById("projects-prompt");
const setupScreen = document.getElementById("setup-screen");
const appShell = document.getElementById("app-shell");
const setupPlannerSelect = document.getElementById("setup-planner-select");
const setupApiKeyField = document.getElementById("setup-api-key-field");
const setupApiKeyInput = document.getElementById("setup-api-key-input");
const btnSetupApiKeyVisibility = document.getElementById(
  "btn-setup-api-key-visibility",
);
const btnSetupContinue = document.getElementById("btn-setup-continue");
const setupError = document.getElementById("setup-error");
const viewProjects = document.getElementById("view-projects");
const viewProjectDetail = document.getElementById("view-project-detail");
const btnBackToProjects = document.getElementById("btn-back-to-projects");
const projectDetailName = document.getElementById("project-detail-name");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const settingsMenu = document.getElementById("settings-menu");
const btnSettings = document.getElementById("btn-settings");
const settingsPanel = document.getElementById("settings-panel");
const settingsProviderSelect = document.getElementById(
  "settings-provider-select",
);
const settingsApiKeyField = document.getElementById("settings-api-key-field");
const settingsApiKeyInput = document.getElementById("settings-api-key-input");
const btnSettingsApiKeyVisibility = document.getElementById(
  "btn-settings-api-key-visibility",
);
const settingsModelSelect = document.getElementById("settings-model-select");
const btnSettingsChangeKey = document.getElementById("btn-settings-change-key");
const settingsMessage = document.getElementById("settings-message");

const WELCOME_DISMISSED_KEY = "openbrowser-welcome-dismissed";
const SIDEBAR_COLLAPSED_KEY = "openbrowser-sidebar-collapsed";
const SIDEBAR_WIDTH_EXPANDED = 320;
const SIDEBAR_WIDTH_COLLAPSED = 52;

let bridgePort = 0;
let extensionSocket = null;
let pendingApproval = null;
let currentProjectId = null;
let currentPlan = [];
let actionTrace = [];
let currentAiModel = "gemini-2.5-flash";
let aiProviderSelectBound = false;

async function init() {
  if (window.openBrowser) {
    try {
      bridgePort = await window.openBrowser.getBridgePort();
      console.log("[OpenBrowser] Bridge port:", bridgePort);
      const cfg = await window.openBrowser.getAiConfig?.();
      if (cfg) {
        currentAiModel = cfg.model || currentAiModel;
        setupAiProviderSelect(cfg);
      }
    } catch (e) {
      console.warn("[OpenBrowser] init:", e);
    }
  }
  if (!bridgePort) bridgePort = 9333;
  connectToBridge();
  setupBrowser();
  setupProjects();
  setupWelcome();
  setupSidebarToggle();
  setupViewSwitching();
  setupApiKeyVisibilityToggles();
  await setupSetupScreen();
  setupSettingsMenu();
  setupKeyboardShortcuts();
  refreshProjectList();
  if (localStorage.getItem(WELCOME_DISMISSED_KEY))
    welcomeBlock?.classList.add("hidden");
  const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  if (collapsed && sidebar) {
    sidebar.classList.add("collapsed");
    try {
      if (window.openBrowser?.setSidebarWidth)
        await window.openBrowser.setSidebarWidth(SIDEBAR_WIDTH_COLLAPSED);
    } catch (_) {}
    if (sidebarToggle) {
      sidebarToggle.setAttribute("aria-label", "Expand sidebar");
      sidebarToggle.title = "Expand sidebar";
      const icon = sidebarToggle.querySelector(".sidebar-toggle-icon");
      if (icon) icon.textContent = "▶";
    }
  }
}

function setupWelcome() {
  const dismissBtn = document.getElementById("btn-dismiss-welcome");
  if (dismissBtn)
    dismissBtn.addEventListener("click", () => {
      localStorage.setItem(WELCOME_DISMISSED_KEY, "1");
      welcomeBlock?.classList.add("hidden");
    });
}

function setupSidebarToggle() {
  if (!sidebar || !sidebarToggle) return;
  sidebarToggle.addEventListener("click", () => {
    const collapsed = sidebar.classList.toggle("collapsed");
    const width = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
    try {
      if (window.openBrowser?.setSidebarWidth)
        window.openBrowser.setSidebarWidth(width);
    } catch (_) {}
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    sidebarToggle.setAttribute(
      "aria-label",
      collapsed ? "Expand sidebar" : "Collapse sidebar",
    );
    sidebarToggle.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    const icon = sidebarToggle.querySelector(".sidebar-toggle-icon");
    if (icon) icon.textContent = collapsed ? "▶" : "◀";
  });
  const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  const icon = sidebarToggle.querySelector(".sidebar-toggle-icon");
  if (icon) icon.textContent = collapsed ? "▶" : "◀";
}

function showProjectsView() {
  if (viewProjects) viewProjects.hidden = false;
  if (viewProjectDetail) viewProjectDetail.hidden = true;
}

function showProjectDetailView() {
  if (viewProjects) viewProjects.hidden = true;
  if (viewProjectDetail) viewProjectDetail.hidden = false;
  if (projectDetailName)
    projectDetailName.textContent =
      projectNameInput?.value?.trim() || "Project";
}

function setupViewSwitching() {
  btnBackToProjects?.addEventListener("click", () => {
    showProjectsView();
  });
}

function setSetupError(message = "") {
  if (!setupError) return;
  setupError.textContent = message || "Invalid Gemini API key";
  setupError.hidden = !message;
}

function setSettingsMessage(message = "", kind = "") {
  if (!settingsMessage) return;
  settingsMessage.textContent = message;
  settingsMessage.className = "settings-message" + (kind ? ` ${kind}` : "");
  settingsMessage.hidden = !message;
}

function setApiKeyInputVisibility(inputEl, buttonEl, visible) {
  if (!inputEl || !buttonEl) return;
  inputEl.type = visible ? "text" : "password";
  buttonEl.classList.toggle("is-visible", visible);
  const label = visible ? "Hide API key" : "Show API key";
  buttonEl.setAttribute("aria-label", label);
  buttonEl.title = label;
}

function setupApiKeyVisibilityToggles() {
  setApiKeyInputVisibility(setupApiKeyInput, btnSetupApiKeyVisibility, false);
  setApiKeyInputVisibility(
    settingsApiKeyInput,
    btnSettingsApiKeyVisibility,
    false,
  );

  btnSetupApiKeyVisibility?.addEventListener("click", () => {
    const visible = setupApiKeyInput?.type === "password";
    setApiKeyInputVisibility(
      setupApiKeyInput,
      btnSetupApiKeyVisibility,
      visible,
    );
  });

  btnSettingsApiKeyVisibility?.addEventListener("click", () => {
    const visible = settingsApiKeyInput?.type === "password";
    setApiKeyInputVisibility(
      settingsApiKeyInput,
      btnSettingsApiKeyVisibility,
      visible,
    );
  });
}

async function populateSettingsModels(apiKey = "", selectedModel = "") {
  if (!settingsModelSelect) return;
  settingsModelSelect.innerHTML = "";
  let models = [];
  try {
    models = await window.openBrowser?.listGeminiModels?.(apiKey);
  } catch (_) {}
  const options =
    Array.isArray(models) && models.length
      ? models
      : [selectedModel || currentAiModel];
  options.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    settingsModelSelect.appendChild(opt);
  });
  const target =
    selectedModel && options.includes(selectedModel)
      ? selectedModel
      : options[0];
  settingsModelSelect.value = target || currentAiModel;
}

function applyAiConfigToUi(config) {
  if (!config) return;
  currentAiModel = config.model || currentAiModel;
  const provider = config.aiProvider || "gemini";
  const geminiKey = config.geminiApiKey || "";
  if (setupPlannerSelect) setupPlannerSelect.value = provider;
  if (setupApiKeyInput) setupApiKeyInput.value = geminiKey;
  if (aiProviderSelect) {
    aiProviderSelect.value = provider;
    aiProviderSelect.dispatchEvent(new Event("change"));
  }
  if (apiKeyInput) apiKeyInput.value = geminiKey;
}

async function showMainInterface() {
  try {
    await window.openBrowser?.startMainInterface?.();
  } catch (e) {
    console.warn("[OpenBrowser] startMainInterface:", e);
  }
  if (setupScreen) setupScreen.hidden = true;
  if (appShell) appShell.hidden = false;
  showProjectsView();
}

function setupSettingsMenu() {
  btnSettings?.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!settingsPanel) return;
    const opening = settingsPanel.hidden;
    settingsPanel.hidden = !settingsPanel.hidden;
    if (!opening) return;
    if (settingsProviderSelect)
      settingsProviderSelect.value = aiProviderSelect?.value || "gemini";
    if (settingsApiKeyField) settingsApiKeyField.style.display = "";
    if (settingsApiKeyInput) {
      settingsApiKeyInput.value = (
        apiKeyInput?.value ||
        setupApiKeyInput?.value ||
        ""
      ).trim();
    }
    setApiKeyInputVisibility(
      settingsApiKeyInput,
      btnSettingsApiKeyVisibility,
      false,
    );
    await populateSettingsModels(
      settingsApiKeyInput?.value?.trim() || "",
      currentAiModel,
    );
    setSettingsMessage("");
  });

  document.addEventListener("click", (e) => {
    if (!settingsPanel || settingsPanel.hidden) return;
    if (!settingsMenu?.contains(e.target)) settingsPanel.hidden = true;
  });

  btnSettingsChangeKey?.addEventListener("click", async () => {
    const provider = settingsProviderSelect?.value || "gemini";
    const geminiApiKey = settingsApiKeyInput?.value?.trim() || "";
    const model = settingsModelSelect?.value || currentAiModel;
    const result = await window.openBrowser?.verifyAndSaveAiConfig?.({
      aiProvider: provider,
      geminiApiKey,
      model,
    });
    if (!result?.ok) {
      setSettingsMessage("Invalid Gemini API key", "error");
      return;
    }
    const cfg = await window.openBrowser?.getAiConfig?.();
    if (cfg) {
      currentAiModel = cfg.model || currentAiModel;
      setupAiProviderSelect(cfg);
    }
    applyAiConfigToUi(result.config);
    setSettingsMessage("Saved", "success");
  });
}

async function setupSetupScreen() {
  if (appShell) appShell.hidden = true;
  const refreshSetupApiKeyInput = () => {
    const visible = setupPlannerSelect?.value === "gemini";
    if (setupApiKeyField)
      setupApiKeyField.style.display = visible ? "" : "none";
    else if (setupApiKeyInput)
      setupApiKeyInput.style.display = visible ? "" : "none";
  };
  refreshSetupApiKeyInput();
  setupPlannerSelect?.addEventListener("change", refreshSetupApiKeyInput);
  setSetupError("");

  const saved = await window.openBrowser?.getSavedAiConfig?.();
  if (saved?.hasConfig && saved?.config) {
    applyAiConfigToUi(saved.config);
    const cfg = await window.openBrowser?.getAiConfig?.();
    if (cfg) {
      currentAiModel = cfg.model || currentAiModel;
      setupAiProviderSelect(cfg);
    }
    await showMainInterface();
    return;
  }

  if (setupScreen) setupScreen.hidden = false;
  btnSetupContinue?.addEventListener("click", async () => {
    const provider = setupPlannerSelect?.value || "gemini";
    const geminiApiKey = setupApiKeyInput?.value?.trim() || "";
    const result = await window.openBrowser?.verifyAndSaveAiConfig?.({
      aiProvider: provider,
      geminiApiKey,
      model: currentAiModel,
    });
    if (!result?.ok) {
      setSetupError("Invalid Gemini API key");
      return;
    }
    setSetupError("");
    const cfg = await window.openBrowser?.getAiConfig?.();
    if (cfg) {
      currentAiModel = cfg.model || currentAiModel;
      setupAiProviderSelect(cfg);
    }
    applyAiConfigToUi(result.config);
    await showMainInterface();
  });
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (viewProjectDetail && !viewProjectDetail.hidden) btnExecute?.click();
    }
  });
}

function setupAiProviderSelect(cfg) {
  if (!aiProviderSelect) return;
  aiProviderSelect.innerHTML = "";
  ["heuristic", "gemini", "ollama"].forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent =
      p === "heuristic"
        ? "Heuristic (no AI)"
        : p === "gemini"
          ? `Gemini (${cfg.model})`
          : `Ollama (${cfg.model})`;
    if (p === cfg.provider) opt.selected = true;
    aiProviderSelect.appendChild(opt);
  });
  if (!aiProviderSelectBound) {
    aiProviderSelect.addEventListener("change", () => {
      const p = aiProviderSelect.value;
      if (apiKeyInput) apiKeyInput.style.display = p === "gemini" ? "" : "none";
    });
    aiProviderSelectBound = true;
  }
  if (apiKeyInput)
    apiKeyInput.style.display = cfg.provider === "gemini" ? "" : "none";
}

function connectToBridge() {
  if (!bridgePort) {
    statusExtension.textContent = "no bridge";
    statusExtension.className = "status-value disconnected";
    return;
  }
  const ws = new WebSocket(`ws://127.0.0.1:${bridgePort}`);
  extensionSocket = ws;

  ws.onopen = () => {
    statusExtension.textContent = "ready";
    statusExtension.className = "status-value connected";
    ws.send(JSON.stringify({ type: "identify", role: "renderer" }));
    ws.send(JSON.stringify({ type: "ping" }));
  };

  ws.onclose = () => {
    statusExtension.textContent = "disconnected";
    statusExtension.className = "status-value disconnected";
    setTimeout(connectToBridge, 2000);
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "action_result") {
        logAction(msg.payload, msg.payload.success ? "success" : "error");
      }
    } catch (e) {}
  };
}

function setupBrowser() {
  if (window.openBrowser?.browserGetUrl) {
    window.openBrowser.browserGetUrl().then((url) => {
      if (url) urlBar.value = url;
    });
  }
  if (window.openBrowser?.onBrowserUrlChanged) {
    window.openBrowser.onBrowserUrlChanged((url) => {
      urlBar.value = url || urlBar.placeholder;
    });
  }
}

function navigateBrowser(url) {
  if (window.openBrowser?.browserNavigate) {
    window.openBrowser.browserNavigate(url);
  }
}

btnGo.addEventListener("click", () => {
  let url = urlBar.value.trim();
  if (!url.startsWith("http"))
    url = "https://www.google.com/search?q=" + encodeURIComponent(url);
  navigateBrowser(url);
});

btnExecute.addEventListener("click", async () => {
  const goal = goalInput.value.trim();
  if (!goal) return;

  actionTrace = [];
  setState("planning");
  logAction({ actionId: "plan", message: `Goal: ${goal}` }, "info");

  let plan;
  const provider = aiProviderSelect?.value || "heuristic";
  const apiKeyOverride = apiKeyInput?.value?.trim();
  if (provider !== "heuristic" && window.openBrowser?.plan) {
    try {
      plan = await window.openBrowser.plan(
        goal,
        provider,
        apiKeyOverride || undefined,
      );
      if (plan?.length)
        logAction({ message: `Plan from ${provider}` }, "success");
    } catch (e) {
      logAction({ error: `${provider} failed: ` + (e?.message || e) }, "error");
    }
  }
  if (!plan?.length) {
    plan = planFromGoal(goal);
    logAction({ message: "Plan from heuristics" }, "info");
  }
  currentPlan = plan;
  await persistGoalToProject();
  setState("executing");

  try {
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      if (i > 0 && plan[i - 1].action.type === "navigate") {
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (step.requiresApproval) {
        setState("waiting_approval");
        pendingApproval = step;
        if (approvalSection) approvalSection.hidden = false;
        if (approvalMessage)
          approvalMessage.textContent = `Approve: ${step.action.type} on "${step.action.selector || step.action.url || "element"}"?`;
        const approved = await new Promise((resolve) => {
          btnApprove.onclick = () => {
            approvalSection.hidden = true;
            pendingApproval = null;
            resolve(true);
          };
          btnReject.onclick = () => {
            approvalSection.hidden = true;
            pendingApproval = null;
            logAction(
              { actionId: step.action.id, error: "Rejected by user" },
              "error",
            );
            resolve(false);
          };
        });
        if (!approved) continue;
      }

      if (step.action.type === "navigate") {
        navigateBrowser(step.action.url);
        logAction({ actionId: step.action.id, success: true }, "success");
      } else if (window.openBrowser?.executeActionInBrowser) {
        const result = await window.openBrowser.executeActionInBrowser(
          step.action,
        );
        logAction(
          {
            actionId: step.action.id,
            success: result?.success,
            error: result?.error,
          },
          result?.success ? "success" : "error",
        );
      } else if (
        extensionSocket &&
        extensionSocket.readyState === WebSocket.OPEN
      ) {
        extensionSocket.send(
          JSON.stringify({ type: "action", payload: step.action }),
        );
      } else {
        logAction(
          { actionId: step.action.id, error: "Cannot execute action" },
          "error",
        );
      }
    }
    setState("completed");
    await persistGoalToProject();
  } catch (err) {
    logAction({ error: "Run failed: " + (err?.message || err) }, "error");
    setState("failed");
    await persistGoalToProject();
  }
});

async function runPlan(plan) {
  setState("executing");
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    if (i > 0 && plan[i - 1].action.type === "navigate") {
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (step.requiresApproval) {
      setState("waiting_approval");
      approvalSection.hidden = false;
      approvalMessage.textContent = `Approve: ${step.action.type} on "${step.action.selector || step.action.url || "element"}"?`;
      const approved = await new Promise((resolve) => {
        btnApprove.onclick = () => {
          approvalSection.hidden = true;
          resolve(true);
        };
        btnReject.onclick = () => {
          approvalSection.hidden = true;
          logAction({ actionId: step.action.id, error: "Rejected" }, "error");
          resolve(false);
        };
      });
      if (!approved) continue;
    }
    if (step.action.type === "navigate") {
      navigateBrowser(step.action.url);
      logAction({ actionId: step.action.id, success: true }, "success");
    } else if (window.openBrowser?.executeActionInBrowser) {
      const result = await window.openBrowser.executeActionInBrowser(
        step.action,
      );
      logAction(
        {
          actionId: step.action.id,
          success: result?.success,
          error: result?.error,
        },
        result?.success ? "success" : "error",
      );
    }
  }
  setState("completed");
}

function setupProjects() {
  btnSaveProject?.addEventListener("click", saveProject);
  btnNewProject?.addEventListener("click", () => {
    currentProjectId = null;
    goalInput.value = "";
    projectNameInput.value = "";
    actionTrace = [];
    currentPlan = [];
    setState("idle");
    while (actionLog?.firstChild) actionLog.removeChild(actionLog.firstChild);
    if (actionLogEmpty) {
      actionLogEmpty.classList.remove("hidden");
      actionLog.appendChild(actionLogEmpty);
    }
  });
}

/** Persist current goal/plan/trace into the current project (no toast). */
async function persistGoalToProject() {
  if (!currentProjectId) return;
  const goal = goalInput?.value?.trim() ?? "";
  const name =
    projectNameInput?.value?.trim() || goal?.slice(0, 50) || "Untitled";
  const provider = aiProviderSelect?.value || "heuristic";
  try {
    await window.openBrowser?.projectsSave?.({
      id: currentProjectId,
      name: name || "Untitled",
      goal: goal || "",
      plan: currentPlan || [],
      trace: actionTrace || [],
      aiProvider: provider,
    });
  } catch (_) {}
}

async function saveProject() {
  const goal = goalInput?.value?.trim() ?? "";
  const name = projectNameInput?.value?.trim() || goal || "Untitled";
  if (!name && !goal) return;
  const provider = aiProviderSelect?.value || "heuristic";
  const isOnProjectsView = viewProjectDetail?.hidden === true;
  try {
    const project = await window.openBrowser?.projectsSave?.({
      id: currentProjectId || undefined,
      name: name || goal?.slice(0, 50) || "Untitled",
      goal: goal || name || "",
      plan: currentPlan || [],
      trace: actionTrace || [],
      aiProvider: provider,
    });
    if (project) {
      currentProjectId = project.id;
      if (projectNameInput) projectNameInput.value = project.name;
      if (projectDetailName) projectDetailName.textContent = project.name;
      await refreshProjectList();
      if (isOnProjectsView) {
        if (goalInput) goalInput.value = project.goal || "";
        actionTrace = project.trace || [];
        currentPlan = project.plan || [];
        while (actionLog?.firstChild)
          actionLog.removeChild(actionLog.firstChild);
        if (actionTrace?.length) {
          actionTrace.forEach((t) => {
            const el = document.createElement("div");
            el.className = "action-log-entry " + (t.kind || "info");
            el.textContent = t.time + " " + t.msg;
            actionLog.appendChild(el);
          });
          actionLogEmpty?.classList.add("hidden");
        } else if (actionLogEmpty) {
          actionLog.appendChild(actionLogEmpty);
          actionLogEmpty.classList.remove("hidden");
        }
        showProjectDetailView();
      } else {
        logAction({ message: `Saved: ${project.name}` }, "success");
      }
    } else {
      logAction({ error: "Save failed (no response)" }, "error");
    }
  } catch (e) {
    logAction({ error: "Save failed: " + (e?.message || e) }, "error");
  }
}

async function loadProject(id) {
  const p = await window.openBrowser?.projectsLoad?.(id);
  if (!p) return;
  currentProjectId = p.id;
  if (projectNameInput) projectNameInput.value = p.name || "";
  goalInput.value = p.goal || "";
  actionTrace = p.trace || [];
  currentPlan = p.plan || [];
  while (actionLog?.firstChild) actionLog.removeChild(actionLog.firstChild);
  (p.trace || []).forEach((t) => {
    const el = document.createElement("div");
    el.className = "action-log-entry " + (t.kind || "info");
    el.textContent = t.time + " " + t.msg;
    actionLog.appendChild(el);
  });
  actionLogEmpty?.classList.add("hidden");
  setState("idle");
  if (projectDetailName) projectDetailName.textContent = p.name || "Project";
  showProjectDetailView();
}

async function refreshProjectList() {
  if (!projectList) return;
  let list;
  try {
    list = await window.openBrowser?.projectsList?.();
  } catch (e) {
    projectList.innerHTML =
      "<div class='project-list-empty'>Error loading projects</div>";
    return;
  }
  if (!list?.length) {
    projectList.innerHTML =
      "<div class='project-list-empty'>No saved projects. Enter name above and click Save.</div>";
    if (projectsPrompt) projectsPrompt.classList.remove("hidden");
    return;
  }
  if (projectsPrompt) projectsPrompt.classList.add("hidden");
  projectList.innerHTML = "";
  list.forEach((p) => {
    const item = document.createElement("div");
    item.className = "project-list-item";
    const title = document.createElement("span");
    title.className = "project-list-item-title";
    title.textContent = p.name || p.goal?.slice(0, 40) || "Untitled";
    title.title = p.goal || "";
    title.onclick = () => loadProject(p.id);
    const del = document.createElement("button");
    del.className = "project-list-item-delete";
    del.textContent = "×";
    del.onclick = (e) => {
      e.stopPropagation();
      window.openBrowser
        ?.projectsDelete?.(p.id)
        .then(() => refreshProjectList());
    };
    item.appendChild(title);
    item.appendChild(del);
    projectList.appendChild(item);
  });
}

function planFromGoal(goal) {
  const id = () => "a-" + Math.random().toString(36).slice(2, 10);
  const lower = goal.toLowerCase();

  const navigate = (url) => ({
    action: { id: id(), type: "navigate", url },
    requiresApproval: false,
  });
  const typeIn = (selector, text, submit = true) => ({
    action: { id: id(), type: "fill", selector, text, submit },
    requiresApproval: false,
  });

  // Extract the search query by stripping site/action keywords
  const extractQuery = (keywords) => {
    let q = lower;
    keywords.forEach((k) => {
      q = q.replace(k, "");
    });
    return q.replace(/['"]/g, "").trim() || goal.trim();
  };

  // YouTube
  const ytKeywords = ["youtube", "on youtube", "in youtube"];
  const isYT = ytKeywords.some((k) => lower.includes(k));
  if (isYT) {
    const query = extractQuery([
      "visit",
      "go to",
      "open",
      "youtube",
      "search",
      "on",
      "in",
      "for",
    ]);
    if (query) {
      return [
        navigate("https://www.youtube.com"),
        typeIn(
          'input#search-input, ytd-searchbox input, input[name="search_query"], input[aria-label*="Search" i]',
          query,
        ),
      ];
    }
    return [navigate("https://www.youtube.com")];
  }

  // Bing
  if (lower.includes("bing")) {
    const query = extractQuery(["search", "on bing", "bing", "for", "find"]);
    if (query)
      return [
        navigate("https://www.bing.com/search?q=" + encodeURIComponent(query)),
      ];
    return [navigate("https://www.bing.com")];
  }

  // Wikipedia
  if (lower.includes("wikipedia")) {
    const query = extractQuery([
      "search",
      "wikipedia",
      "on",
      "for",
      "find",
      "open",
      "look up",
    ]);
    if (query)
      return [
        navigate(
          "https://en.wikipedia.org/w/index.php?search=" +
            encodeURIComponent(query),
        ),
      ];
    return [navigate("https://en.wikipedia.org")];
  }

  // Reddit
  if (lower.includes("reddit")) {
    const query = extractQuery([
      "search",
      "reddit",
      "on",
      "for",
      "find",
      "open",
    ]);
    if (query)
      return [
        navigate(
          "https://www.reddit.com/search/?q=" + encodeURIComponent(query),
        ),
      ];
    return [navigate("https://www.reddit.com")];
  }

  // GitHub
  if (lower.includes("github")) {
    const query = extractQuery([
      "search",
      "github",
      "on",
      "for",
      "find",
      "open",
    ]);
    if (query)
      return [
        navigate("https://github.com/search?q=" + encodeURIComponent(query)),
      ];
    return [navigate("https://github.com")];
  }

  // Bare "open/go to/visit <site>" — extract a URL-shaped word
  const openMatch = lower.match(
    /(?:open|visit|go to|navigate to)\s+([\w.-]+\.\w{2,})/i,
  );
  if (openMatch) {
    const site = openMatch[1];
    return [navigate(site.startsWith("http") ? site : "https://" + site)];
  }

  // Explicit URL in goal
  const urlMatch = goal.match(/https?:\/\/\S+/);
  if (urlMatch) return [navigate(urlMatch[0])];

  // Google search (default)
  const isSearch =
    lower.includes("search") ||
    lower.includes("google") ||
    lower.includes("find");
  if (isSearch) {
    const query = goal
      .replace(/^(search for|google|find|search)\s+/i, "")
      .replace(/['"]/g, "")
      .trim();
    return [
      navigate("https://www.google.com"),
      typeIn('textarea[name="q"], input[name="q"]', query),
    ];
  }

  // Fallback: Google search with the full goal as query
  return [
    navigate("https://www.google.com/search?q=" + encodeURIComponent(goal)),
  ];
}

function setState(state) {
  if (!statusState) return;
  const labels = {
    idle: "Idle",
    planning: "Planning…",
    executing: "Running…",
    waiting_approval: "Waiting for approval",
    completed: "Done",
    failed: "Failed",
    recovering: "Recovering…",
  };
  statusState.textContent = labels[state] || state;
  statusState.className = "status-value";
  if (state === "idle") statusState.classList.add("status-idle");
  if (state === "completed") statusState.classList.remove("status-idle");
  if (state === "failed") statusState.classList.add("disconnected");
  const busy =
    state === "planning" || state === "executing" || state === "recovering";
  if (btnExecute) {
    btnExecute.disabled = busy;
    const textEl = btnExecute.querySelector(".btn-text");
    const label = busy ? "Running…" : "Run";
    if (textEl) textEl.textContent = label;
    else btnExecute.textContent = label;
  }
}

function logAction(result, kind = "info") {
  actionLogEmpty?.classList.add("hidden");
  const msg =
    result.message ||
    result.error ||
    `${result.action?.type || "?"} ${result.success !== undefined ? (result.success ? "ok" : "failed") : ""}`;
  const time = new Date().toLocaleTimeString();
  actionTrace.push({ time, msg, kind });
  const el = document.createElement("div");
  el.className = "action-log-entry " + kind;
  el.textContent = time + " " + msg;
  actionLog.appendChild(el);
  actionLog.scrollTop = actionLog.scrollHeight;
}

init();
