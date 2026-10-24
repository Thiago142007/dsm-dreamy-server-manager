/**
 * Captura de erros do frontend — módulo sem nenhum import.
 *
 * Precisa ser o primeiro import do main.tsx: se qualquer outro módulo falhar ao
 * carregar, os handlers já estão instalados e a pane fica registrada em
 * window.__dsmErrors (depois gravada em ~/.dsm/crash.log pelo main.tsx).
 */

type Captured = { label: string; text: string };

const bucket: Captured[] = [];

function describe(detail: unknown): string {
  if (detail instanceof Error) {
    return `${detail.message}\n${detail.stack ?? ""}`;
  }
  if (typeof detail === "string") return detail;
  if (typeof detail === "object" && detail !== null) {
    try {
      return JSON.stringify(detail, null, 2);
    } catch {
      return String(detail);
    }
  }
  return String(detail);
}

function capture(label: string, detail: unknown) {
  bucket.push({ label, text: describe(detail) });
  console.error(`[DSM ${label}]`, detail);
}

// evento de erro de script (import quebrado, sintaxe, etc.)
window.addEventListener("error", (event) => {
  const target = event.target as unknown as { src?: string; href?: string } | null;
  const where = target?.src ?? target?.href;
  capture(where ? `erro-de-recurso (${where})` : "error", event.error ?? event.message);
});

// promise rejeitada sem tratamento
window.addEventListener("unhandledrejection", (event) => {
  capture("unhandledrejection", event.reason);
});

/** Devolve (e limpa) os erros capturados. */
export function drainErrors(): Captured[] {
  return bucket.splice(0, bucket.length);
}

/** True quando já aconteceu algum erro. */
export function hasErrors(): boolean {
  return bucket.length > 0;
}
