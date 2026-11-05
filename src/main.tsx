import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PopoutApp } from "./components/PopoutApp";
import { installContextMenuGuard } from "./lib/context-menu";
import { loadAppFonts } from "./lib/fonts";
import { readWindowMode } from "./lib/window-mode";
import "@fontsource-variable/geist-mono";
import "./styles/globals.css";

// Release builds show WebKit's menu only for text; dev builds keep it everywhere, with Inspect Element.
// Popout windows load this file too, so they get the same rule.
if (import.meta.env.PROD) {
  installContextMenuGuard(document);
}

const rootElement = document.getElementById("root");
const mode = readWindowMode(window.location.search);

if (rootElement) {
  void loadAppFonts().then(() => {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        {mode.kind === "popout" ? <PopoutApp sessionId={mode.sessionId} /> : <App />}
      </React.StrictMode>
    );
  });
}
