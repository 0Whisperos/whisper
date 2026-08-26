import { getCurrentWindow } from "@tauri-apps/api/window";

export interface CloseRequestedEvent {
  preventDefault(): void;
}

export type CloseRequestedHandler = (event: CloseRequestedEvent) => void | Promise<void>;
export type UnlistenFn = () => void;

export async function listenAppCloseRequested(handler: CloseRequestedHandler): Promise<UnlistenFn> {
  return getCurrentWindow().onCloseRequested(handler);
}

export async function destroyAppWindow(): Promise<void> {
  await getCurrentWindow().destroy();
}
