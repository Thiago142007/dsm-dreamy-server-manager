/**
 * Aba "Mundos": cards com os mundos do servidor, upload, arquivos e regenerar.
 */
import { useState } from "react";
import { api, type ServerEntry, type WorldItem } from "../../lib/bridge";
import { useAsync } from "../../lib/hooks";
import { McButton } from "../../components/McButton";
import { McText } from "../../components/McText";
import { Modal } from "../../components/Modal";
import { Field } from "../../components/Fields";
import { useToast } from "../../components/Toast";
import { UI } from "../../theme/sound";
import { ICONS } from "../../theme/assets";
import { softwareIcon } from "./softwareIcon";

export function WorldsTab({ server }: { server: ServerEntry }) {
  const worlds = useAsync<WorldItem[]>(() => api.listWorlds(server.id), [server.id]);
  const [uploading, setUploading] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState<WorldItem | null>(null);
  const [browsing, setBrowsing] = useState<{ world: string; files: { name: string; path: string; isDir: boolean; sizeHuman: string }[] } | null>(null);
  const { notify } = useToast();

  const upload = async () => {
    setUploading(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        title: "Escolha a pasta do mundo (a que contém level.dat)",
        multiple: false,
      });
      if (typeof selected !== "string") return;
      const name = await api.uploadWorld(server.id, selected);
      worlds.refresh();
      notify(`Mundo "${name}" enviado.`, "success");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="tab tab--worlds">
      <section className="mc-panel">
        <div className="mc-panel__title mc-row">
          <McText scale={1.2}>Mundos do servidor</McText>
          <div className="mc-spacer" />
          <McButton size="small" disabled={uploading} onClick={() => void upload()}>
            {uploading ? "Enviando..." : "Upload de mundo"}
          </McButton>
        </div>
        <div className="tab__body">
          {worlds.loading && <span className="mc-hint">carregando...</span>}
          {worlds.error && <McText scale={1} className="mc-text-red">{worlds.error}</McText>}
          {(worlds.data ?? []).length === 0 && !worlds.loading && (
            <span className="mc-hint">
              Nenhum mundo ainda — o servidor cria um novo quando inicia. Você também pode enviar um
              mundo que já tenha no seu computador.
            </span>
          )}
          <div className="worlds-grid">
            {(worlds.data ?? []).map((world) => (
              <article key={world.name} className="world-card">
                <div className="world-card__icon">
                  <img src={softwareIcon(server.software)} alt="" />
                  {world.active && <span className="world-card__active">ativo</span>}
                </div>
                <div className="world-card__info">
                  <McText scale={1.3}>{world.name}</McText>
                  <span className="mc-hint">{world.sizeHuman}</span>
                </div>
                <div className="world-card__actions">
                  <McButton
                    size="small"
                    onClick={async () => {
                      try {
                        const files = await api.worldFiles(server.id, world.name);
                        setBrowsing({ world: world.name, files });
                        UI.pop();
                      } catch (e) {
                        notify((e as Error).message, "error");
                      }
                    }}
                  >
                    Arquivos
                  </McButton>
                  <McButton
                    size="small"
                    variant="danger"
                    onClick={() => setConfirmRegen(world)}
                  >
                    Regerar
                  </McButton>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <Modal
        open={confirmRegen !== null}
        title={`Regerar "${confirmRegen?.name}"?`}
        confirmLabel="Regerar"
        destructive
        onClose={() => setConfirmRegen(null)}
        onConfirm={() => {
          const world = confirmRegen!;
          void (async () => {
            try {
              await api.regenerateWorld(server.id, world.name);
              notify("Mundo apagado. Um novo será criado ao iniciar o servidor.", "success");
              worlds.refresh();
            } catch (e) {
              notify((e as Error).message, "error");
            }
          })();
          setConfirmRegen(null);
        }}
      >
        <p>
          A pasta do mundo <b>{confirmRegen?.name}</b> será apagada por completo. Construções, itens e
          jogadores dentro dela são perdidos.
        </p>
        {confirmRegen?.active && (
          <p className="mc-text-yellow">
            Esse é o mundo ativo do servidor. Faça um backup antes se não t certeza.
          </p>
        )}
      </Modal>

      <Modal
        open={browsing !== null}
        title={`Arquivos de ${browsing?.world ?? ""}`}
        width={620}
        onClose={() => setBrowsing(null)}
      >
        <div className="mc-scroll" style={{ maxHeight: 320 }}>
          {(browsing?.files ?? []).map((f) => (
            <div key={f.path} className="file-row">
              <span className="file-row__icon">{f.isDir ? "📁" : "📄"}</span>
              <span className="file-row__name">{f.name}</span>
              <span className="file-row__size">{f.isDir ? "pasta" : f.sizeHuman}</span>
            </div>
          ))}
        </div>
      </Modal>

      <section className="mc-panel">
        <McText scale={1.2} className="mc-panel__title">
          Como enviar um mundo
        </McText>
        <div className="tab__body">
          <span className="mc-hint">
            1. No Minecraft, salve e feche o mundo. 2. Copie a pasta do mundo (ela tem um arquivo{" "}
            <b>level.dat</b> dentro) para o computador. 3. Clique em <b>Upload de mundo</b> e escolha
            essa pasta. 4. Em <b>Opções</b>, troque o "Nome do mundo" para a pasta que você enviou.
          </span>
          <img src={ICONS.grass} alt="" style={{ width: 32, imageRendering: "pixelated" }} />
        </div>
      </section>
    </div>
  );
}
