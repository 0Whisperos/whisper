import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { installContextMenuPolicy } from "./shared/tauri/contextMenuPolicy";
import "./styles.css";

installContextMenuPolicy();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
