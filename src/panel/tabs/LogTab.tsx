/**
 * Aba "Log": todos os arquivos de log do servidor, com abrir/copiar/deletar.
 */
import { useState } from "react";
import { api, type LogItem } from "../../lib/bridge";
import { useAsync } from "../../lib/hooks";
import { McButton } from "../../components/McButton";
import { McText } from "../../components/McText";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import { UI } from "../../theme/sound";

export function LogTab({ server }: { server: { id: string } }) {
  const logs = useAsync<LogItem[]>(() => api.listLogs(server.id), [server.id]);
  const [opened, setOpened] = useState<{ name: string; content: string } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const { notify } = useToast();

  const openLog = async (name: string) => {
    setLoading(name);
    try {
      const content = await api.readLog(server.id, name);
      setOpened({ name, content });
      UI.pop();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setLoading(null);
    }
  };

  const copyLog = async (name: string) => {
    try {
      const content = await api.copyLog(server.id, name);
      await navigator.clipboard.writeText(content);
      notify("Log copiado para a área de transferência.", "success");
      UI.pop();
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };

  return (
    <div className="tab tab--log">
      <section className="mc-panel">
        <McText scale={1.2} className="mc-panel__title">
          Logs do servidor
        </McText>
        <div className="tab__body">
          {logs.loading && <span className="mc-hint">carregando...</span>}
          {logs.error && <McText scale={1} className="mc-text-red">{logs.error}</McText>}
          {!logs.loading && (logs.data ?? []).length === 0 && (
            <span className="mc-hint">
              Nenhum log ainda. Os arquivos aparecem aqui depois que o servidor rodar pela primeira
              vez (pasta <b>logs/</b>).
            </span>
          )}
          <table className="mc-table">
            <thead>
              <tr>
                <th>Arquivo</th>
                <th>Modificado</th>
                <th>Tamanho</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(logs.data ?? []).map((log) => (
                <tr key={log.fileName}>
                  <td>{log.fileName}</td>
                  <td>{formatDate(log.modified)}</td>
                  <td>{log.sizeHuman}</td>
                  <td className="mc-row">
                    <McButton
                      size="small"
                      disabled={loading === log.fileName}
                      onClick={() => void openLog(log.fileName)}
                    >
                      Abrir
                    </McButton>
                    <McButton size="small" onClick={() => void copyLog(log.fileName)}>
                      Copiar
                    </McButton>
                    <McButton
                      size="small"
                      variant="danger"
                      onClick={async () => {
                        if (!confirm(`Apagar ${log.fileName}?`)) return;
                        try {
                          await api.deleteLog(server.id, log.fileName);
                          logs.refresh();
                          notify("Log apagado.", "success");
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
        open={opened !== null}
        title={opened?.name ?? ""}
        width={820}
        onClose={() => setOpened(null)}
      >
        <pre className="log-view mc-scroll">{opened?.content}</pre>
        <div className="mc-row" style={{ marginTop: 12 }}>
          <div className="mc-spacer" />
          <McButton
            onClick={async () => {
              if (!opened) return;
              try {
                await navigator.clipboard.writeText(opened.content);
                notify("Copiado.", "success");
              } catch {
                notify("não foi possível copiar", "error");
              }
            }}
          >
            Copiar tudo
          </McButton>
        </div>
      </Modal>
    </div>
  );
}
