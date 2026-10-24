/**
 * Aba "Server": endereço, status e os botões de ligar/parar/reiniciar/forçar.
 */
import { useEffect, useState } from "react";
import { api, type ServerEntry, type ServerStatus } from "../../lib/bridge";
import { useTauriEvent } from "../../lib/hooks";
import { McButton } from "../../components/McButton";
import { McText } from "../../components/McText";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { statusLabel, statusColor, serverAddress } from "../../lib/format";
import { UI } from "../../theme/sound";

export function ServerTab({
  server,
  status,
  onStatus,
}: {
  server: ServerEntry;
  status: ServerStatus;
  onStatus: (s: ServerStatus) => void;
  onServer: (s: ServerEntry) => void;
}) {
  const [confirmForce, setConfirmForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const { notify } = useToast();

  useTauriEvent<{ serverId: string; status: ServerStatus }>("server://status", (e) => {
    if (e.serverId === server.id) onStatus(e.status);
  });

  const run = async (fn: () => Promise<unknown>, okMessage: string) => {
    setBusy(true);
    try {
      await fn();
      onStatus(await api.serverStatus(server.id));
      notify(okMessage, "success");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const starting = status === "starting" || status === "stopping" || status === "online";
  const port = server.port;

  return (
    <div className="tab tab--server">
      <header className="server-header">
        <McText scale={1} className="server-header__label">
          ENDEREÇO DO SERVIDOR
        </McText>
        <button
          className="server-header__ip"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(serverAddress(port));
              setCopied(true);
              UI.pop();
              window.setTimeout(() => setCopied(false), 1600);
            } catch {
              notify("não foi possível copiar", "error");
            }
          }}
          title="Clique para copiar"
        >
          {serverAddress(port)}
        </button>
        <div className="server-header__status" style={{ color: statusColor(status) }}>
          <span className="server-header__dot" style={{ background: statusColor(status) }} />
          <McText scale={1.4}>{statusLabel(status)}</McText>
        </div>
        {copied && <span className="mc-hint">copiado!</span>}
      </header>

      <div className="server-actions">
        {!starting ? (
          <McButton
            variant="primary"
            size="large"
            wide
            disabled={busy}
            onClick={() => run(() => api.startServer(server.id), "Ligando o servidor...")}
          >
            Iniciar
          </McButton>
        ) : (
          <div className="server-actions__row">
            <McButton
              size="large"
              disabled={busy || status === "stopping"}
              onClick={() => run(() => api.stopServer(server.id), "Parando o servidor...")}
            >
              Parar
            </McButton>
            <McButton
              size="large"
              disabled={busy || status === "stopping"}
              onClick={() => run(() => api.restartServer(server.id), "Reiniciando...")}
            >
              Reiniciar
            </McButton>
            <McButton
              size="large"
              variant="danger"
              disabled={busy}
              onClick={() => setConfirmForce(true)}
            >
              Forçar Desligamento
            </McButton>
          </div>
        )}
      </div>

      <div className="server-info">
        <McText scale={1} className="server-info__title">
          Como entrar no servidor
        </McText>
        <ol className="server-info__list">
          <li>Abra o Minecraft Java na mesma versão ({server.version}).</li>
          <li>
            Vá em <b>Multiplayer</b> → <b>Adicionar servidor</b>.
          </li>
          <li>
            Cole o endereço <b>{serverAddress(port)}</b> (se for jogar com amigos, use o IP da sua
            máquina na rede).
          </li>
        </ol>
        <span className="mc-hint">
          Dica: para amigos de fora da sua casa entrarem, é preciso liberar a porta {port} no
          roteador (port forwarding) ou usar um serviço de túnel — não é obrigatório para testar
          sozinho ou na mesma rede.
        </span>
      </div>

      <Modal
        open={confirmForce}
        title="Forçar desligamento?"
        confirmLabel="Forçar desligamento"
        destructive
        onConfirm={async () => {
          setConfirmForce(false);
          await run(() => api.forceStopServer(server.id), "Desligamento forçado enviado.");
        }}
        onClose={() => setConfirmForce(false)}
      >
        <p>
          O desligamento forçado mata o processo do Java imediatamente (equivalente a fechar pela
          barra de tarefas). <b>O mundo pode não ser salvo</b> e itens/construções recentes podem
          ser perdidos.
        </p>
        <p>
          Use só quando o servidor travar e o botão <b>Parar</b> não funcionar. Em seguida, clique em{" "}
          <b>Iniciar</b> de novo — o Minecraft corrige a maioria dos problemas sozinho.
        </p>
      </Modal>
    </div>
  );
}
