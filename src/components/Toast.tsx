/**
 * Notificações do app no canto da tela, com som de erro/sucesso do jogo.
 */
import { createContext, useCallback, useContext, useState } from "react";
import { UI } from "../theme/sound";

export type ToastKind = "info" | "success" | "error";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<{
  notify: (message: string, kind?: ToastKind) => void;
}>({ notify: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, kind, message }]);
    if (kind === "error") UI.error();
    if (kind === "success") UI.success();
    window.setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id));
    }, kind === "error" ? 7000 : 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind} mc-panel`}>
            <span
              className="toast__dot"
              style={{
                background:
                  t.kind === "error"
                    ? "var(--mc-red)"
                    : t.kind === "success"
                      ? "var(--mc-green)"
                      : "var(--mc-aqua)",
              }}
            />
            <span className="toast__text">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
