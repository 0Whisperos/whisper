import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type AppExitRequestedHandler = () => void | Promise<void>;

export async function listenAppExitRequested(handler: AppExitRequestedHandler): Promise<() => void> {
  return getCurrentWindow().listen<void>("app-exit-requested", () => handler());
}

export function completeAppExit(): Promise<void> {
  return invoke<void>("complete_app_exit");
}

export function setAppAuthenticated(authenticated: boolean): Promise<void> {
  return invoke<void>("set_app_authenticated", { authenticated });
}
