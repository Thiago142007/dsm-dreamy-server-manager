/**
 * Aba "Console": mostra "Offline" quando o servidor está parado e o console ao
 * vivo quando está rodando, com campo para enviar comandos.
 */
import { useEffect, useRef, useState } from "react";
import { api, type LogLine, type ServerStatus } from "../../lib/bridge";
import { useTauriEvent } from "../../lib/hooks";
import { McButton } from "../../components/McButton";
import { McText } from "../../components/McText";
import { useToast } from "../../components/Toast";
import { UI } from "../../theme/sound";

const HELP: string[] = [
  "help — lista os comandos",
  "list — quem está online",
  "say <texto> — manda mensagem no chat",
  "op <jogador> — dá permissão de admin",
  "whitelist add <jogador> — libera entrada",
  "gamemode creative <jogador> — muda o modo de jogo",
  "tp <a> <b> — teleporta",
  "save-all — salva o mundo agora",
  "stop — desliga o servidor",
];

export function ConsoleTab({
  server,
  status,
}: {
  server: { id: string };
  status: ServerStatus;
}) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { notify } = useToast();

  useEffect(() => {
    api
      .consoleHistory(server.id)
      .then(setLines)
      .catch(() => setLines([]));
  }, [server.id]);

  useTauriEvent<{ serverId: string; line: LogLine }>("server://log", (e) => {
    if (e.serverId !== server.id) return;
    setLines((prev) => {
      // quando o processo reinicia o contador volta, então filtramos por ordem
      if (prev.some((l) => l.id === e.line.id && l.line === e.line.line)) return prev;
      return [...prev, e.line].slice(-4000);
    });
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  const send = async () => {
    const command = input.trim();
    if (!command) return;
    try {
      await api.sendConsole(server.id, command);
      setHistory((h) => [command, ...h].slice(0, 50));
      setHistoryIndex(-1);
      setInput("");
      UI.pop();
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };

  if (status === "offline") {
    return (
      <div className="tab tab--console">
        <div className="console console--offline">
          <McText scale={2.4}>Offline</McText>
          <span className="mc-hint">
            Ligue o servidor na aba <b>Server</b> para acompanhar o console e enviar comandos.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="tab tab--console">
      <div className="console">
        <div className="console__log mc-scroll">
          {lines.map((line, i) => (
            <div
              key={`${line.id}-${i}`}
              className={`console__line console__line--${line.stream}`}
            >
              <span className="console__time">{line.ts}</span>
              <span className="console__text">{line.line}</span>
            </div>
          ))}
          {lines.length === 0 && <span className="mc-hint">aguardando a primeira saída...</span>}
          <div ref={bottomRef} />
        </div>

        <div className="console__commands">
          <span className="mc-hint">Comandos úteis:</span>
          <div className="mc-row mc-row--wrap">
            {HELP.map((hint) => (
              <button
                key={hint}
                className="console__chip"
                onClick={() => setInput(hint.split(" ")[0])}
                title={hint}
              >
                {hint.split(" ")[0]}
              </button>
            ))}
          </div>
        </div>

        <form
          className="console__form"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <span className="console__prompt">&gt;</span>
          <input
            className="mc-input console__input"
            value={input}
            autoFocus
            placeholder="Digite um comando e aperte Enter..."
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault();
                const next = Math.min(historyIndex + 1, history.length - 1);
                if (history[next] !== undefined) {
                  setHistoryIndex(next);
                  setInput(history[next]);
                }
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                const next = historyIndex - 1;
                setHistoryIndex(next);
                setInput(next < 0 ? "" : history[next]);
              }
            }}
          />
          <McButton type="submit" disabled={!input.trim()}>
            Enviar
          </McButton>
        </form>
      </div>
    </div>
  );
}
