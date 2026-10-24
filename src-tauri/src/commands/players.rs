//! Comandos de jogadores para servidores Java.
//!
//! O painel lê os dados do mundo direto do disco (`world/playerdata/*.dat`,
//! `whitelist.json`, `ops.json`, `banned-players.json`, `banned-ips.json`) e,
//! quando o servidor está no ar, também conversa com o console via `ProcessHub`.
//!
//! O diferencial deste módulo é o inventário em tempo real: ele contém um
//! parser/escritor de NBT binário próprio (nenhum crate de NBT é usado) para
//! ler e regravar `playerdata/<uuid>.dat` preservando todos os campos
//! originais do jogador.
//!
//! ## Limitações reais (leia antes de confiar cegamente)
//!
//! * **Jogadores "online"**: a forma 100% correta de saber quem está conectado
//!   é rodar `hub.send("list")` e parsear a resposta do console. Como essa
//!   resposta é assíncrona (não temos um mecanismo de request/response no
//!   `ProcessHub`, que só tem `send`), usamos uma heurística pragmática e
//!   honesta: um jogador é considerado online se o arquivo
//!   `world/playerdata/<uuid>.dat` foi modificado nos últimos 15 minutos —
//!   que é justamente o que o servidor faz ao salvar o mundo enquanto alguém
//!   está logado. O resultado é aproximado (inclui quem saiu nos últimos
//!   minutos e exclui quem está AFK em um mundo com autosave desligado).
//! * **Escrita no playerdata com o servidor ligado**: o servidor mantém os
//!   dados do jogador em memória e só escreve no disco no save. Se você editar
//!   o `.dat` com o servidor rodando, a próxima gravação do servidor
//!   **sobrescreve** sua alteração. Por isso os comandos de edição de
//!   inventário/envio de itens priorizam comandos de console (`/give`) quando
//!   o servidor está online, e a edição de NBT só é feita quando está offline.
//! * **Ban por IP offline**: sem o servidor rodando não dá para descobrir o IP
//!   de um jogador (não existe histórico de IP em disco). Nesse caso gravamos
//!   um registro em `banned-ips.json` com IP placeholder `0.0.0.0`, que o
//!   servidor ignora; use o banimento por IP com o servidor ligado.
//! * **Vida/fome**: ajustar vida por comando usa `/damage` (tirar) e
//!   `/effect give instant_health` (curar), que são aproximações — o jogo
//!   aplica resistência/absorção e arredondamentos. Com o servidor offline
//!   regravamos `Health`/`foodLevel` direto no NBT, que é exato.
//! * **`max_stack`**: é uma aproximação por lista de exceções + presença do
//!   componente de dano. Itens de mods podem fugir da regra.
//! * **UUID offline**: quando o servidor está em modo offline, o UUID do
//!   jogador é derivado do nome (`OfflinePlayer:<nome>` via MD5). Já
//!   implementamos esse algoritmo, mas o UUID "de verdade" (modo online) só
//!   existe depois de o jogador entrar — nesse caso ele vem do `usercache.json`.
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

use crate::error::{err, CommandError, CommandResult};
use crate::util;

// ---------------------------------------------------------------------------
// Modelos expostos ao frontend
// ---------------------------------------------------------------------------

/// Jogador detectado no servidor (heurística de playerdata recente).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OnlinePlayer {
    pub uuid: String,
    pub name: String,
    /// ISO local do último save — usado pelo frontend para mostrar "há X min".
    pub last_seen: String,
    pub health: f32,
    pub food: i32,
}

/// Referência simples a um jogador (whitelist, ops).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlayerRef {
    pub uuid: String,
    pub name: String,
}

/// Entrada de `ops.json`.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct OpEntry {
    pub uuid: String,
    pub name: String,
    /// 1..4 — permission level do operador.
    pub level: i32,
    pub bypasses_player_limit: bool,
}

/// Entrada de `banned-players.json`.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BannedPlayer {
    pub uuid: String,
    pub name: String,
    pub created: String,
    pub source: String,
    /// "forever" ou data ISO.
    pub expires: String,
    pub reason: String,
}

/// Entrada de `banned-ips.json`.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BannedIp {
    pub ip: String,
    /// pode ser null em bans de IP feitos pelo console.
    pub uuid: Option<String>,
    pub name: Option<String>,
    pub created: String,
    pub source: String,
    pub expires: String,
    pub reason: String,
}

/// Resultado de um banimento — o frontend usa para saber o que foi banido.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BanResult {
    /// "nick" ou "ip".
    pub kind: String,
    /// o que foi banido (nome ou IP).
    pub target: String,
}

/// Um item dentro de um container do jogador.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ItemStack {
    /// slot dentro do container (ver `PlayerSnapshot` para o significado).
    pub slot: i32,
    pub id: String,
    pub count: i32,
    pub display_name: Option<String>,
    pub damage: i32,
    /// primeira linha de lore (as demais vão em `nbt_json`).
    pub lore: Option<String>,
    /// true quando o item tem `tag`/`components` (encantamentos, nome, etc).
    pub nbt_present: bool,
    pub max_stack: i32,
    /// compound NBT do item serializado em JSON (debug e reescrita).
    pub nbt_json: String,
}

/// Foto completa do jogador lida do `playerdata`.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub uuid: String,
    pub name: String,
    pub health: f32,
    pub food: i32,
    pub saturation: f32,
    pub xp_level: i32,
    /// 0.0 .. 1.0 — progresso dentro do nível.
    pub xp_progress: f32,
    /// "survival" | "creative" | "adventure" | "spectator".
    pub game_mode: String,
    /// slots 0..8 = hotbar, 9..35 = inventário principal, -106/40 = mão esquerda
    /// (quando o servidor guarda a offhand dentro da lista).
    pub inventory: Vec<ItemStack>,
    /// slots 0..26 do baú do fim.
    pub ender_chest: Vec<ItemStack>,
    /// **ordem do Minecraft Java: [botas, calças, peitoral, capacete]**.
    pub armor: Vec<ItemStack>,
    pub offhand: Option<ItemStack>,
    pub server_online: bool,
}

/// Kit pré-definido oferecido pelo painel.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct KitInfo {
    pub id: String,
    pub label: String,
    pub description: String,
    pub items: usize,
}

/// Item de um kit: id, quantidade e encantamentos simples (`nome`, nível).
struct KitItem {
    id: &'static str,
    count: i32,
    enchant: &'static [(&'static str, i32)],
}

struct KitDef {
    id: &'static str,
    label: &'static str,
    description: &'static str,
    items: &'static [KitItem],
}

/// Kits fixos, definidos em Rust (o frontend só escolhe o id).
const KITS: &[KitDef] = &[
    KitDef {
        id: "starter",
        label: "Kit Iniciante",
        description: "Espada, picareta e machado de ferro, comida e tochas.",
        items: &[
            KitItem { id: "minecraft:iron_sword", count: 1, enchant: &[("minecraft:sharpness", 1)] },
            KitItem { id: "minecraft:iron_pickaxe", count: 1, enchant: &[("minecraft:efficiency", 1)] },
            KitItem { id: "minecraft:iron_axe", count: 1, enchant: &[] },
            KitItem { id: "minecraft:bread", count: 64, enchant: &[] },
            KitItem { id: "minecraft:torch", count: 64, enchant: &[] },
        ],
    },
    KitDef {
        id: "pvp",
        label: "Kit PvP",
        description: "Armadura de diamante com proteção, espada e maçãs douradas.",
        items: &[
            KitItem { id: "minecraft:diamond_helmet", count: 1, enchant: &[("minecraft:protection", 2)] },
            KitItem { id: "minecraft:diamond_chestplate", count: 1, enchant: &[("minecraft:protection", 2)] },
            KitItem { id: "minecraft:diamond_leggings", count: 1, enchant: &[("minecraft:protection", 2)] },
            KitItem { id: "minecraft:diamond_boots", count: 1, enchant: &[("minecraft:protection", 2)] },
            KitItem { id: "minecraft:diamond_sword", count: 1, enchant: &[("minecraft:sharpness", 3)] },
            KitItem { id: "minecraft:golden_apple", count: 8, enchant: &[] },
        ],
    },
    KitDef {
        id: "builder",
        label: "Kit Construtor",
        description: "Blocos variados e ferramentas de construção.",
        items: &[
            KitItem { id: "minecraft:diamond_pickaxe", count: 1, enchant: &[("minecraft:efficiency", 3)] },
            KitItem { id: "minecraft:diamond_shovel", count: 1, enchant: &[] },
            KitItem { id: "minecraft:oak_planks", count: 64, enchant: &[] },
            KitItem { id: "minecraft:cobblestone", count: 64, enchant: &[] },
            KitItem { id: "minecraft:glass", count: 64, enchant: &[] },
            KitItem { id: "minecraft:torch", count: 64, enchant: &[] },
        ],
    },
];

// ---------------------------------------------------------------------------
// NBT binário (implementação própria, sem crate externo)
// ---------------------------------------------------------------------------

/// Uma tag NBT já lida.
///
/// `List` guarda o tipo do conteúdo porque o formato NBT o declara antes dos
/// itens: uma lista vazia precisa saber se é de Ints, de Compounds etc.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Tag {
    End,
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(f32),
    Double(f64),
    ByteArray(Vec<u8>),
    String(String),
    List(ListTag),
    Compound(Vec<(String, Tag)>),
    IntArray(Vec<i32>),
    LongArray(Vec<i64>),
}

/// Lista NBT: tipo do conteúdo + itens.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ListTag {
    pub kind: u8,
    pub items: Vec<Tag>,
}

impl ListTag {
    fn new(kind: u8) -> Self {
        Self { kind, items: Vec::new() }
    }
}

impl Tag {
    /// Tipo NBT desta tag (0 = End).
    pub(crate) fn kind(&self) -> u8 {
        match self {
            Tag::End => 0,
            Tag::Byte(_) => 1,
            Tag::Short(_) => 2,
            Tag::Int(_) => 3,
            Tag::Long(_) => 4,
            Tag::Float(_) => 5,
            Tag::Double(_) => 6,
            Tag::ByteArray(_) => 7,
            Tag::String(_) => 8,
            Tag::List(_) => 9,
            Tag::Compound(_) => 10,
            Tag::IntArray(_) => 11,
            Tag::LongArray(_) => 12,
        }
    }

    fn compound(&self) -> Option<&Vec<(String, Tag)>> {
        match self {
            Tag::Compound(m) => Some(m),
            _ => None,
        }
    }

    fn compound_mut(&mut self) -> Option<&mut Vec<(String, Tag)>> {
        match self {
            Tag::Compound(m) => Some(m),
            _ => None,
        }
    }

    /// Campo de um compound (None se não for compound ou não existir).
    pub(crate) fn get(&self, key: &str) -> Option<&Tag> {
        self.compound().and_then(|m| m.iter().find(|(k, _)| k == key).map(|(_, v)| v))
    }

    /// Campo de um compound, versão mutável.
    fn get_mut(&mut self, key: &str) -> Option<&mut Tag> {
        match self {
            Tag::Compound(m) => m.iter_mut().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    /// Insere/substitui um campo, preservando a posição dos já existentes.
    fn set(&mut self, key: &str, value: Tag) {
        if let Some(m) = self.compound_mut() {
            if let Some(slot) = m.iter_mut().find(|(k, _)| k == key) {
                slot.1 = value;
            } else {
                m.push((key.to_string(), value));
            }
        }
    }

    /// Remove um campo do compound.
    fn remove(&mut self, key: &str) -> Option<Tag> {
        let m = self.compound_mut()?;
        let pos = m.iter().position(|(k, _)| k == key)?;
        Some(m.remove(pos).1)
    }

    fn as_i32(&self) -> Option<i32> {
        match self {
            Tag::Byte(v) => Some(*v as i32),
            Tag::Short(v) => Some(*v as i32),
            Tag::Int(v) => Some(*v),
            Tag::Float(v) => Some(*v as i32),
            Tag::Double(v) => Some(*v as i32),
            _ => None,
        }
    }

    fn as_f32(&self) -> Option<f32> {
        match self {
            Tag::Float(v) => Some(*v),
            Tag::Double(v) => Some(*v as f32),
            Tag::Byte(v) => Some(*v as f32),
            Tag::Short(v) => Some(*v as f32),
            Tag::Int(v) => Some(*v as f32),
            _ => None,
        }
    }

    fn as_str(&self) -> Option<&str> {
        match self {
            Tag::String(s) => Some(s.as_str()),
            _ => None,
        }
    }

    fn as_list(&self) -> Option<&ListTag> {
        match self {
            Tag::List(l) => Some(l),
            _ => None,
        }
    }

    fn as_list_mut(&mut self) -> Option<&mut ListTag> {
        match self {
            Tag::List(l) => Some(l),
            _ => None,
        }
    }
}

fn nbt_err(msg: impl Into<String>) -> CommandError {
    CommandError::Parse(msg.into())
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/// Lê um stream NBT (já descomprimido) e devolve o compound raiz.
///
/// Um `.dat` de playerdata tem sempre `TAG_Compound` na raiz com nome vazio.
/// Listas heterogêneas não podem ocorrer (o tipo é único por lista) e listas
/// vazias são aceitas — o tipo declarado simplesmente não é usado.
fn nbt_read(data: &[u8]) -> CommandResult<Tag> {
    let mut r = Reader { data, pos: 0 };
    let kind = r.u8()?;
    if kind != 10 {
        return Err(nbt_err(format!(
            "raiz NBT inesperada: tipo {kind} (esperado 10 = Compound)"
        )));
    }
    let _name = r.string()?;
    r.payload(10)
}

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn u8(&mut self) -> CommandResult<u8> {
        if self.pos >= self.data.len() {
            return Err(nbt_err("fim inesperado do arquivo NBT (u8)"));
        }
        let v = self.data[self.pos];
        self.pos += 1;
        Ok(v)
    }

    fn take(&mut self, n: usize) -> CommandResult<&'a [u8]> {
        let end = self
            .pos
            .checked_add(n)
            .ok_or_else(|| nbt_err("índice NBT estourou"))?;
        if end > self.data.len() {
            return Err(nbt_err("fim inesperado do arquivo NBT"));
        }
        let slice = &self.data[self.pos..end];
        self.pos = end;
        Ok(slice)
    }

    fn i16(&mut self) -> CommandResult<i16> {
        let b = self.take(2)?;
        Ok(i16::from_be_bytes([b[0], b[1]]))
    }

    fn i32(&mut self) -> CommandResult<i32> {
        let b = self.take(4)?;
        Ok(i32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn i64(&mut self) -> CommandResult<i64> {
        let b = self.take(8)?;
        let mut out = [0u8; 8];
        out.copy_from_slice(b);
        Ok(i64::from_be_bytes(out))
    }

    fn f32b(&mut self) -> CommandResult<f32> {
        let b = self.take(4)?;
        Ok(f32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn f64b(&mut self) -> CommandResult<f64> {
        let b = self.take(8)?;
        let mut out = [0u8; 8];
        out.copy_from_slice(b);
        Ok(f64::from_be_bytes(out))
    }

    fn string(&mut self) -> CommandResult<String> {
        let len = self.i16()? as usize;
        let raw = self.take(len)?;
        String::from_utf8(raw.to_vec()).map_err(|e| nbt_err(format!("string NBT não é UTF-8: {e}")))
    }

    /// Lê o *valor* de uma tag cujo tipo (`kind`) já foi consumido.
    fn payload(&mut self, kind: u8) -> CommandResult<Tag> {
        match kind {
            0 => Ok(Tag::End),
            1 => Ok(Tag::Byte(self.take(1)?[0] as i8)),
            2 => Ok(Tag::Short(self.i16()?)),
            3 => Ok(Tag::Int(self.i32()?)),
            4 => Ok(Tag::Long(self.i64()?)),
            5 => Ok(Tag::Float(self.f32b()?)),
            6 => Ok(Tag::Double(self.f64b()?)),
            7 => {
                let n = self.i32()?.max(0) as usize;
                Ok(Tag::ByteArray(self.take(n)?.to_vec()))
            }
            8 => Ok(Tag::String(self.string()?)),
            9 => {
                let item_kind = self.u8()?;
                let n = self.i32()?;
                if n < 0 {
                    return Err(nbt_err("lista NBT com tamanho negativo"));
                }
                let n = n as usize;
                // sanidade: uma lista nunca pode ter mais itens do que o resto
                // do arquivo tem bytes (protege contra arquivo corrompido)
                let remaining = self.data.len().saturating_sub(self.pos);
                if n > remaining + 1 {
                    return Err(nbt_err("lista NBT com tamanho impossível"));
                }
                let mut list = ListTag::new(item_kind);
                for _ in 0..n {
                    list.items.push(self.payload(item_kind)?);
                }
                Ok(Tag::List(list))
            }
            10 => {
                let mut out: Vec<(String, Tag)> = Vec::new();
                loop {
                    let k = self.u8()?;
                    if k == 0 {
                        break;
                    }
                    let name = self.string()?;
                    out.push((name, self.payload(k)?));
                }
                Ok(Tag::Compound(out))
            }
            11 => {
                let n = self.i32()?.max(0) as usize;
                let mut v = Vec::with_capacity(n.min(4096));
                for _ in 0..n {
                    v.push(self.i32()?);
                }
                Ok(Tag::IntArray(v))
            }
            12 => {
                let n = self.i32()?.max(0) as usize;
                let mut v = Vec::with_capacity(n.min(4096));
                for _ in 0..n {
                    v.push(self.i64()?);
                }
                Ok(Tag::LongArray(v))
            }
            other => Err(nbt_err(format!("tipo NBT desconhecido: {other}"))),
        }
    }
}

// ---------------------------------------------------------------------------
// Escritor
// ---------------------------------------------------------------------------

/// Serializa um compound raiz como arquivo NBT (nome vazio na raiz).
///
/// Preserva a ordem dos campos — assim o diff com o arquivo original fica
/// mínimo e o servidor não estranha o que foi regravado.
fn nbt_write(root: &Tag) -> CommandResult<Vec<u8>> {
    let mut w = Writer { out: Vec::new() };
    w.u8(10)?;
    w.string("")?;
    match root {
        Tag::Compound(m) => {
            for (name, value) in m {
                w.tag(name, value)?;
            }
        }
        _ => return Err(nbt_err("raiz NBT não é um compound")),
    }
    w.u8(0)?; // TAG_End
    Ok(w.out)
}

struct Writer {
    out: Vec<u8>,
}

impl Writer {
    fn u8(&mut self, v: u8) -> CommandResult<()> {
        self.out.push(v);
        Ok(())
    }

    fn i16(&mut self, v: i16) -> CommandResult<()> {
        self.out.extend_from_slice(&v.to_be_bytes());
        Ok(())
    }

    fn i32(&mut self, v: i32) -> CommandResult<()> {
        self.out.extend_from_slice(&v.to_be_bytes());
        Ok(())
    }

    fn i64(&mut self, v: i64) -> CommandResult<()> {
        self.out.extend_from_slice(&v.to_be_bytes());
        Ok(())
    }

    fn f32b(&mut self, v: f32) -> CommandResult<()> {
        self.out.extend_from_slice(&v.to_be_bytes());
        Ok(())
    }

    fn f64b(&mut self, v: f64) -> CommandResult<()> {
        self.out.extend_from_slice(&v.to_be_bytes());
        Ok(())
    }

    fn string(&mut self, s: &str) -> CommandResult<()> {
        let bytes = s.as_bytes();
        if bytes.len() > u16::MAX as usize {
            return Err(nbt_err("string NBT longa demais (> 65535 bytes)"));
        }
        self.i16(bytes.len() as i16)?;
        self.out.extend_from_slice(bytes);
        Ok(())
    }

    /// Escreve `nome` + tipo + valor (usado dentro de compounds).
    fn tag(&mut self, name: &str, value: &Tag) -> CommandResult<()> {
        self.string(name)?;
        self.u8(value.kind())?;
        self.payload(value)
    }

    /// Escreve só o valor (o tipo já foi emitido).
    fn payload(&mut self, value: &Tag) -> CommandResult<()> {
        match value {
            Tag::End => self.u8(0),
            Tag::Byte(v) => self.u8(*v as u8),
            Tag::Short(v) => self.i16(*v),
            Tag::Int(v) => self.i32(*v),
            Tag::Long(v) => self.i64(*v),
            Tag::Float(v) => self.f32b(*v),
            Tag::Double(v) => self.f64b(*v),
            Tag::ByteArray(v) => {
                if v.len() > i32::MAX as usize {
                    return Err(nbt_err("byte array NBT longa demais"));
                }
                self.i32(v.len() as i32)?;
                self.out.extend_from_slice(v);
                Ok(())
            }
            Tag::String(s) => self.string(s),
            Tag::List(l) => {
                self.u8(l.kind)?;
                if l.items.len() > i32::MAX as usize {
                    return Err(nbt_err("lista NBT longa demais"));
                }
                self.i32(l.items.len() as i32)?;
                for item in &l.items {
                    self.payload(item)?;
                }
                Ok(())
            }
            Tag::Compound(m) => {
                for (name, value) in m {
                    self.tag(name, value)?;
                }
                self.u8(0)
            }
            Tag::IntArray(v) => {
                if v.len() > i32::MAX as usize {
                    return Err(nbt_err("int array NBT longo demais"));
                }
                self.i32(v.len() as i32)?;
                for item in v {
                    self.i32(*item)?;
                }
                Ok(())
            }
            Tag::LongArray(v) => {
                if v.len() > i32::MAX as usize {
                    return Err(nbt_err("long array NBT longo demais"));
                }
                self.i32(v.len() as i32)?;
                for item in v {
                    self.i64(*item)?;
                }
                Ok(())
            }
        }
    }
}

// ---------------------------------------------------------------------------
// NBT <-> JSON (campo `nbt_json` dos itens)
// ---------------------------------------------------------------------------

/// Converte uma tag NBT em `serde_json::Value`.
///
/// Arrays viram listas de números e compounds viram objetos — é o formato que
/// o frontend usa para inspecionar um item.
fn tag_to_json(tag: &Tag) -> serde_json::Value {
    use serde_json::Value as J;
    match tag {
        Tag::End => J::Null,
        Tag::Byte(v) => J::from(*v as i64),
        Tag::Short(v) => J::from(*v as i64),
        Tag::Int(v) => J::from(*v),
        Tag::Long(v) => J::from(*v),
        Tag::Float(v) => J::from(*v as f64),
        Tag::Double(v) => J::from(*v),
        Tag::ByteArray(v) => J::Array(v.iter().map(|b| J::from(*b as i64)).collect()),
        Tag::String(s) => J::String(s.clone()),
        Tag::List(l) => J::Array(l.items.iter().map(tag_to_json).collect()),
        Tag::Compound(m) => {
            let mut map = serde_json::Map::new();
            for (k, v) in m {
                map.insert(k.clone(), tag_to_json(v));
            }
            J::Object(map)
        }
        Tag::IntArray(v) => J::Array(v.iter().map(|x| J::from(*x as i64)).collect()),
        Tag::LongArray(v) => J::Array(v.iter().map(|x| J::from(*x)).collect()),
    }
}

/// JSON de uma tag sempre como string (é o que vai em `nbt_json`).
fn tag_json_string(tag: &Tag) -> String {
    serde_json::to_string(&tag_to_json(tag)).unwrap_or_else(|_| "null".to_string())
}

// ---------------------------------------------------------------------------
// Leitura/escrita do playerdata
// ---------------------------------------------------------------------------

/// Lê e descomprime um `.dat` (gzip, com fallback para NBT puro).
fn read_player_dat(path: &Path) -> CommandResult<Vec<u8>> {
    let raw = fs::read(path).map_err(|e| {
        crate::error::CommandError::Io(format!("falha ao ler {}: {e}", path.display()))
    })?;
    if raw.len() >= 2 && raw[0] == 0x1f && raw[1] == 0x8b {
        let mut dec = flate2::read::GzDecoder::new(&raw[..]);
        let mut out = Vec::new();
        dec.read_to_end(&mut out).map_err(|e| {
            crate::error::CommandError::Io(format!("falha ao descomprimir {}: {e}", path.display()))
        })?;
        Ok(out)
    } else {
        Ok(raw)
    }
}

/// Lê o compound NBT completo do playerdata de um jogador.
fn load_player_nbt(path: &Path) -> CommandResult<Tag> {
    let bytes = read_player_dat(path)?;
    nbt_read(&bytes)
}

/// Grava o compound NBT de volta, **gzipado**, preservando tudo.
///
/// A gravação é atômica (arquivo temporário + rename) para nunca deixar um
/// `.dat` cortado no disco se algo falhar no meio.
fn write_player_nbt(uuid: &str, path: &Path, root: &Tag) -> CommandResult<()> {
    let plain = nbt_write(root)?;
    let tmp = path.with_extension("dsm-tmp");
    {
        let file = fs::File::create(&tmp).map_err(|e| {
            crate::error::CommandError::Io(format!("falha ao criar {}: {e}", tmp.display()))
        })?;
        let mut enc = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        enc.write_all(&plain).map_err(|e| {
            crate::error::CommandError::Io(format!("falha ao comprimir NBT: {e}"))
        })?;
        enc.finish().map_err(|e| {
            crate::error::CommandError::Io(format!("falha ao finalizar gzip: {e}"))
        })?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        crate::error::CommandError::Io(format!(
            "falha ao substituir {} ({uuid}): {e}",
            path.display()
        ))
    })
}

// ---------------------------------------------------------------------------
// Caminhos dentro da pasta do servidor
// ---------------------------------------------------------------------------

/// Lê `level-name` do server.properties (o mesmo critério do módulo `worlds`).
fn level_name(root: &Path) -> Option<String> {
    let raw = fs::read_to_string(root.join("server.properties")).ok()?;
    for line in raw.lines() {
        let line = line.trim();
        let rest = line.strip_prefix("level-name")?.trim_start();
        if let Some(value) = rest.strip_prefix('=') {
            let value = value.trim();
            if !value.is_empty() && !value.contains("..") {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// Pasta do mundo (`level-name` ou `world`).
fn world_dir(root: &Path) -> PathBuf {
    root.join(level_name(root).unwrap_or_else(|| "world".to_string()))
}

/// `world/playerdata` do servidor.
fn playerdata_dir(root: &Path) -> PathBuf {
    world_dir(root).join("playerdata")
}

/// Caminho do `.dat` de um jogador (valida que está dentro do servidor).
fn player_dat_path(root: &Path, uuid: &str) -> CommandResult<PathBuf> {
    let rel = format!(
        "{}/playerdata/{}.dat",
        level_name(root).unwrap_or_else(|| "world".to_string()),
        uuid.trim()
    );
    if uuid.contains('/') || uuid.contains('\\') || uuid.contains("..") {
        return err("uuid inválido");
    }
    util::resolve_in_server(root, &rel)
}

/// Caminho de um arquivo JSON na raiz do servidor (whitelist, ops, bans...).
fn server_json(root: &Path, name: &str) -> CommandResult<PathBuf> {
    util::resolve_in_server(root, name)
}

/// O servidor está respondendo pelo console?
fn is_online(hub: &std::sync::Arc<crate::process_mgr::ProcessHub>, server_id: &str) -> bool {
    hub.is_running(server_id)
}

/// Envia um comando de console se o servidor estiver online.
///
/// Devolve `true` quando o comando foi enviado — é assim que os comandos deste
/// módulo decidem entre "console" e "regravar o arquivo".
fn send_if_online(
    hub: &std::sync::Arc<crate::process_mgr::ProcessHub>,
    server_id: &str,
    command: &str,
) -> bool {
    if !is_online(hub, server_id) {
        return false;
    }
    match hub.send(server_id, command) {
        Ok(()) => true,
        Err(e) => {
            eprintln!("[dsm/players] falha ao enviar '{command}': {e}");
            false
        }
    }
}

/// Manda `save-all flush` e espera o servidor jogar tudo no disco.
///
/// Sem esse flush, uma leitura feita com o servidor ligado pode pegar o
/// playerdata de minutos atrás — e uma escrita pode ser sobrescrita.
async fn flush_if_online(
    hub: &std::sync::Arc<crate::process_mgr::ProcessHub>,
    server_id: &str,
) -> bool {
    if !send_if_online(hub, server_id, "save-all flush") {
        return false;
    }
    tokio::time::sleep(Duration::from_millis(400)).await;
    true
}

/// Data/hora local no formato que o Minecraft grava nos bans.
fn now_string() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S %z").to_string()
}

/// Data/hora legível a partir do mtime de um arquivo.
fn mtime_string(path: &Path) -> String {
    let Ok(meta) = fs::metadata(path) else {
        return String::new();
    };
    let Ok(modified) = meta.modified() else {
        return String::new();
    };
    chrono::DateTime::<chrono::Local>::from(modified)
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

/// Idade do arquivo em minutos (u64::MAX se não der para ler).
fn minutes_since_modified(path: &Path) -> u64 {
    let Ok(meta) = fs::metadata(path) else {
        return u64::MAX;
    };
    let Ok(modified) = meta.modified() else {
        return u64::MAX;
    };
    let age = SystemTime::now()
        .duration_since(modified)
        .unwrap_or_else(|_| Duration::from_secs(0));
    age.as_secs() / 60
}

// ---------------------------------------------------------------------------
// UUID offline (algoritmo do Minecraft)
// ---------------------------------------------------------------------------

/// MD5 mínimo, só para gerar UUID offline de nome.
///
/// É exatamente o que `UUID.nameUUIDFromBytes` faz no cliente: MD5 dos bytes,
/// depois fixa a versão (3) e a variante (IETF).
fn md5(input: &[u8]) -> [u8; 16] {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, // 0..15
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, // 16..31
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, // 32..47
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, // 48..63
    ];
    const K: [u32; 64] = [
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613,
        0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193,
        0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d,
        0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
        0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
        0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
        0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244,
        0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
        0xeb86d391,
    ];

    // padding: 0x80, zeros até 56 mod 64, e o tamanho em bits (little endian)
    let bit_len = (input.len() as u64).wrapping_mul(8);
    let mut msg = input.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_le_bytes());

    let mut a: u32 = 0x67452301;
    let mut b: u32 = 0xefcdab89;
    let mut c: u32 = 0x98badcfe;
    let mut d: u32 = 0x10325476;

    for chunk in msg.chunks_exact(64) {
        let mut m = [0u32; 16];
        for i in 0..16 {
            let base = i * 4;
            m[i] = u32::from_le_bytes([chunk[base], chunk[base + 1], chunk[base + 2], chunk[base + 3]]);
        }
        let (mut aa, mut bb, mut cc, mut dd) = (a, b, c, d);
        for i in 0..64 {
            let (f, g) = if i < 16 {
                ((bb & cc) | (!bb & dd), i)
            } else if i < 32 {
                ((dd & bb) | (!dd & cc), (5 * i + 1) % 16)
            } else if i < 48 {
                (bb ^ cc ^ dd, (3 * i + 5) % 16)
            } else {
                (cc ^ (bb | !dd), (7 * i) % 16)
            };
            let f = f
                .wrapping_add(aa)
                .wrapping_add(K[i])
                .wrapping_add(m[g]);
            aa = dd;
            dd = cc;
            cc = bb;
            bb = bb.wrapping_add(f.rotate_left(S[i]));
        }
        a = a.wrapping_add(aa);
        b = b.wrapping_add(bb);
        c = c.wrapping_add(cc);
        d = d.wrapping_add(dd);
    }

    let mut out = [0u8; 16];
    out[0..4].copy_from_slice(&a.to_le_bytes());
    out[4..8].copy_from_slice(&b.to_le_bytes());
    out[8..12].copy_from_slice(&c.to_le_bytes());
    out[12..16].copy_from_slice(&d.to_le_bytes());
    out
}

/// UUID "offline" de um nome — igual ao do Minecraft em modo offline.
fn offline_uuid(name: &str) -> String {
    let mut bytes = b"OfflinePlayer:".to_vec();
    bytes.extend_from_slice(name.as_bytes());
    let mut digest = md5(&bytes);
    digest[6] = (digest[6] & 0x0f) | 0x30; // versão 3
    digest[8] = (digest[8] & 0x3f) | 0x80; // variante IETF
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// UUID sem hifens e em minúsculas (para comparar com o usercache).
fn normalize_uuid(uuid: &str) -> String {
    uuid.trim().to_lowercase().replace('-', "")
}

/// Um UUID parece válido (32 ou 36 hex)?
fn looks_like_uuid(value: &str) -> bool {
    let v = value.trim();
    if v.len() != 32 && v.len() != 36 {
        return false;
    }
    v.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Para exibição: UUID com hifens.
fn dashed(uuid: &str) -> String {
    let n = normalize_uuid(uuid);
    if n.len() != 32 {
        return uuid.to_string();
    }
    format!(
        "{}-{}-{}-{}-{}",
        &n[0..8],
        &n[8..12],
        &n[12..16],
        &n[16..20],
        &n[20..32]
    )
}

// ---------------------------------------------------------------------------
// Utilitários de JSON em disco
// ---------------------------------------------------------------------------

/// Lê uma lista JSON (`whitelist.json`, `ops.json`, ...).
///
/// Arquivo ausente/vazio é lista vazia — o servidor só cria esses arquivos
/// quando alguém é adicionado.
fn read_json_list<T: serde::de::DeserializeOwned>(path: &Path) -> CommandResult<Vec<T>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path)?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    let parsed: Option<Vec<T>> = serde_json::from_str(&raw)?;
    Ok(parsed.unwrap_or_default())
}

/// Grava uma lista JSON com formatação bonita (como o servidor faz).
fn write_json_list<T: Serialize>(path: &Path, items: &[T]) -> CommandResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(items)?;
    fs::write(path, raw)?;
    Ok(())
}

/// Lê o `usercache.json`: `[{"uuid": "...", "name": "..."}]`.
fn read_usercache(root: &Path) -> Vec<(String, String)> {
    let path = match server_json(root, "usercache.json") {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    #[derive(Deserialize)]
    struct CacheEntry {
        #[serde(default)]
        uuid: String,
        #[serde(default)]
        name: String,
    }
    read_json_list::<CacheEntry>(&path)
        .unwrap_or_default()
        .into_iter()
        .filter(|e| !e.name.is_empty())
        .map(|e| (e.uuid, e.name))
        .collect()
}

/// UUID do jogador a partir do nome, consultando o `usercache.json`.
///
/// Sem o usercache (jogador que nunca entrou) usamos o UUID offline.
fn uuid_for_name(root: &Path, name: &str) -> String {
    let wanted = name.trim().to_lowercase();
    for (uuid, cached) in read_usercache(root) {
        if cached.eq_ignore_ascii_case(&wanted) {
            return normalize_uuid(&uuid);
        }
    }
    normalize_uuid(&offline_uuid(name.trim()))
}

// ---------------------------------------------------------------------------
// Itens: leitura do NBT para `ItemStack`
// ---------------------------------------------------------------------------

/// Texto puro de um componente de chat (`components."minecraft:custom_name"`).
///
/// Em 1.20.5+ o valor já é um componente (`{"text":"..."}`) e em versões
/// antigas é uma string JSON — tratamos os dois.
fn chat_text(tag: &Tag) -> Option<String> {
    match tag {
        Tag::String(raw) => {
            let trimmed = raw.trim();
            if let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(trimmed)
            {
                if let Some(text) = map.get("text").and_then(|t| t.as_str()) {
                    return Some(text.to_string());
                }
                if let Some(extra) = map.get("extra").and_then(|e| e.as_array()) {
                    let joined: String = extra
                        .iter()
                        .filter_map(|v| v.get("text").and_then(|t| t.as_str()))
                        .collect();
                    if !joined.is_empty() {
                        return Some(joined);
                    }
                }
                return Some(trimmed.to_string());
            }
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Tag::Compound(map) => {
            if let Some(text) = map
                .iter()
                .find(|(k, _)| k == "text")
                .and_then(|(_, v)| v.as_str())
            {
                return Some(text.to_string());
            }
            for (k, v) in map {
                if k == "extra" {
                    if let Tag::List(l) = v {
                        let joined: String = l
                            .items
                            .iter()
                            .filter_map(|t| t.get("text").and_then(|x| x.as_str()))
                            .collect();
                        if !joined.is_empty() {
                            return Some(joined);
                        }
                    }
                }
            }
            None
        }
        _ => None,
    }
}

/// Lore de um item: `components."minecraft:lore"` (novo) ou `tag.display.Lore`.
fn item_lore(item: &Tag) -> Option<String> {
    let list = item
        .get("components")
        .and_then(|c| c.get("minecraft:lore"))
        .or_else(|| {
            item.get("tag")
                .and_then(|t| t.get("display"))
                .and_then(|d| d.get("Lore"))
        })?;
    let Tag::List(l) = list else {
        return None;
    };
    let joined: Vec<String> = l.items.iter().filter_map(chat_text).collect();
    if joined.is_empty() {
        None
    } else {
        Some(joined.join("\n"))
    }
}

/// Nome customizado: `components."minecraft:custom_name"` (1.20.5+) ou
/// `tag.display.Name` (versões antigas).
fn item_display_name(item: &Tag) -> Option<String> {
    let raw = item
        .get("components")
        .and_then(|c| c.get("minecraft:custom_name"))
        .or_else(|| {
            item.get("tag")
                .and_then(|t| t.get("display"))
                .and_then(|d| d.get("Name"))
        })?;
    chat_text(raw)
}

/// Valor do componente de dano: `components."minecraft:damage"` ou `Damage`.
fn item_damage(item: &Tag) -> i32 {
    if let Some(v) = item
        .get("components")
        .and_then(|c| c.get("minecraft:damage"))
        .and_then(|t| t.as_i32())
    {
        return v;
    }
    item.get("Damage").and_then(|t| t.as_i32()).unwrap_or(0)
}

/// O item tem campo de dano (`Damage` ou `components."minecraft:damage"`)?
///
/// Serve para detectar itens duráveis (ferramentas, armas, armaduras) mesmo
/// quando o dano atual é 0 — um item novo tem `Damage: 0`, então olhar só o
/// valor classificaria uma espada nova como empilhável.
fn item_has_damage(item: &Tag) -> bool {
    item.get("Damage").is_some()
        || item
            .get("components")
            .map(|c| c.get("minecraft:damage").is_some())
            .unwrap_or(false)
}

/// O item tem dados extras (encantamentos, nome, lore, components)?
fn item_has_nbt(item: &Tag) -> bool {
    let Some(map) = item.compound() else {
        return false;
    };
    map.iter()
        .any(|(k, _)| !matches!(k.as_str(), "Slot" | "slot" | "Count" | "count" | "id"))
}

/// Tamanho máximo da pilha — aproximação documentada.
///
/// Regra: itens com componente de dano (ferramentas, armas, armaduras) empilham
/// 1; uma lista curta de exceções (baldes, barcos, cenouras no pau, etc.)
/// também empilha 1; ovos/bolas de neve/placas/banners empilham 16; o resto 64.
fn max_stack_for(id: &str, damage_present: bool) -> i32 {
    if damage_present {
        return 1;
    }
    // itens que nunca empilham
    const ONE: &[&str] = &[
        "minecraft:bucket",
        "minecraft:water_bucket",
        "minecraft:lava_bucket",
        "minecraft:milk_bucket",
        "minecraft:powder_snow_bucket",
        "minecraft:axolotl_bucket",
        "minecraft:cod_bucket",
        "minecraft:salmon_bucket",
        "minecraft:pufferfish_bucket",
        "minecraft:tropical_fish_bucket",
        "minecraft:minecart",
        "minecraft:chest_minecart",
        "minecraft:hopper_minecart",
        "minecraft:tnt_minecart",
        "minecraft:furnace_minecart",
        "minecraft:command_block_minecart",
        "minecraft:saddle",
        "minecraft:boat",
        "minecraft:oak_boat",
        "minecraft:spruce_boat",
        "minecraft:birch_boat",
        "minecraft:jungle_boat",
        "minecraft:acacia_boat",
        "minecraft:dark_oak_boat",
        "minecraft:mangrove_boat",
        "minecraft:cherry_boat",
        "minecraft:bamboo_raft",
        "minecraft:cake",
        "minecraft:potion",
        "minecraft:splash_potion",
        "minecraft:lingering_potion",
        "minecraft:honey_bottle",
        "minecraft:enchanted_book",
        "minecraft:shield",
        "minecraft:bow",
        "minecraft:crossbow",
        "minecraft:trident",
        "minecraft:mace",
        "minecraft:fishing_rod",
        "minecraft:shears",
        "minecraft:flint_and_steel",
        "minecraft:goat_horn",
        "minecraft:totem_of_undying",
        "minecraft:writable_book",
        "minecraft:written_book",
        "minecraft:knowledge_book",
        "minecraft:bundle",
    ];
    if ONE.contains(&id) {
        return 1;
    }
    if id.ends_with("_bucket") || id.ends_with("_boat") || id.ends_with("_minecart") {
        return 1;
    }
    // pilhas de 16
    const SIXTEEN: &[&str] = &[
        "minecraft:egg",
        "minecraft:snowball",
        "minecraft:ender_pearl",
        "minecraft:eye_of_ender",
        "minecraft:armor_stand",
        "minecraft:banner",
        "minecraft:white_banner",
        "minecraft:sign",
        "minecraft:oak_sign",
        "minecraft:spruce_sign",
        "minecraft:birch_sign",
        "minecraft:jungle_sign",
        "minecraft:acacia_sign",
        "minecraft:dark_oak_sign",
        "minecraft:mangrove_sign",
        "minecraft:cherry_sign",
        "minecraft:bamboo_sign",
        "minecraft:crimson_sign",
        "minecraft:warped_sign",
        "minecraft:hanging_roots",
        "minecraft:experience_bottle",
    ];
    if SIXTEEN.contains(&id) || id.ends_with("_sign") || id.ends_with("_banner") {
        return 16;
    }
    if id.ends_with("_spawn_egg") {
        return 16;
    }
    64
}

/// Converte o compound NBT de um item em `ItemStack`.
fn item_from_tag(slot: i32, item: &Tag) -> ItemStack {
    let id = item
        .get("id")
        .and_then(|t| t.as_str())
        .unwrap_or("minecraft:air")
        .to_string();
    let count = item
        .get("Count")
        .and_then(|t| t.as_i32())
        .or_else(|| item.get("count").and_then(|t| t.as_i32()))
        .unwrap_or(1);
    let damage = item_damage(item);
    ItemStack {
        slot,
        id: id.clone(),
        count: count.max(1),
        display_name: item_display_name(item),
        damage,
        lore: item_lore(item),
        nbt_present: item_has_nbt(item),
        max_stack: max_stack_for(&id, item_has_damage(item)),
        nbt_json: tag_json_string(item),
    }
}

/// Um compound "vazio" é um slot sem item (como o servidor escreve).
fn is_empty_item(item: &Tag) -> bool {
    match item {
        Tag::Compound(map) => map.is_empty(),
        _ => true,
    }
}

/// Descobre o valor de slot de um item, tolerando `Slot` e `slot`.
fn item_slot(item: &Tag) -> Option<i32> {
    item.get("Slot")
        .and_then(|t| t.as_i32())
        .or_else(|| item.get("slot").and_then(|t| t.as_i32()))
}

/// Escreve o slot de um item preservando a nomenclatura do arquivo original
/// (`Slot` byte nas versões antigas, `slot` int nas novas).
fn set_item_slot(item: &mut Tag, slot: i32) {
    let key = if item.get("slot").is_some() {
        "slot"
    } else if item.get("Slot").is_some() {
        "Slot"
    } else {
        "Slot"
    };
    let value = if key == "slot" {
        Tag::Int(slot)
    } else {
        Tag::Byte(slot.clamp(-128, 127) as i8)
    };
    item.set(key, value);
    if key == "Slot" {
        item.remove("slot");
    }
}

/// Escreve a contagem de um item preservando `Count`/`count`.
fn set_item_stack_count(item: &mut Tag, count: i32) {
    let key = if item.get("count").is_some() { "count" } else { "Count" };
    let value = if key == "count" {
        Tag::Int(count)
    } else {
        Tag::Byte(count.clamp(1, 127) as i8)
    };
    item.set(key, value);
}

/// Containers suportados pelo painel.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Container {
    /// `Inventory` — chave = slot NBT (0..35, -106 = offhand).
    Inventory,
    /// `EnderItems` — chave = slot 0..26.
    Ender,
    /// `ArmorItems` — chave = índice 0..3 (botas, calças, peitoral, capacete).
    Armor,
    /// `SelectedItem` — chave 0.
    Offhand,
}

impl Container {
    /// Aceita vários apelidos para o frontend não precisar ser exato.
    fn parse(value: &str) -> Option<Container> {
        match value.trim().to_lowercase().as_str() {
            "inventory" | "inv" | "hotbar" | "main" | "jogador" => Some(Container::Inventory),
            "ender" | "enderchest" | "ender_chest" | "enderc" => Some(Container::Ender),
            "armor" | "armour" | "armadura" => Some(Container::Armor),
            "offhand" | "off_hand" | "secondhand" | "mao" => Some(Container::Offhand),
            _ => None,
        }
    }
}

/// Campo raiz que guarda a lista do container (offhand é tratado à parte).
fn container_list<'a>(root: &'a Tag, container: Container) -> Option<&'a Vec<Tag>> {
    let key = match container {
        Container::Inventory => "Inventory",
        Container::Ender => "EnderItems",
        Container::Armor => "ArmorItems",
        Container::Offhand => return None,
    };
    root.get(key).and_then(|t| t.as_list()).map(|l| &l.items)
}

/// Lista mutável do container, criando-a se não existir.
fn container_list_mut<'a>(root: &'a mut Tag, container: Container) -> Option<&'a mut Vec<Tag>> {
    let key = match container {
        Container::Inventory => "Inventory",
        Container::Ender => "EnderItems",
        Container::Armor => "ArmorItems",
        Container::Offhand => return None,
    };
    if root.get(key).is_none() {
        root.set(key, Tag::List(ListTag::new(10)));
    }
    root.get_mut(key).and_then(|t| t.as_list_mut()).map(|l| &mut l.items)
}

/// Um item do container pela chave (slot ou índice).
fn container_get<'a>(root: &'a Tag, container: Container, key: i32) -> Option<&'a Tag> {
    match container {
        Container::Inventory | Container::Ender => container_list(root, container)
            .and_then(|items| items.iter().find(|i| item_slot(i) == Some(key))),
        Container::Armor => container_list(root, Container::Armor)
            .and_then(|items| items.get(key.max(0) as usize)),
        Container::Offhand => {
            // 1.20.5+ guarda a offhand em `SelectedItem`; versões antigas a
            // deixam dentro do `Inventory` com slot -106 (ou 40).
            if let Some(sel) = root.get("SelectedItem") {
                if !is_empty_item(sel) {
                    return Some(sel);
                }
            }
            container_list(root, Container::Inventory).and_then(|items| {
                items
                    .iter()
                    .find(|i| matches!(item_slot(i), Some(-106) | Some(40)))
            })
        }
    }
}

/// Remove um item do container (devolve o compound removido).
fn container_take(root: &mut Tag, container: Container, key: i32) -> Option<Tag> {
    match container {
        Container::Inventory | Container::Ender => {
            let items = container_list_mut(root, container)?;
            let pos = items.iter().position(|i| item_slot(i) == Some(key))?;
            Some(items.remove(pos))
        }
        Container::Armor => {
            let items = container_list_mut(root, Container::Armor)?;
            let idx = key.max(0) as usize;
            if idx < items.len() {
                Some(items.remove(idx))
            } else {
                None
            }
        }
        Container::Offhand => {
            if let Some(sel) = root.get("SelectedItem") {
                if !is_empty_item(sel) {
                    let taken = sel.clone();
                    root.remove("SelectedItem");
                    return Some(taken);
                }
            }
            let items = container_list_mut(root, Container::Inventory)?;
            let pos = items
                .iter()
                .position(|i| matches!(item_slot(i), Some(-106) | Some(40)))?;
            Some(items.remove(pos))
        }
    }
}

/// Coloca um item no container, na chave pedida.
fn container_put(root: &mut Tag, container: Container, key: i32, item: Tag) -> CommandResult<()> {
    match container {
        Container::Inventory | Container::Ender => {
            let mut item = item;
            set_item_slot(&mut item, key);
            let items = container_list_mut(root, container)
                .ok_or_else(|| nbt_err("container NBT indisponível"))?;
            if let Some(pos) = items.iter().position(|i| item_slot(i) == Some(key)) {
                items[pos] = item;
            } else {
                items.push(item);
            }
            Ok(())
        }
        Container::Armor => {
            let idx = key.max(0) as usize;
            let items = container_list_mut(root, Container::Armor)
                .ok_or_else(|| nbt_err("container NBT indisponível"))?;
            while items.len() <= idx {
                items.push(Tag::Compound(Vec::new()));
            }
            items[idx] = item;
            Ok(())
        }
        Container::Offhand => {
            // tire a offhand antiga de onde ela estiver para não duplicar
            container_take(root, Container::Offhand, 0);
            let mut item = item;
            item.remove("Slot");
            item.remove("slot");
            root.set("SelectedItem", item);
            Ok(())
        }
    }
}

/// Slots já ocupados no inventário (para o `/give` offline achar buraco).
fn used_inventory_slots(root: &Tag) -> Vec<i32> {
    container_list(root, Container::Inventory)
        .map(|items| items.iter().filter_map(item_slot).collect())
        .unwrap_or_default()
}

/// Primeiro slot livre do inventário principal (0..35).
fn free_inventory_slot(root: &Tag) -> Option<i32> {
    let used = used_inventory_slots(root);
    (0..36).find(|slot| !used.contains(slot))
}

/// Monta o compound NBT de um item novo (formato clássico).
fn new_item_tag(id: &str, count: i32) -> Tag {
    let mut map: Vec<(String, Tag)> = Vec::new();
    map.push(("Count".to_string(), Tag::Byte(count.clamp(1, 127) as i8)));
    map.push(("id".to_string(), Tag::String(id.to_string())));
    Tag::Compound(map)
}

/// Garante o prefixo `minecraft:` (o frontend pode mandar só "diamond").
fn normalize_item_id(id: &str) -> CommandResult<String> {
    let id = id.trim();
    if id.is_empty() {
        return err("informe o id do item");
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '_' | '-'))
    {
        return err(format!("id de item inválido: {id}"));
    }
    if id.contains(':') {
        Ok(id.to_string())
    } else {
        Ok(format!("minecraft:{id}"))
    }
}

// ---------------------------------------------------------------------------
// Jogadores online
// ---------------------------------------------------------------------------

/// Janela usada para considerar um `.dat` como "jogador online", em minutos.
const ONLINE_WINDOW_MINUTES: u64 = 15;

/// Lista os jogadores (quase) online do servidor Java.
///
/// **Como funciona (e a limitação):** a forma canônica seria mandar `list` no
/// console e parsear a resposta — mas o `ProcessHub` é write-only (não existe
/// request/response), então não temos como Capturar a resposta. Em vez disso
/// usamos uma heurística honesta: o servidor só regrava
/// `world/playerdata/<uuid>.dat` de um jogador enquanto ele está conectado, então
/// consideramos online quem teve o `.dat` modificado nos últimos 15 minutos.
/// Isso inclui quem saiu há pouco e pode excluir quem está AFK em um mundo com
/// autosave desligado. `health`/`food` vêm do próprio NBT (melhor esforço).
#[tauri::command]
pub(crate) async fn list_online_players(
    server_id: String,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<Vec<OnlinePlayer>> {
    let root = util::server_dir(&server_id);
    if !root.exists() {
        return Ok(Vec::new());
    }
    // com o servidor no ar, peça um flush para os dados não ficarem velhos
    flush_if_online(&hub, &server_id).await;

    let dir = playerdata_dir(&root);
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()),
    };

    let mut out: Vec<OnlinePlayer> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("dat") {
            continue;
        }
        if minutes_since_modified(&path) > ONLINE_WINDOW_MINUTES {
            continue;
        }
        let uuid = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if !looks_like_uuid(&uuid) {
            continue;
        }

        let (health, food) = read_vitals(&path).unwrap_or((20.0, 20));
        out.push(OnlinePlayer {
            name: resolve_player_name_inner(&root, &uuid),
            uuid,
            last_seen: mtime_string(&path),
            health,
            food,
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Lê `Health`/`foodLevel` de um playerdata (ignora o resto).
fn read_vitals(path: &Path) -> Option<(f32, i32)> {
    let root = load_player_nbt(path).ok()?;
    let health = root.get("Health").and_then(|t| t.as_f32()).unwrap_or(20.0);
    let food = root
        .get("foodLevel")
        .and_then(|t| t.as_i32())
        .unwrap_or(20);
    Some((health, food))
}

/// Resolve o nick de um UUID (implementação interna, sem estado do Tauri).
///
/// Ordem: `usercache.json` → `whitelist.json` → `ops.json` →
/// `banned-players.json`. Se nada for encontrado, devolve "Desconhecido"
/// (quem nunca entrou com um UUID que o painel não conhece).
fn resolve_player_name_inner(root: &Path, uuid: &str) -> String {
    let wanted = normalize_uuid(uuid);
    for (cached_uuid, name) in read_usercache(root) {
        if normalize_uuid(&cached_uuid) == wanted {
            return name;
        }
    }

    #[derive(Deserialize)]
    struct Named {
        #[serde(default)]
        uuid: String,
        #[serde(default)]
        name: String,
    }
    let lists = ["whitelist.json", "ops.json", "banned-players.json"];
    for list in lists {
        let Ok(path) = server_json(root, list) else {
            continue;
        };
        if let Ok(entries) = read_json_list::<Named>(&path) {
            for entry in entries {
                if !entry.name.is_empty() && normalize_uuid(&entry.uuid) == wanted {
                    return entry.name;
                }
            }
        }
    }
    "Desconhecido".to_string()
}

/// Resolve o nick de um UUID pelo `usercache.json` (e listas do servidor).
#[tauri::command]
pub(crate) fn resolve_player_name(server_id: String, uuid: String) -> CommandResult<String> {
    let root = util::server_dir(&server_id);
    if !root.exists() {
        return Ok("Desconhecido".to_string());
    }
    if uuid.trim().is_empty() {
        return err("informe o uuid do jogador");
    }
    Ok(resolve_player_name_inner(&root, &uuid))
}

// ---------------------------------------------------------------------------
// Whitelist
// ---------------------------------------------------------------------------

/// Lista a whitelist (`whitelist.json`).
#[tauri::command]
pub(crate) fn list_whitelist(server_id: String) -> CommandResult<Vec<PlayerRef>> {
    let root = util::server_dir(&server_id);
    let path = server_json(&root, "whitelist.json")?;
    Ok(read_json_list::<PlayerRef>(&path)?)
}

/// Adiciona um jogador na whitelist (arquivo + console quando online).
///
/// O UUID é o do `usercache.json` quando o jogador já entrou no servidor; se
/// não, cai no UUID offline (MD5 de `OfflinePlayer:<nome>`), que é o que um
/// servidor em modo offline usa. Em modo online o servidor regrava o UUID
/// correto quando o comando `whitelist add` é processado.
#[tauri::command]
pub(crate) fn add_to_whitelist(
    server_id: String,
    name: String,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<PlayerRef> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return err("informe o nome do jogador");
    }
    if name.chars().count() > 16 {
        return err("o nome do Minecraft tem no máximo 16 caracteres");
    }
    let root = util::server_dir(&server_id);
    let path = server_json(&root, "whitelist.json")?;

    let mut list = read_json_list::<PlayerRef>(&path)?;
    let uuid = uuid_for_name(&root, &name);
    let entry = PlayerRef {
        uuid: dashed(&uuid),
        name: name.clone(),
    };
    if let Some(existing) = list.iter_mut().find(|p| p.name.eq_ignore_ascii_case(&name)) {
        existing.uuid = entry.uuid.clone();
    } else {
        list.push(entry.clone());
    }
    write_json_list(&path, &list)?;

    // com o servidor no ar o comando é a fonte da verdade (e já persiste)
    send_if_online(&hub, &server_id, &format!("whitelist add {name}"));
    Ok(entry)
}

/// Remove um jogador da whitelist pelo UUID.
#[tauri::command]
pub(crate) fn remove_from_whitelist(
    server_id: String,
    uuid: String,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<()> {
    let wanted = normalize_uuid(&uuid);
    if wanted.is_empty() {
        return err("informe o uuid do jogador");
    }
    let root = util::server_dir(&server_id);
    let path = server_json(&root, "whitelist.json")?;

    let list = read_json_list::<PlayerRef>(&path)?;
    let removed: Vec<PlayerRef> = list
        .iter()
        .filter(|p| normalize_uuid(&p.uuid) == wanted)
        .cloned()
        .collect();
    if removed.is_empty() {
        return err("jogador não encontrado na whitelist");
    }
    let kept: Vec<PlayerRef> = list
        .into_iter()
        .filter(|p| normalize_uuid(&p.uuid) != wanted)
        .collect();
    write_json_list(&path, &kept)?;

    for player in removed {
        send_if_online(&hub, &server_id, &format!("whitelist remove {}", player.name));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Operadores
// ---------------------------------------------------------------------------

/// Lista os operadores (`ops.json`).
#[tauri::command]
pub(crate) fn list_ops(server_id: String) -> CommandResult<Vec<OpEntry>> {
    let root = util::server_dir(&server_id);
    let path = server_json(&root, "ops.json")?;
    let mut list = read_json_list::<OpEntry>(&path)?;
    // mais poderosos primeiro
    list.sort_by(|a, b| b.level.cmp(&a.level).then(a.name.cmp(&b.name)));
    Ok(list)
}

/// Dá OP a um jogador (console quando online; arquivo quando offline).
///
/// **Limitação:** o comando vanilla `/op <nome>` não aceita nível — ele sempre
/// promove ao nível 4. Então, quando o servidor está online mandamos o `/op` e
/// em seguida ajustamos o `level` no `ops.json` para o valor pedido; quando o
/// servidor está offline gravamos o arquivo com o nível pedido. Esteja ciente de
/// que o servidor regrava o `ops.json` inteiro quando a lista de ops muda, então
/// um ajuste feito com o servidor ligado pode ser sobrescrito depois.
#[tauri::command]
pub(crate) fn add_op(
    server_id: String,
    name: String,
    level: i32,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<OpEntry> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return err("informe o nome do jogador");
    }
    if !(1..=4).contains(&level) {
        return err("o nível de OP deve ser 1, 2, 3 ou 4");
    }
    let root = util::server_dir(&server_id);
    let path = server_json(&root, "ops.json")?;

    let uuid = uuid_for_name(&root, &name);
    let entry = OpEntry {
        uuid: dashed(&uuid),
        name: name.clone(),
        level,
        bypasses_player_limit: true,
    };

    let mut list = read_json_list::<OpEntry>(&path)?;
    if let Some(existing) = list.iter_mut().find(|p| p.name.eq_ignore_ascii_case(&name)) {
        existing.uuid = entry.uuid.clone();
        existing.level = level;
    } else {
        list.push(entry.clone());
    }
    write_json_list(&path, &list)?;

    // o comando console é a fonte da verdade quando o servidor está no ar
    send_if_online(&hub, &server_id, &format!("op {name}"));
    Ok(entry)
}

/// Tira o OP de um jogador pelo UUID.
#[tauri::command]
pub(crate) fn remove_op(
    server_id: String,
    uuid: String,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<()> {
    let wanted = normalize_uuid(&uuid);
    if wanted.is_empty() {
        return err("informe o uuid do jogador");
    }
    let root = util::server_dir(&server_id);
    let path = server_json(&root, "ops.json")?;

    let list = read_json_list::<OpEntry>(&path)?;
    let removed: Vec<OpEntry> = list
        .iter()
        .filter(|p| normalize_uuid(&p.uuid) == wanted)
        .cloned()
        .collect();
    if removed.is_empty() {
        return err("jogador não encontrado na lista de OPs");
    }
    let kept: Vec<OpEntry> = list
        .into_iter()
        .filter(|p| normalize_uuid(&p.uuid) != wanted)
        .collect();
    write_json_list(&path, &kept)?;

    for player in removed {
        send_if_online(&hub, &server_id, &format!("deop {}", player.name));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Banimentos
// ---------------------------------------------------------------------------

/// Fonte registrada nos bans criados pelo painel.
const BAN_SOURCE: &str = "DSM Painel";

/// Lista os jogadores banidos (`banned-players.json`).
#[tauri::command]
pub(crate) fn list_banned_players(server_id: String) -> CommandResult<Vec<BannedPlayer>> {
    let root = util::server_dir(&server_id);
    let path = server_json(&root, "banned-players.json")?;
    Ok(read_json_list::<BannedPlayer>(&path)?)
}

/// Monta uma entrada de ban com os campos que o servidor espera.
fn ban_entry(
    uuid: Option<String>,
    name: Option<String>,
    ip: Option<String>,
    reason: String,
) -> (BannedPlayer, BannedIp) {
    let now = now_string();
    let reason = if reason.trim().is_empty() {
        "Banido pelo painel".to_string()
    } else {
        reason.trim().to_string()
    };
    let player = BannedPlayer {
        uuid: uuid.clone().unwrap_or_default(),
        name: name.clone().unwrap_or_default(),
        created: now.clone(),
        source: BAN_SOURCE.to_string(),
        expires: "forever".to_string(),
        reason: reason.clone(),
    };
    let ip_entry = BannedIp {
        ip: ip.unwrap_or_default(),
        uuid,
        name,
        created: now,
        source: BAN_SOURCE.to_string(),
        expires: "forever".to_string(),
        reason,
    };
    (player, ip_entry)
}

/// Bane um jogador — `kind` decide se é por nick ("nick") ou IP ("ip").
///
/// Existe porque o frontend pergunta ao usuário qual dos dois banir; os dois
/// modos estão implementados em [`ban_player_nick`] e [`ban_player_ip`].
#[tauri::command]
pub(crate) async fn ban_player(
    server_id: String,
    name: String,
    reason: String,
    kind: String,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<BanResult> {
    match kind.trim().to_lowercase().as_str() {
        "nick" | "name" | "player" => ban_player_nick(server_id, name, reason, hub).await,
        "ip" => ban_player_ip(server_id, name, reason, hub).await,
        other => err(format!("tipo de banimento desconhecido: {other}")),
    }
}

/// Bane por nick: grava `banned-players.json` e manda `ban` no console.
#[tauri::command]
pub(crate) async fn ban_player_nick(
    server_id: String,
    name: String,
    reason: String,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<BanResult> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return err("informe o nome do jogador");
    }
    let root = util::server_dir(&server_id);
    let path = server_json(&root, "banned-players.json")?;

    let uuid = uuid_for_name(&root, &name);
    let (entry, _ip_entry) = ban_entry(
        Some(dashed(&uuid)),
        Some(name.clone()),
        None,
        reason.clone(),
    );

    let mut list = read_json_list::<BannedPlayer>(&path)?;
    list.retain(|p| normalize_uuid(&p.uuid) != uuid);
    list.push(entry);
    write_json_list(&path, &list)?;

    // online: o comando é a fonte da verdade (e regrava o UUID certo)
    let command = if reason.trim().is_empty() {
        format!("ban {name}")
    } else {
        format!("ban {name} {reason}")
    };
    send_if_online(&hub, &server_id, &command);

    Ok(BanResult {
        kind: "nick".to_string(),
        target: name,
    })
}

/// Bane por IP: manda `ban-ip <nome>` no console (o servidor descobre o IP).
///
/// **Limitação:** com o servidor desligado não há como saber o IP do jogador
/// (o Minecraft não guarda histórico de IPs em disco). Nesse caso gravamos em
/// `banned-ips.json` uma entrada com IP placeholder `0.0.0.0`, que o servidor
/// ignora — o registro fica visível no painel só para controle humano. Use o
/// banimento por IP com o servidor ligado.
#[tauri::command]
pub(crate) async fn ban_player_ip(
    server_id: String,
    name: String,
    reason: String,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<BanResult> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return err("informe o nome do jogador");
    }
    let root = util::server_dir(&server_id);
    let command = if reason.trim().is_empty() {
        format!("ban-ip {name}")
    } else {
        format!("ban-ip {name} {reason}")
    };

    if send_if_online(&hub, &server_id, &command) {
        // o servidor vai gravar banned-ips.json sozinho com o IP verdadeiro
        return Ok(BanResult {
            kind: "ip".to_string(),
            target: name,
        });
    }

    let uuid = uuid_for_name(&root, &name);
    let (_player, ip_entry) = ban_entry(
        Some(dashed(&uuid)),
        Some(name.clone()),
        Some("0.0.0.0".to_string()),
        reason,
    );
    let path = server_json(&root, "banned-ips.json")?;
    let mut list = read_json_list::<BannedIp>(&path)?;
    list.push(ip_entry);
    write_json_list(&path, &list)?;

    Ok(BanResult {
        kind: "ip".to_string(),
        target: name,
    })
}

/// Remove o banimento de um jogador (por UUID).
#[tauri::command]
pub(crate) fn unban_player(
    server_id: String,
    uuid: String,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<()> {
    let wanted = normalize_uuid(&uuid);
    if wanted.is_empty() {
        return err("informe o uuid do jogador");
    }
    let root = util::server_dir(&server_id);
    let path = server_json(&root, "banned-players.json")?;

    let list = read_json_list::<BannedPlayer>(&path)?;
    let removed: Vec<BannedPlayer> = list
        .iter()
        .filter(|p| normalize_uuid(&p.uuid) == wanted)
        .cloned()
        .collect();
    if removed.is_empty() {
        return err("jogador não encontrado na lista de banidos");
    }
    let kept: Vec<BannedPlayer> = list
        .into_iter()
        .filter(|p| normalize_uuid(&p.uuid) != wanted)
        .collect();
    write_json_list(&path, &kept)?;

    for player in removed {
        if player.name.trim().is_empty() {
            continue;
        }
        send_if_online(&hub, &server_id, &format!("pardon {}", player.name));
    }
    Ok(())
}

/// Lista os IPs banidos (`banned-ips.json`).
#[tauri::command]
pub(crate) fn list_banned_ips(server_id: String) -> CommandResult<Vec<BannedIp>> {
    let root = util::server_dir(&server_id);
    let path = server_json(&root, "banned-ips.json")?;
    Ok(read_json_list::<BannedIp>(&path)?)
}

/// Bane um IP diretamente.
#[tauri::command]
pub(crate) fn ban_ip(
    server_id: String,
    ip: String,
    reason: String,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<BannedIp> {
    let ip = ip.trim().to_string();
    if ip.is_empty() {
        return err("informe o IP");
    }
    if !(ip.contains('.') || ip.contains(':')) {
        return err(format!("IP inválido: {ip}"));
    }
    let root = util::server_dir(&server_id);
    let path = server_json(&root, "banned-ips.json")?;

    let (_player, entry) = ban_entry(None, None, Some(ip.clone()), reason.clone());
    let mut list = read_json_list::<BannedIp>(&path)?;
    list.retain(|e| e.ip != ip);
    list.push(entry.clone());
    write_json_list(&path, &list)?;

    let command = if reason.trim().is_empty() {
        format!("ban-ip {ip}")
    } else {
        format!("ban-ip {ip} {reason}")
    };
    send_if_online(&hub, &server_id, &command);
    Ok(entry)
}

/// Remove o banimento de um IP.
#[tauri::command]
pub(crate) fn unban_ip(
    server_id: String,
    ip: String,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<()> {
    let ip = ip.trim().to_string();
    if ip.is_empty() {
        return err("informe o IP");
    }
    let root = util::server_dir(&server_id);
    let path = server_json(&root, "banned-ips.json")?;

    let list = read_json_list::<BannedIp>(&path)?;
    if !list.iter().any(|e| e.ip == ip) {
        return err("IP não encontrado na lista de bans");
    }
    let kept: Vec<BannedIp> = list.into_iter().filter(|e| e.ip != ip).collect();
    write_json_list(&path, &kept)?;

    send_if_online(&hub, &server_id, &format!("pardon-ip {ip}"));
    Ok(())
}

// ---------------------------------------------------------------------------
// Snapshot do jogador
// ---------------------------------------------------------------------------

/// Nome do modo de jogo a partir do campo `playerGameType`.
fn game_mode_name(value: Option<&Tag>) -> String {
    match value.and_then(|t| t.as_i32()).unwrap_or(0) {
        1 => "creative",
        2 => "adventure",
        3 => "spectator",
        _ => "survival",
    }
    .to_string()
}

/// Monta o `PlayerSnapshot` a partir do compound NBT do jogador.
///
/// A ordem de `ArmorItems` no Minecraft Java é **[botas, calças, peitoral,
/// capacete]** — o frontend precisa saber disso para desenhar os slots.
fn snapshot_from_root(uuid: &str, root: &Tag, name: String, online: bool) -> PlayerSnapshot {
    let mut inventory: Vec<ItemStack> = Vec::new();
    if let Some(list) = container_list(root, Container::Inventory) {
        for item in list {
            if is_empty_item(item) {
                continue;
            }
            // slots 100..103 são a armadura no formato antigo (pré-1.9) e já
            // aparece em `ArmorItems` nas versões atuais
            if matches!(item_slot(item), Some(100..=103)) {
                continue;
            }
            inventory.push(item_from_tag(item_slot(item).unwrap_or(-1), item));
        }
    }
    inventory.sort_by_key(|i| i.slot);

    let mut ender_chest: Vec<ItemStack> = Vec::new();
    if let Some(list) = container_list(root, Container::Ender) {
        for item in list {
            if is_empty_item(item) {
                continue;
            }
            ender_chest.push(item_from_tag(item_slot(item).unwrap_or(-1), item));
        }
    }
    ender_chest.sort_by_key(|i| i.slot);

    // [botas, calças, peitoral, capacete] — a ordem do jogo
    let mut armor: Vec<ItemStack> = Vec::new();
    if let Some(list) = container_list(root, Container::Armor) {
        for (index, item) in list.iter().enumerate() {
            if is_empty_item(item) {
                continue;
            }
            armor.push(item_from_tag(index as i32, item));
        }
    }

    let offhand = container_get(root, Container::Offhand, 0)
        .filter(|i| !is_empty_item(i))
        .map(|item| item_from_tag(0, item));

    PlayerSnapshot {
        uuid: dashed(uuid),
        name,
        // padrões do jogo quando o campo não existe
        health: root.get("Health").and_then(|t| t.as_f32()).unwrap_or(20.0),
        food: root.get("foodLevel").and_then(|t| t.as_i32()).unwrap_or(20),
        saturation: root
            .get("foodSaturationLevel")
            .and_then(|t| t.as_f32())
            .unwrap_or(5.0),
        xp_level: root.get("XpLevel").and_then(|t| t.as_i32()).unwrap_or(0),
        xp_progress: root.get("XpP").and_then(|t| t.as_f32()).unwrap_or(0.0),
        game_mode: game_mode_name(root.get("playerGameType")),
        inventory,
        ender_chest,
        armor,
        offhand,
        server_online: online,
    }
}

/// Foto completa do jogador: vida, fome, XP, modo de jogo e inventários.
///
/// **Ordem das operações:** com o servidor no ar mandamos `save-all flush` e
/// esperamos ~400ms antes de ler o disco, senão leremos dados velhos. A pasta
/// do mundo vem do `level-name` do `server.properties` (com fallback para
/// `world/`). Os itens são convertidos para `ItemStack` com o compound NBT
/// completo em `nbt_json`, o que permite ao frontend inspecionar encantamentos
/// e depois regravar sem perder nada.
#[tauri::command]
pub(crate) async fn get_player_snapshot(
    server_id: String,
    uuid: String,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<PlayerSnapshot> {
    let uuid = uuid.trim().to_string();
    if !looks_like_uuid(&uuid) {
        return err("uuid inválido");
    }
    let root = util::server_dir(&server_id);
    let online = flush_if_online(&hub, &server_id).await;

    let path = player_dat_path(&root, &uuid)?;
    if !path.exists() {
        return Err(crate::error::CommandError::Other(format!(
            "o jogador {} nunca entrou neste servidor (sem {})",
            dashed(&uuid),
            path.display()
        )));
    }
    let nbt = load_player_nbt(&path)?;
    let name = resolve_player_name_inner(&root, &uuid);
    Ok(snapshot_from_root(&uuid, &nbt, name, online))
}

/// Ajusta a vida do jogador.
///
/// **Servidor offline:** regrava `Health` no NBT (exato).
/// **Servidor online:** dividimos em dois comandos porque o vanilla não tem um
/// "set health": para baixo usamos `/damage <player> <quantidade>` e para cima
/// `/effect give <player> instant_health 1 <amplificador> true`. A cura é
/// aproximada — o jogo aplica absorção, resistência e arredondamentos, e o
/// `/effect` pode ser bloqueado se o jogador tiver imunidade. Além disso o
/// servidor regrava o playerdata no próximo save, então a mudança some se você
/// editar com o servidor ligado.
#[tauri::command]
pub(crate) async fn set_player_health(
    server_id: String,
    uuid: String,
    value: f32,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<()> {
    let uuid = uuid.trim().to_string();
    if !looks_like_uuid(&uuid) {
        return err("uuid inválido");
    }
    if !value.is_finite() || value < 0.0 {
        return err("a vida deve ser um número >= 0");
    }
    let target = value.min(1024.0); // limite do atributo no vanilla

    let root = util::server_dir(&server_id);
    let path = player_dat_path(&root, &uuid)?;
    let online = flush_if_online(&hub, &server_id).await;
    if !path.exists() {
        return Err(crate::error::CommandError::Other(format!(
            "o jogador {} nunca entrou neste servidor",
            dashed(&uuid)
        )));
    }
    let name = resolve_player_name_inner(&root, &uuid);

    let current = read_vitals(&path).map(|(h, _)| h).unwrap_or(20.0);
    if online {
        if target < current {
            let amount = (current - target).round().max(1.0);
            send_if_online(&hub, &server_id, &format!("damage {name} {amount}"));
        } else if target > current {
            let diff = target - current;
            // instant_health cura ~4 pontos de vida por nível do efeito
            let amp = ((diff / 4.0).ceil() as i32 - 1).clamp(0, 254);
            send_if_online(
                &hub,
                &server_id,
                &format!("effect give {name} instant_health 1 {amp} true"),
            );
        }
        return Ok(());
    }

    let mut nbt = load_player_nbt(&path)?;
    nbt.set("Health", Tag::Float(target));
    if target <= 0.0 {
        // o servidor trata Health <= 0 como morte no próximo tick
        nbt.set("DeathTime", Tag::Short(0));
    }
    write_player_nbt(&uuid, &path, &nbt)?;
    Ok(())
}

/// Ajusta a fome do jogador.
///
/// **Servidor offline:** regrava `foodLevel` (e zera a exaustão) no NBT.
/// **Servidor online:** `/effect give saturation` para restaurar e
/// `/effect give hunger` para esvaziar — ambos aproximados, porque o jogo
/// reconstrói a fome a partir de saturação/exaustão a cada tick.
#[tauri::command]
pub(crate) async fn set_player_food(
    server_id: String,
    uuid: String,
    value: i32,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<()> {
    let uuid = uuid.trim().to_string();
    if !looks_like_uuid(&uuid) {
        return err("uuid inválido");
    }
    if !(0..=20).contains(&value) {
        return err("a fome deve ficar entre 0 e 20");
    }
    let root = util::server_dir(&server_id);
    let path = player_dat_path(&root, &uuid)?;
    let online = flush_if_online(&hub, &server_id).await;
    if !path.exists() {
        return Err(crate::error::CommandError::Other(format!(
            "o jogador {} nunca entrou neste servidor",
            dashed(&uuid)
        )));
    }
    let name = resolve_player_name_inner(&root, &uuid);

    let current = read_vitals(&path).map(|(_, f)| f).unwrap_or(20);
    if online {
        if value > current {
            let amp = (value - current - 1).clamp(0, 254);
            send_if_online(
                &hub,
                &server_id,
                &format!("effect give {name} saturation 5 {amp} true"),
            );
        } else if value < current {
            let amp = (current - value - 1).clamp(0, 254);
            send_if_online(
                &hub,
                &server_id,
                &format!("effect give {name} hunger 10 {amp} true"),
            );
        }
        return Ok(());
    }

    let mut nbt = load_player_nbt(&path)?;
    nbt.set("foodLevel", Tag::Int(value));
    nbt.set("foodSaturationLevel", Tag::Float((value as f32 / 2.0).min(20.0)));
    nbt.set("foodExhaustionLevel", Tag::Float(0.0));
    nbt.set("foodTickTimer", Tag::Int(0));
    write_player_nbt(&uuid, &path, &nbt)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Edição de inventário (regrava o NBT)
// ---------------------------------------------------------------------------

/// Resolve o container a partir do apelido mandado pelo frontend.
fn parse_container(value: &str) -> CommandResult<Container> {
    Container::parse(value).ok_or_else(|| {
        crate::error::CommandError::Other(format!(
            "container desconhecido: {value} (use inventory, ender, armor ou offhand)"
        ))
    })
}

/// Carrega o NBT do jogador garantindo que o arquivo existe.
fn load_player_or_err(root: &Path, uuid: &str) -> CommandResult<(PathBuf, Tag)> {
    let path = player_dat_path(root, uuid)?;
    if !path.exists() {
        return Err(crate::error::CommandError::Other(format!(
            "o jogador {} nunca entrou neste servidor",
            dashed(uuid)
        )));
    }
    let nbt = load_player_nbt(&path)?;
    Ok((path, nbt))
}

/// Move um item entre slots/containers regravando o NBT.
///
/// `container` é onde o item está hoje e `to_container` (opcional, padrão =
/// mesmo container) é para onde vai. Os slots são:
/// inventário = slot NBT (0..35), ender chest = slot 0..26,
/// armadura = índice 0..3 (**0 = botas, 1 = calças, 2 = peitoral, 3 = capacete**)
/// e offhand = 0.
///
/// **Limitação:** exige o servidor **offline**. Com o servidor ligado o jogo
/// mantém o inventário em memória e regrava o `.dat` no save, sobrescrevendo
/// esta mudança.
#[tauri::command]
pub(crate) async fn move_item(
    server_id: String,
    uuid: String,
    from_slot: i32,
    to_slot: i32,
    container: String,
    to_container: Option<String>,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<()> {
    let uuid = uuid.trim().to_string();
    if !looks_like_uuid(&uuid) {
        return err("uuid inválido");
    }
    let from = parse_container(&container)?;
    let to = match to_container.as_deref() {
        Some(v) if !v.trim().is_empty() => parse_container(v)?,
        _ => from,
    };

    let root = util::server_dir(&server_id);
    flush_if_online(&hub, &server_id).await;
    let (path, mut nbt) = load_player_or_err(&root, &uuid)?;

    let taken = container_take(&mut nbt, from, from_slot)
        .ok_or_else(|| crate::error::CommandError::Other("slot de origem vazio".into()))?;
    if is_empty_item(&taken) {
        return err("slot de origem vazio");
    }

    // se o destino está ocupado, o item de lá volta para a origem (troca)
    // quando os containers são iguais; entre containers diferentes abortamos
    // em vez de destruir um item sem o usuário pedir
    if let Some(existing) = container_take(&mut nbt, to, to_slot) {
        if !is_empty_item(&existing) {
            if from == to {
                container_put(&mut nbt, from, from_slot, existing)?;
            } else {
                container_put(&mut nbt, to, to_slot, existing)?;
                container_put(&mut nbt, from, from_slot, taken)?;
                return err("o destino já está ocupado");
            }
        }
    }
    container_put(&mut nbt, to, to_slot, taken)?;

    write_player_nbt(&uuid, &path, &nbt)?;
    Ok(())
}

/// Muda a quantidade de um item (0 remove o item).
#[tauri::command]
pub(crate) async fn set_item_count(
    server_id: String,
    uuid: String,
    slot: i32,
    container: String,
    count: i32,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<()> {
    let uuid = uuid.trim().to_string();
    if !looks_like_uuid(&uuid) {
        return err("uuid inválido");
    }
    let box_kind = parse_container(&container)?;
    if count < 0 {
        return err("a quantidade não pode ser negativa");
    }
    let root = util::server_dir(&server_id);
    flush_if_online(&hub, &server_id).await;
    let (path, mut nbt) = load_player_or_err(&root, &uuid)?;

    if count == 0 {
        container_take(&mut nbt, box_kind, slot);
        write_player_nbt(&uuid, &path, &nbt)?;
        return Ok(());
    }

    let taken = container_take(&mut nbt, box_kind, slot)
        .ok_or_else(|| crate::error::CommandError::Other("slot vazio".into()))?;
    if is_empty_item(&taken) {
        return err("slot vazio");
    }
    let mut item = taken;
    // `Count` é byte: 1..127
    set_item_stack_count(&mut item, count.min(127));
    container_put(&mut nbt, box_kind, slot, item)?;
    write_player_nbt(&uuid, &path, &nbt)?;
    Ok(())
}

/// Remove um item de um slot/container.
#[tauri::command]
pub(crate) async fn remove_item(
    server_id: String,
    uuid: String,
    slot: i32,
    container: String,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<()> {
    let uuid = uuid.trim().to_string();
    if !looks_like_uuid(&uuid) {
        return err("uuid inválido");
    }
    let box_kind = parse_container(&container)?;
    let root = util::server_dir(&server_id);
    flush_if_online(&hub, &server_id).await;
    let (path, mut nbt) = load_player_or_err(&root, &uuid)?;

    let taken = container_take(&mut nbt, box_kind, slot);
    if taken.as_ref().map(is_empty_item).unwrap_or(true) {
        return err("slot vazio");
    }
    write_player_nbt(&uuid, &path, &nbt)?;
    Ok(())
}

/// Dá um item ao jogador.
///
/// Com o servidor **online** usamos `/give` (caminho seguro — o jogo valida o
/// item e os componentes). Com o servidor **offline** inserimos o compound no
/// primeiro slot livre do inventário, quebrando quantidades acima de 127 em
/// pilhas separadas (limite do `Count` byte). Só o formato clássico de item é
/// escrito; encantamentos/nome não são adicionados por este comando.
#[tauri::command]
pub(crate) async fn give_item(
    server_id: String,
    uuid: String,
    item_id: String,
    count: i32,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<ItemStack> {
    let uuid = uuid.trim().to_string();
    if !looks_like_uuid(&uuid) {
        return err("uuid inválido");
    }
    let id = normalize_item_id(&item_id)?;
    if !(1..=2304).contains(&count) {
        return err("a quantidade deve ficar entre 1 e 2304");
    }
    let root = util::server_dir(&server_id);
    let name = resolve_player_name_inner(&root, &uuid);

    if send_if_online(&hub, &server_id, &format!("give {name} {id} {count}")) {
        return Ok(ItemStack {
            slot: -1,
            id,
            count,
            display_name: None,
            damage: 0,
            lore: None,
            nbt_present: false,
            max_stack: 64,
            nbt_json: "null".to_string(),
        });
    }

    let (path, mut nbt) = load_player_or_err(&root, &uuid)?;
    let mut remaining = count;
    let mut first: Option<ItemStack> = None;
    while remaining > 0 {
        let batch = remaining.min(64);
        let Some(slot) = free_inventory_slot(&nbt) else {
            return err("inventário cheio");
        };
        let item = new_item_tag(&id, batch);
        let stack = item_from_tag(slot, &item);
        if first.is_none() {
            first = Some(stack);
        }
        container_put(&mut nbt, Container::Inventory, slot, item)?;
        remaining -= batch;
    }
    write_player_nbt(&uuid, &path, &nbt)?;

    first.ok_or_else(|| crate::error::CommandError::Other("nenhum item aplicado".into()))
}

/// Lista os kits disponíveis (para o frontend popular o seletor).
#[tauri::command]
pub(crate) fn list_kits() -> CommandResult<Vec<KitInfo>> {
    Ok(KITS
        .iter()
        .map(|k| KitInfo {
            id: k.id.to_string(),
            label: k.label.to_string(),
            description: k.description.to_string(),
            items: k.items.len(),
        })
        .collect())
}

/// Índice em `ArmorItems` de um item de armadura (ordem do jogo: botas, calças,
/// peitoral, capacete). `None` para itens que não são armadura.
fn armor_slot_for(id: &str) -> Option<i32> {
    let bare = id.trim_start_matches("minecraft:");
    if bare.ends_with("_boots") {
        Some(0)
    } else if bare.ends_with("_leggings") {
        Some(1)
    } else if bare.ends_with("_chestplate") {
        Some(2)
    } else if bare.ends_with("_helmet") {
        Some(3)
    } else {
        None
    }
}

/// Grava encantamentos no item nos dois formatos de NBT.
///
/// `components."minecraft:enchantments"` é o formato 1.20.5+ e
/// `tag.Enchantments` é o formato antigo — o servidor lê o que conhece e ignora
/// o outro.
fn apply_enchants(item: &mut Tag, enchants: &[(&str, i32)]) {
    let mut levels: Vec<(String, Tag)> = Vec::new();
    let mut legacy: Vec<Tag> = Vec::new();
    for (name, level) in enchants {
        levels.push((name.to_string(), Tag::Int(*level)));
        let mut entry: Vec<(String, Tag)> = Vec::new();
        entry.push(("id".to_string(), Tag::String(name.to_string())));
        entry.push(("lvl".to_string(), Tag::Short(*level as i16)));
        legacy.push(Tag::Compound(entry));
    }
    if levels.is_empty() {
        return;
    }

    // formato novo (1.20.5+)
    let mut components: Vec<(String, Tag)> = Vec::new();
    if let Some(Tag::Compound(existing)) = item.get("components") {
        components = existing.clone();
    }
    components.retain(|(k, _)| k != "minecraft:enchantments");
    components.push(("minecraft:enchantments".to_string(), Tag::Compound(levels)));
    item.set("components", Tag::Compound(components));

    // formato antigo
    let mut tag: Vec<(String, Tag)> = Vec::new();
    if let Some(Tag::Compound(existing)) = item.get("tag") {
        tag = existing.clone();
    }
    tag.retain(|(k, _)| k != "Enchantments");
    tag.push((
        "Enchantments".to_string(),
        Tag::List(ListTag { kind: 10, items: legacy }),
    ));
    item.set("tag", Tag::Compound(tag));
}

/// Aplica um kit pré-definido (offline pelo NBT, online por `/give`).
///
/// Devolve quantos itens foram aplicados. **Limitação:** com o servidor online
/// mandamos `/give` para cada item e os encantamentos não são aplicados; com o
/// servidor offline os encantamentos são gravados no NBT nos dois formatos.
#[tauri::command]
pub(crate) async fn kit_player(
    server_id: String,
    uuid: String,
    kit_id: String,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<usize> {
    let uuid = uuid.trim().to_string();
    if !looks_like_uuid(&uuid) {
        return err("uuid inválido");
    }
    let kit = KITS
        .iter()
        .find(|k| k.id.eq_ignore_ascii_case(kit_id.trim()))
        .ok_or_else(|| crate::error::CommandError::Other(format!("kit desconhecido: {kit_id}")))?;
    let root = util::server_dir(&server_id);
    let name = resolve_player_name_inner(&root, &uuid);

    let mut applied = 0usize;
    if is_online(&hub, &server_id) {
        // caminho "online": só /give, sem encantamento (sintaxe frágil entre
        // versões e o comando vanilla de kit completo não existe)
        for item in kit.items {
            send_if_online(&hub, &server_id, &format!("give {name} {} {}", item.id, item.count));
            applied += 1;
        }
        return Ok(applied);
    }

    let (path, mut nbt) = load_player_or_err(&root, &uuid)?;
    for item in kit.items {
        let mut stack = new_item_tag(item.id, item.count);
        if !item.enchant.is_empty() {
            apply_enchants(&mut stack, item.enchant);
        }
        // itens de armadura vão para os slots certos do ArmorItems
        if let Some(index) = armor_slot_for(item.id) {
            container_put(&mut nbt, Container::Armor, index, stack)?;
            applied += 1;
            continue;
        }
        let mut left = item.count;
        while left > 0 {
            let batch = left.min(64);
            let Some(slot) = free_inventory_slot(&nbt) else {
                return Ok(applied);
            };
            let mut single = stack.clone();
            set_item_stack_count(&mut single, batch);
            container_put(&mut nbt, Container::Inventory, slot, single)?;
            left -= batch;
            applied += 1;
        }
    }
    write_player_nbt(&uuid, &path, &nbt)?;
    Ok(applied)
}

/// Mata o jogador (manda `kill` no console; o nick é resolvido pelo usercache).
#[tauri::command]
pub(crate) fn kill_player(
    server_id: String,
    name_or_uuid: String,
    hub: tauri::State<'_, std::sync::Arc<crate::process_mgr::ProcessHub>>,
) -> CommandResult<()> {
    let value = name_or_uuid.trim();
    if value.is_empty() {
        return err("informe o nome ou uuid do jogador");
    }
    if !hub.is_running(&server_id) {
        return err("o servidor precisa estar online para usar /kill");
    }
    let root = util::server_dir(&server_id);
    let name = if looks_like_uuid(value) {
        resolve_player_name_inner(&root, value)
    } else {
        value.to_string()
    };
    if name == "Desconhecido" || name.is_empty() {
        return err("não foi possível resolver o nome do jogador");
    }
    hub.send(&server_id, &format!("kill {name}"))?;
    Ok(())
}
