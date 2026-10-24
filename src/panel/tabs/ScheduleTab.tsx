/**
 * Aba "Agendamento": tarefas com expressão cron (reiniciar, backup, comando).
 */
import { useState } from "react";
import { api, type ScheduledTask, type ServerEntry } from "../../lib/bridge";
import { useAsync } from "../../lib/hooks";
import { McButton } from "../../components/McButton";
import { McText } from "../../components/McText";
import { Select, TextField } from "../../components/Fields";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import { UI } from "../../theme/sound";

const ACTIONS = [
  { value: "restart", label: "Reiniciar o servidor" },
  { value: "backup", label: "Criar backup" },
  { value: "stop", label: "Parar o servidor" },
  { value: "command", label: "Executar comando" },
];

const PRESETS = [
  { label: "Todo dia às 4h", cron: "0 0 4 * * *" },
  { label: "A cada 6 horas", cron: "0 0 */6 * * *" },
  { label: "A cada 30 minutos", cron: "0 */30 * * * *" },
  { label: "Domingo às 3h", cron: "0 0 3 * * 0" },
];

export function ScheduleTab({ server }: { server: ServerEntry }) {
  const tasks = useAsync<ScheduledTask[]>(() => api.listTasks(server.id), [server.id]);
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 0 4 * * *");
  const [action, setAction] = useState("restart");
  const [payload, setPayload] = useState("");
  const [preview, setPreview] = useState<string[]>([]);
  const { notify } = useToast();

  const checkCron = async (value: string) => {
    setCron(value);
    try {
      setPreview(await api.cronPreview(value, 3));
    } catch (e) {
      setPreview([]);
      notify((e as Error).message, "error");
    }
  };

  const create = async () => {
    try {
      await api.createTask(server.id, name.trim() || "Tarefa", cron, action, payload);
      tasks.refresh();
      notify("Tarefa criada.", "success");
      setName("");
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };

  return (
    <div className="tab tab--schedule">
      <section className="mc-panel">
        <McText scale={1.2} className="mc-panel__title">
          Nova tarefa
        </McText>
        <div className="tab__body">
          <TextField
            label="Nome"
            value={name}
            onChange={setName}
            placeholder="Backup da madrugada"
          />
          <Select
            label="O que fazer"
            value={action}
            onChange={setAction}
            options={ACTIONS}
          />
          {action === "command" && (
            <TextField
              label="Comando"
              value={payload}
              onChange={setPayload}
              placeholder="save-all"
              hint="Comando de console executado no horário agendado."
            />
          )}
          <TextField
            label="Quando (cron)"
            value={cron}
            onChange={(v) => void checkCron(v)}
            hint="Formato: segundo minuto hora dia mês dia-da-semana"
          />
          <div className="mc-row mc-row--wrap">
            {PRESETS.map((p) => (
              <McButton key={p.cron} size="small" onClick={() => void checkCron(p.cron)}>
                {p.label}
              </McButton>
            ))}
          </div>
          {preview.length > 0 && (
            <span className="mc-hint">Próximas execuções: {preview.join(" · ")}</span>
          )}
          <McButton variant="primary" onClick={() => void create()}>
            Criar tarefa
          </McButton>
        </div>
      </section>

      <section className="mc-panel">
        <McText scale={1.2} className="mc-panel__title">
          Tarefas deste servidor
        </McText>
        <div className="tab__body">
          {(tasks.data ?? []).length === 0 && (
            <span className="mc-hint">
              Nenhuma tarefa. Exemplo útil: um backup todo dia às 4h da manhã.
            </span>
          )}
          <table className="mc-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Ação</th>
                <th>Quando</th>
                <th>Última</th>
                <th>Ativa</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(tasks.data ?? []).map((task) => (
                <tr key={task.id}>
                  <td>{task.name}</td>
                  <td>
                    {ACTIONS.find((a) => a.value === task.action)?.label ?? task.action}
                    {task.action === "command" && task.payload ? `: ${task.payload}` : ""}
                  </td>
                  <td className="mc-hint">{task.cron}</td>
                  <td className="mc-hint">{task.lastRun ? formatDate(task.lastRun) : "—"}</td>
                  <td>
                    <McButton
                      size="small"
                      onClick={async () => {
                        await api.updateTask(task.id, { enabled: !task.enabled });
                        tasks.refresh();
                      }}
                    >
                      {task.enabled ? "ligada" : "desligada"}
                    </McButton>
                  </td>
                  <td className="mc-row">
                    <McButton
                      size="small"
                      onClick={() => {
                        void api.runTaskNow(task.id).then(() => {
                          notify("Tarefa executada.", "success");
                          UI.pop();
                        });
                      }}
                      title="Executar agora"
                    >
                      ▶
                    </McButton>
                    <McButton
                      size="small"
                      variant="danger"
                      onClick={async () => {
                        await api.deleteTask(task.id);
                        tasks.refresh();
                        notify("Tarefa removida.", "success");
                      }}
                    >
                      Remover
                    </McButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <span className="mc-hint">
            As tarefas rodam enquanto o painel estiver aberto. Reinícios e backups acontecem nos
            horários; comandos são enviados ao console do servidor.
          </span>
        </div>
      </section>
    </div>
  );
}
