/**
 * Aba "Players": jogadores online, whitelist, ops, banidos e o editor de
 * inventário/ender chest em tempo real.
 */
import { useEffect, useMemo, useState } from "react";
import {
  api,
  type ItemStack,
  type OnlinePlayer,
  type PlayerSnapshot,
  type ServerEntry,
} from "../../lib/bridge";
import { useAsync, useInterval } from "../../lib/hooks";
import { McButton } from "../../components/McButton";
import { McText } from "../../components/McText";
import { Modal } from "../../components/Modal";
import { Select, TextField } from "../../components/Fields";
import { useToast } from "../../components/Toast";
import { UI, sfx } from "../../theme/sound";
import { TEX, ICONS } from "../../theme/assets";
import { itemIcon } from "../../theme/icons";

/** Ícone de item com fallback visual. */
function ItemIcon({ id }: { id: string }) {
  const url = itemIcon(id);
  if (!url) return <span className="mc-slot__id">{id.replace("minecraft:", "")}</span>;
  return <img src={url} alt={id} title={id} />;
}

type View =
  | { kind: "online" }
  | { kind: "whitelist" }
  | { kind: "ops" }
  | { kind: "banned" }
  | { kind: "bannedIps" }
  | { kind: "player"; uuid: string };

const KITS = [
  { id: "starter", name: "Iniciante", items: "espada e picareta de ferro, comida e tochas" },
  { id: "pvp", name: "PvP", items: "armadura de diamante, espada e maçãs douradas" },
  { id: "builder", name: "Construtor", items: "blocos variados e ferramentas" },
];

const ARMOR_LABELS = ["Botas", "Calças", "Peitoral", "Capacete"];

export function PlayersTab({ server }: { server: ServerEntry }) {
  const [view, setView] = useState<View>({ kind: "online" });
  const online = useAsync<OnlinePlayer[]>(() => api.listOnlinePlayers(server.id), [server.id]);

  // whitelist aparece só quando está ativa (como o jogador pediu)
  const [whitelistOn, setWhitelistOn] = useState(false);
  useEffect(() => {
    api
      .readProperties(server.id)
      .then((props) => setWhitelistOn(props.find((p) => p.key === "white-list")?.value === "true"))
      .catch(() => {});
  }, [server.id]);

  useInterval(() => online.refresh(), 15000);

  const blocks = useMemo(() => {
    const list = [
      { kind: "ops" as const, label: "OPs", icon: "⭐" },
      { kind: "banned" as const, label: "Players Banidos", icon: "⛔" },
      { kind: "bannedIps" as const, label: "IPs Banidos", icon: "🛡" },
    ];
    if (whitelistOn) {
      return [{ kind: "whitelist" as const, label: "Whitelist", icon: "📜" }, ...list];
    }
    return list;
  }, [whitelistOn]);

  return (
    <div className="tab tab--players">
      <section className="mc-panel players-blocks">
        <McText scale={1.2} className="mc-panel__title">
          Jogadores e permissões
        </McText>
        <div className="players-blocks__grid">
          <button
            className={`players-block ${view.kind === "online" ? "players-block--active" : ""}`}
            onClick={() => setView({ kind: "online" })}
          >
            <span className="players-block__icon">👥</span>
            <McText scale={1}>Online agora</McText>
            <span className="mc-hint">{online.data?.length ?? 0} jogador(es)</span>
          </button>
          {blocks.map((b) => (
            <button
              key={b.kind}
              className={`players-block ${view.kind === b.kind ? "players-block--active" : ""}`}
              onClick={() => setView({ kind: b.kind })}
            >
              <span className="players-block__icon">{b.icon}</span>
              <McText scale={1}>{b.label}</McText>
              <span className="mc-hint">abrir lista</span>
            </button>
          ))}
        </div>
      </section>

      {view.kind === "online" && (
        <section className="mc-panel">
          <McText scale={1.2} className="mc-panel__title">
            Jogadores online
          </McText>
          <div className="tab__body">
            {(online.data ?? []).length === 0 && (
              <span className="mc-hint">
                Ninguém online agora. Os jogadores aparecem aqui quando entram no servidor — clique em
                um nome para ver o inventário, a fome e a vida em tempo real.
              </span>
            )}
            <div className="players-online">
              {(online.data ?? []).map((player) => (
                <button
                  key={player.uuid}
                  className="player-card"
                  onClick={() => {
                    UI.pop();
                    setView({ kind: "player", uuid: player.uuid });
                  }}
                >
                  <img src={TEX.inventory} alt="" className="player-card__head" />
                  <div className="player-card__info">
                    <McText scale={1.2}>{player.name}</McText>
                    <span className="mc-hint">
                      ❤ {player.health.toFixed(0)} · 🍗 {player.food}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {view.kind === "whitelist" && <WhitelistView server={server} />}
      {view.kind === "ops" && <OpsView server={server} />}
      {view.kind === "banned" && <BannedView server={server} />}
      {view.kind === "bannedIps" && <BannedIpsView server={server} />}
      {view.kind === "player" && (
        <PlayerView server={server} uuid={view.uuid} onBack={() => setView({ kind: "online" })} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ listas -- */

function WhitelistView({ server }: { server: ServerEntry }) {
  const list = useAsync(() => api.listWhitelist(server.id), [server.id]);
  const [name, setName] = useState("");
  const { notify } = useToast();

  const add = async () => {
    const nick = name.trim();
    if (!nick) return;
    try {
      await api.addToWhitelist(server.id, nick);
      setName("");
      list.refresh();
      notify(`${nick} entrou na whitelist.`, "success");
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };

  return (
    <section className="mc-panel">
      <McText scale={1.2} className="mc-panel__title">
        Whitelist (somente estes entram)
      </McText>
      <div className="tab__body">
        <div className="mc-row">
          <TextField
            value={name}
            onChange={setName}
            placeholder="Nick do jogador"
            onEnter={() => void add()}
            label="Adicionar jogador"
          />
          <McButton onClick={() => void add()} disabled={!name.trim()}>
            Adicionar
          </McButton>
        </div>
        {list.error && <McText scale={1} className="mc-text-red">{list.error}</McText>}
        {(list.data ?? []).length === 0 && !list.loading && (
          <span className="mc-hint">A whitelist está vazia — qualquer pessoa entra.</span>
        )}
        <table className="mc-table">
          <tbody>
            {(list.data ?? []).map((p) => (
              <tr key={p.uuid}>
                <td>
                  <img src={ICONS.grass} alt="" className="inline-icon" /> {p.name}
                </td>
                <td className="mc-hint">{p.uuid}</td>
                <td>
                  <McButton
                    size="small"
                    variant="danger"
                    onClick={async () => {
                      try {
                        await api.removeFromWhitelist(server.id, p.uuid);
                        list.refresh();
                        notify(`${p.name} removido.`, "success");
                      } catch (e) {
                        notify((e as Error).message, "error");
                      }
                    }}
                  >
                    Remover
                  </McButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OpsView({ server }: { server: ServerEntry }) {
  const list = useAsync(() => api.listOps(server.id), [server.id]);
  const [name, setName] = useState("");
  const [level, setLevel] = useState(4);
  const { notify } = useToast();

  return (
    <section className="mc-panel">
      <McText scale={1.2} className="mc-panel__title">
        Operadores (admins)
      </McText>
      <div className="tab__body">
        <div className="mc-row">
          <TextField
            value={name}
            onChange={setName}
            placeholder="Nick do jogador"
            onEnter={async () => {
              if (!name.trim()) return;
              try {
                await api.addOp(server.id, name.trim(), level);
                setName("");
                list.refresh();
                notify(`${name} agora é OP.`, "success");
              } catch (e) {
                notify((e as Error).message, "error");
              }
            }}
            label="Dar OP"
          />
          <Select
            label="Nível"
            value={level}
            onChange={setLevel}
            options={[
              { value: 1, label: "1 — ignora proteção de spawn" },
              { value: 2, label: "2 — comandos de cheat" },
              { value: 3, label: "3 — comandos de admin" },
              { value: 4, label: "4 — todos os comandos" },
            ]}
          />
        </div>
        {(list.data ?? []).length === 0 && !list.loading && (
          <span className="mc-hint">Nenhum operador ainda.</span>
        )}
        <table className="mc-table">
          <tbody>
            {(list.data ?? []).map((op) => (
              <tr key={op.uuid}>
                <td>⭐ {op.name}</td>
                <td className="mc-hint">nível {op.level}</td>
                <td>
                  <McButton
                    size="small"
                    variant="danger"
                    onClick={async () => {
                      try {
                        await api.removeOp(server.id, op.uuid);
                        list.refresh();
                        notify(`${op.name} não é mais OP.`, "success");
                      } catch (e) {
                        notify((e as Error).message, "error");
                      }
                    }}
                  >
                    Remover
                  </McButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BannedView({ server }: { server: ServerEntry }) {
  const list = useAsync(() => api.listBannedPlayers(server.id), [server.id]);
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const { notify } = useToast();

  return (
    <section className="mc-panel">
      <McText scale={1.2} className="mc-panel__title">
        Players banidos
      </McText>
      <div className="tab__body">
        <div className="mc-row">
          <TextField
            value={name}
            onChange={setName}
            placeholder="Nick"
            label="Banir jogador"
          />
          <TextField
            value={reason}
            onChange={setReason}
            placeholder="Motivo (opcional)"
            label="Motivo"
          />
          <McButton
            variant="danger"
            disabled={!name.trim()}
            onClick={async () => {
              try {
                await api.banPlayerNick(server.id, name.trim(), reason.trim() || "banido pelo painel");
                setName("");
                list.refresh();
                notify(`${name} foi banido.`, "success");
              } catch (e) {
                notify((e as Error).message, "error");
              }
            }}
          >
            Banir
          </McButton>
        </div>
        {(list.data ?? []).length === 0 && !list.loading && (
          <span className="mc-hint">Nenhum jogador banido.</span>
        )}
        <table className="mc-table">
          <tbody>
            {(list.data ?? []).map((b) => (
              <tr key={b.uuid}>
                <td>⛔ {b.name}</td>
                <td className="mc-hint">{b.reason || "sem motivo"}</td>
                <td>
                  <McButton
                    size="small"
                    onClick={async () => {
                      try {
                        await api.unbanPlayer(server.id, b.uuid);
                        list.refresh();
                        notify(`${b.name} desbanido.`, "success");
                      } catch (e) {
                        notify((e as Error).message, "error");
                      }
                    }}
                  >
                    Desbanir
                  </McButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BannedIpsView({ server }: { server: ServerEntry }) {
  const list = useAsync(() => api.listBannedIps(server.id), [server.id]);
  const [ip, setIp] = useState("");
  const [reason, setReason] = useState("");
  const { notify } = useToast();

  return (
    <section className="mc-panel">
      <McText scale={1.2} className="mc-panel__title">
        IPs banidos
      </McText>
      <div className="tab__body">
        <div className="mc-row">
          <TextField
            value={ip}
            onChange={setIp}
            placeholder="200.123.45.6"
            label="Banir IP"
          />
          <TextField value={reason} onChange={setReason} placeholder="Motivo (opcional)" label="Motivo" />
          <McButton
            variant="danger"
            disabled={!ip.trim()}
            onClick={async () => {
              try {
                await api.banIp(server.id, ip.trim(), reason.trim() || "banido pelo painel");
                setIp("");
                list.refresh();
                notify(`IP ${ip} banido.`, "success");
              } catch (e) {
                notify((e as Error).message, "error");
              }
            }}
          >
            Banir IP
          </McButton>
        </div>
        {(list.data ?? []).length === 0 && !list.loading && (
          <span className="mc-hint">Nenhum IP banido.</span>
        )}
        <table className="mc-table">
          <tbody>
            {(list.data ?? []).map((b) => (
              <tr key={b.ip}>
                <td>🛡 {b.ip}</td>
                <td className="mc-hint">{b.reason || "sem motivo"}</td>
                <td>
                  <McButton
                    size="small"
                    onClick={async () => {
                      try {
                        await api.unbanIp(server.id, b.ip);
                        list.refresh();
                        notify(`${b.ip} desbanido.`, "success");
                      } catch (e) {
                        notify((e as Error).message, "error");
                      }
                    }}
                  >
                    Desbanir
                  </McButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------- ficha do jogador -- */

function PlayerView({
  server,
  uuid,
  onBack,
}: {
  server: ServerEntry;
  uuid: string;
  onBack: () => void;
}) {
  const [snapshot, setSnapshot] = useState<PlayerSnapshot | null>(null);
  const [container, setContainer] = useState<"inventory" | "ender">("inventory");
  const [selected, setSelected] = useState<{ container: string; slot: number } | null>(null);
  const [itemId, setItemId] = useState("minecraft:diamond");
  const [itemCount, setItemCount] = useState(1);
  const { notify } = useToast();

  const load = async () => {
    try {
      setSnapshot(await api.getPlayerSnapshot(server.id, uuid));
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, uuid]);

  useInterval(() => {
    if (document.visibilityState === "visible") void load();
  }, 5000);

  const items = container === "inventory" ? snapshot?.inventory ?? [] : snapshot?.enderChest ?? [];

  const clickSlot = async (item: ItemStack) => {
    if (!snapshot) return;
    const here = { container, slot: item.slot };
    if (!selected) {
      setSelected(here);
      UI.pop();
      return;
    }
    if (selected.container === here.container && selected.slot === here.slot) {
      setSelected(null);
      return;
    }
    try {
      await api.moveItem(
        server.id,
        uuid,
        selected.slot,
        here.slot,
        selected.container,
        here.container,
      );
      setSelected(null);
      await load();
      sfx.play("pop", { volume: 0.7 });
      notify("Item movido.", "success");
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };

  return (
    <section className="mc-panel player-view">
      <div className="player-view__head">
        <McButton size="small" onClick={onBack}>
          ← Voltar
        </McButton>
        <McText scale={1.4}>{snapshot?.name ?? "Carregando..."}</McText>
        <span className="mc-hint">
          {snapshot?.gameMode ?? "?"} · nível {snapshot?.xpLevel ?? 0} ·{" "}
          {snapshot?.serverOnline ? "servidor online" : "servidor offline"}
        </span>
        <div className="mc-spacer" />
        <McButton size="small" onClick={() => void load()}>
          Atualizar
        </McButton>
      </div>

      {snapshot && (
        <div className="player-view__body">
          <div className="player-view__vitals">
            <div className="vital">
              <span className="mc-hint">Vida</span>
              <div className="vital__bar">
                <div
                  className="vital__fill vital__fill--health"
                  style={{ width: `${Math.max(0, Math.min(100, (snapshot.health / 20) * 100))}%` }}
                />
              </div>
              <span>{snapshot.health.toFixed(1)} / 20</span>
              <div className="mc-row">
                <McButton
                  size="small"
                  onClick={async () => {
                    await api.setPlayerHealth(server.id, uuid, Math.max(0, snapshot.health - 4));
                    await load();
                  }}
                >
                  -4
                </McButton>
                <McButton
                  size="small"
                  variant="primary"
                  onClick={async () => {
                    await api.setPlayerHealth(server.id, uuid, 20);
                    await load();
                  }}
                >
                  Encher
                </McButton>
              </div>
            </div>
            <div className="vital">
              <span className="mc-hint">Fome</span>
              <div className="vital__bar">
                <div
                  className="vital__fill vital__fill--food"
                  style={{ width: `${Math.max(0, Math.min(100, (snapshot.food / 20) * 100))}%` }}
                />
              </div>
              <span>{snapshot.food} / 20</span>
              <div className="mc-row">
                <McButton
                  size="small"
                  onClick={async () => {
                    await api.setPlayerFood(server.id, uuid, Math.max(0, snapshot.food - 4));
                    await load();
                  }}
                >
                  -4
                </McButton>
                <McButton
                  size="small"
                  variant="primary"
                  onClick={async () => {
                    await api.setPlayerFood(server.id, uuid, 20);
                    await load();
                  }}
                >
                  Encher
                </McButton>
              </div>
            </div>
          </div>

          <div className="player-view__actions">
            <span className="mc-field__label">Kits</span>
            <div className="mc-row mc-row--wrap">
              {KITS.map((kit) => (
                <McButton
                  key={kit.id}
                  size="small"
                  title={kit.items}
                  onClick={async () => {
                    try {
                      const count = await api.kitPlayer(server.id, uuid, kit.id);
                      await load();
                      notify(`${kit.name} aplicado (${count} itens).`, "success");
                    } catch (e) {
                      notify((e as Error).message, "error");
                    }
                  }}
                >
                  {kit.name}
                </McButton>
              ))}
            </div>

            <span className="mc-field__label">Dar item</span>
            <div className="mc-row">
              <TextField value={itemId} onChange={setItemId} placeholder="minecraft:diamond" />
              <TextField
                type="number"
                value={String(itemCount)}
                onChange={(v) => setItemCount(Number(v) || 1)}
              />
              <McButton
                onClick={async () => {
                  try {
                    await api.giveItem(server.id, uuid, itemId.trim(), itemCount);
                    await load();
                    notify("Item entregue.", "success");
                  } catch (e) {
                    notify((e as Error).message, "error");
                  }
                }}
              >
                Dar
              </McButton>
            </div>

            <div className="mc-row">
              <McButton
                onClick={async () => {
                  if (!confirm(`Matar ${snapshot.name}?`)) return;
                  try {
                    await api.killPlayer(server.id, snapshot.name);
                    UI.kill();
                    notify("Jogador morto.", "success");
                  } catch (e) {
                    notify((e as Error).message, "error");
                  }
                }}
              >
                Matar
              </McButton>
              <McButton
                variant="danger"
                onClick={() => void banFlow(server, snapshot, notify)}
              >
                Banir
              </McButton>
            </div>
          </div>

          <div className="player-view__containers">
            <div className="mc-row">
              <McButton
                size="small"
                variant={container === "inventory" ? "primary" : "default"}
                onClick={() => setContainer("inventory")}
              >
                Inventário
              </McButton>
              <McButton
                size="small"
                variant={container === "ender" ? "primary" : "default"}
                onClick={() => setContainer("ender")}
              >
                Ender Chest
              </McButton>
              <span className="mc-hint">
                {selected
                  ? "clique em outro slot para mover o item"
                  : "clique em dois slots para trocar os itens de lugar"}
              </span>
            </div>

            <div className="inventory-grid">
              {items.map((item) => (
                <button
                  key={item.slot}
                  className={`mc-slot mc-slot--filled ${
                    selected?.container === container && selected?.slot === item.slot
                      ? "mc-slot--selected"
                      : ""
                  }`}
                  title={item.displayName ?? item.id}
                  onClick={() => void clickSlot(item)}
                  onContextMenu={async (e) => {
                    e.preventDefault();
                    try {
                      await api.removeItem(server.id, uuid, item.slot, container);
                      await load();
                      notify("Item removido.", "success");
                    } catch (err) {
                      notify((err as Error).message, "error");
                    }
                  }}
                >
                  <ItemIcon id={item.id} />
                  {item.count > 1 && <span className="mc-slot__count">{item.count}</span>}
                  {item.nbtPresent && <span className="mc-slot__nbt" title={item.nbtJson} />}
                </button>
              ))}
              {items.length === 0 && <span className="mc-hint">nenhum item neste container.</span>}
            </div>

            {snapshot.armor.length > 0 && (
              <div className="mc-stack mc-stack--tight">
                <span className="mc-field__label">Armadura</span>
                <div className="mc-row">
                  {snapshot.armor.map((item, i) => (
                    <div key={i} className="mc-slot" title={ARMOR_LABELS[i]}>
                      {item.id && item.id !== "minecraft:air" ? (
                        <ItemIcon id={item.id} />
                      ) : (
                        <span className="mc-hint">{ARMOR_LABELS[i]?.[0] ?? ""}</span>
                      )}
                    </div>
                  ))}
                  {snapshot.offhand && (
                    <div className="mc-slot" title="Mão esquerda">
                      <span className="mc-hint">✋</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** Fluxo de banimento: escolha entre nick e IP. */
async function banFlow(
  server: ServerEntry,
  snapshot: PlayerSnapshot,
  notify: (msg: string, kind?: "info" | "success" | "error") => void,
) {
  const byIp = window.confirm(
    `Banir ${snapshot.name}?\n\nOK = banir o NICK (pode voltar com outra conta)\nCancelar = banir por IP (bloqueia a conexão)`,
  );
  try {
    if (byIp) {
      await api.banPlayerNick(server.id, snapshot.name, "banido pelo painel");
    } else {
      await api.banPlayerIp(server.id, snapshot.name, "banido pelo painel");
    }
    UI.ban();
    notify(`${snapshot.name} foi banido.`, "success");
  } catch (e) {
    notify((e as Error).message, "error");
  }
}
