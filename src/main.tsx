import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LinkMenuLayer } from "./components/LinkMenuLayer";
import { PopoutApp } from "./components/PopoutApp";
import { ComputerUsePill } from "./components/computer-use/ComputerUsePill";
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
    if (mode.kind === "pill") {
      // The pill is one line and a button: no session, no links, no menu.
      ReactDOM.createRoot(rootElement).render(
        <React.StrictMode>
          <ComputerUsePill />
        </React.StrictMode>,
      );
      return;
    }
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        {mode.kind === "popout" ? <PopoutApp sessionId={mode.sessionId} /> : <App />}
        <LinkMenuLayer />
      </React.StrictMode>
    );
  });
}
