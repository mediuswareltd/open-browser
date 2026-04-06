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
const statusConnectionLabel = document.getElementById(
  "status-connection-label",
);
const actionLog = document.getElementById("action-log");
const approvalSection = document.getElementById("approval-section");
const approvalMessage = document.getElementById("approval-message");
const btnApprove = document.getElementById("btn-approve");
const btnReject = document.getElementById("btn-reject");
const structuredStepsEl = document.getElementById("structured-steps");
const structuredStepsEmpty = document.getElementById("structured-steps-empty");
const resultSummaryEl = document.getElementById("result-summary");
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
const taskTabList = document.getElementById("task-tab-list");
const btnNewTaskTab = document.getElementById("btn-new-task-tab");
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
const settingsExecutorModeSelect = document.getElementById(
  "settings-executor-mode",
);
const btnSettingsChangeKey = document.getElementById("btn-settings-change-key");
const btnSettingsRemoveKey = document.getElementById("btn-settings-remove-key");
const btnSettingsProfiles = document.getElementById("btn-settings-profiles");
const settingsProfilesPanel = document.getElementById(
  "settings-profiles-panel",
);
const settingsProfilesList = document.getElementById("settings-profiles-list");
const btnSettingsProfileNew = document.getElementById(
  "btn-settings-profile-new",
);
const settingsMessage = document.getElementById("settings-message");

const WELCOME_DISMISSED_KEY = "openbrowser-welcome-dismissed";
const SIDEBAR_COLLAPSED_KEY = "openbrowser-sidebar-collapsed";
const SIDEBAR_WIDTH_EXPANDED = 360;
const SIDEBAR_WIDTH_COLLAPSED = 56;

let bridgePort = 0;
let extensionSocket = null;
let pendingApprovalRequestId = null;
let currentProjectId = null;
let currentPlan = [];
let actionTrace = [];
let currentProjectTabs = [];
let currentTabId = null;
let currentAiModel = "gemini-2.5-flash";
let aiProviderSelectBound = false;
let profileState = { profiles: [], activeProfileId: "default" };
let executorBridgeBound = false;
let currentStructuredRun = null;
let currentExecutorMode = "browserview";
let bridgeConnected = false;

function createTaskTabId() {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createRunId() {
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createActionId() {
  return `a-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function ensurePlanStepActionIds(plan = []) {
  if (!Array.isArray(plan)) return [];
  return plan.map((step) => {
    const action =
      step?.action && typeof step.action === "object" ? { ...step.action } : {};
    if (!String(action?.id || "").trim()) {
      action.id = createActionId();
    }
    return {
      ...step,
      action,
    };
  });
}

function normalizeStepStatus(status) {
  if (
    status === "pending" ||
    status === "running" ||
    status === "done" ||
    status === "failed"
  ) {
    return status;
  }
  return "pending";
}

function normalizeStructuredStep(step = {}, fallbackTitle = "Step") {
  return {
    id:
      String(step?.id || "").trim() ||
      `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: String(step?.title || fallbackTitle).trim() || fallbackTitle,
    status: normalizeStepStatus(step?.status),
    startedAt:
      typeof step?.startedAt === "number" ? Number(step.startedAt) : undefined,
    completedAt:
      typeof step?.completedAt === "number"
        ? Number(step.completedAt)
        : undefined,
    error: step?.error ? String(step.error) : undefined,
    actionId: step?.actionId ? String(step.actionId) : undefined,
    isAction: Boolean(step?.isAction),
    loading: Boolean(step?.loading),
  };
}

function normalizeStructuredRun(run) {
  if (!run || typeof run !== "object") return null;
  const steps = Array.isArray(run.steps)
    ? run.steps.map((step, idx) =>
        normalizeStructuredStep(step, `Step ${idx + 1}`),
      )
    : [];
  return {
    id: String(run.id || createRunId()),
    prompt: String(run.prompt || ""),
    createdAt:
      typeof run.createdAt === "number" ? Number(run.createdAt) : Date.now(),
    steps,
    logs: normalizeTraceEntries(run.logs),
    result:
      run.result && typeof run.result === "object"
        ? {
            status: String(run.result.status || "pending"),
            message: String(run.result.message || ""),
          }
        : { status: "pending", message: "" },
  };
}

function actionLabel(action = {}) {
  const type = String(action?.type || "action");
  if (type === "navigate")
    return `Open ${String(action?.url || "target page")}`;
  if (type === "fill" || type === "type")
    return `Fill ${String(action?.selector || "input field")}`;
  if (type === "click")
    return `Click ${String(action?.selector || "target element")}`;
  if (type === "select")
    return `Select ${String(action?.selector || "dropdown option")}`;
  if (type === "scroll") return `Scroll ${String(action?.direction || "page")}`;
  if (type === "screenshot") return "Capture screenshot";
  return `Run ${type}`;
}

function createStructuredSteps(goal, plan = []) {
  const runId = createRunId();
  const steps = [
    {
      id: `${runId}-interpret`,
      title: "Interpret prompt",
      status: "running",
      startedAt: Date.now(),
    },
  ];
  plan.forEach((step, idx) => {
    const action = step?.action || {};
    steps.push({
      id: `${runId}-action-${idx + 1}`,
      title: actionLabel(action),
      status: "pending",
      actionId: String(action?.id || ""),
      isAction: true,
    });
  });
  steps.push({
    id: `${runId}-finalize`,
    title: "Finalize run",
    status: "pending",
  });
  return {
    id: runId,
    prompt: String(goal || ""),
    createdAt: Date.now(),
    steps: steps.map((step, idx) =>
      normalizeStructuredStep(step, `Step ${idx + 1}`),
    ),
    logs: normalizeTraceEntries(actionTrace),
    result: { status: "running", message: "Execution started" },
  };
}

function createStructuredStepsPlaceholder(goal, plan = []) {
  const runId = createRunId();
  const steps = [
    {
      id: `${runId}-interpret`,
      title: "Generating steps...",
      status: "running",
      startedAt: Date.now(),
      loading: true,
    },
  ];
  plan.forEach((step, idx) => {
    const action = step?.action || {};
    steps.push({
      id: `${runId}-action-${idx + 1}`,
      title: `Generating step ${idx + 1}...`,
      status: "pending",
      actionId: String(action?.id || ""),
      isAction: true,
      loading: true,
    });
  });
  steps.push({
    id: `${runId}-finalize`,
    title: "Generating steps...",
    status: "pending",
    loading: true,
  });
  return {
    id: runId,
    prompt: String(goal || ""),
    createdAt: Date.now(),
    steps: steps.map((step, idx) =>
      normalizeStructuredStep(step, `Step ${idx + 1}`),
    ),
    logs: normalizeTraceEntries(actionTrace),
    result: { status: "running", message: "Execution started" },
  };
}

function sanitizeFriendlyStepTitle(value, fallback) {
  const raw = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return fallback;
  return raw.length > 90 ? raw.slice(0, 90).trim() : raw;
}

function applyFriendlyTitlesToRun(run, titles = {}) {
  if (!run || !Array.isArray(run.steps) || !run.steps.length) return run;
  const steps = run.steps.map((step) => ({ ...step }));
  const actionIndexes = [];
  steps.forEach((step, idx) => {
    if (step?.isAction) actionIndexes.push(idx);
  });

  const intro = steps[0];
  if (intro && !intro.isAction) {
    intro.title = sanitizeFriendlyStepTitle(
      titles?.introTitle,
      intro.title || "Prepare task",
    );
    intro.loading = false;
  }

  const actionTitles = Array.isArray(titles?.actionTitles)
    ? titles.actionTitles
    : [];
  actionIndexes.forEach((idx, i) => {
    const nextTitle = sanitizeFriendlyStepTitle(
      actionTitles[i],
      steps[idx].title || `Step ${i + 1}`,
    );
    steps[idx].title = nextTitle;
    steps[idx].loading = false;
  });

  const outroIndex = steps.length - 1;
  const outro = steps[outroIndex];
  if (outro && !outro.isAction) {
    outro.title = sanitizeFriendlyStepTitle(
      titles?.outroTitle,
      outro.title || "Wrap up task",
    );
    outro.loading = false;
  }

  return {
    ...run,
    steps,
  };
}

async function fetchFriendlyTitles(goal, plan, apiKeyOverride) {
  if (!window.openBrowser?.generateStepTitles) return null;
  try {
    return await window.openBrowser.generateStepTitles(
      goal,
      plan,
      apiKeyOverride || undefined,
    );
  } catch (_) {
    return null;
  }
}

function buildStructuredRun(goal, plan, apiKeyOverride) {
  if (!window.openBrowser?.generateStepTitles) {
    return createStructuredSteps(goal, plan);
  }

  const run = createStructuredStepsPlaceholder(goal, plan);
  void fetchFriendlyTitles(goal, plan, apiKeyOverride).then((titles) => {
    if (!titles) return;
    updateCurrentRun((current) => {
      if (!current || current.id !== run.id) return current;
      return applyFriendlyTitlesToRun(current, titles);
    });
  });

  return run;
}

function getActionStepIndexForStart(steps = [], actionId = "") {
  if (actionId) {
    const byId = steps.findIndex(
      (step) => step.isAction && step.actionId === actionId,
    );
    if (byId >= 0) return byId;
  }
  const running = steps.findIndex(
    (step) => step.isAction && step.status === "running",
  );
  if (running >= 0) return running;
  return steps.findIndex((step) => step.isAction && step.status === "pending");
}

function getActionStepIndexForResult(steps = [], actionId = "") {
  if (actionId) {
    const byId = steps.findIndex(
      (step) => step.isAction && step.actionId === actionId,
    );
    if (byId >= 0) return byId;
  }
  const running = steps.findIndex(
    (step) => step.isAction && step.status === "running",
  );
  if (running >= 0) return running;
  return steps.findIndex(
    (step) =>
      step.isAction && (step.status === "pending" || step.status === "running"),
  );
}

function updateCurrentRun(mutator) {
  if (!currentStructuredRun) return;
  const next = normalizeStructuredRun(mutator({ ...currentStructuredRun }));
  currentStructuredRun = next;
  syncActiveTaskTabFromUi();
  renderStructuredRun();
}

function markActionStepRunning(actionId) {
  updateCurrentRun((run) => {
    const steps = run.steps.map((step) => ({ ...step }));
    const interpret = steps[0];
    if (interpret && interpret.status === "running") {
      interpret.status = "done";
      interpret.completedAt = Date.now();
    }
    const idx = getActionStepIndexForStart(steps, String(actionId || ""));
    if (idx >= 0) {
      steps[idx].status = "running";
      steps[idx].startedAt = steps[idx].startedAt || Date.now();
    }
    run.steps = steps;
    return run;
  });
}

function markActionStepResult(actionId, success, errorMessage = "") {
  updateCurrentRun((run) => {
    const steps = run.steps.map((step) => ({ ...step }));
    const idx = getActionStepIndexForResult(steps, String(actionId || ""));
    if (idx >= 0) {
      steps[idx].status = success ? "done" : "failed";
      steps[idx].completedAt = Date.now();
      steps[idx].error = success
        ? undefined
        : String(errorMessage || "Action failed");
    }
    if (!success) {
      const finalize = steps[steps.length - 1];
      if (finalize && !finalize.actionId) {
        finalize.status = "failed";
        finalize.startedAt = finalize.startedAt || Date.now();
        finalize.completedAt = Date.now();
        finalize.error = String(errorMessage || "Run failed");
      }
      run.result = {
        status: "failed",
        message: String(errorMessage || "Execution failed"),
      };
    }
    run.steps = steps;
    return run;
  });
}

function applyTerminalStateToRun(state) {
  if (!currentStructuredRun) return;
  updateCurrentRun((run) => {
    const steps = run.steps.map((step) => ({ ...step }));
    const interpret = steps[0];
    if (interpret && interpret.status === "running") {
      interpret.status = state === "failed" ? "failed" : "done";
      interpret.completedAt = Date.now();
      if (state === "failed") interpret.error = interpret.error || "Run failed";
    }
    const finalize = steps[steps.length - 1];
    if (finalize && !finalize.actionId) {
      finalize.startedAt = finalize.startedAt || Date.now();
      finalize.completedAt = Date.now();
      if (state === "completed") {
        finalize.status = "done";
        finalize.error = undefined;
      } else if (state === "failed") {
        finalize.status = "failed";
        finalize.error = finalize.error || "Run failed";
      }
    }
    run.steps = steps;
    if (state === "completed") {
      const hasFailedStep = steps.some((step) => step.status === "failed");
      run.result = hasFailedStep
        ? { status: "failed", message: "Execution completed with failures" }
        : {
            status: "done",
            message:
              "Execution finished (action-level success, goal not verified)",
          };
    } else if (state === "failed") {
      run.result = {
        status: "failed",
        message:
          run.result?.message && run.result.message !== "Execution started"
            ? run.result.message
            : "Execution failed",
      };
    }
    return run;
  });
}

function renderStructuredSteps(run) {
  if (!structuredStepsEl) return;
  while (structuredStepsEl.firstChild)
    structuredStepsEl.removeChild(structuredStepsEl.firstChild);
  const steps = Array.isArray(run?.steps) ? run.steps : [];
  if (!steps.length) {
    if (structuredStepsEmpty) {
      structuredStepsEmpty.classList.remove("hidden");
      structuredStepsEl.appendChild(structuredStepsEmpty);
    }
    return;
  }
  if (structuredStepsEmpty) structuredStepsEmpty.classList.add("hidden");
  steps.forEach((step) => {
    const row = document.createElement("div");
    row.className = `structured-step-row ${normalizeStepStatus(step?.status)}${step?.loading ? " loading" : ""}`;
    const dot = document.createElement("span");
    dot.className = "structured-step-dot";
    const title = document.createElement("span");
    title.className = "structured-step-title";
    title.textContent = step?.error
      ? `${step.title} (${step.error})`
      : step.title;
    row.appendChild(dot);
    row.appendChild(title);
    structuredStepsEl.appendChild(row);
  });
}

function renderResultSummary(run) {
  if (!resultSummaryEl) return;
  if (!run) {
    resultSummaryEl.textContent = "No result yet.";
    resultSummaryEl.className = "result-summary";
    return;
  }
  const status = String(run?.result?.status || "pending");
  const message =
    String(run?.result?.message || "").trim() ||
    (status === "failed"
      ? "Execution failed."
      : status === "done"
        ? "Execution completed."
        : "Run in progress.");
  resultSummaryEl.textContent = message;
  resultSummaryEl.className =
    "result-summary" +
    (status === "failed" ? " failed" : status === "done" ? " success" : "");
}

function renderStructuredRun() {
  renderStructuredSteps(currentStructuredRun);
  renderResultSummary(currentStructuredRun);
}

function normalizeTraceEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => ({
    time: String(entry?.time || ""),
    msg: String(entry?.msg || ""),
    kind: String(entry?.kind || "info"),
  }));
}

function getNextTaskTabName() {
  const base = "New Task";
  let index = 1;
  let name = base;
  const existingNames = new Set(
    currentProjectTabs.map((tab) => String(tab?.name || "")),
  );
  while (existingNames.has(name)) {
    index += 1;
    name = `${base} ${index}`;
  }
  return name;
}

function createDefaultTaskTab(prompt = "", logs = []) {
  return {
    id: createTaskTabId(),
    name: getNextTaskTabName(),
    prompt: String(prompt || ""),
    logs: normalizeTraceEntries(logs),
    latestRun: null,
  };
}

function normalizeProjectTabs(project = {}) {
  const legacyGoal = String(project.goal || "");
  const legacyTrace = normalizeTraceEntries(project.trace);
  let tabs = Array.isArray(project.tabs)
    ? project.tabs.map((tab, idx) => ({
        id: String(tab?.id || createTaskTabId()).trim() || createTaskTabId(),
        name:
          String(tab?.name || `New Task ${idx + 1}`).trim() ||
          `New Task ${idx + 1}`,
        prompt: String(tab?.prompt || ""),
        logs: normalizeTraceEntries(tab?.logs),
        latestRun: normalizeStructuredRun(tab?.latestRun),
      }))
    : [];
  if (!tabs.length) {
    tabs = [
      {
        id: createTaskTabId(),
        name: "New Task",
        prompt: legacyGoal,
        logs: legacyTrace,
        latestRun: null,
      },
    ];
  }
  let activeTabId = String(project.activeTabId || "").trim();
  if (!activeTabId || !tabs.some((tab) => tab.id === activeTabId)) {
    activeTabId = tabs[0].id;
  }
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];
  return {
    ...project,
    tabs,
    activeTabId,
    goal: String(activeTab.prompt || ""),
    trace: normalizeTraceEntries(activeTab.logs),
  };
}

function getActiveTaskTab() {
  return currentProjectTabs.find((tab) => tab.id === currentTabId) || null;
}

function ensureTaskTabs(goalFallback = "", logsFallback = []) {
  if (!currentProjectTabs.length) {
    const fallback = createDefaultTaskTab(goalFallback, logsFallback);
    currentProjectTabs = [fallback];
    currentTabId = fallback.id;
    return;
  }
  if (
    !currentTabId ||
    !currentProjectTabs.some((tab) => tab.id === currentTabId)
  ) {
    currentTabId = currentProjectTabs[0].id;
  }
}

function syncActiveTaskTabFromUi() {
  ensureTaskTabs(goalInput?.value || "", actionTrace);
  const activeTab = getActiveTaskTab();
  if (!activeTab) return;
  activeTab.prompt = String(goalInput?.value || "");
  activeTab.logs = normalizeTraceEntries(actionTrace);
  activeTab.latestRun = normalizeStructuredRun(currentStructuredRun);
}

function renderActionLogEntries(entries = []) {
  while (actionLog?.firstChild) actionLog.removeChild(actionLog.firstChild);
  const safeEntries = normalizeTraceEntries(entries);
  if (!safeEntries.length) {
    if (actionLogEmpty) {
      actionLogEmpty.classList.remove("hidden");
      actionLog.appendChild(actionLogEmpty);
    }
    return;
  }
  safeEntries.forEach((t) => {
    const el = document.createElement("div");
    el.className = "action-log-entry " + (t.kind || "info");
    el.textContent = t.time + " " + t.msg;
    actionLog.appendChild(el);
  });
  actionLogEmpty?.classList.add("hidden");
}

function applyActiveTaskTabToUi() {
  ensureTaskTabs(goalInput?.value || "", actionTrace);
  const activeTab = getActiveTaskTab();
  if (!activeTab) return;
  if (goalInput) goalInput.value = String(activeTab.prompt || "");
  actionTrace = normalizeTraceEntries(activeTab.logs);
  currentStructuredRun = normalizeStructuredRun(activeTab.latestRun);
  renderActionLogEntries(actionTrace);
  renderStructuredRun();
  renderTaskTabs();
}

function renderTaskTabs() {
  if (!taskTabList) return;
  taskTabList.innerHTML = "";
  if (!currentProjectTabs.length) {
    const empty = document.createElement("div");
    empty.className = "task-tab-empty";
    empty.textContent = "No tabs yet";
    taskTabList.appendChild(empty);
    return;
  }
  currentProjectTabs.forEach((tab) => {
    const item = document.createElement("div");
    item.className =
      "task-tab-item" + (tab.id === currentTabId ? " active" : "");
    item.onclick = () => switchTaskTab(tab.id);

    const title = document.createElement("span");
    title.className = "task-tab-item-name";
    title.textContent = tab.name || "New Task";
    title.title = tab.prompt || "";
    item.ondblclick = (e) => {
      e.stopPropagation();
      startTaskTabInlineRename(tab.id, title);
    };

    const actions = document.createElement("div");
    actions.className = "task-tab-item-actions";

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "task-tab-item-menu-btn";
    menuBtn.textContent = "\u22EE";
    menuBtn.title = "Tab options";
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      const isOpen = menu.hidden === false;
      closeTaskTabMenus();
      menu.hidden = isOpen;
      if (!isOpen) item.classList.add("menu-open");
    };

    const menu = document.createElement("div");
    menu.className = "task-tab-item-menu";
    menu.hidden = true;

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "task-tab-item-menu-action";
    renameBtn.textContent = "Rename";
    renameBtn.onclick = (e) => {
      e.stopPropagation();
      menu.hidden = true;
      startTaskTabInlineRename(tab.id, title);
    };

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "task-tab-item-menu-action danger";
    deleteBtn.textContent = "Delete";
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      menu.hidden = true;
      deleteTaskTab(tab.id);
    };

    menu.appendChild(renameBtn);
    menu.appendChild(deleteBtn);
    actions.appendChild(menuBtn);
    actions.appendChild(menu);

    item.appendChild(title);
    item.appendChild(actions);
    taskTabList.appendChild(item);
  });
}

function closeTaskTabMenus() {
  document
    .querySelectorAll(".task-tab-item-menu")
    .forEach((menu) => (menu.hidden = true));
  document
    .querySelectorAll(".task-tab-item.menu-open")
    .forEach((row) => row.classList.remove("menu-open"));
}

async function switchTaskTab(tabId) {
  if (!tabId || currentTabId === tabId) return;
  closeTaskTabMenus();
  syncActiveTaskTabFromUi();
  if (!currentProjectTabs.some((tab) => tab.id === tabId)) return;
  currentTabId = tabId;
  applyActiveTaskTabToUi();
  await persistGoalToProject();
}

async function addTaskTab() {
  syncActiveTaskTabFromUi();
  const tab = createDefaultTaskTab("", []);
  currentProjectTabs.push(tab);
  currentTabId = tab.id;
  applyActiveTaskTabToUi();
  await persistGoalToProject();
}

async function renameTaskTab(tabId, nextName) {
  const tab = currentProjectTabs.find((item) => item.id === tabId);
  if (!tab) return;
  const name = nextName.trim();
  if (!name) return;
  tab.name = name;
  renderTaskTabs();
  await persistGoalToProject();
}

function startTaskTabInlineRename(tabId, titleEl) {
  const tab = currentProjectTabs.find((item) => item.id === tabId);
  if (!tab || !titleEl || titleEl.tagName !== "SPAN") return;
  closeTaskTabMenus();
  const input = document.createElement("input");
  input.type = "text";
  input.className = "task-tab-item-name-input";
  input.value = tab.name || "New Task";
  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const next = input.value?.trim();
    if (!next) {
      renderTaskTabs();
      return;
    }
    await renameTaskTab(tabId, next);
  };
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("dblclick", (e) => e.stopPropagation());
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      renderTaskTabs();
    }
  });
  input.addEventListener("blur", () => {
    commit();
  });
  titleEl.replaceWith(input);
  input.focus();
  input.select();
}

async function deleteTaskTab(tabId) {
  const index = currentProjectTabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return;
  const tabName = currentProjectTabs[index]?.name || "New Task";
  if (!window.confirm(`Delete tab "${tabName}"?`)) return;
  syncActiveTaskTabFromUi();
  currentProjectTabs.splice(index, 1);
  if (!currentProjectTabs.length) {
    const fallback = createDefaultTaskTab("", []);
    currentProjectTabs = [fallback];
    currentTabId = fallback.id;
  } else if (currentTabId === tabId) {
    currentTabId =
      currentProjectTabs[Math.max(0, index - 1)]?.id ||
      currentProjectTabs[0].id;
  }
  applyActiveTaskTabToUi();
  await persistGoalToProject();
}

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
      await refreshExecutorModeState();
    } catch (e) {
      console.warn("[OpenBrowser] init:", e);
    }
  }
  if (!bridgePort) bridgePort = 9333;
  renderExecutorConnectionStatus();
  connectToBridge();
  setupBrowser();
  setupExecutorBridge();
  setupProjects();
  setupWelcome();
  setupSidebarToggle();
  setupViewSwitching();
  setupApiKeyVisibilityToggles();
  await setupSetupScreen();
  setupSettingsMenu();
  setupKeyboardShortcuts();
  refreshProjectList();
  renderStructuredRun();
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
      if (icon) icon.textContent = "<";
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
    if (icon) icon.textContent = collapsed ? "<" : ">";
  });
  const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  const icon = sidebarToggle.querySelector(".sidebar-toggle-icon");
  if (icon) icon.textContent = collapsed ? "<" : ">";
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

function closeProfileActionMenus() {
  document
    .querySelectorAll(".settings-profile-menu")
    .forEach((menu) => (menu.hidden = true));
}

function setProfilesPanelOpen(open) {
  if (!settingsProfilesPanel) return;
  settingsProfilesPanel.hidden = !open;
  settingsProfilesPanel.classList.toggle("open", open);
  if (!open) closeProfileActionMenus();
}

async function refreshProfilesState() {
  try {
    const next = await window.openBrowser?.getProfiles?.();
    if (next?.profiles && next?.activeProfileId) profileState = next;
  } catch (_) {}
  return profileState;
}

async function commitProfileRename(profileId, nextName) {
  const trimmed = String(nextName || "").trim();
  if (!trimmed) return false;
  if (!window.openBrowser?.renameProfile) {
    setSettingsMessage("Profile rename unavailable. Restart app.", "error");
    return false;
  }
  try {
    const next = await window.openBrowser.renameProfile(profileId, trimmed);
    if (next?.profiles && next?.activeProfileId) profileState = next;
    else await refreshProfilesState();
    renderProfilesList();
    setSettingsMessage("Profile renamed", "success");
    return true;
  } catch (_) {
    setSettingsMessage("Failed to rename profile", "error");
    return false;
  }
}

function startInlineProfileRename(profile, item, selectBtn) {
  if (!profile || !item || !selectBtn) return;
  closeProfileActionMenus();
  const input = document.createElement("input");
  input.type = "text";
  input.className = "settings-profile-name-input";
  input.value = profile.name || profile.id;
  let committed = false;
  const finish = async (save) => {
    if (committed) return;
    committed = true;
    if (save) {
      const ok = await commitProfileRename(profile.id, input.value);
      if (!ok) renderProfilesList();
      return;
    }
    renderProfilesList();
  };
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      await finish(false);
    }
  });
  input.addEventListener("blur", () => {
    finish(true);
  });
  selectBtn.replaceWith(input);
  input.focus();
  input.select();
}

function renderProfilesList() {
  if (!settingsProfilesList) return;
  settingsProfilesList.innerHTML = "";
  const list = Array.isArray(profileState?.profiles)
    ? profileState.profiles
    : [];
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "project-list-empty";
    empty.textContent = "No profiles";
    settingsProfilesList.appendChild(empty);
    return;
  }
  list.forEach((profile) => {
    const item = document.createElement("div");
    const isActive = profile.id === profileState.activeProfileId;
    item.className = "settings-profile-item" + (isActive ? " active" : "");

    const select = document.createElement("button");
    select.type = "button";
    select.className = "settings-profile-select";
    select.textContent = profile.name || profile.id;
    select.title = profile.id;
    select.ondblclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      startInlineProfileRename(profile, item, select);
    };
    select.onclick = async () => {
      const next = await window.openBrowser?.setActiveProfile?.(profile.id);
      if (next?.profiles && next?.activeProfileId) profileState = next;
      renderProfilesList();
      setSettingsMessage(
        `Active profile: ${profile.name || profile.id}`,
        "success",
      );
    };
    item.ondblclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      startInlineProfileRename(profile, item, select);
    };

    const active = document.createElement("span");
    active.className = "settings-profile-active";
    active.textContent = isActive ? "Active" : "";

    const actions = document.createElement("div");
    actions.className = "settings-profile-actions";

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "settings-profile-menu-btn";
    menuBtn.textContent = "\u22EE";
    menuBtn.title = "Profile options";

    const menu = document.createElement("div");
    menu.className = "settings-profile-menu";
    menu.hidden = true;

    menuBtn.onclick = (e) => {
      e.stopPropagation();
      const wasOpen = menu.hidden === false;
      closeProfileActionMenus();
      menu.hidden = wasOpen;
    };

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "settings-profile-menu-action";
    renameBtn.textContent = "Rename";
    renameBtn.onclick = async (e) => {
      e.stopPropagation();
      menu.hidden = true;
      startInlineProfileRename(profile, item, select);
    };

    menu.appendChild(renameBtn);

    if (profile.id !== "default") {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "settings-profile-menu-action danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.onclick = async (e) => {
        e.stopPropagation();
        menu.hidden = true;
        if (!window.confirm(`Delete profile "${profile.name || profile.id}"?`))
          return;
        const next = await window.openBrowser?.deleteProfile?.(profile.id);
        if (next?.profiles && next?.activeProfileId) profileState = next;
        renderProfilesList();
      };
      menu.appendChild(deleteBtn);
    }

    actions.appendChild(menuBtn);
    actions.appendChild(menu);
    item.appendChild(select);
    item.appendChild(active);
    item.appendChild(actions);
    settingsProfilesList.appendChild(item);
  });
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

function normalizeExecutorMode(value) {
  return value === "playwright" ? "playwright" : "browserview";
}

function renderExecutorConnectionStatus() {
  if (!statusExtension) return;

  if (currentExecutorMode === "playwright") {
    if (statusConnectionLabel) statusConnectionLabel.textContent = "Playwright";
    statusExtension.textContent = "uses current browser session";
    statusExtension.className = "status-value connected";
    return;
  }

  if (statusConnectionLabel) statusConnectionLabel.textContent = "Extension";
  if (!bridgePort) {
    statusExtension.textContent = "no bridge";
    statusExtension.className = "status-value disconnected";
    return;
  }
  statusExtension.textContent = bridgeConnected ? "ready" : "disconnected";
  statusExtension.className = `status-value ${bridgeConnected ? "connected" : "disconnected"}`;
}

async function refreshExecutorModeState() {
  const mode = await window.openBrowser?.getExecutorMode?.();
  currentExecutorMode = normalizeExecutorMode(mode);
  return currentExecutorMode;
}

async function syncSettingsExecutorModeUi() {
  if (!settingsExecutorModeSelect) return;
  const mode = await refreshExecutorModeState();
  settingsExecutorModeSelect.value = mode;
  renderExecutorConnectionStatus();
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
    if (!opening) {
      setProfilesPanelOpen(false);
      return;
    }
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
    await refreshProfilesState();
    renderProfilesList();
    await syncSettingsExecutorModeUi();
    setProfilesPanelOpen(false);
    setSettingsMessage("");
  });

  document.addEventListener("click", (e) => {
    if (!settingsPanel || settingsPanel.hidden) return;
    if (!settingsMenu?.contains(e.target)) {
      settingsPanel.hidden = true;
      setProfilesPanelOpen(false);
      closeProfileActionMenus();
    }
  });

  btnSettingsProfiles?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const willOpen = settingsProfilesPanel?.hidden !== false;
    if (willOpen) {
      await refreshProfilesState();
      renderProfilesList();
    }
    setProfilesPanelOpen(willOpen);
  });

  btnSettingsProfileNew?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const created = await window.openBrowser?.createProfile?.();
    if (created?.profiles && created?.activeProfileId) profileState = created;
    renderProfilesList();
    const createdId = created?.createdProfileId;
    if (!createdId) return;
    const profile = profileState.profiles?.find((p) => p.id === createdId);
    const nextName = window.prompt(
      "Profile name",
      profile?.name || "New Profile",
    );
    if (nextName === null) return;
    const trimmed = nextName.trim();
    if (!trimmed) return;
    try {
      const renamed = await window.openBrowser?.renameProfile?.(
        createdId,
        trimmed,
      );
      if (renamed?.profiles && renamed?.activeProfileId) profileState = renamed;
      else await refreshProfilesState();
      renderProfilesList();
      setSettingsMessage("Profile renamed", "success");
    } catch (_) {
      setSettingsMessage("Failed to rename profile", "error");
    }
  });

  settingsExecutorModeSelect?.addEventListener("change", async () => {
    const nextMode = normalizeExecutorMode(settingsExecutorModeSelect.value);
    const result = await window.openBrowser?.setExecutorMode?.(nextMode);
    if (!result?.ok) {
      setSettingsMessage(
        result?.error || "Failed to set execution mode",
        "error",
      );
      await syncSettingsExecutorModeUi();
      return;
    }
    currentExecutorMode = normalizeExecutorMode(result.mode);
    settingsExecutorModeSelect.value = currentExecutorMode;
    renderExecutorConnectionStatus();
    setSettingsMessage(
      `Execution mode set to ${currentExecutorMode}`,
      "success",
    );
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

  btnSettingsRemoveKey?.addEventListener("click", async () => {
    try {
      await window.openBrowser?.clearAiConfigAndReset?.();
    } catch (e) {
      setSettingsMessage("Failed to remove API key", "error");
      return;
    }
    if (settingsPanel) settingsPanel.hidden = true;
    setProfilesPanelOpen(false);
    window.location.reload();
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
    bridgeConnected = false;
    renderExecutorConnectionStatus();
    return;
  }
  const ws = new WebSocket(`ws://127.0.0.1:${bridgePort}`);
  extensionSocket = ws;

  ws.onopen = () => {
    bridgeConnected = true;
    renderExecutorConnectionStatus();
    ws.send(JSON.stringify({ type: "identify", role: "renderer" }));
    ws.send(JSON.stringify({ type: "ping" }));
  };

  ws.onclose = () => {
    bridgeConnected = false;
    renderExecutorConnectionStatus();
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

function requestApprovalFromUser(action) {
  if (!approvalSection || !btnApprove || !btnReject)
    return Promise.resolve(false);
  approvalSection.hidden = false;
  if (approvalMessage) {
    approvalMessage.textContent = `Approve: ${action?.type || "action"} on "${action?.selector || action?.url || "element"}"?`;
  }
  return new Promise((resolve) => {
    btnApprove.onclick = () => {
      approvalSection.hidden = true;
      btnApprove.onclick = null;
      btnReject.onclick = null;
      resolve(true);
    };
    btnReject.onclick = () => {
      approvalSection.hidden = true;
      btnApprove.onclick = null;
      btnReject.onclick = null;
      resolve(false);
    };
  });
}

function logExecutorTrace(entry) {
  if (!entry || typeof entry !== "object") return;
  if (entry?.action?.id && !entry.result) {
    markActionStepRunning(String(entry.action.id));
  }
  const result = entry.result;
  if (result && typeof result === "object") {
    const success = Boolean(result.success);
    markActionStepResult(
      String(result.actionId || entry?.action?.id || ""),
      success,
      String(result.error || ""),
    );
    logAction(
      {
        actionId: result.actionId || entry?.action?.id,
        success,
        error: result.error,
      },
      success ? "success" : "error",
    );
    return;
  }
  if (entry.message) {
    const kind =
      entry.state === "failed" || entry.state === "recovering"
        ? "error"
        : "info";
    logAction({ message: String(entry.message) }, kind);
  }
}

function setupExecutorBridge() {
  if (executorBridgeBound || !window.openBrowser) return;

  window.openBrowser.onExecutorState?.((state) => {
    setState(state);
    if (state === "completed" || state === "failed") {
      applyTerminalStateToRun(state);
    }
    if (state === "completed" || state === "failed") {
      persistGoalToProject();
    }
  });

  window.openBrowser.onExecutorTrace?.((entry) => {
    logExecutorTrace(entry);
  });

  window.openBrowser.onExecutorApprovalRequired?.(async (payload) => {
    const requestId = String(payload?.requestId || "");
    const action = payload?.action || {};
    pendingApprovalRequestId = requestId || null;
    const approved = await requestApprovalFromUser(action);
    const activeRequestId = pendingApprovalRequestId;
    pendingApprovalRequestId = null;
    if (activeRequestId && window.openBrowser?.respondToExecutorApproval) {
      await window.openBrowser.respondToExecutorApproval(
        activeRequestId,
        approved,
      );
    }
    if (!approved) {
      logAction({ actionId: action?.id, error: "Rejected by user" }, "error");
      markActionStepResult(String(action?.id || ""), false, "Rejected by user");
    }
  });

  executorBridgeBound = true;
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
  plan = ensurePlanStepActionIds(plan);
  currentPlan = plan;
  currentStructuredRun = buildStructuredRun(goal, plan, apiKeyOverride);
  renderStructuredRun();
  await persistGoalToProject();

  try {
    if (!window.openBrowser?.runExecutionPlan) {
      throw new Error("Executor runtime is unavailable");
    }
    let selectedMode = currentExecutorMode;
    try {
      selectedMode = await refreshExecutorModeState();
      renderExecutorConnectionStatus();
    } catch (_) {}
    logAction({ message: `Executor mode: ${selectedMode}` }, "info");

    const runResult = await window.openBrowser.runExecutionPlan(
      goal,
      plan,
      selectedMode,
    );
    if (!runResult?.ok) {
      updateCurrentRun((run) => {
        run.result = {
          status: "failed",
          message: String(runResult?.error || "Execution failed"),
        };
        return run;
      });
      logAction({ error: runResult?.error || "Execution failed" }, "error");
      setState("failed");
    }
    await persistGoalToProject();
  } catch (err) {
    updateCurrentRun((run) => {
      run.result = {
        status: "failed",
        message: "Run failed: " + String(err?.message || err),
      };
      return run;
    });
    logAction({ error: "Run failed: " + (err?.message || err) }, "error");
    setState("failed");
    await persistGoalToProject();
  }
});

function setupProjects() {
  btnSaveProject?.addEventListener("click", saveProject);
  btnNewTaskTab?.addEventListener("click", addTaskTab);
  document.addEventListener("click", () => {
    closeTaskTabMenus();
  });
  btnNewProject?.addEventListener("click", () => {
    currentProjectId = null;
    if (goalInput) goalInput.value = "";
    if (projectNameInput) projectNameInput.value = "";
    actionTrace = [];
    currentPlan = [];
    currentStructuredRun = null;
    currentProjectTabs = [];
    currentTabId = null;
    ensureTaskTabs("", []);
    renderTaskTabs();
    setState("idle");
    renderActionLogEntries([]);
    renderStructuredRun();
  });
}

/** Persist current goal/plan/trace into the current project (no toast). */
async function persistGoalToProject() {
  if (!currentProjectId) return;
  const goal = goalInput?.value?.trim() ?? "";
  syncActiveTaskTabFromUi();
  ensureTaskTabs(goal, actionTrace);
  const activeTab = getActiveTaskTab() || currentProjectTabs[0];
  if (activeTab) {
    activeTab.prompt = goal;
    activeTab.logs = normalizeTraceEntries(actionTrace);
  }
  const name =
    projectNameInput?.value?.trim() || goal?.slice(0, 50) || "Untitled";
  const provider = aiProviderSelect?.value || "heuristic";
  try {
    await window.openBrowser?.projectsSave?.({
      id: currentProjectId,
      name: name || "Untitled",
      goal: String(activeTab?.prompt || goal || ""),
      plan: currentPlan || [],
      trace: normalizeTraceEntries(activeTab?.logs || actionTrace),
      tabs: currentProjectTabs,
      activeTabId: activeTab?.id || currentTabId,
      aiProvider: provider,
    });
  } catch (_) {}
}

async function saveProject() {
  const goal = goalInput?.value?.trim() ?? "";
  syncActiveTaskTabFromUi();
  ensureTaskTabs(goal, actionTrace);
  const activeTab = getActiveTaskTab() || currentProjectTabs[0];
  const activeGoal = String(activeTab?.prompt || goal || "");
  const activeLogs = normalizeTraceEntries(activeTab?.logs || actionTrace);
  const name = projectNameInput?.value?.trim() || activeGoal || "Untitled";
  if (!name && !activeGoal) return;
  const provider = aiProviderSelect?.value || "heuristic";
  const isOnProjectsView = viewProjectDetail?.hidden === true;
  try {
    const project = await window.openBrowser?.projectsSave?.({
      id: currentProjectId || undefined,
      name: name || activeGoal?.slice(0, 50) || "Untitled",
      goal: activeGoal || name || "",
      plan: currentPlan || [],
      trace: activeLogs,
      tabs: currentProjectTabs,
      activeTabId: activeTab?.id || currentTabId,
      aiProvider: provider,
    });
    if (project) {
      const normalized = normalizeProjectTabs(project);
      currentProjectId = project.id;
      if (projectNameInput) projectNameInput.value = normalized.name;
      if (projectDetailName) projectDetailName.textContent = normalized.name;
      currentProjectTabs = normalized.tabs || [];
      currentTabId =
        normalized.activeTabId || currentProjectTabs[0]?.id || null;
      currentPlan = normalized.plan || [];
      await refreshProjectList();
      if (isOnProjectsView) {
        applyActiveTaskTabToUi();
        showProjectDetailView();
      } else {
        logAction({ message: `Saved: ${normalized.name}` }, "success");
        syncActiveTaskTabFromUi();
        renderTaskTabs();
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
  const normalized = normalizeProjectTabs(p);
  currentProjectId = normalized.id;
  if (projectNameInput) projectNameInput.value = normalized.name || "";
  currentProjectTabs = normalized.tabs || [];
  currentTabId = normalized.activeTabId || currentProjectTabs[0]?.id || null;
  currentPlan = normalized.plan || [];
  applyActiveTaskTabToUi();
  setState("idle");
  if (projectDetailName)
    projectDetailName.textContent = normalized.name || "Project";
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
  if (currentStructuredRun) {
    currentStructuredRun.logs = normalizeTraceEntries(actionTrace);
  }
  const el = document.createElement("div");
  el.className = "action-log-entry " + kind;
  el.textContent = time + " " + msg;
  actionLog.appendChild(el);
  actionLog.scrollTop = actionLog.scrollHeight;
  syncActiveTaskTabFromUi();
}

init();
