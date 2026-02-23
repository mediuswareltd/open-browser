/**
 * WebSocket bridge server: Electron/Runtime <-> Extension
 * Extension connects here to receive actions and send back results
 */

import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { BrowserAction, ActionResult } from "../shared/schemas";

const DEFAULT_PORT = 9333;

export interface BridgeCallbacks {
  onActionResult?: (result: ActionResult) => void;
}

export function createServer(callbacks: BridgeCallbacks = {}) {
  let wss: WebSocketServer | null = null;
  let port = DEFAULT_PORT;
  let extensionClient: WebSocket | null = null;
  let rendererClients: Set<WebSocket> = new Set();

  return {
    get port() {
      return port;
    },

    async start() {
      return new Promise<void>((resolve, reject) => {
        wss = new WebSocketServer({ port: DEFAULT_PORT }, () => {
          const addr = wss!.address();
          port = typeof addr === "object" && addr ? addr.port : DEFAULT_PORT;
          console.log("[OpenBrowser Bridge] WebSocket server on port", port);
          resolve();
        });

        wss.on("connection", (ws: WebSocket) => {
          ws.on("message", (data: Buffer) => {
            try {
              const msg = JSON.parse(data.toString());

              if (msg.type === "identify" && msg.role === "extension") {
                extensionClient = ws;
                console.log("[OpenBrowser Bridge] Extension registered");
                ws.on("close", () => {
                  extensionClient = null;
                  console.log("[OpenBrowser Bridge] Extension disconnected");
                });
                return;
              }

              if (msg.type === "identify" && msg.role === "renderer") {
                rendererClients.add(ws);
                console.log("[OpenBrowser Bridge] Renderer registered");
                ws.on("close", () => rendererClients.delete(ws));
                return;
              }

              if (msg.type === "action_result") {
                callbacks.onActionResult?.(msg.payload as ActionResult);
                rendererClients.forEach((c) => {
                  if (c.readyState === 1) c.send(data.toString());
                });
                return;
              }

              if (msg.type === "action" && extensionClient?.readyState === 1) {
                extensionClient.send(JSON.stringify(msg));
              }
            } catch (e) {
              console.error("[OpenBrowser Bridge] Invalid message:", e);
            }
          });
        });

        wss.on("error", reject);
      });
    },

    stop() {
      extensionClient?.close();
      extensionClient = null;
      rendererClients.forEach((c) => c.close());
      rendererClients.clear();
      wss?.close();
      wss = null;
    },

    sendAction(action: BrowserAction): boolean {
      if (!extensionClient || extensionClient.readyState !== 1) return false;
      extensionClient.send(JSON.stringify({ type: "action", payload: action }));
      return true;
    },

    requestPerception(): boolean {
      if (!extensionClient || extensionClient.readyState !== 1) return false;
      extensionClient.send(JSON.stringify({ type: "perceive" }));
      return true;
    },

    setCallbacks(cb: BridgeCallbacks) {
      Object.assign(callbacks, cb);
    },
  };
}
