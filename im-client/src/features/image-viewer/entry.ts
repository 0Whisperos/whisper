export function isImageViewerWindow(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get("window") === "image-viewer";
}
