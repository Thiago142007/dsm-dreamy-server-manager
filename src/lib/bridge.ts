/**
 * Ponte tipada com o backend Rust.
 *
 * Todos os nomes de comando e campos correspondem ao que está em
 * src-tauri/src/commands/. Erros chegam como string (CommandError é serializado
 * assim), então `invoke` devolve uma exceção com a mensagem legível.
 */
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export type ServerStatus = "offline" | "starting" | "online" | "stopping";

export interface Motd {
  line1: string;
  line2: string;
}

export interface ServerEntry {
  id: string;
  name: string;
  software: string;
  version: string;
  icon: string | null;
  motd: Motd;
  javaMajor: number;
  ramMb: number;
  jar: string;
  port: number;
  createdAt: string;
  modpack: string | null;
  eulaAccepted: boolean;
}

export interface SoftwareInfo {
  id: string;
  name: string;
  kind: string;
  plugins: boolean;
  mods: boolean;
  datapacks: boolean;
  properties: boolean;
  proxy: boolean;
  description: string;
}

export interface VersionOption {
  version: string;
  stable: boolean;
  note: string | null;
}

export interface PropertyEntry {
  key: string;
  value: string;
  comment: string | null;
  known: boolean;
}

export interface FileItem {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  sizeHuman: string;
  modified: string;
  isArchive: boolean;
}

export interface BackupItem {
  fileName: string;
  size: number;
  sizeHuman: string;
  created: string;
  kind: string;
}

export interface WorldItem {
  name: string;
  path: string;
  size: number;
  sizeHuman: string;
  active: boolean;
}

export interface LogItem {
  fileName: string;
  path: string;
  size: number;
  sizeHuman: string;
  modified: string;
}

export interface LogLine {
  id: number;
  ts: string;
  stream: string;
  line: string;
}

export interface ProgressEvent {
  serverId: string;
  stage: string;
  message: string;
  percent: number | null;
}

export interface CreateServerInput {
  name: string;
  software: string;
  version: string;
  motdLine1?: string;
  motdLine2?: string;
  iconPath?: string;
  ramMb?: number;
  port?: number;
  eulaAccepted: boolean;
  javaMajor?: number;
  modpack?: string;
}

export interface PlayerRef {
  uuid: string;
  name: string;
}

export interface OnlinePlayer {
  uuid: string;
  name: string;
  lastSeen: string;
  health: number;
  food: number;
}

export interface ItemStack {
  slot: number;
  id: string;
  count: number;
  displayName: string | null;
  damage: number;
  lore: string | null;
  nbtPresent: boolean;
  maxStack: number;
  nbtJson: string;
}

export interface PlayerSnapshot {
  uuid: string;
  name: string;
  health: number;
  food: number;
  saturation: number;
  xpLevel: number;
  xpProgress: number;
  gameMode: string;
  inventory: ItemStack[];
  enderChest: ItemStack[];
  armor: ItemStack[];
  offhand: ItemStack | null;
  serverOnline: boolean;
}

export interface ScheduledTask {
  id: string;
  serverId: string;
  name: string;
  cron: string;
  action: string;
  payload: string;
  enabled: boolean;
  lastRun: string | null;
}

export interface Tabs {
  plugins: boolean;
  mods: boolean;
  datapacks: boolean;
  properties: boolean;
}

/** Chama um comando do backend. */
export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (e) {
    const message = typeof e === "string" ? e : (e as Error)?.message ?? String(e);
    throw new Error(message);
  }
}

export const api = {
  // utilidades
  ping: () => call<string>("ping", {}),
  appPaths: () => call<Record<string, string>>("app_paths", {}),
  serverPath: (id: string) => call<string>("server_path", { serverId: id }),
  javaStatus: () =>
    call<{ major: number; installed: boolean; path: string | null }[]>("java_status", {}),
  ensureJava: (major: number) => call<string>("ensure_java", { major }),

  // servidores
  listServers: () => call<ServerEntry[]>("list_servers", {}),
  getServer: (id: string) => call<ServerEntry>("get_server", { serverId: id }),
  createServer: (input: CreateServerInput) => call<ServerEntry>("create_server", { input }),
  updateServer: (id: string, patch: Record<string, unknown>) =>
    call<ServerEntry>("update_server", { serverId: id, patch }),
  deleteServer: (id: string, wipeFolder: boolean) =>
    call<void>("delete_server", { serverId: id, wipeFolder }),
  setServerMotd: (id: string, motd: Motd) =>
    call<ServerEntry>("set_server_motd", { serverId: id, motd }),
  setServerIcon: (id: string, sourcePath: string) =>
    call<ServerEntry>("set_server_icon", { serverId: id, sourcePath }),
  getServerIcon: (id: string) => call<string | null>("get_server_icon", { serverId: id }),

  // conteúdo (plugins, mods, datapacks)
  searchContent: (input: {
    serverId: string;
    kind: "plugins" | "mods" | "datapacks";
    provider: string;
    query: string;
    page: number;
    limit: number;
    curseForgeKey?: string;
  }) =>
    call<ContentSearchResult>("search_content", {
      input: {
        serverId: input.serverId,
        kind: input.kind,
        provider: input.provider,
        query: input.query,
        page: input.page,
        limit: input.limit,
        curseForgeKey: input.curseForgeKey ?? null,
      },
    }),
  installContent: (input: {
    serverId: string;
    kind: "plugins" | "mods" | "datapacks";
    provider: string;
    projectId: string;
    version?: string | null;
    curseForgeKey?: string;
  }) =>
    call<string>("install_content", {
      input: {
        serverId: input.serverId,
        kind: input.kind,
        provider: input.provider,
        projectId: input.projectId,
        version: input.version ?? null,
        curseForgeKey: input.curseForgeKey ?? null,
      },
    }),
  installedContent: (id: string, kind: "plugins" | "mods" | "datapacks") =>
    call<string[]>("installed_content", { serverId: id, kind }),

  // catálogo
  listSoftware: () => call<SoftwareInfo[]>("list_software", {}),
  versions: (softwareId: string) => call<VersionOption[]>("versions", { softwareId }),
  installPlan: (softwareId: string, version: string) =>
    call<InstallPlan>("install_plan", { softwareId, version }),
  tabsFor: (id: string) => call<Tabs>("tabs_for", { serverId: id }),
  changeSoftware: (id: string, softwareId: string, version: string, wipe: boolean) =>
    call<ServerEntry>("change_software", { serverId: id, softwareId, version, wipe }),
  clearVersionCache: (softwareId?: string) =>
    call<void>("clear_version_cache", { softwareId: softwareId ?? null }),

  // ciclo de vida
  startServer: (id: string) => call<ServerStatus>("start_server", { serverId: id }),
  stopServer: (id: string) => call<void>("stop_server", { serverId: id }),
  restartServer: (id: string) => call<void>("restart_server", { serverId: id }),
  forceStopServer: (id: string) => call<void>("force_stop_server", { serverId: id }),
  sendConsole: (id: string, command: string) =>
    call<void>("send_console", { serverId: id, command }),
  consoleHistory: (id: string) => call<LogLine[]>("console_history", { serverId: id }),
  serverStatus: (id: string) => call<ServerStatus>("server_status", { serverId: id }),
  startupCommand: (id: string) =>
    call<{ command: string; jar: string; jarPath: string; unixArgs: boolean; running: boolean }>(
      "startup_command",
      { serverId: id },
    ),
  setRam: (id: string, ramMb: number) => call<ServerEntry>("set_ram", { serverId: id, ramMb }),
  setJavaMajor: (id: string, major: number) =>
    call<ServerEntry>("set_java_major", { serverId: id, major }),
  setJarName: (id: string, jar: string) => call<ServerEntry>("set_jar_name", { serverId: id, jar }),

  // propriedades
  readProperties: (id: string) => call<PropertyEntry[]>("read_properties", { serverId: id }),
  setProperty: (id: string, key: string, value: string) =>
    call<PropertyEntry[]>("set_property", { serverId: id, key, value }),
  setProperties: (id: string, changes: [string, string][]) =>
    call<PropertyEntry[]>("set_properties", { serverId: id, changes }),
  removeProperty: (id: string, key: string) =>
    call<PropertyEntry[]>("remove_property", { serverId: id, key }),
  propertiesPath: (id: string) => call<string>("properties_path", { serverId: id }),

  // arquivos
  listFiles: (id: string, path: string) => call<FileItem[]>("list_files", { serverId: id, path }),
  readTextFile: (id: string, path: string) =>
    call<string>("read_text_file", { serverId: id, path }),
  writeTextFile: (id: string, path: string, content: string) =>
    call<void>("write_text_file", { serverId: id, path, content }),
  createFolder: (id: string, path: string) => call<void>("create_folder", { serverId: id, path }),
  createFile: (id: string, path: string) => call<void>("create_file", { serverId: id, path }),
  renamePath: (id: string, path: string, newName: string) =>
    call<void>("rename_path", { serverId: id, path, newName }),
  deletePaths: (id: string, paths: string[]) =>
    call<void>("delete_paths", { serverId: id, paths }),
  copyPaths: (id: string, paths: string[], dest: string) =>
    call<void>("copy_paths", { serverId: id, paths, dest }),
  movePaths: (id: string, paths: string[], dest: string) =>
    call<void>("move_paths", { serverId: id, paths, dest }),
  compressPaths: (id: string, paths: string[], outputName: string) =>
    call<string>("compress_paths", { serverId: id, paths, outputName }),
  extractArchive: (id: string, path: string, dest: string) =>
    call<number>("extract_archive", { serverId: id, path, dest }),
  downloadPaths: (id: string, paths: string[]) =>
    call<string[]>("download_paths", { serverId: id, paths }),
  pathExists: (id: string, path: string) => call<boolean>("path_exists", { serverId: id, path }),

  // players
  listOnlinePlayers: (id: string) => call<OnlinePlayer[]>("list_online_players", { serverId: id }),
  resolvePlayerName: (id: string, uuid: string) =>
    call<string>("resolve_player_name", { serverId: id, uuid }),
  listWhitelist: (id: string) => call<PlayerRef[]>("list_whitelist", { serverId: id }),
  addToWhitelist: (id: string, name: string) =>
    call<PlayerRef>("add_to_whitelist", { serverId: id, name }),
  removeFromWhitelist: (id: string, uuid: string) =>
    call<void>("remove_from_whitelist", { serverId: id, uuid }),
  listOps: (id: string) =>
    call<{ uuid: string; name: string; level: number; bypassesPlayerLimit: boolean }[]>(
      "list_ops",
      { serverId: id },
    ),
  addOp: (id: string, name: string, level: number) =>
    call<{ uuid: string; name: string; level: number }>("add_op", { serverId: id, name, level }),
  removeOp: (id: string, uuid: string) => call<void>("remove_op", { serverId: id, uuid }),
  listBannedPlayers: (id: string) =>
    call<{ uuid: string; name: string; reason: string; expires: string }[]>(
      "list_banned_players",
      { serverId: id },
    ),
  banPlayerNick: (id: string, name: string, reason: string) =>
    call<void>("ban_player_nick", { serverId: id, name, reason }),
  banPlayerIp: (id: string, name: string, reason: string) =>
    call<void>("ban_player_ip", { serverId: id, name, reason }),
  unbanPlayer: (id: string, uuid: string) =>
    call<void>("unban_player", { serverId: id, uuid }),
  listBannedIps: (id: string) =>
    call<{ ip: string; uuid: string | null; name: string; reason: string }[]>(
      "list_banned_ips",
      { serverId: id },
    ),
  banIp: (id: string, ip: string, reason: string) =>
    call<void>("ban_ip", { serverId: id, ip, reason }),
  unbanIp: (id: string, ip: string) => call<void>("unban_ip", { serverId: id, ip }),
  getPlayerSnapshot: (id: string, uuid: string) =>
    call<PlayerSnapshot>("get_player_snapshot", { serverId: id, uuid }),
  setPlayerHealth: (id: string, uuid: string, value: number) =>
    call<void>("set_player_health", { serverId: id, uuid, value }),
  setPlayerFood: (id: string, uuid: string, value: number) =>
    call<void>("set_player_food", { serverId: id, uuid, value }),
  moveItem: (id: string, uuid: string, fromSlot: number, toSlot: number, container: string, toContainer?: string) =>
    call<void>("move_item", {
      serverId: id,
      uuid,
      fromSlot,
      toSlot,
      container,
      toContainer: toContainer ?? null,
    }),
  setItemCount: (id: string, uuid: string, slot: number, container: string, count: number) =>
    call<void>("set_item_count", { serverId: id, uuid, slot, container, count }),
  removeItem: (id: string, uuid: string, slot: number, container: string) =>
    call<void>("remove_item", { serverId: id, uuid, slot, container }),
  giveItem: (id: string, uuid: string, itemId: string, count: number) =>
    call<ItemStack>("give_item", { serverId: id, uuid, itemId, count }),
  killPlayer: (id: string, nameOrUuid: string) =>
    call<void>("kill_player", { serverId: id, nameOrUuid }),
  kitPlayer: (id: string, uuid: string, kitId: string) =>
    call<number>("kit_player", { serverId: id, uuid, kitId }),
  listKits: () =>
    call<{ id: string; name: string; description: string; items: number }[]>("list_kits", {}),

  // mundos
  listWorlds: (id: string) => call<WorldItem[]>("list_worlds", { serverId: id }),
  regenerateWorld: (id: string, name: string) =>
    call<void>("regenerate_world", { serverId: id, name }),
  worldFiles: (id: string, name: string) => call<FileItem[]>("world_files", { serverId: id, name }),
  uploadWorld: (id: string, sourceAbsolutePath: string) =>
    call<string>("upload_world", { serverId: id, sourceAbsolutePath }),

  // backups
  listBackups: (id: string) => call<BackupItem[]>("list_backups", { serverId: id }),
  createBackup: (id: string) => call<BackupItem>("create_backup", { serverId: id }),
  restoreBackup: (id: string, fileName: string) =>
    call<void>("restore_backup", { serverId: id, fileName }),
  copyBackup: (id: string, fileName: string) =>
    call<BackupItem>("copy_backup", { serverId: id, fileName }),
  moveBackup: (id: string, fileName: string, targetServerId: string) =>
    call<BackupItem>("move_backup", { serverId: id, fileName, targetServerId }),
  deleteBackup: (id: string, fileName: string) =>
    call<void>("delete_backup", { serverId: id, fileName }),
  backupSize: (id: string) => call<number>("backup_size", { serverId: id }),

  // logs
  listLogs: (id: string) => call<LogItem[]>("list_logs", { serverId: id }),
  readLog: (id: string, fileName: string) => call<string>("read_log", { serverId: id, fileName }),
  copyLog: (id: string, fileName: string) => call<string>("copy_log", { serverId: id, fileName }),
  deleteLog: (id: string, fileName: string) => call<void>("delete_log", { serverId: id, fileName }),

  // agendamento
  listTasks: (id: string) => call<ScheduledTask[]>("list_tasks", { serverId: id }),
  createTask: (id: string, name: string, cron: string, action: string, payload: string) =>
    call<ScheduledTask>("create_task", {
      serverId: id,
      name,
      cronExpression: cron,
      action,
      payload,
    }),
  updateTask: (taskId: string, patch: Record<string, unknown>) =>
    call<ScheduledTask>("update_task", { taskId, ...patch }),
  deleteTask: (taskId: string) => call<void>("delete_task", { taskId }),
  runTaskNow: (taskId: string) => call<void>("run_task_now", { taskId }),
  cronPreview: (cron: string, limit?: number) =>
    call<string[]>("cron_preview", { cronExpression: cron, limit }),
};

export interface InstallPlan {
  type: "jar" | "forgeInstaller" | "modLoader" | "buildTools" | "extract" | "unavailable";
  note: string;
}

export interface ContentSearchResult {
  items: {
    id: string;
    slug: string;
    title: string;
    description: string;
    author: string;
    downloads: number;
    iconUrl: string | null;
    versions: string[];
    installed: string | null;
  }[];
  total: number;
  provider: string;
}
