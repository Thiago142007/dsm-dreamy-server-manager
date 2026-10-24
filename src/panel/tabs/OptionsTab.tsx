/**
 * Aba "Opções": prévia da lista de servidores do jogo, troca de ícone, editor
 * de MOTD e a lista do server.properties.
 */
import { useEffect, useMemo, useState } from "react";
import { api, type PropertyEntry, type ServerEntry } from "../../lib/bridge";
import { McButton } from "../../components/McButton";
import { McText } from "../../components/McText";
import { Modal } from "../../components/Modal";
import { MotdEditor } from "../../components/MotdEditor";
import { Select, TextField, Toggle } from "../../components/Fields";
import { useToast } from "../../components/Toast";
import { motdToHtml } from "../../lib/format";
import { useAsync } from "../../lib/hooks";
import { TEX, ICONS } from "../../theme/assets";
import { IconUpload } from "../../components/IconUpload";

/** Chaves do server.properties que ganham controles próprios. */
const EDITORS: Record<string, "number" | "text" | "bool" | "select" | "motd"> = {
  "max-players": "number",
  gamemode: "select",
  difficulty: "select",
  "online-mode": "bool",
  "white-list": "bool",
  "allow-flight": "bool",
  "force-gamemode": "bool",
  "spawn-protection": "number",
  pvp: "bool",
  "enable-command-block": "bool",
  "require-resource-pack": "bool",
  "resource-pack": "text",
  "resource-pack-prompt": "motd",
  "level-name": "text",
  "view-distance": "number",
  motd: "motd",
  "server-port": "number",
};

const GAMEMODES = ["survival", "creative", "adventure", "spectator"];
const DIFFICULTIES = ["peaceful", "easy", "normal", "hard"];

export function OptionsTab({
  server,
  onServer,
}: {
  server: ServerEntry;
  onServer: (s: ServerEntry) => void;
}) {
  const [motdOpen, setMotdOpen] = useState(false);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const properties = useAsync<PropertyEntry[]>(() => api.readProperties(server.id), [server.id]);
  const { notify } = useToast();

  useEffect(() => {
    let alive = true;
    api
      .getServerIcon(server.id)
      .then((b64) => {
        if (alive) setIconUrl(b64 ? `data:image/png;base64,${b64}` : null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [server.id, server.icon]);

  const byKey = useMemo(() => {
    const map: Record<string, PropertyEntry> = {};
    (properties.data ?? []).forEach((p) => (map[p.key] = p));
    return map;
  }, [properties.data]);

  const value = (key: string, fallback = "") => byKey[key]?.value ?? fallback;

  /** Salva uma chave no backend e recarrega a lista. */
  const save = async (key: string, val: string) => {
    try {
      await api.setProperty(server.id, key, val);
      properties.refresh();
      if (key === "motd") {
        const updated = await api.getServer(server.id);
        onServer(updated);
      }
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };

  const bool = (key: string) => value(key) === "true";

  return (
    <div className="tab tab--options">
      {/* ---------- prévia igual à lista de servidores do Minecraft ---------- */}
      <section className="mc-panel options-preview">
        <McText scale={1.2} className="mc-panel__title">
          Como aparece na lista de servidores
        </McText>
        <div className="options-preview__body">
          <div
            className="server-list-entry server-list-entry--large"
            style={{ backgroundImage: `url(${TEX.serverSelection})` }}
          >
            <button
              className="server-list-entry__icon"
              onClick={() => setMotdOpen(true)}
              title="Trocar a foto do servidor"
            >
              {iconUrl ? (
                <img src={iconUrl} alt="" />
              ) : (
                <>
                  <img src={ICONS.dirt} alt="" className="server-list-entry__dirt" />
                  <span className="server-list-entry__edit">✎</span>
                </>
              )}
            </button>
            <div className="server-list-entry__info">
              <div className="server-list-entry__name">{server.name}</div>
              <div className="server-list-entry__motd">
                <span dangerouslySetInnerHTML={{ __html: motdToHtml(server.motd.line1) }} />
                <br />
                <span dangerouslySetInnerHTML={{ __html: motdToHtml(server.motd.line2) }} />
              </div>
              <div className="server-list-entry__ping">
                <span className="server-list-entry__bars">
                  <i style={{ height: 4 }} />
                  <i style={{ height: 7 }} />
                  <i style={{ height: 10 }} />
                  <i style={{ height: 13 }} />
                  <i style={{ height: 16 }} />
                </span>
                {server.version}
              </div>
            </div>
            <button
              className="server-list-entry__edit-btn"
              onClick={() => setMotdOpen(true)}
              title="Editar a descrição (MOTD)"
            >
              ✎
            </button>
          </div>

          <div className="options-preview__side">
            <IconUpload
              current={server.icon}
              serverId={server.id}
              onPick={async (path) => {
                try {
                  const updated = await api.setServerIcon(server.id, path);
                  onServer(updated);
                  notify("Ícone atualizado.", "success");
                } catch (e) {
                  notify((e as Error).message, "error");
                }
              }}
            />
            <span className="mc-hint">
              A imagem é cortada e redimensionada para 64x64 pixels — o tamanho máximo que o server
              icon do Minecraft aceita.
            </span>
          </div>
        </div>
      </section>

      {/* ---------- editor de MOTD ---------- */}
      <Modal
        open={motdOpen}
        title="Editor de MOTD"
        width={720}
        onClose={() => setMotdOpen(false)}
      >
        <MotdEditor
          serverName={server.name}
          value={server.motd}
          onChange={(motd) => onServer({ ...server, motd })}
        />
        <div className="mc-row" style={{ marginTop: 12 }}>
          <div className="mc-spacer" />
          <McButton
            variant="primary"
            onClick={async () => {
              try {
                const updated = await api.setServerMotd(server.id, server.motd);
                onServer(updated);
                notify("Descrição salva.", "success");
                setMotdOpen(false);
              } catch (e) {
                notify((e as Error).message, "error");
              }
            }}
          >
            Salvar descrição
          </McButton>
        </div>
      </Modal>

      {/* ---------- server.properties ---------- */}
      <section className="mc-panel options-props">
        <McText scale={1.2} className="mc-panel__title">
          server.properties
        </McText>
        <div className="options-props__body">
          {properties.loading && <span className="mc-hint">carregando...</span>}
          {properties.error && (
            <div className="mc-stack">
              <McText scale={1} className="mc-text-red">
                {properties.error}
              </McText>
              <span className="mc-hint">
                O arquivo é criado quando o servidor inicia pela primeira vez. Clique em Iniciar na
                aba Server e volte aqui.
              </span>
            </div>
          )}

          {!properties.loading && !properties.error && (
            <div className="options-props__grid">
              <TextField
                label="Máximo de jogadores"
                type="number"
                value={value("max-players", "20")}
                onChange={(v) => void save("max-players", v)}
                hint="Quantas pessoas podem entrar ao mesmo tempo."
              />

              <Select
                label="Modo de jogo padrão"
                value={value("gamemode", "survival")}
                onChange={(v) => void save("gamemode", v)}
                options={GAMEMODES.map((g) => ({ value: g, label: g }))}
              />

              <Select
                label="Dificuldade"
                value={value("difficulty", "easy")}
                onChange={(v) => void save("difficulty", v)}
                options={DIFFICULTIES.map((d) => ({ value: d, label: d }))}
              />

              <Toggle
                label="Whitelist (lista de permitidos)"
                checked={bool("white-list")}
                onChange={(v) => void save("white-list", String(v))}
                hint="Quando ligada, só quem estiver na whitelist entra."
              />

              <Toggle
                label="Modo pirata (online-mode)"
                checked={bool("online-mode")}
                onChange={(v) => void save("online-mode", String(v))}
                hint="Desligar permite que contas sem Minecraft original entrem — útil para jogar com amigos, mas deixa o servidor aberto."
              />

              <Toggle
                label="Permitir voo (allow-flight)"
                checked={bool("allow-flight")}
                onChange={(v) => void save("allow-flight", String(v))}
                hint="Ligue se você usa plugins de voo ou mods compatíveis."
              />

              <Toggle
                label="Forçar modo de jogo"
                checked={bool("force-gamemode")}
                onChange={(v) => void save("force-gamemode", String(v))}
                hint="Obriga todo jogador a entrar no modo de jogo padrão."
              />

              <TextField
                label="Proteção de spawn"
                type="number"
                value={value("spawn-protection", "16")}
                onChange={(v) => void save("spawn-protection", v)}
                hint="Raio em blocos protegidos ao redor do spawn (0 desliga)."
              />

              <Toggle
                label="PvP"
                checked={bool("pvp")}
                onChange={(v) => void save("pvp", String(v))}
              />

              <Toggle
                label="Exigir resource pack"
                checked={bool("require-resource-pack")}
                onChange={(v) => void save("require-resource-pack", String(v))}
              />

              {bool("require-resource-pack") && (
                <>
                  <TextField
                    label="Link do resource pack"
                    value={value("resource-pack")}
                    onChange={(v) => void save("resource-pack", v)}
                    placeholder="https://exemplo.com/pack.zip"
                  />
                  <Select
                    label="Aviso mostrado ao baixar"
                    value="custom"
                    onChange={() => {}}
                    options={[
                      { value: "custom", label: "Texto personalizado (editor abaixo)" },
                      { value: "default", label: "Texto padrão do jogo" },
                    ]}
                    hint="Use o editor de MOTD (botão abaixo) para escrever o aviso."
                  />
                  <McButton
                    size="small"
                    onClick={() =>
                      void save("resource-pack-prompt", server.motd.line1 || "Baixe o pack!")
                    }
                  >
                    Definir texto do aviso
                  </McButton>
                </>
              )}

              <TextField
                label="Nome do mundo"
                value={value("level-name", "world")}
                onChange={(v) => void save("level-name", v)}
                hint="Nome da pasta do mundo principal (veja em Mundos)."
              />

              <TextField
                label="Distância de visão"
                type="number"
                value={value("view-distance", "10")}
                onChange={(v) => void save("view-distance", v)}
              />

              <Toggle
                label="Bloco de comandos"
                checked={bool("enable-command-block")}
                onChange={(v) => void save("enable-command-block", String(v))}
              />
            </div>
          )}

          {/* lista completa, para quem quiser mexer no resto */}
          <details className="options-props__all">
            <summary>
              <McText scale={1}>{`Todas as chaves (${properties.data?.length ?? 0})`}</McText>
            </summary>
            <div className="mc-scroll options-props__raw">
              <table className="mc-table">
                <thead>
                  <tr>
                    <th>Chave</th>
                    <th>Valor</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(properties.data ?? []).map((p) => (
                    <tr key={p.key}>
                      <td>{p.key}</td>
                      <td>
                        <input
                          className="mc-input"
                          value={p.value}
                          onChange={(e) => void save(p.key, e.target.value)}
                        />
                      </td>
                      <td>
                        <McButton
                          size="small"
                          variant="danger"
                          onClick={() => void api.removeProperty(server.id, p.key).then(properties.refresh)}
                        >
                          Remover
                        </McButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <span className="mc-hint">
              Arquivo: server.properties · as mudanças valem na próxima vez que o servidor iniciar
              (algumas opções aceitam reload pelo console).
            </span>
          </details>
        </div>
      </section>
    </div>
  );
}

export { EDITORS };
