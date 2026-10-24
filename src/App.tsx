/**
 * App: roteamento entre a lista de servidores, a criação e o painel.
 */
import { useEffect, useState } from "react";
import { ServerListScreen } from "./screens/ServerListScreen";
import { CreateServerScreen } from "./screens/CreateServerScreen";
import { PanelScreen } from "./panel/PanelScreen";
import { ToastProvider } from "./components/Toast";
import { McText } from "./components/McText";
import { Panorama } from "./components/Panorama";
import { ensureFontLoaded } from "./theme/font";
import { ensureIconsLoaded } from "./theme/icons";
import { registrarBoot } from "./lib/diagnostico";
import type { ServerEntry } from "./lib/bridge";
import "./styles/mc.css";
import "./styles/app.css";

type Route =
  | { name: "list" }
  | { name: "create" }
  | { name: "panel"; server: ServerEntry };

function Router() {
  const [route, setRoute] = useState<Route>({ name: "list" });
  const [ready, setReady] = useState(false);

  // a fonte bitmap e a lista de ícones são arquivos em public/: esperamos os
  // dois antes de desenhar, para o texto não piscar com a fonte de fallback.
  // Quando terminam, gravamos o boot em ~/.dsm/crash.log — é o nosso sinal de
  // "a interface montou", útil quando alguém relata tela branca.
  useEffect(() => {
    void Promise.all([ensureFontLoaded(), ensureIconsLoaded()]).finally(() => {
      setReady(true);
      void registrarBoot();
    });
  }, []);

  if (!ready) {
    return (
      <div className="mc-app">
        <Panorama />
        <div className="mc-screen mc-center">
          <McText scale={2.2} className="mc-pulse">
            Carregando...
          </McText>
        </div>
      </div>
    );
  }

  if (route.name === "create") {
    return (
      <CreateServerScreen
        onBack={() => setRoute({ name: "list" })}
        onCreated={() => setRoute({ name: "list" })}
      />
    );
  }

  if (route.name === "panel") {
    return (
      <PanelScreen
        key={route.server.id}
        serverId={route.server.id}
        onExit={() => setRoute({ name: "list" })}
      />
    );
  }

  return (
    <ServerListScreen
      onOpen={(server) => setRoute({ name: "panel", server })}
      onCreate={() => setRoute({ name: "create" })}
    />
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Router />
    </ToastProvider>
  );
}
