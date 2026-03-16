/**
 * OpenBrowser - Sidebar Renderer
 * Handles onboarding/settings and project/task management UI
 */

const urlBar = document.getElementById("url-bar");
const btnGo = document.getElementById("btn-go");

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
const btnNewProject = document.getElementById("btn-new-project");
const projectList = document.getElementById("project-list");
const projectDetailName = document.getElementById("project-detail-name");
const projectNameEdit = document.getElementById("project-name-edit");
const btnNewTask = document.getElementById("btn-new-task");
const taskList = document.getElementById("task-list");
const taskPromptInput = document.getElementById("task-prompt-input");
const btnAddTaskPrompt = document.getElementById("btn-add-task-prompt");
const promptHistory = document.getElementById("prompt-history");
const promptHistoryEmpty = document.getElementById("prompt-history-empty");

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
const btnSettingsRemoveKey = document.getElementById("btn-settings-remove-key");
const settingsMessage = document.getElementById("settings-message");

const SIDEBAR_COLLAPSED_KEY = "openbrowser-sidebar-collapsed";
const SIDEBAR_WIDTH_EXPANDED = 320;
const SIDEBAR_WIDTH_COLLAPSED = 52;
const DEFAULT_TASK_TITLE = "New Task";

let currentAiModel = "gemini-2.5-flash";
let currentProject = null;
let currentProjectId = null;
let currentTaskId = null;
let projectSummaries = [];
let editingTaskId = null;

function showProjectsView() {
  if (viewProjects) viewProjects.hidden = false;
  if (viewProjectDetail) viewProjectDetail.hidden = true;
}

function showProjectDetailView() {
  if (viewProjects) viewProjects.hidden = true;
  if (viewProjectDetail) viewProjectDetail.hidden = false;
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

function applyAiConfigToUi(config) {
  if (!config) return;
  currentAiModel = config.model || currentAiModel;
  const provider = config.aiProvider || "gemini";
  const geminiKey = config.geminiApiKey || "";
  if (setupPlannerSelect) setupPlannerSelect.value = provider;
  if (setupApiKeyInput) setupApiKeyInput.value = geminiKey;
  if (settingsProviderSelect) settingsProviderSelect.value = provider;
  if (settingsApiKeyInput) settingsApiKeyInput.value = geminiKey;
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

async function showMainInterface() {
  try {
    await window.openBrowser?.startMainInterface?.();
  } catch (e) {
    console.warn("[OpenBrowser] startMainInterface:", e);
  }
  if (setupScreen) setupScreen.hidden = true;
  if (appShell) appShell.hidden = false;
  showProjectsView();
  await refreshProjectList();
}

function setupSettingsMenu() {
  btnSettings?.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!settingsPanel) return;
    const opening = settingsPanel.hidden;
    settingsPanel.hidden = !settingsPanel.hidden;
    if (!opening) return;

    const cfg = await window.openBrowser?.getAiConfig?.();
    if (cfg) applyAiConfigToUi(cfg);
    if (settingsApiKeyField) settingsApiKeyField.style.display = "";
    setApiKeyInputVisibility(
      settingsApiKeyInput,
      btnSettingsApiKeyVisibility,
      false,
    );
    await populateSettingsModels(
      settingsApiKeyInput?.value?.trim() || "",
      cfg?.model || currentAiModel,
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
    if (cfg) applyAiConfigToUi(cfg);
    setSettingsMessage("Saved", "success");
  });

  btnSettingsRemoveKey?.addEventListener("click", async () => {
    try {
      await window.openBrowser?.clearAiConfigAndReset?.();
    } catch (_) {
      setSettingsMessage("Failed to remove API key", "error");
      return;
    }
    if (settingsPanel) settingsPanel.hidden = true;
    window.location.reload();
  });
}

async function setupSetupScreen() {
  if (appShell) appShell.hidden = true;
  const refreshSetupApiKeyInput = () => {
    const visible = setupPlannerSelect?.value === "gemini";
    if (setupApiKeyField)
      setupApiKeyField.style.display = visible ? "" : "none";
  };
  refreshSetupApiKeyInput();
  setupPlannerSelect?.addEventListener("change", refreshSetupApiKeyInput);
  setSetupError("");

  const saved = await window.openBrowser?.getSavedAiConfig?.();
  if (saved?.hasConfig && saved?.config) {
    applyAiConfigToUi(saved.config);
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
    applyAiConfigToUi(result.config);
    await showMainInterface();
  });
}

function setupSidebarToggle() {
  if (!sidebar || !sidebarToggle) return;
  sidebarToggle.addEventListener("click", () => {
    const collapsed = sidebar.classList.toggle("collapsed");
    const width = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
    try {
      window.openBrowser?.setSidebarWidth?.(width);
    } catch (_) {}
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    sidebarToggle.setAttribute(
      "aria-label",
      collapsed ? "Expand sidebar" : "Collapse sidebar",
    );
    sidebarToggle.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    const icon = sidebarToggle.querySelector(".sidebar-toggle-icon");
    if (icon) icon.textContent = collapsed ? "\u25B6" : "\u25C0";
  });

  const collapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  if (collapsed) {
    sidebar.classList.add("collapsed");
    try {
      window.openBrowser?.setSidebarWidth?.(SIDEBAR_WIDTH_COLLAPSED);
    } catch (_) {}
  }
  const icon = sidebarToggle.querySelector(".sidebar-toggle-icon");
  if (icon) icon.textContent = collapsed ? "\u25B6" : "\u25C0";
}

function setupBrowser() {
  window.openBrowser?.browserGetUrl?.().then((url) => {
    if (urlBar && url) urlBar.value = url;
  });
  window.openBrowser?.onBrowserUrlChanged?.((url) => {
    if (urlBar) urlBar.value = url || urlBar.placeholder;
  });
}

function navigateBrowser(url) {
  if (window.openBrowser?.browserNavigate) {
    window.openBrowser.browserNavigate(url);
  }
}

function closeAllMenus(except = null) {
  document.querySelectorAll(".item-menu").forEach((menu) => {
    if (menu !== except) menu.hidden = true;
  });
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "";
  }
}

function currentTask() {
  if (!currentProject || !currentTaskId) return null;
  return currentProject.tasks.find((task) => task.id === currentTaskId) || null;
}

function renderPromptHistory() {
  if (!promptHistory) return;
  while (promptHistory.firstChild) {
    promptHistory.removeChild(promptHistory.firstChild);
  }
  const task = currentTask();
  const entries = task?.promptHistory || [];
  if (!entries.length) {
    if (promptHistoryEmpty) {
      promptHistoryEmpty.classList.remove("hidden");
      promptHistory.appendChild(promptHistoryEmpty);
    }
    return;
  }
  if (promptHistoryEmpty) promptHistoryEmpty.classList.add("hidden");
  entries.forEach((entry) => {
    const el = document.createElement("div");
    el.className = "action-log-entry";
    el.textContent = `${formatTime(entry.createdAt)} ${entry.prompt}`;
    promptHistory.appendChild(el);
  });
}

async function refreshProjectList() {
  try {
    projectSummaries = (await window.openBrowser?.projectsList?.()) || [];
  } catch (_) {
    projectSummaries = [];
  }
  renderProjectList();

  if (
    currentProjectId &&
    !projectSummaries.some((project) => project.id === currentProjectId)
  ) {
    currentProject = null;
    currentProjectId = null;
    currentTaskId = null;
    showProjectsView();
  }
}

function renderProjectList() {
  if (!projectList) return;
  projectList.innerHTML = "";

  if (!projectSummaries.length) {
    const empty = document.createElement("div");
    empty.className = "project-list-empty";
    empty.textContent = "No projects yet. Create one to get started.";
    projectList.appendChild(empty);
    return;
  }

  projectSummaries.forEach((project) => {
    const item = document.createElement("div");
    item.className =
      "project-list-item" +
      (project.id === currentProjectId ? " is-selected" : "");

    const titleBtn = document.createElement("button");
    titleBtn.type = "button";
    titleBtn.className = "project-list-item-title-btn";
    titleBtn.title = project.name || "Untitled Project";
    const title = document.createElement("span");
    title.className = "project-list-item-title";
    title.textContent = project.name || "Untitled Project";
    titleBtn.appendChild(title);
    titleBtn.addEventListener("click", () => {
      closeAllMenus();
      openProject(project.id);
    });

    const menuWrap = document.createElement("div");
    menuWrap.className = "item-menu-wrap";
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "item-menu-btn";
    menuBtn.textContent = "...";

    const menu = document.createElement("div");
    menu.className = "item-menu";
    menu.hidden = true;

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "item-menu-item";
    renameBtn.textContent = "Rename";
    renameBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      closeAllMenus();
      await openProject(project.id);
      startProjectRename();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "item-menu-item danger";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      closeAllMenus();
      await window.openBrowser?.projectDelete?.(project.id);
      if (currentProjectId === project.id) {
        currentProject = null;
        currentProjectId = null;
        currentTaskId = null;
        showProjectsView();
      }
      await refreshProjectList();
    });

    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      closeAllMenus(menu);
      menu.hidden = !open;
    });

    menu.appendChild(renameBtn);
    menu.appendChild(deleteBtn);
    menuWrap.appendChild(menuBtn);
    menuWrap.appendChild(menu);

    item.appendChild(titleBtn);
    item.appendChild(menuWrap);
    projectList.appendChild(item);
  });
}

function renderTaskList() {
  if (!taskList) return;
  taskList.innerHTML = "";
  const tasks = currentProject?.tasks || [];

  if (!tasks.length) {
    const empty = document.createElement("div");
    empty.className = "project-list-empty";
    empty.textContent = "No tasks yet. Create a new task.";
    taskList.appendChild(empty);
    return;
  }

  tasks.forEach((task) => {
    const item = document.createElement("div");
    item.className =
      "project-list-item" + (task.id === currentTaskId ? " is-selected" : "");

    if (editingTaskId === task.id) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "project-name-input project-name-inline";
      input.value = task.title || DEFAULT_TASK_TITLE;

      let handled = false;
      const complete = async (save) => {
        if (handled) return;
        handled = true;
        editingTaskId = null;
        if (save) {
          const nextTitle = input.value.trim();
          if (nextTitle) {
            const updated = await window.openBrowser?.taskRename?.(
              currentProjectId,
              task.id,
              nextTitle,
            );
            if (updated) currentProject = updated;
            await refreshProjectList();
          }
        }
        renderProjectDetail();
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          complete(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          complete(false);
        }
      });
      input.addEventListener("blur", () => complete(true));
      item.appendChild(input);

      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    } else {
      const titleBtn = document.createElement("button");
      titleBtn.type = "button";
      titleBtn.className = "project-list-item-title-btn";
      const title = document.createElement("span");
      title.className = "project-list-item-title";
      title.textContent = task.title || DEFAULT_TASK_TITLE;
      titleBtn.appendChild(title);
      titleBtn.addEventListener("click", () => {
        closeAllMenus();
        currentTaskId = task.id;
        renderProjectDetail();
      });
      item.appendChild(titleBtn);
    }

    const menuWrap = document.createElement("div");
    menuWrap.className = "item-menu-wrap";
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "item-menu-btn";
    menuBtn.textContent = "...";

    const menu = document.createElement("div");
    menu.className = "item-menu";
    menu.hidden = true;

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "item-menu-item";
    renameBtn.textContent = "Rename";
    renameBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeAllMenus();
      editingTaskId = task.id;
      renderTaskList();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "item-menu-item danger";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      closeAllMenus();
      const updated = await window.openBrowser?.taskDelete?.(
        currentProjectId,
        task.id,
      );
      if (updated) {
        currentProject = updated;
        const exists = updated.tasks.some((t) => t.id === currentTaskId);
        currentTaskId = exists ? currentTaskId : updated.tasks[0]?.id || null;
      }
      await refreshProjectList();
      renderProjectDetail();
    });

    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      closeAllMenus(menu);
      menu.hidden = !open;
    });

    menu.appendChild(renameBtn);
    menu.appendChild(deleteBtn);
    menuWrap.appendChild(menuBtn);
    menuWrap.appendChild(menu);
    item.appendChild(menuWrap);
    taskList.appendChild(item);
  });
}

function renderProjectDetail() {
  if (!currentProject) return;
  if (projectDetailName) {
    projectDetailName.hidden = false;
    projectDetailName.textContent = currentProject.name || "Project";
  }
  if (projectNameEdit) projectNameEdit.hidden = true;

  const hasSelectedTask = currentProject.tasks.some(
    (task) => task.id === currentTaskId,
  );
  if (!hasSelectedTask) currentTaskId = currentProject.tasks[0]?.id || null;

  renderTaskList();
  renderPromptHistory();

  const canAddPrompt = Boolean(currentTaskId);
  if (taskPromptInput) {
    taskPromptInput.disabled = !canAddPrompt;
    taskPromptInput.placeholder = canAddPrompt
      ? "What do you want to automate?"
      : "Create a task first";
  }
  if (btnAddTaskPrompt) btnAddTaskPrompt.disabled = !canAddPrompt;
}

async function openProject(projectId, preferredTaskId) {
  const project = await window.openBrowser?.projectLoad?.(projectId);
  if (!project) {
    await refreshProjectList();
    return;
  }
  currentProject = project;
  currentProjectId = project.id;
  const preferredExists = project.tasks.some(
    (task) => task.id === preferredTaskId,
  );
  if (preferredExists) currentTaskId = preferredTaskId;
  else if (!project.tasks.some((task) => task.id === currentTaskId)) {
    currentTaskId = project.tasks[0]?.id || null;
  }
  editingTaskId = null;
  renderProjectDetail();
  renderProjectList();
  showProjectDetailView();
}

function startProjectRename() {
  if (!currentProject || !projectNameEdit || !projectDetailName) return;

  projectDetailName.hidden = true;
  projectNameEdit.hidden = false;
  projectNameEdit.value = currentProject.name || "Project";
  projectNameEdit.focus();
  projectNameEdit.select();

  let handled = false;
  const complete = async (save) => {
    if (handled) return;
    handled = true;
    projectNameEdit.removeEventListener("keydown", onKeyDown);
    projectNameEdit.removeEventListener("blur", onBlur);

    if (save) {
      const nextName = projectNameEdit.value.trim();
      if (nextName) {
        const updated = await window.openBrowser?.projectRename?.(
          currentProject.id,
          nextName,
        );
        if (updated) {
          currentProject = updated;
          currentProjectId = updated.id;
        }
      }
    }

    projectNameEdit.hidden = true;
    projectDetailName.hidden = false;
    renderProjectDetail();
    await refreshProjectList();
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      complete(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      complete(false);
    }
  };
  const onBlur = () => complete(true);

  projectNameEdit.addEventListener("keydown", onKeyDown);
  projectNameEdit.addEventListener("blur", onBlur);
}

async function createProjectAndOpen() {
  const project = await window.openBrowser?.projectCreate?.("New Project");
  if (!project) return;
  currentProject = project;
  currentProjectId = project.id;
  currentTaskId = project.tasks[0]?.id || null;
  editingTaskId = null;
  renderProjectDetail();
  showProjectDetailView();
  await refreshProjectList();
  startProjectRename();
}

async function createTaskForCurrentProject() {
  if (!currentProjectId) return;
  const updated = await window.openBrowser?.taskCreate?.(currentProjectId);
  if (!updated) return;
  currentProject = updated;
  currentTaskId = updated.tasks[updated.tasks.length - 1]?.id || null;
  editingTaskId = null;
  renderProjectDetail();
  await refreshProjectList();
}

async function addPromptToCurrentTask() {
  if (!currentProjectId || !currentTaskId || !taskPromptInput) return;
  const prompt = taskPromptInput.value.trim();
  if (!prompt) return;

  const updated = await window.openBrowser?.taskAddPrompt?.(
    currentProjectId,
    currentTaskId,
    prompt,
  );
  if (!updated) return;

  currentProject = updated;
  taskPromptInput.value = "";
  renderProjectDetail();
  await refreshProjectList();
}

function setupProjectEvents() {
  btnBackToProjects?.addEventListener("click", () => {
    showProjectsView();
  });

  btnNewProject?.addEventListener("click", () => {
    createProjectAndOpen();
  });

  btnNewTask?.addEventListener("click", () => {
    createTaskForCurrentProject();
  });

  btnAddTaskPrompt?.addEventListener("click", () => {
    addPromptToCurrentTask();
  });

  taskPromptInput?.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      addPromptToCurrentTask();
    }
  });
}

async function init() {
  try {
    const cfg = await window.openBrowser?.getAiConfig?.();
    if (cfg) applyAiConfigToUi(cfg);
  } catch (_) {}

  setupBrowser();
  setupSidebarToggle();
  setupApiKeyVisibilityToggles();
  setupProjectEvents();
  setupSettingsMenu();

  document.addEventListener("click", () => closeAllMenus());

  btnGo?.addEventListener("click", () => {
    let url = urlBar?.value?.trim() || "";
    if (!url) return;
    if (!url.startsWith("http")) {
      url = "https://www.google.com/search?q=" + encodeURIComponent(url);
    }
    navigateBrowser(url);
  });

  await setupSetupScreen();
}

init();
