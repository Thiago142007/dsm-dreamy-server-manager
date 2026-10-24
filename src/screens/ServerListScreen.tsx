/**
 * Tela inicial: lista de servidores em cards, com o botão "+" sempre primeiro.
 */
import { useEffect, useMemo, useState } from "react";
import { api, type ServerEntry, type ServerStatus } from "../lib/bridge";
import { useTauriEvent, useInterval } from "../lib/hooks";
import { formatRam, statusLabel, statusColor } from "../lib/format";
import { McButton } from "../components/McButton";
import { McText } from "../components/McText";
import { Panorama } from "../components/Panorama";
import { useToast } from "../components/Toast";
import { soundsEnabled } from "../theme/sound";
import { ICONS, TEX } from "../theme/assets";
import { useStored } from "../lib/hooks";

const SOFTWARE_ICON: Record<string, string> = {
  vanilla: ICONS.grass,
  paper: ICONS.grass,
  purpur: ICONS.grass,
  spigot: ICONS.cobblestone,
  quilt: ICONS.planks,
  fabric: ICONS.diamond,
  forge: ICONS.stone,
  neoforge: ICONS.stone,
  mohist: ICONS.cobblestone,
  magma: ICONS.stone,
  archlight: ICONS.stone,
  bungeecord: ICONS.planks,
  velocity: ICONS.planks,
  pocketmine: ICONS.planks,
  bedrock: ICONS.grass,
  modpack: ICONS.diamond,
};

export function ServerListScreen({
  onOpen,
  onCreate,
}: {
  onOpen: (server: ServerEntry) => void;
  onCreate: () => void;
}) {
  const [servers, setServers] = useState<ServerEntry[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({});
  const { notify } = useToast();
  const [soundOn, setSoundOn] = useStored("sounds", true);

  useEffect(() => {
    soundsEnabled(soundOn);
  }, [soundOn]);

  const load = async () => {
    try {
      const list = await api.listServers();
      setServers(list);
      const entries = await Promise.all(
        list.map(async (s) => [s.id, await api.serverStatus(s.id)] as const),
      );
      setStatuses(Object.fromEntries(entries));
    } catch (e) {
      notify((e as Error).message, "error");
      setServers([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // acompanha status em tempo real
  useTauriEvent<{ serverId: string; status: ServerStatus }>("server://status", (e) => {
    setStatuses((prev) => ({ ...prev, [e.serverId]: e.status }));
    if (e.status === "online") void load();
  });

  // assim que um servidor termina de instalar, atualiza a lista
  useTauriEvent<{ serverId: string }>("server://installed", () => void load());

  useInterval(() => {
    void (async () => {
      const entries = await Promise.all(
        (servers ?? []).map(async (s) => [s.id, await api.serverStatus(s.id)] as const),
      );
      setStatuses(Object.fromEntries(entries));
    })();
  }, 5000);

  const ordered = useMemo(() => servers ?? [], [servers]);

  if (servers === null) {
    return (
      <div className="mc-app">
        <Panorama />
        <div className="mc-screen mc-center">
          <McText scale={2.4} className="mc-pulse">
            Carregando...
          </McText>
        </div>
      </div>
    );
  }

  return (
    <div className="mc-app">
      <Panorama />
      <div className="mc-screen">
        <header className="home-header">
          <div className="home-header__brand">
            <img src={ICONS.grass} alt="" className="home-header__logo" />
            <div>
              <h1 className="mc-title">DSM</h1>
              <McText scale={1.1} className="mc-subtitle">
                Painel de Servidor Minecraft
              </McText>
            </div>
          </div>
          <div className="mc-row">
            <McButton
              size="small"
              onClick={() => {
                setSoundOn(!soundOn);
              }}
              title="Liga/desliga os sons do app"
            >
              {soundOn ? "Sons: ligados" : "Sons: desligados"}
            </McButton>
          </div>
        </header>

        <div className="home-body mc-scroll">
          <div className="server-grid">
            {/* o "+" sempre acima de qualquer servidor */}
            <button
              className="server-card server-card--new"
              onClick={onCreate}
              title="Criar um novo servidor"
            >
              <span className="server-card__plus">+</span>
              <McText scale={1.6}>Criar servidor</McText>
              <span className="mc-hint">Vanilla, Paper, Fabric, Modpacks...</span>
            </button>

            {ordered.map((server) => {
              const status = statuses[server.id] ?? "offline";
              return (
                <button
                  key={server.id}
                  className="server-card"
                  onClick={() => onOpen(server)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                  }}
                >
                  <div className="server-card__icon">
                    <img
                      src={SOFTWARE_ICON[server.software] ?? ICONS.dirt}
                      alt=""
                      className="server-card__block"
                    />
                    <span className="server-card__status" style={{ background: statusColor(status) }} />
                  </div>
                  <div className="server-card__info">
                    <McText scale={1.5}>{server.name}</McText>
                    <span className="server-card__software">
                      {server.software} · {server.version || "modpack"}
                    </span>
                    <span className="server-card__meta">
                      {formatRam(server.ramMb)} · porta {server.port} · Java {server.javaMajor}
                    </span>
                    <span className="server-card__state" style={{ color: statusColor(status) }}>
                      {statusLabel(status)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {ordered.length === 0 && (
            <div className="home-empty">
              <McText scale={2}>Você ainda não tem servidores</McText>
              <McText scale={1} className="mc-hint">
                Clique no "+" para criar o primeiro. Leva menos de dois minutos.
              </McText>
              <img
                src={TEX.inventory}
                alt=""
                style={{ width: 180, opacity: 0.5, marginTop: 16 }}
              />
            </div>
          )}
        </div>

        <footer className="home-footer">
          <span className="mc-hint">
            {ordered.length} servidor(es) · dados em ~/.dsm · feito para quem está começando
          </span>
        </footer>
      </div>
    </div>
  );
}
