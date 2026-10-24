//! Utilitários de sistema de arquivos, arquivamento e formatação.
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{err, CommandResult};

/// Raiz dos dados do painel (~/.dsm).
pub fn dsm_home() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".dsm")
}

pub fn servers_dir() -> PathBuf {
    dsm_home().join("servers")
}

pub fn java_dir() -> PathBuf {
    dsm_home().join("java")
}

pub fn backups_dir() -> PathBuf {
    dsm_home().join("backups")
}

pub fn cache_dir() -> PathBuf {
    dsm_home().join("cache")
}

pub fn server_dir(id: &str) -> PathBuf {
    servers_dir().join(id)
}

/// Garante que `path` está dentro de `root` (impede path traversal).
pub fn ensure_inside(root: &Path, path: &Path) -> CommandResult<()> {
    let root_canon = match fs::canonicalize(root) {
        Ok(p) => p,
        Err(_) => root.to_path_buf(),
    };
    // para caminhos que ainda não existem, canoniza o pai mais próximo
    let mut probe = path.to_path_buf();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if probe.exists() {
            let canon = fs::canonicalize(&probe).unwrap_or(probe.clone());
            let mut rebuilt = canon.clone();
            for t in tail.iter().rev() {
                rebuilt.push(t);
            }
            if rebuilt.starts_with(&root_canon) {
                return Ok(());
            }
            return err(format!(
                "caminho fora da pasta do servidor: {}",
                rebuilt.display()
            ));
        }
        match (probe.parent(), probe.file_name()) {
            (Some(parent), Some(name)) if parent != Path::new("") => {
                tail.push(name.to_os_string());
                probe = parent.to_path_buf();
            }
            _ => {
                return err(format!("caminho inválido: {}", path.display()));
            }
        }
    }
}

/// Resolve um caminho relativo dentro da pasta do servidor.
pub fn resolve_in_server(root: &Path, rel: &str) -> CommandResult<PathBuf> {
    let rel = rel.trim_start_matches("./").trim_start_matches('/');
    if rel.contains("..") {
        return err("caminho não pode conter '..'");
    }
    let full = if rel.is_empty() {
        root.to_path_buf()
    } else {
        root.join(rel)
    };
    ensure_inside(root, &full)?;
    Ok(full)
}

/// Tamanho de um arquivo/pasta em bytes.
pub fn dir_size(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }
    if path.is_file() {
        return fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    }
    let mut total = 0u64;
    if let Ok(entries) = fs::read_dir(path) {
        for e in entries.flatten() {
            let p = e.path();
            total += dir_size(&p);
        }
    }
    total
}

/// Data/hora formatada para nomes de backup.
pub fn stamp_now() -> String {
    chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string()
}

/// Remove um arquivo/pasta recursivamente sem falhar se não existir.
pub fn remove_any(path: &Path) -> CommandResult<()> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

/// Copia arquivo ou pasta recursivamente.
pub fn copy_any(src: &Path, dst: &Path) -> CommandResult<()> {
    if src.is_dir() {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)?.flatten() {
            let target = dst.join(entry.file_name());
            copy_any(&entry.path(), &target)?;
        }
    } else {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(src, dst)?;
    }
    Ok(())
}

/// Compacta uma lista de caminhos em um .tar.gz.
pub fn create_tar_gz(items: &[(String, PathBuf)], output: &Path) -> CommandResult<()> {
    let file = fs::File::create(output)?;
    let enc = flate2::write::GzEncoder::new(file, flate2::Compression::default());
    let mut builder = tar::Builder::new(enc);
    for (name, path) in items {
        if path.is_dir() {
            builder.append_dir_all(name, path)?;
        } else {
            let mut f = fs::File::open(path)?;
            builder.append_file(name, &mut f)?;
        }
    }
    builder.into_inner()?.finish()?;
    Ok(())
}

/// Extrai .tar.gz / .zip / .7z (7z exige p7zip instalado).
pub fn extract_archive(path: &Path, dest: &Path) -> CommandResult<usize> {
    fs::create_dir_all(dest)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if name.ends_with(".zip") {
        let f = fs::File::open(path)?;
        let mut zip = zip::ZipArchive::new(std::io::BufReader::new(f))
            .map_err(|e| crate::error::CommandError::Parse(e.to_string()))?;
        for i in 0..zip.len() {
            let mut entry = zip
                .by_index(i)
                .map_err(|e| crate::error::CommandError::Parse(e.to_string()))?;
            let out = dest.join(entry.mangled_name());
            if entry.is_dir() {
                fs::create_dir_all(&out)?;
            } else {
                if let Some(p) = out.parent() {
                    fs::create_dir_all(p)?;
                }
                let mut out_file = fs::File::create(&out)?;
                std::io::copy(&mut entry, &mut out_file)?;
            }
        }
        Ok(zip.len())
    } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") || name.ends_with(".tar") {
        let f = fs::File::open(path)?;
        let mut archive = tar::Archive::new(f);
        archive.unpack(dest)?;
        Ok(archive.entries()?.count())
    } else if name.ends_with(".7z") {
        let status = std::process::Command::new("7z")
            .args(["x", "-y", "-bd"])
            .arg(path)
            .arg(format!("-o{}", dest.display()))
            .status()
            .map_err(|_| crate::error::CommandError::Other(
                "extração de .7z requer o pacote p7zip-full instalado".to_string(),
            ))?;
        if !status.success() {
            return err("falha ao extrair .7z");
        }
        Ok(0)
    } else {
        err("formato de arquivo não suportado")
    }
}

/// Bytes em texto legível.
pub fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut size = bytes as f64;
    let mut unit = 0;
    while size >= 1024.0 && unit < UNITS.len() - 1 {
        size /= 1024.0;
        unit += 1;
    }
    format!("{:.1} {}", size, UNITS[unit])
}
