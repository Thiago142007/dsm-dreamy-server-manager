/**
 * Tela de configuração inicial do servidor.
 *
 * Tudo centralizado, como no menu "Criar novo mundo" do jogo: logo (opcional),
 * nome, software e versão. O botão de criar só libera quando tem nome,
 * software e versão.
 */
import { useEffect, useMemo, useState } from "react";
import { api, type SoftwareInfo, type VersionOption } from "../lib/bridge";
import { McButton } from "../components/McButton";
import { McText } from "../components/McText";
import { Field, Select, TextField, Toggle } from "../components/Fields";
import { IconUpload } from "../components/IconUpload";
import { useToast } from "../components/Toast";
import { mcVersionOf } from "../lib/format";
import { UI } from "../theme/sound";
import { TEX } from "../theme/assets";

export function CreateServerScreen({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: () => void;
}) {
  const [softwareList, setSoftwareList] = useState<SoftwareInfo[]>([]);
  const [software, setSoftware] = useState("");
  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [version, setVersion] = useState("");
  const [name, setName] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [iconPath, setIconPath] = useState<string | null>(null);
  const [ram, setRam] = useState(2048);
  const [eula, setEula] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { notify } = useToast();

  useEffect(() => {
    api
      .listSoftware()
      .then(setSoftwareList)
      .catch((e) => notify((e as Error).message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // versões: busca sempre que o software muda
  useEffect(() => {
    if (!software) {
      setVersions([]);
      setVersion("");
      return;
    }
    let alive = true;
    setLoadingVersions(true);
    setError(null);
    api
      .versions(software)
      .then((list) => {
        if (!alive) return;
        setVersions(list);
        setVersion(list[0]?.version ?? "");
      })
      .catch((e: Error) => {
        if (!alive) return;
        setVersions([]);
        setError(e.message);
      })
      .finally(() => {
        if (alive) setLoadingVersions(false);
      });
    return () => {
      alive = false;
    };
  }, [software]);

  const ready = name.trim().length > 0 && software.length > 0 && version.length > 0;
  const planNote = useMemo(() => software, [software]);

  const create = async () => {
    if (!ready) return;
    setCreating(true);
    try {
      const server = await api.createServer({
        name: name.trim(),
        software,
        version,
        motdLine1: line1.trim() || `${software} ${version}`,
        motdLine2: line2.trim() || "Servidor criado no DSM",
        ramMb: ram,
        eulaAccepted: eula,
        iconPath: iconPath ?? undefined,
      });
      notify(`"${server.name}" criado. Baixando os arquivos...`, "success");
      onCreated();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setCreating(false);
    }
  };

  const softwareOptions = softwareList.map((s) => ({ value: s.id, label: s.name }));
  const versionOptions = versions.map((v) => ({
    value: v.version,
    label: v.note ? `${v.version} — ${v.note}` : v.version,
  }));

  return (
    <div className="mc-app">
      <div className="mc-tile-bg" />
      <div className="create-screen">
        <header className="create-screen__header">
          <McButton size="small" onClick={onBack}>
            ← Voltar
          </McButton>
          <h1 className="mc-title">Criar novo servidor</h1>
          <span className="mc-hint">Tudo é opcional, exceto o nome e a versão.</span>
        </header>

        <div className="create-screen__body mc-scroll">
          <div className="create-screen__stack">
            <IconUpload current={null} onPick={setIconPath} />

            <TextField
              label="Nome do servidor"
              value={name}
              onChange={setName}
              placeholder="Meu servidor"
              maxLength={40}
              autoFocus
            />

            <Select
              label="Software"
              placeholder="Escolha o software..."
              value={software}
              onChange={(v) => {
                setSoftware(v);
                UI.pop();
              }}
              options={softwareOptions}
              hint={
                softwareList.find((s) => s.id === software)?.description ??
                "Cada software tem um propósito: Paper é o mais rápido, Fabric/Quilt rodam mods, BungeeCord e Velocity são proxies."
              }
            />

            {software && (
              <Select
                label="Versão"
                value={version}
                onChange={setVersion}
                options={versionOptions}
                disabled={loadingVersions || versionOptions.length === 0}
                placeholder={loadingVersions ? "Carregando versões..." : "Nenhuma versão encontrada"}
                hint={
                  versions.length > 0
                    ? `${versions.length} versões disponíveis para este software.`
                    : undefined
                }
              />
            )}

            {error && (
              <div className="create-screen__error">
                <McText scale={1} className="mc-text-red">
                  {error}
                </McText>
              </div>
            )}

            <Field
              label="Descrição (opcional)"
              hint="Duas linhas, como aparecem na lista de servidores do Minecraft. Pode mudar depois, com editor completo."
            >
              <div className="mc-stack mc-stack--tight">
                <input
                  className="mc-input"
                  value={line1}
                  maxLength={120}
                  placeholder="Linha 1 (ex.: Survival com os amigos)"
                  onChange={(e) => setLine1(e.target.value)}
                />
                <input
                  className="mc-input"
                  value={line2}
                  maxLength={120}
                  placeholder="Linha 2 (ex.: 1.21.4 — bem-vindo!)"
                  onChange={(e) => setLine2(e.target.value)}
                />
              </div>
            </Field>

            <Select
              label="Memória máxima (RAM)"
              value={ram}
              onChange={setRam}
              options={[
                { value: 1024, label: "1 GB — até 4 amigos" },
                { value: 2048, label: "2 GB — ideal para começar" },
                { value: 4096, label: "4 GB — até 20 amigos" },
                { value: 6144, label: "6 GB — mods leves" },
                { value: 8192, label: "8 GB — modpack" },
                { value: 12288, label: "12 GB — modpack pesado" },
              ]}
              hint="Dá para mudar depois na aba Inicialização. Use no máximo metade da RAM do seu computador."
            />

            <Toggle
              label="Aceito o EULA da Mojang"
              checked={eula}
              onChange={setEula}
              hint="Necessário para ligar servidores oficiais (Vanilla, Paper, Fabric, Spigot...). Leia em minecraft.net/eula."
            />

            <McText scale={1} className="mc-hint">
              {planNote ? "Ao criar, o app baixa o Java e os arquivos do servidor." : ""}
            </McText>
          </div>
        </div>

        <footer className="create-screen__footer">
          <span className="mc-hint">
            {ready
              ? `Pronto: ${name.trim()} · ${software} ${version ? mcVersionOf(version) : ""}`
              : "Preencha o nome, o software e a versão."}
          </span>
          <McButton
            variant="primary"
            size="large"
            disabled={!ready || creating}
            onClick={create}
            wide
          >
            {creating ? "Criando..." : "Criar Servidor"}
          </McButton>
        </footer>
      </div>
      <img src={TEX.serverSelection} alt="" className="mc-hidden" />
    </div>
  );
}
