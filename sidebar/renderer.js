/**
 * OpenBrowser - Sidebar Renderer
 * Handles UI, connects to bridge, displays status and action log
 */

const aiProviderSelect = document.getElementById("ai-provider-select");
const apiKeyInput = document.getElementById("api-key-input");
const apiKeyLabel = document.getElementById("api-key-label");
const goalInput = document.getElementById("goal-input");
const btnExecute = document.getElementById("btn-execute");
const btnRerun = document.getElementById("btn-rerun");
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

let bridgePort = 0;
let extensionSocket = null;
let pendingApproval = null;
let currentProjectId = null;
let currentPlan = [];
let actionTrace = [];

async function init() {
  if (window.openBrowser) {
    bridgePort = await window.openBrowser.getBridgePort();
    console.log("[OpenBrowser] Bridge port:", bridgePort);
    const cfg = await window.openBrowser.getAiConfig?.();
    if (cfg) setupAiProviderSelect(cfg);
  }
  if (!bridgePort) bridgePort = 9333;
  connectToBridge();
  setupBrowser();
  setupProjects();
  refreshProjectList();
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
  aiProviderSelect.addEventListener("change", () => {
    const p = aiProviderSelect.value;
    apiKeyLabel.hidden = p !== "gemini";
    apiKeyInput.hidden = p !== "gemini";
  });
  const p = cfg.provider;
  apiKeyLabel.hidden = p !== "gemini";
  apiKeyInput.hidden = p !== "gemini";
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
  if (!url.startsWith("http")) url = "https://www.google.com/search?q=" + encodeURIComponent(url);
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
      plan = await window.openBrowser.plan(goal, provider, apiKeyOverride || undefined);
      if (plan?.length) logAction({ message: `Plan from ${provider}` }, "success");
    } catch (e) {
      logAction({ error: `${provider} failed: ` + (e?.message || e) }, "error");
    }
  }
  if (!plan?.length) {
    plan = planFromGoal(goal);
    logAction({ message: "Plan from heuristics" }, "info");
  }
  currentPlan = plan;
  btnRerun.disabled = false;
  setState("executing");

  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    if (i > 0 && plan[i - 1].action.type === "navigate") {
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (step.requiresApproval) {
      setState("waiting_approval");
      pendingApproval = step;
      approvalSection.hidden = false;
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
          logAction({ actionId: step.action.id, error: "Rejected by user" }, "error");
          resolve(false);
        };
      });
      if (!approved) continue;
    }

    if (step.action.type === "navigate") {
      navigateBrowser(step.action.url);
      logAction({ actionId: step.action.id, success: true }, "success");
    } else if (window.openBrowser?.executeActionInBrowser) {
      const result = await window.openBrowser.executeActionInBrowser(step.action);
      logAction({ actionId: step.action.id, success: result?.success, error: result?.error }, result?.success ? "success" : "error");
    } else if (extensionSocket && extensionSocket.readyState === WebSocket.OPEN) {
      extensionSocket.send(JSON.stringify({ type: "action", payload: step.action }));
    } else {
      logAction({ actionId: step.action.id, error: "Cannot execute action" }, "error");
    }
  }

  setState("completed");
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
      const result = await window.openBrowser.executeActionInBrowser(step.action);
      logAction({ actionId: step.action.id, success: result?.success, error: result?.error }, result?.success ? "success" : "error");
    }
  }
  setState("completed");
}

btnRerun?.addEventListener("click", async () => {
  if (!currentPlan?.length) return;
  actionTrace = [];
  actionLog.innerHTML = "";
  logAction({ message: `Re-running: ${goalInput.value?.slice(0, 50) || "project"}` }, "info");
  await runPlan(currentPlan);
});

function setupProjects() {
  btnSaveProject?.addEventListener("click", saveProject);
  btnNewProject?.addEventListener("click", () => {
    currentProjectId = null;
    btnRerun.disabled = true;
    goalInput.value = "";
    projectNameInput.value = "";
    actionLog.innerHTML = "";
    actionTrace = [];
    currentPlan = [];
    setState("idle");
  });
}

async function saveProject() {
  const goal = goalInput.value.trim();
  const name = projectNameInput?.value?.trim() || goal || "Untitled";
  if (!name && !goal) return;
  const provider = aiProviderSelect?.value || "heuristic";
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
      projectNameInput.value = project.name;
      await refreshProjectList();
      logAction({ message: `Saved: ${project.name}` }, "success");
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
  btnRerun.disabled = !(p.plan?.length);
  goalInput.value = p.goal;
  projectNameInput.value = p.name;
  actionTrace = p.trace || [];
  currentPlan = p.plan || [];
  actionLog.innerHTML = "";
  p.trace?.forEach((t) => {
    const el = document.createElement("div");
    el.className = "action-log-entry " + (t.kind || "info");
    el.textContent = t.time + " " + t.msg;
    actionLog.appendChild(el);
  });
  setState("idle");
}

async function refreshProjectList() {
  if (!projectList) return;
  let list;
  try {
    list = await window.openBrowser?.projectsList?.();
  } catch (e) {
    projectList.innerHTML = "<div class='project-list-empty'>Error loading projects</div>";
    return;
  }
  if (!list?.length) {
    projectList.innerHTML = "<div class='project-list-empty'>No saved projects. Enter name above and click Save.</div>";
    return;
  }
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
      window.openBrowser?.projectsDelete?.(p.id).then(() => refreshProjectList());
    };
    item.appendChild(title);
    item.appendChild(del);
    projectList.appendChild(item);
  });
}

function planFromGoal(goal) {
  const id = () => "a-" + Math.random().toString(36).slice(2, 10);
  const lower = goal.toLowerCase();

  // Heuristic: if it looks like a search, generate search plan
  if (lower.includes("search") || lower.includes("google") || !lower.includes("http")) {
    const query = goal.replace(/^(search for|google|find)\s+/i, "").replace(/"|'/g, "").trim();
    return [
      {
        action: {
          id: id(),
          type: "navigate",
          url: "https://www.google.com",
        },
        requiresApproval: false,
      },
      {
        action: {
          id: id(),
          type: "type",
          selector: "textarea[name=q], input[name=q]",
          text: query,
          submit: true,
        },
        requiresApproval: false,
      },
    ];
  }

  // Default: navigate to URL if it looks like one
  const urlMatch = goal.match(/https?:\/\/\S+/);
  if (urlMatch) {
    return [
      {
        action: {
          id: id(),
          type: "navigate",
          url: urlMatch[0],
        },
        requiresApproval: false,
      },
    ];
  }

  return [
    {
      action: {
        id: id(),
        type: "navigate",
        url: "https://www.google.com/search?q=" + encodeURIComponent(goal),
      },
      requiresApproval: false,
    },
  ];
}

function setState(state) {
  statusState.textContent = state;
}

function logAction(result, kind = "info") {
  const msg = result.message || result.error || `${result.action?.type || "?"} ${result.success !== undefined ? (result.success ? "ok" : "failed") : ""}`;
  const time = new Date().toLocaleTimeString();
  actionTrace.push({ time, msg, kind });
  const el = document.createElement("div");
  el.className = "action-log-entry " + kind;
  el.textContent = time + " " + msg;
  actionLog.appendChild(el);
  actionLog.scrollTop = actionLog.scrollHeight;
}

init();
