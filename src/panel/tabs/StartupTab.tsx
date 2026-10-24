/**
 * Aba "Inicialização": comando de boot, versão do Java, jar e RAM.
 */
import { useEffect, useState } from "react";
import { api, type ServerEntry } from "../../lib/bridge";
import { useAsync } from "../../lib/hooks";
import { McButton } from "../../components/McButton";
import { McText } from "../../components/McText";
import { Select, TextField } from "../../components/Fields";
import { useToast } from "../../components/Toast";
import { formatRam } from "../../lib/format";
import { softwareIcon } from "./softwareIcon";

const RAM_OPTIONS = [512, 1024, 2048, 3072, 4096, 6144, 8192, 12288, 16384];
const JAVA_MAJORS = [8, 11, 16, 17, 21, 25];

export function StartupTab({
  server,
  onServer,
}: {
  server: ServerEntry;
  onServer: (s: ServerEntry) => void;
}) {
  const startup = useAsync(() => api.startupCommand(server.id), [server.id, server.ramMb]);
  const javaStatus = useAsync(() => api.javaStatus(), []);
  const [jar, setJar] = useState(server.jar);
  const { notify } = useToast();

  useEffect(() => {
    setJar(server.jar);
  }, [server.jar]);

  const ram = server.ramMb;

  return (
    <div className="tab tab--startup">
      <section className="mc-panel">
        <McText scale={1.2} className="mc-panel__title">
          Como o servidor é iniciado
        </McText>
        <div className="tab__body">
          <div className="startup-command">
            <span className="mc-field__label">Comando executado</span>
            <code className="startup-command__code">{startup.data?.command ?? "..."}</code>
            <McButton
              size="small"
              onClick={async () => {
                if (!startup.data?.command) return;
                try {
                  await navigator.clipboard.writeText(startup.data.command);
                  notify("Comando copiado.", "success");
                } catch {
                  notify("não foi possível copiar", "error");
                }
              }}
            >
              Copiar comando
            </McButton>
          </div>

          <div className="startup-grid">
            <Select
              label="Memória máxima (RAM)"
              value={ram}
              onChange={async (value) => {
                try {
                  const updated = await api.setRam(server.id, value);
                  onServer(updated);
                  notify(`RAM definida: ${formatRam(value)}.`, "success");
                } catch (e) {
                  notify((e as Error).message, "error");
                }
              }}
              options={RAM_OPTIONS.map((r) => ({
                value: r,
                label: `${formatRam(r)}${r > 4096 ? " (mods/modpack)" : ""}`,
              }))}
              hint="Altera o comando de inicialização automaticamente (-Xmx)."
            />

            <Select
              label="Versão do Java"
              value={server.javaMajor}
              onChange={async (value) => {
                try {
                  const updated = await api.setJavaMajor(server.id, value);
                  onServer(updated);
                  notify(`Java ${value} selecionado.`, "success");
                } catch (e) {
                  notify((e as Error).message, "error");
                }
              }}
              options={JAVA_MAJORS.map((j) => {
                const status = javaStatus.data?.find((s) => s.major === j);
                return {
                  value: j,
                  label: `Java ${j}${status?.installed ? " (instalado)" : " (baixa ao iniciar)"}`,
                };
              })}
              hint="O app baixa o Java sozinho quando precisar."
            />

            <TextField
              label="Arquivo .jar"
              value={jar}
              onChange={setJar}
              onEnter={async () => {
                try {
                  const updated = await api.setJarName(server.id, jar.trim());
                  onServer(updated);
                  notify("Jar atualizado.", "success");
                } catch (e) {
                  notify((e as Error).message, "error");
                }
              }}
              hint="O padrão é server.jar. Só mude se você renomeou o arquivo."
            />

            <div className="mc-stack mc-stack--tight">
              <span className="mc-field__label">Situação</span>
              <span className="mc-hint">
                {startup.data?.unixArgs
                  ? "Este servidor (Forge/NeoForge) é iniciado com unix_args.txt + user_jvm_args.txt."
                  : "Este servidor é iniciado com -Xmx<java> -jar server.jar nogui."}
              </span>
              <span className="mc-hint">
                {startup.data?.running ? "Rodando agora." : "Parado."}
              </span>
              <img
                src={softwareIcon(server.software)}
                alt=""
                style={{ width: 32, imageRendering: "pixelated" }}
              />
            </div>
          </div>

          <span className="mc-hint">
            Dica: para modpacks pesados use pelo menos 6 GB de RAM e mantenha pelo menos 2 GB livres
            para o sistema.
          </span>
        </div>
      </section>
    </div>
  );
}
