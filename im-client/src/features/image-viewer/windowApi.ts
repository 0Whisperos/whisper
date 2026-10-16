import { getCurrentWindow } from "@tauri-apps/api/window";

/** Native window operations are kept separate from the image session IPC contract. */
export function minimizeViewerWindow(): Promise<void> {
  return getCurrentWindow().minimize();
}

export function toggleViewerWindowMaximized(): Promise<void> {
  return getCurrentWindow().toggleMaximize();
}

export function isViewerWindowMaximized(): Promise<boolean> {
  return getCurrentWindow().isMaximized();
}

export function closeViewerWindow(): Promise<void> {
  return getCurrentWindow().close();
}

export function listenViewerWindowResized(handler: () => void): Promise<() => void> {
  return getCurrentWindow().onResized(handler);
}
