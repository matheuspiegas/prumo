//! Log em arquivo. No Windows o app é um programa de janela (sem console), então o que sairia no
//! terminal se perde; e com `panic = "abort"` um erro derrubaria o processo sem deixar rastro.
//! Cada linha é gravada e liberada na hora, para que, se o processo morrer por um erro nativo
//! (C++/FFI), a ÚLTIMA linha do arquivo mostre onde parou.
use std::{fs, io::Write, path::{Path, PathBuf}, sync::OnceLock};
use tarefas_core::data_dir;

const MAX_BYTES: u64 = 1_000_000;
static FILE: OnceLock<PathBuf> = OnceLock::new();

pub fn log_dir() -> PathBuf {
    data_dir().join("logs")
}

/// Acrescenta uma linha com data/hora ao arquivo.
pub fn append_line(path: &Path, msg: &str) {
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{} {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"), msg);
    }
}

/// Mantém um arquivo anterior (`prumo.old.log`) quando o atual passa de ~1 MB.
fn rotate(path: &Path, max: u64) {
    if fs::metadata(path).map(|m| m.len() > max).unwrap_or(false) {
        let _ = fs::rename(path, path.with_file_name("prumo.old.log"));
    }
}

pub fn write(msg: &str) {
    if let Some(p) = FILE.get() {
        append_line(p, msg);
    }
}

/// Usa `crate::plog!("texto {}", x)`.
#[macro_export]
macro_rules! plog {
    ($($arg:tt)*) => { $crate::logging::write(&format!($($arg)*)) };
}

pub fn init() {
    let dir = log_dir();
    let _ = fs::create_dir_all(&dir);
    let file = dir.join("prumo.log");
    rotate(&file, MAX_BYTES);
    let _ = FILE.set(file);

    // Registra o erro (mensagem + local) antes de o processo abortar.
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        write(&format!(
            "PÂNICO na thread {:?}: {info}\n{}",
            thread.name().unwrap_or("?"),
            std::backtrace::Backtrace::force_capture()
        ));
        prev(info);
    }));

    write(&format!(
        "=== Prumo {} iniciado | so={} arq={} ggml={} ===",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
        crate::stt::GGML_ENABLED
    ));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_timestamped_lines_and_rotates() {
        let dir = std::env::temp_dir().join(format!("prumo-log-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("prumo.log");
        append_line(&f, "primeira");
        append_line(&f, "segunda");
        let txt = fs::read_to_string(&f).unwrap();
        assert_eq!(txt.lines().count(), 2);
        assert!(txt.lines().next().unwrap().ends_with("primeira"));
        // 2024-01-01 12:00:00.000 → começa com ano de 4 dígitos
        assert!(txt.chars().take(4).all(|c| c.is_ascii_digit()));

        rotate(&f, 5);
        assert!(!f.exists() && dir.join("prumo.old.log").exists());
        fs::remove_dir_all(&dir).ok();
    }
}
