import type { WebviewToExtensionMessage, ExtensionToWebviewMessage } from '../../panel/messages';

type VsCodeApi = {
  postMessage(message: WebviewToExtensionMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

declare function acquireVsCodeApi(): VsCodeApi;

let api: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
  if (!api) api = acquireVsCodeApi();
  return api;
}

export function onExtensionMessage(handler: (message: ExtensionToWebviewMessage) => void): () => void {
  const listener = (event: MessageEvent) => handler(event.data as ExtensionToWebviewMessage);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
