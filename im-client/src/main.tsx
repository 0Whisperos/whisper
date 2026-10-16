import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { isImageViewerWindow } from "./features/image-viewer/entry";
import { ImageViewer } from "./features/image-viewer/ImageViewer";
import { installContextMenuPolicy } from "./shared/tauri/contextMenuPolicy";
import "./styles.css";

installContextMenuPolicy();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    {isImageViewerWindow() ? <ImageViewer /> : <App />}
  </StrictMode>,
);
