/**
 * Aba "Software": trocar o software e a versão do servidor.
 *
 * Ao confirmar com "Apagar todo o servidor" marcado, o painel faz um backup
 * completo automaticamente antes — o usuário pode voltar atrás pela aba Backups.
 */
import { useEffect, useState } from "react";
import { api, type ServerEntry, type SoftwareInfo, type VersionOption } from "../../lib/bridge";
import { useAsync } from "../../lib/hooks";
import { McButton } from "../../components/McButton";
import { McText } from "../../components/McText";
import { Modal } from "../../components/Modal";
import { Select, Toggle } from "../../components/Fields";
import { useToast } from "../../components/Toast";
import { UI } from "../../theme/sound";
import { softwareIcon } from "./softwareIcon";

export function SoftwareTab({
  server,
  onServer,
}: {
  server: ServerEntry;
  onServer: (s: ServerEntry) => void;
}) {
  const softwareList = useAsync<SoftwareInfo[]>(() => api.listSoftware(), []);
  const [software, setSoftware] = useState(server.software);
  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [version, setVersion] = useState(server.version);
  const [wipe, setWipe] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  useEffect(() => {
    let alive = true;
    api
      .versions(software)
      .then((list) => {
        if (!alive) return;
        setVersions(list);
        if (!list.some((v) => v.version === version)) setVersion(list[0]?.version ?? "");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [software]);

  const changed = software !== server.software || version !== server.version;

  const apply = async () => {
    setBusy(true);
    try {
      const updated = await api.changeSoftware(server.id, software, version, wipe);
      onServer(updated);
      setConfirmOpen(false);
      notify(
        wipe
          ? "Software trocado. Um backup de segurança foi criado na aba Backups."
          : "Software trocado.",
        "success",
      );
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tab tab--software">
      <section className="mc-panel">
        <McText scale={1.2} className="mc-panel__title">
          Software do servidor
        </McText>
        <div className="tab__body">
          <div className="software-current">
            <img src={softwareIcon(server.software)} alt="" className="software-current__icon" />
            <div>
              <McText scale={1.3}>{server.name}</McText>
              <div className="mc-hint">
                {server.software} · {server.version || "modpack"}
              </div>
            </div>
          </div>

          <Select
            label="Novo software"
            value={software}
            onChange={(v) => {
              setSoftware(v);
              UI.pop();
            }}
            options={(softwareList.data ?? []).map((s) => ({
              value: s.id,
              label: `${s.name} — ${s.description}`,
            }))}
          />

          {software !== "modpack" && (
            <Select
              label="Nova versão"
              value={version}
              onChange={setVersion}
              options={versions.map((v) => ({
                value: v.version,
                label: v.note ? `${v.version} — ${v.note}` : v.version,
              }))}
            />
          )}

          <Toggle
            label="Apagar todo o servidor"
            checked={wipe}
            onChange={setWipe}
            hint="Apagar todo o servidor permite que você crie um servidor totalmente novo sem problema nenhum. Sem marcar, apenas os arquivos do programa são trocados (mundo, plugins e configurações ficam)."
          />

          <McButton
            variant={wipe ? "danger" : "primary"}
            disabled={!changed || busy}
            onClick={() => setConfirmOpen(true)}
          >
            {busy ? "Trocando..." : "Trocar Software"}
          </McButton>

          {!changed && <span className="mc-hint">Escolha um software ou versão diferente.</span>}
        </div>
      </section>

      <Modal
        open={confirmOpen}
        title="Tem certeza?"
        confirmLabel={wipe ? "Apagar e trocar" : "Trocar Software"}
        destructive={wipe}
        onConfirm={() => void apply()}
        onClose={() => setConfirmOpen(false)}
        width={560}
      >
        <p>
          O servidor será alterado para <b>{software}</b> na versão <b>{version || "—"}</b>.
        </p>
        {wipe ? (
          <>
            <p>
              <b>Tudo dentro da pasta do servidor será apagado.</b> Antes disso o DSM cria um backup
              completo (arquivo <b>.tar.gz</b>) na aba <b>Backups</b> — se você se arrepender, é só
              restaurar.
            </p>
            <p className="mc-text-red">
              Isso inclui mundo, jogadores, plugins e datapacks.
            </p>
          </>
        ) : (
          <p>
            Os arquivos do servidor (mundo, jogadores, plugins e datapacks) são mantidos. Só o
            programa é trocado — use essa opção com cuidado: mundos de versões diferentes podem não
            carregar.
          </p>
        )}
      </Modal>
    </div>
  );
}
