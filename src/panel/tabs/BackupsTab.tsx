/**
 * Aba "Backups": criar, restaurar, copiar, cortar e deletar backups.
 */
import { useState } from "react";
import { api, type BackupItem, type ServerEntry } from "../../lib/bridge";
import { useAsync } from "../../lib/hooks";
import { McButton } from "../../components/McButton";
import { McText } from "../../components/McText";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import { UI } from "../../theme/sound";

export function BackupsTab({ server }: { server: ServerEntry }) {
  const backups = useAsync<BackupItem[]>(() => api.listBackups(server.id), [server.id]);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<BackupItem | null>(null);
  const [moving, setMoving] = useState<BackupItem | null>(null);
  const [servers, setServers] = useState<ServerEntry[]>([]);
  const [target, setTarget] = useState("");
  const { notify } = useToast();

  const create = async () => {
    setCreating(true);
    try {
      await api.createBackup(server.id);
      backups.refresh();
      notify("Backup criado.", "success");
      UI.success();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setCreating(false);
    }
  };

  const openMove = async (item: BackupItem) => {
    setMoving(item);
    try {
      const list = await api.listServers();
      setServers(list);
      setTarget(list.find((s) => s.id !== server.id)?.id ?? "");
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };

  return (
    <div className="tab tab--backups">
      <section className="mc-panel">
        <div className="mc-panel__title mc-row">
          <McText scale={1.2}>Backups do servidor</McText>
          <div className="mc-spacer" />
          <McButton variant="primary" disabled={creating} onClick={() => void create()}>
            {creating ? "Compactando..." : "Criar Backup"}
          </McButton>
        </div>
        <div className="tab__body">
          <span className="mc-hint">
            Os backups ficam em <b>~/.dsm/backups/{server.id.slice(0, 8)}/</b> e são arquivos{" "}
            <b>.tar.gz</b> com o servidor inteiro (mundo, plugins, configurações). Guarde uma cópia em
            outro lugar de tempo em tempo — um HD também pode falhar.
          </span>
          {backups.loading && <span className="mc-hint">carregando...</span>}
          {backups.error && <McText scale={1} className="mc-text-red">{backups.error}</McText>}
          {(backups.data ?? []).length === 0 && !backups.loading && (
            <span className="mc-hint">Nenhum backup ainda.</span>
          )}
          <table className="mc-table">
            <thead>
              <tr>
                <th>Backup</th>
                <th>Criado em</th>
                <th>Tamanho</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(backups.data ?? []).map((item) => (
                <tr key={item.fileName}>
                  <td>{item.fileName}</td>
                  <td>{formatDate(item.fileName)}</td>
                  <td>{item.sizeHuman}</td>
                  <td className="mc-row">
                    <McButton size="small" variant="primary" onClick={() => setRestoring(item)}>
                      Restaurar
                    </McButton>
                    <McButton
                      size="small"
                      onClick={async () => {
                        try {
                          await api.copyBackup(server.id, item.fileName);
                          backups.refresh();
                          notify("Backup copiado.", "success");
                        } catch (e) {
                          notify((e as Error).message, "error");
                        }
                      }}
                    >
                      Copiar
                    </McButton>
                    <McButton size="small" onClick={() => void openMove(item)}>
                      Cortar
                    </McButton>
                    <McButton
                      size="small"
                      variant="danger"
                      onClick={async () => {
                        if (!confirm(`Apagar ${item.fileName}?`)) return;
                        try {
                          await api.deleteBackup(server.id, item.fileName);
                          backups.refresh();
                          notify("Backup apagado.", "success");
                        } catch (e) {
                          notify((e as Error).message, "error");
                        }
                      }}
                    >
                      Deletar
                    </McButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={restoring !== null}
        title="Restaurar backup?"
        confirmLabel="Restaurar"
        destructive
        onClose={() => setRestoring(null)}
        onConfirm={() => {
          const item = restoring!;
          void (async () => {
            try {
              await api.restoreBackup(server.id, item.fileName);
              notify("Backup restaurado.", "success");
              backups.refresh();
            } catch (e) {
              notify((e as Error).message, "error");
            }
          })();
          setRestoring(null);
        }}
      >
        <p>
          Tudo que está na pasta do servidor agora será <b>substituído</b> pelo conteúdo de{" "}
          <b>{restoring?.fileName}</b>. Mudanças feitas depois desse backup serão perdidas.
        </p>
        <p>Se o servidor estiver ligado, desligue antes de restaurar.</p>
      </Modal>

      <Modal
        open={moving !== null}
        title="Mover backup para outro servidor"
        confirmLabel="Mover"
        onClose={() => setMoving(null)}
        onConfirm={() => {
          const item = moving!;
          void (async () => {
            try {
              await api.moveBackup(server.id, item.fileName, target);
              backups.refresh();
              notify("Backup movido.", "success");
            } catch (e) {
              notify((e as Error).message, "error");
            }
          })();
          setMoving(null);
        }}
      >
        <p>Escolha o servidor de destino:</p>
        <select className="mc-select" value={target} onChange={(e) => setTarget(e.target.value)}>
          {servers
            .filter((s) => s.id !== server.id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </Modal>
    </div>
  );
}
