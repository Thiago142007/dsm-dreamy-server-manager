/**
 * Aba "Conteúdo": Plugins, Mods, Datapacks e Modpacks.
 *
 * A lista vem do Modrinth (e do CurseForge quando configurado), sempre filtrada
 * pelo loader do servidor — então um servidor Fabric nunca mostra mod de Forge.
 * Itens já instalados aparecem como "Já instalado".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ServerEntry, type Tabs } from "../../lib/bridge";
import { useAsync } from "../../lib/hooks";
import { McButton } from "../../components/McButton";
import { McText } from "../../components/McText";
import { Modal } from "../../components/Modal";
import { Select, TextField, Toggle } from "../../components/Fields";
import { useToast } from "../../components/Toast";
import { truncate } from "../../lib/format";
import { UI } from "../../theme/sound";
import { ICONS } from "../../theme/assets";

export type ContentKind = "plugins" | "mods" | "datapacks";

interface ContentItem {
  id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  iconUrl: string | null;
  versions: string[];
  /** nome do arquivo já instalado, quando for o caso */
  installed: string | null;
}

/** Provedores por tipo de conteúdo. */
const PROVIDERS: Record<ContentKind, { id: string; label: string }[]> = {
  plugins: [
    { id: "modrinth", label: "Modrinth" },
    { id: "curseforge", label: "CurseForge" },
    { id: "hangar", label: "Hangar" },
    { id: "spiget", label: "SpigotMC (Spiget)" },
  ],
  mods: [
    { id: "modrinth", label: "Modrinth" },
    { id: "curseforge", label: "CurseForge" },
  ],
  datapacks: [
    { id: "modrinth", label: "Modrinth" },
    { id: "curseforge", label: "CurseForge" },
  ],
};

const PER_PAGE = 100;

export function ContentTab({
  server,
  kind,
  tabs,
}: {
  server: ServerEntry;
  kind: ContentKind;
  tabs: Tabs | null;
}) {
  const [provider, setProvider] = useState("modrinth");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [installing, setInstalling] = useState<string | null>(null);
  const [curseKey, setCurseKey] = useState(
    () => localStorage.getItem("dsm:curseforge-key") ?? "",
  );
  const [keyOpen, setKeyOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { notify } = useToast();

  const content = useAsync<{ items: ContentItem[]; total: number }>(
    () =>
      api.searchContent({
        serverId: server.id,
        kind,
        provider,
        query,
        page,
        limit: PER_PAGE,
      }),
    [server.id, kind, provider, query, page],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [page]);

  const loaderLabel = useMemo(() => {
    if (kind === "plugins") return "plugins";
    if (kind === "mods") return "mods";
    return "datapacks";
  }, [kind]);

  const install = async (item: ContentItem) => {
    setInstalling(item.id);
    try {
      await api.installContent({
        serverId: server.id,
        kind,
        provider,
        projectId: item.id,
        version: null,
      });
      content.refresh();
      notify(`${item.title} instalado.`, "success");
      UI.pop();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setInstalling(null);
    }
  };

  const needsKey = provider === "curseforge" && !curseKey;

  return (
    <div className="tab tab--content">
      <div className="content-toolbar">
        <Select
          label="Provedor"
          value={provider}
          onChange={setProvider}
          options={PROVIDERS[kind].map((p) => ({ value: p.id, label: p.label }))}
        />
        <div className="mc-spacer" />
        <TextField
          label={`Buscar ${loaderLabel}`}
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(0);
          }}
          placeholder="nome do plugin..."
        />
        <McButton
          size="small"
          onClick={() => setKeyOpen(true)}
          title="Configurar a chave da API do CurseForge"
        >
          ⚙ API
        </McButton>
      </div>

      <span className="mc-hint">
        Versão detectada: <b>{server.version}</b> · software <b>{server.software}</b>. Só aparecem{" "}
        {loaderLabel} compatíveis com essa versão.
      </span>

      {needsKey && (
        <div className="content-warning mc-panel">
          <McText scale={1} className="mc-text-yellow">
            O CurseForge exige uma chave de API.
          </McText>
          <span className="mc-hint">
            Crie uma chave gratuita em console.curseforge.com e cole no botão "⚙ API". Sem ela, use o
            Modrinth, que funciona sem cadastro.
          </span>
        </div>
      )}

      <div className="content-list mc-scroll" ref={scrollRef}>
        {content.loading && <span className="mc-hint">carregando...</span>}
        {content.error && <McText scale={1} className="mc-text-red">{content.error}</McText>}
        {(content.data?.items ?? []).map((item) => (
          <article key={item.id} className="content-card">
            <div className="content-card__icon">
              {item.iconUrl ? (
                <img src={item.iconUrl} alt="" />
              ) : (
                <img src={ICONS.planks} alt="" />
              )}
            </div>
            <div className="content-card__body">
              <McText scale={1.2}>{item.title}</McText>
              <p className="content-card__desc">{truncate(item.description, 150)}</p>
              <span className="mc-hint">por {item.author}</span>
            </div>
            <div className="content-card__side">
              <McButton
                size="small"
                disabled={item.installed !== null || installing === item.id}
                onClick={() => void install(item)}
              >
                {item.installed ? "Já instalado" : installing === item.id ? "Instalando..." : "Instalar"}
              </McButton>
              <span className="content-card__downloads">
                {formatDownloads(item.downloads)} downloads
              </span>
            </div>
          </article>
        ))}
        {(content.data?.items ?? []).length === 0 && !content.loading && (
          <span className="mc-hint">Nada encontrado com esses filtros.</span>
        )}
      </div>

      <div className="content-pager">
        {page > 0 && (
          <McButton size="small" onClick={() => setPage(page - 1)}>
            ← Página anterior
          </McButton>
        )}
        <span className="mc-hint">
          Página {page + 1} de {Math.max(1, Math.ceil((content.data?.total ?? 0) / PER_PAGE))} ·{" "}
          {content.data?.total ?? 0} {loaderLabel}
        </span>
        <McButton
          size="small"
          disabled={page + 1 >= Math.ceil((content.data?.total ?? 0) / PER_PAGE)}
          onClick={() => setPage(page + 1)}
        >
          Próxima página →
        </McButton>
      </div>

      <Modal
        open={keyOpen}
        title="Chave da API do CurseForge"
        width={520}
        onClose={() => setKeyOpen(false)}
        confirmLabel="Salvar"
        onConfirm={() => {
          localStorage.setItem("dsm:curseforge-key", curseKey);
          setKeyOpen(false);
          content.refresh();
          notify("Chave salva.", "success");
        }}
      >
        <TextField
          label="Chave"
          value={curseKey}
          onChange={setCurseKey}
          placeholder="$2a$10$..."
          hint="Obtenha em console.curseforge.com (gratuito). A chave fica salva só neste computador."
        />
      </Modal>
    </div>
  );
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
