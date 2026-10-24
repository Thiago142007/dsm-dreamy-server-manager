/**
 * Aba "Arquivos": gerenciador de arquivos do servidor.
 *
 * Clique com o botão direito em um item (ou no vazio) abre o menu de contexto,
 * com opções diferentes para arquivo, pasta e arquivo compactado. Dá para
 * selecionar vários itens, copiar/colar/cortar e comprimir em .tar.gz.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type FileItem, type ServerEntry } from "../../lib/bridge";
import { McButton } from "../../components/McButton";
import { McText } from "../../components/McText";
import { Modal } from "../../components/Modal";
import { TextArea } from "../../components/Fields";
import { useToast } from "../../components/Toast";
import { UI } from "../../theme/sound";

type Clipboard = { mode: "copy" | "cut"; paths: string[] } | null;

interface MenuState {
  x: number;
  y: number;
  /** null = clique no vazio (criar pasta / colar) */
  item: FileItem | null;
}

export function FilesTab({ server }: { server: ServerEntry }) {
  const [path, setPath] = useState("");
  const [items, setItems] = useState<FileItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<Clipboard>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null);
  const [creating, setCreating] = useState<"folder" | "file" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { notify } = useToast();

  const load = useCallback(async (target: string) => {
    try {
      const files = await api.listFiles(server.id, target);
      setItems(files);
      setError(null);
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
      setItems([]);
    }
  }, [server.id]);

  useEffect(() => {
    void load(path);
  }, [load, path]);

  // fecha o menu de contexto com clique/escala
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  const guard = async (fn: () => Promise<unknown>, ok = "Pronto.") => {
    setBusy(true);
    try {
      await fn();
      await load(path);
      notify(ok, "success");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const openMenu = (e: React.MouseEvent, item: FileItem | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (item) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(item.path)) next.delete(item.path);
        else next.add(item.path);
        return next;
      });
    }
    setMenu({ x: e.clientX, y: e.clientY, item });
  };

  const targets = () => {
    if (!menu?.item) return [...selected];
    return selected.has(menu.item.path) ? [...selected] : [menu.item.path];
  };

  const download = async (paths: string[]) => {
    try {
      const absolute = await api.downloadPaths(server.id, paths);
      // o backend devolve caminhos absolutos; abrimos a pasta pelo xdg-open
      const first = absolute[0];
      if (!first) return;
      const folder = first.includes("/") ? first.substring(0, first.lastIndexOf("/")) : first;
      await import("@tauri-apps/plugin-opener").then((m) => m.openPath(folder));
      notify(`Arquivo salvo. Pasta: ${folder}`, "success");
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };

  const crumbs = path ? path.split("/").filter(Boolean) : [];

  return (
    <div className="tab tab--files">
      <div className="files-toolbar">
        <McButton
          size="small"
          disabled={!path}
          onClick={() => {
            const parent = path.split("/").slice(0, -1).join("/");
            setPath(parent);
          }}
        >
          ↑ Subir
        </McButton>
        <span className="files-path">
          ~/.dsm/servers/{server.id.slice(0, 8)}/{path}
        </span>
        <div className="mc-spacer" />
        {clipboard && (
          <span className="mc-hint">
            {clipboard.paths.length} item(ns) na área de transferência ({clipboard.mode === "copy" ? "copiado" : "cortado"})
          </span>
        )}
        <McButton size="small" onClick={() => setCreating("folder")}>
          Nova pasta
        </McButton>
        <McButton size="small" onClick={() => setCreating("file")}>
          Novo arquivo
        </McButton>
        {selected.size > 0 && (
          <>
            <McButton
              size="small"
              disabled={busy}
              onClick={() =>
                void guard(
                  () =>
                    api.compressPaths(
                      server.id,
                      [...selected],
                      `backup-${new Date().toISOString().slice(0, 10)}.tar.gz`,
                    ),
                  "Compactado em .tar.gz.",
                )
              }
            >
              Comprimir ({selected.size})
            </McButton>
            <McButton size="small" onClick={() => void download([...selected])}>
              Baixar
            </McButton>
          </>
        )}
      </div>

      {error && (
        <div className="files-error">
          <McText scale={1} className="mc-text-red">{error}</McText>
        </div>
      )}

      <div
        className="files-list mc-scroll"
        ref={listRef}
        onContextMenu={(e) => {
          if (e.target === listRef.current || (e.target as HTMLElement).classList.contains("files-list")) {
            openMenu(e, null);
          }
        }}
      >
        {items === null && <span className="mc-hint">carregando...</span>}
        {items?.length === 0 && <span className="mc-hint">pasta vazia — clique com o botão direito para criar algo.</span>}
        {items?.map((item) => (
          <div
            key={item.path}
            className={`file-row ${selected.has(item.path) ? "file-row--selected" : ""}`}
            onContextMenu={(e) => openMenu(e, item)}
          >
            <input
              type="checkbox"
              className="file-row__check"
              checked={selected.has(item.path)}
              onChange={(e) => {
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(item.path);
                  else next.delete(item.path);
                  return next;
                });
              }}
              onClick={(e) => e.stopPropagation()}
              title="Selecionar"
            />
            <span className="file-row__icon">{item.isDir ? "📁" : archiveIcon(item)}</span>
            <button
              className="file-row__name"
              onClick={async () => {
                if (item.isDir) {
                  setPath(item.path);
                  UI.pop();
                  return;
                }
                if (!item.isArchive) {
                  try {
                    const content = await api.readTextFile(server.id, item.path);
                    setEditing({ path: item.path, content });
                  } catch {
                    notify("arquivo binário — use Baixar para abrir fora.", "error");
                  }
                }
              }}
              onDoubleClick={() => item.isDir && setPath(item.path)}
            >
              {item.name}
            </button>
            <span className="file-row__size">{item.isDir ? "pasta" : item.sizeHuman}</span>
            <span className="file-row__date">{item.modified}</span>
            <span className="file-row__actions">
              {item.isArchive && (
                <McButton
                  size="small"
                  onClick={() =>
                    void guard(
                      () =>
                        api.extractArchive(
                          server.id,
                          item.path,
                          `${item.path.replace(/\/[^/]*$/, "")}/`,
                        ),
                      "Extraído.",
                    )
                  }
                >
                  Extrair
                </McButton>
              )}
              <McButton size="small" onClick={() => void download([item.path])}>
                Baixar
              </McButton>
            </span>
          </div>
        ))}
      </div>

      {/* ---------------- menu de contexto ---------------- */}
      {menu && (
        <div
          className="context-menu mc-panel"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {!menu.item && (
            <>
              <button className="context-menu__item" onClick={() => { setCreating("folder"); setMenu(null); }}>
                📁 Criar pasta
              </button>
              <button className="context-menu__item" onClick={() => { setCreating("file"); setMenu(null); }}>
                📄 Criar arquivo
              </button>
              {clipboard && (
                <button
                  className="context-menu__item"
                  onClick={() => {
                    const paths = clipboard.paths;
                    void guard(
                      () =>
                        clipboard.mode === "copy"
                          ? api.copyPaths(server.id, paths, path)
                          : api.movePaths(server.id, paths, path),
                      "Colado.",
                    );
                    if (clipboard.mode === "cut") setClipboard(null);
                    setMenu(null);
                  }}
                >
                  📋 Colar ({clipboard.paths.length})
                </button>
              )}
            </>
          )}

          {menu.item && (
            <>
              <button
                className="context-menu__item"
                onClick={() => {
                  setRenaming(menu.item!.path);
                  setNewName(menu.item!.name);
                  setMenu(null);
                }}
              >
                ✏️ Renomear
              </button>
              <button
                className="context-menu__item"
                onClick={() => {
                  const paths = targets();
                  const base = (paths[0] ?? "arquivo").split("/").pop() ?? "arquivo";
                  void guard(
                    () =>
                      api.compressPaths(
                        server.id,
                        paths,
                        `${base.replace(/\.[^.]+$/, "")}.tar.gz`,
                      ),
                    "Compactado em .tar.gz.",
                  );
                  setMenu(null);
                }}
              >
                🗜 Comprimir ({targets().length})
              </button>
              {menu.item.isArchive && (
                <button
                  className="context-menu__item"
                  onClick={() => {
                    const item = menu.item!;
                    void guard(
                      () =>
                        api.extractArchive(
                          server.id,
                          item.path,
                          path ? `${path}/` : "",
                        ),
                      "Extraído.",
                    );
                    setMenu(null);
                  }}
                >
                  📦 Extrair
                </button>
              )}
              <button
                className="context-menu__item"
                onClick={() => {
                  void download(targets());
                  setMenu(null);
                }}
              >
                ⬇ Baixar
              </button>
              <button
                className="context-menu__item"
                onClick={() => {
                  setClipboard({ mode: "copy", paths: targets() });
                  setMenu(null);
                  UI.pop();
                }}
              >
                📄 Copiar
              </button>
              <button
                className="context-menu__item"
                onClick={() => {
                  setClipboard({ mode: "cut", paths: targets() });
                  setMenu(null);
                  UI.pop();
                }}
              >
                ✂️ Cortar
              </button>
              {!menu.item.isDir && clipboard && (
                <button
                  className="context-menu__item"
                  onClick={() => {
                    const paths = clipboard.paths;
                    void guard(
                      () =>
                        clipboard.mode === "copy"
                          ? api.copyPaths(server.id, paths, path)
                          : api.movePaths(server.id, paths, path),
                      "Colado.",
                    );
                    if (clipboard.mode === "cut") setClipboard(null);
                    setMenu(null);
                  }}
                >
                  📋 Colar
                </button>
              )}
              {menu.item.isDir && clipboard && (
                <button
                  className="context-menu__item"
                  onClick={() => {
                    const paths = clipboard.paths;
                    void guard(
                      () =>
                        clipboard.mode === "copy"
                          ? api.copyPaths(server.id, paths, menu.item!.path)
                          : api.movePaths(server.id, paths, menu.item!.path),
                      "Colado.",
                    );
                    if (clipboard.mode === "cut") setClipboard(null);
                    setMenu(null);
                  }}
                >
                  📋 Colar em {menu.item.name}
                </button>
              )}
              <button
                className="context-menu__item context-menu__item--danger"
                onClick={() => {
                  const paths = targets();
                  if (!confirm(`Apagar ${paths.length} item(ns)? Isso não volta atrás.`)) return;
                  void guard(() => api.deletePaths(server.id, paths), "Apagado.");
                  setMenu(null);
                }}
              >
                🗑 Deletar
              </button>
            </>
          )}
        </div>
      )}

      {crumbs.length > 0 && (
        <div className="files-crumbs">
          <button className="context-menu__item" onClick={() => setPath("")}>
            raiz
          </button>
          {crumbs.map((c, i) => (
            <button
              key={i}
              className="context-menu__item"
              onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* ---------------- modais ---------------- */}
      <Modal
        open={renaming !== null}
        title="Renomear"
        confirmLabel="Renomear"
        onClose={() => setRenaming(null)}
        onConfirm={() => {
          const target = renaming!;
          void guard(() => api.renamePath(server.id, target, newName.trim()), "Renomeado.");
          setRenaming(null);
        }}
      >
        <input
          className="mc-input"
          value={newName}
          autoFocus
          onChange={(e) => setNewName(e.target.value)}
        />
      </Modal>

      <Modal
        open={creating !== null}
        title={creating === "folder" ? "Nova pasta" : "Novo arquivo"}
        confirmLabel="Criar"
        onClose={() => setCreating(null)}
        onConfirm={() => {
          const name = newName.trim();
          if (!name) return;
          const full = path ? `${path}/${name}` : name;
          void guard(
            () => (creating === "folder" ? api.createFolder(server.id, full) : api.createFile(server.id, full)),
            "Criado.",
          );
          setCreating(null);
        }}
      >
        <input
          className="mc-input"
          placeholder={creating === "folder" ? "nome-da-pasta" : "nome.txt"}
          value={newName}
          autoFocus
          onChange={(e) => setNewName(e.target.value)}
        />
      </Modal>

      <Modal
        open={editing !== null}
        title={editing?.path ?? ""}
        width={860}
        cancelLabel="Fechar"
        confirmLabel="Salvar"
        onClose={() => setEditing(null)}
        onConfirm={() => {
          const target = editing!;
          void guard(() => api.writeTextFile(server.id, target.path, target.content), "Salvo.");
          setEditing(null);
        }}
      >
        <TextArea
          value={editing?.content ?? ""}
          onChange={(content) => setEditing((prev) => (prev ? { ...prev, content } : prev))}
          rows={20}
        />
      </Modal>

      {busy && (
        <div className="files-busy">
          <McText scale={1.4} className="mc-pulse">trabalhando...</McText>
        </div>
      )}
    </div>
  );
}

function archiveIcon(item: FileItem): string {
  if (item.isArchive) return "🗜";
  const name = item.name.toLowerCase();
  if (name.endsWith(".jar")) return "☕";
  if (name.endsWith(".json") || name.endsWith(".yml") || name.endsWith(".properties")) return "⚙️";
  if (name.endsWith(".png") || name.endsWith(".jpg")) return "🖼";
  return "📄";
}
