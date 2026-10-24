/**
 * Diagnóstico do app: grava em `~/.dsm/crash.log` uma linha por boot e qualquer
 * erro de JavaScript não tratado.
 *
 * A escrita é feita por um comando do backend (`log_diagnostico`), e não pelo
 * plugin de fs do frontend: assim não depende das permissões do webview e o
 * registro sobrevive mesmo quando a interface não roda.
 *
 * É o que consultamos quando alguém diz "o app abre mas fica branco":
 * - arquivo com a linha de boot → a interface montou, o problema é visual;
 * - arquivo com erro → o stack aponta o culpado;
 * - arquivo ausente → o problema é anterior ao React (assets, WebKit).
 */
import { call } from "./bridge";

/** Registra uma linha de diagnóstico. Falhas são silenciosas. */
async function log(linha: string): Promise<void> {
  try {
    await call<void>("log_diagnostico", { linha });
  } catch {
    /* diagnóstico nunca deve derrubar o app */
  }
}

/** Registra que a interface montou. */
export async function registrarBoot(): Promise<void> {
  await log(
    `boot: interface montada (${window.innerWidth}x${window.innerHeight}, ${navigator.language})`,
  );
}

function descrever(detail: unknown): string {
  if (detail instanceof Error) return `${detail.message} | ${detail.stack ?? ""}`;
  if (typeof detail === "string") return detail;
  if (typeof detail === "object" && detail !== null) {
    try {
      return JSON.stringify(detail);
    } catch {
      return String(detail);
    }
  }
  return String(detail);
}

let instalado = false;

/** Instala os ouvintes de erro. Só precisa rodar uma vez. */
export function instalarDiagnostico(): void {
  if (instalado) return;
  instalado = true;

  window.addEventListener("error", (event) => {
    void log(`erro: ${descrever(event.error ?? event.message)}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    void log(`promise rejeitada: ${descrever(event.reason)}`);
  });
}
