/** Hooks de eventos do backend e utilitários de estado. */
import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Escuta um evento do backend enquanto o componente estiver montado. */
export function useTauriEvent<T>(event: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let alive = true;
    void listen<T>(event, (e) => {
      if (alive) ref.current(e.payload);
    }).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [event]);
}

/** Atualiza o valor a cada `intervalMs` — usado para relógios e listas vivas. */
export function useInterval(fn: () => void, intervalMs: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (intervalMs === null) return;
    const id = window.setInterval(() => ref.current(), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
}

/** Executa uma função assíncrona e guarda erro/carregamento. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((value) => {
        if (alive) {
          setData(value);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const refresh = () => setTick((t) => t + 1);
  return { data, error, loading, refresh };
}

/** Guarda um valor no localStorage (preferências do app). */
export function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`dsm:${key}`);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`dsm:${key}`, JSON.stringify(value));
    } catch {
      /* modo privado: ignora */
    }
  }, [key, value]);
  return [value, setValue] as const;
}
