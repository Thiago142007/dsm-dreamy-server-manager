/**
 * Painel do servidor: sidebar com as abas + conteúdo.
 *
 * A ordem das abas é fixa e segue o que o painel promete: Server, Opções,
 * Console, Log, Players, Software, Arquivos, Plugins/Mods, Datapacks, Mundos,
 * Backups, Inicialização e Agendamento. Abas que o software não suporta
 * (Plugins, Mods, Datapacks) simplesmente não aparecem.
 */
import { useEffect, useMemo, useState } from "react";
import { api, type ServerEntry, type ServerStatus, type Tabs } from "../lib/bridge";
import { useTauriEvent, useInterval, useAsync } from "../lib/hooks";
import { McButton } from "../components/McButton";
import { McText } from "../components/McText";
import { useToast } from "../components/Toast";
import { formatRam } from "../lib/format";
import { TEX } from "../theme/assets";

import { ServerTab } from "./tabs/ServerTab";
import { OptionsTab } from "./tabs/OptionsTab";
import { ConsoleTab } from "./tabs/ConsoleTab";
import { LogTab } from "./tabs/LogTab";
import { PlayersTab } from "./tabs/PlayersTab";
import { SoftwareTab } from "./tabs/SoftwareTab";
import { FilesTab } from "./tabs/FilesTab";
import { ContentTab } from "./tabs/ContentTab";
import { WorldsTab } from "./tabs/WorldsTab";
import { BackupsTab } from "./tabs/BackupsTab";
import { StartupTab } from "./tabs/StartupTab";
import { ScheduleTab } from "./tabs/ScheduleTab";

type TabId =
  | "server"
  | "options"
  | "console"
  | "log"
  | "players"
  | "software"
  | "files"
  | "plugins"
  | "mods"
  | "datapacks"
  | "worlds"
  | "backups"
  | "startup"
  | "schedule";

const BASE_TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "server", label: "Server", icon: "grass" },
  { id: "options", label: "Opções", icon: "planks" },
  { id: "console", label: "Console", icon: "stone" },
  { id: "log", label: "Log", icon: "planks" },
  { id: "players", label: "Players", icon: "grass" },
  { id: "software", label: "Software", icon: "cobblestone" },
  { id: "files", label: "Arquivos", icon: "cobblestone" },
];

export function PanelScreen({
  serverId,
  onExit,
}: {
  serverId: string;
  onExit: () => void;
}) {
  const [tab, setTab] = useState<TabId>("server");
  const [status, setStatus] = useState<ServerStatus>("offline");
  const [server, setServer] = useState<ServerEntry | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { notify } = useToast();
  const { data: tabs } = useAsync<Tabs>(() => api.tabsFor(serverId), [serverId]);

  useEffect(() => {
    let alive = true;
    api
      .getServer(serverId)
      .then((s) => alive && setServer(s))
      .catch((e) => notify((e as Error).message, "error"));
    api
      .serverStatus(serverId)
      .then((s) => alive && setStatus(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  useTauriEvent<{ serverId: string; status: ServerStatus }>("server://status", (e) => {
    if (e.serverId === serverId) setStatus(e.status);
  });
  useTauriEvent<{ serverId: string; jar: string }>("server://installed", (e) => {
    if (e.serverId === serverId) {
      void api.getServer(serverId).then(setServer);
    }
  });

  // status de mentirinha: o backend é a fonte da verdade, mas assim a UI fica viva
  // mesmo se um evento se perder
  useInterval(() => {
    void api.serverStatus(serverId).then(setStatus).catch(() => {});
  }, 8000);

  const visibleTabs = useMemo(() => {
    const list = [...BASE_TABS];
    if (tabs) {
      if (tabs.plugins) list.push({ id: "plugins", label: "Plugins", icon: "planks" });
      if (tabs.mods) list.push({ id: "mods", label: "Mods", icon: "diamond" });
      if (tabs.datapacks) list.push({ id: "datapacks", label: "Datapacks", icon: "diamond" });
    }
    list.push(
      { id: "worlds", label: "Mundos", icon: "grass" },
      { id: "backups", label: "Backups", icon: "stone" },
      { id: "startup", label: "Inicialização", icon: "cobblestone" },
      { id: "schedule", label: "Agendamento", icon: "planks" },
    );
    return list;
  }, [tabs]);

  // se a aba atual desapareceu (ex.: trocou de software), volta para Server
  useEffect(() => {
    if (!visibleTabs.some((t) => t.id === tab)) setTab("server");
  }, [visibleTabs, tab]);

  if (!server) {
    return (
      <div className="mc-app">
        <div className="mc-tile-bg" />
        <div className="mc-screen mc-center">
          <McText scale={2} className="mc-pulse">
            Carregando painel...
          </McText>
        </div>
      </div>
    );
  }

  return (
    <div className="mc-app">
      <div className="mc-tile-bg" />
      <div className="panel">
        <aside className={`panel__sidebar ${sidebarOpen ? "" : "panel__sidebar--collapsed"}`}>
          <div className="panel__brand">
            <img src={TEX.inventory} alt="" className="panel__brand-icon" />
            <McText scale={1.3}>DSM</McText>
          </div>
          <nav className="panel__nav mc-scroll">
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                className={`panel__nav-item ${tab === t.id ? "panel__nav-item--active" : ""}`}
                onClick={() => setTab(t.id)}
                title={t.label}
              >
                <span className={`panel__nav-icon panel__nav-icon--${t.icon}`} />
                <span className="panel__nav-label">{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="panel__sidebar-footer">
            <McButton size="small" onClick={() => setSidebarOpen((v) => !v)}>
              {sidebarOpen ? "‹ Recolher" : "›"}
            </McButton>
          </div>
        </aside>

        <main className="panel__main">
          <header className="panel__topbar">
            <McButton size="small" onClick={onExit}>
              ← Servidores
            </McButton>
            <div className="panel__topbar-info">
              <McText scale={1.4}>{server.name}</McText>
              <span className="mc-hint">
                {server.software} {server.version} · {formatRam(server.ramMb)} · Java{" "}
                {server.javaMajor}
              </span>
            </div>
            <span
              className="panel__status-dot"
              style={{
                background:
                  status === "online"
                    ? "var(--mc-green)"
                    : status === "offline"
                      ? "var(--mc-red)"
                      : "var(--mc-yellow)",
              }}
            />
          </header>

          <div className="panel__content mc-scroll" key={tab}>
            {tab === "server" && (
              <ServerTab server={server} status={status} onStatus={setStatus} onServer={setServer} />
            )}
            {tab === "options" && <OptionsTab server={server} onServer={setServer} />}
            {tab === "console" && <ConsoleTab server={server} status={status} />}
            {tab === "log" && <LogTab server={server} />}
            {tab === "players" && <PlayersTab server={server} />}
            {tab === "software" && <SoftwareTab server={server} onServer={setServer} />}
            {tab === "files" && <FilesTab server={server} />}
            {(tab === "plugins" || tab === "mods" || tab === "datapacks") && (
              <ContentTab server={server} kind={tab} tabs={tabs} />
            )}
            {tab === "worlds" && <WorldsTab server={server} />}
            {tab === "backups" && <BackupsTab server={server} />}
            {tab === "startup" && <StartupTab server={server} onServer={setServer} />}
            {tab === "schedule" && <ScheduleTab server={server} />}
          </div>
        </main>
      </div>
    </div>
  );
}
