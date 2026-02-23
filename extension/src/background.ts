/**
 * OpenBrowser Extension - Background Script
 * Connects to Electron bridge via WebSocket, routes actions to content script
 */

const BRIDGE_URL = "ws://127.0.0.1:9333";

let socket: WebSocket | null = null;
let reconnectTimer: number;

function connect() {
  if (socket?.readyState === WebSocket.OPEN) return;
  try {
    socket = new WebSocket(BRIDGE_URL);
  } catch (e) {
    console.warn("[OpenBrowser] Bridge connect failed:", e);
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    console.log("[OpenBrowser] Connected to bridge");
    socket?.send(JSON.stringify({ type: "identify", role: "extension" }));
  };

  socket.onmessage = async (ev: MessageEvent) => {
    try {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === "action") {
        await handleAction(msg.payload);
      } else if (msg.type === "perceive") {
        await requestPerception();
      } else if (msg.type === "ping") {
        socket?.send(JSON.stringify({ type: "pong" }));
      }
    } catch (e) {
      console.error("[OpenBrowser] Message error:", e);
    }
  };

  socket.onclose = () => {
    socket = null;
    scheduleReconnect();
  };

  socket.onerror = () => {
    socket?.close();
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 2000) as unknown as number;
}

async function getTargetTab() {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    const tabs = await chrome.tabs.query({});
    tab = tabs.find((t) => t.id && t.url?.startsWith("http")) ?? tabs[0];
  }
  return tab;
}

async function handleAction(action: Record<string, unknown>) {
  const tab = await getTargetTab();
  if (!tab?.id) {
    sendResult(action.id as string, false, "No tab found (Extension may not see BrowserView)");
    return;
  }

  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: "execute", action });
    sendResult(action.id as string, result?.success ?? true, result?.error, result?.perception);
  } catch (e) {
    sendResult(action.id as string, false, String(e));
  }
}

async function requestPerception() {
  const tab = await getTargetTab();
  if (!tab?.id) return;
  try {
    const perception = await chrome.tabs.sendMessage(tab.id, { type: "perceive" });
    socket?.send(JSON.stringify({ type: "perception", payload: perception }));
  } catch (e) {
    console.warn("[OpenBrowser] Perception failed:", e);
  }
}

function sendResult(
  actionId: string,
  success: boolean,
  error?: string,
  perception?: unknown
) {
  socket?.send(
    JSON.stringify({
      type: "action_result",
      payload: { actionId, success, error, perception },
    })
  );
}

connect();
