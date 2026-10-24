/**
 * Ponto de entrada do app.
 *
 * `./capture` não tem nenhum import e instala os ouvintes de erro antes de
 * qualquer outro módulo — assim uma pane de import ainda fica registrada em
 * `window.__dsmErrors`, que o `lib/diagnostico` escreve em ~/.dsm/crash.log.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import "./capture";
import App from "./App";
import "./styles/mc.css";
import "./styles/app.css";
import { instalarDiagnostico } from "./lib/diagnostico";

instalarDiagnostico();

try {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} catch (error) {
  console.error("[DSM render]", error);
  throw error;
}
