/** Suppress only native browser menus; custom handlers and keyboard clipboard shortcuts remain available. */
export function installContextMenuPolicy(target: Window = window): () => void {
  const preventNativeMenu = (event: Event) => event.preventDefault();
  target.addEventListener("contextmenu", preventNativeMenu, true);
  return () => target.removeEventListener("contextmenu", preventNativeMenu, true);
}
