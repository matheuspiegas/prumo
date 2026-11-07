//! Transcrição local reaproveitando modelos já instalados (Handy).
//! Os arquivos do Handy são só lidos, nunca modificados.
//!
//! Dois motores:
//! - **Parakeet ONNX** (pasta; formato antigo do Handy), via `transcribe-rs`. Sempre disponível.
//! - **ggml** (arquivos `.bin` do Whisper e `.gguf`; formato atual do Handy), via `transcribe-cpp`.
//!   Só existe quando o app é compilado com a feature `ggml` (exige CMake).
use serde::Serialize;
use std::path::{Path, PathBuf};
use tarefas_core::data_dir;
use transcribe_rs::onnx::Quantization;
use transcribe_rs::onnx::parakeet::{ParakeetModel, ParakeetParams};

/// Este build inclui o motor ggml (Whisper `.bin` e `.gguf`)?
pub const GGML_ENABLED: bool = cfg!(feature = "ggml");

const GGML_MISSING: &str = "Este build do Prumo não inclui o motor ggml (Whisper/GGUF)";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    /// Pasta (Parakeet ONNX) ou arquivo (`.bin`/`.gguf`).
    pub path: String,
    /// "parakeet-onnx" ou "ggml"
    pub engine: String,
    pub size_mb: u64,
    /// "handy", "handy-hf" (cache do HuggingFace usado pelo Handy) ou "prumo"
    pub source: String,
    /// É o modelo selecionado no Handy.
    pub selected_in_handy: bool,
    /// Este build consegue usar o modelo?
    pub supported: bool,
    pub reason: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Searched {
    pub path: String,
    pub exists: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    pub models: Vec<ModelInfo>,
    /// Onde procuramos (ajuda a diagnosticar quando a lista vem vazia).
    pub searched: Vec<Searched>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Engine {
    ParakeetOnnx,
    Ggml,
}

impl Engine {
    fn id(self) -> &'static str {
        match self {
            Engine::ParakeetOnnx => "parakeet-onnx",
            Engine::Ggml => "ggml",
        }
    }
    fn supported(self) -> bool {
        match self {
            Engine::ParakeetOnnx => true,
            Engine::Ggml => GGML_ENABLED,
        }
    }
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

/// Pastas de dados do Handy (identificador `com.pais.handy`). No Windows o Tauri usa
/// `%APPDATA%` (Roaming) para dados do app, mas também olhamos `%LOCALAPPDATA%` por garantia.
pub fn handy_dirs() -> Vec<PathBuf> {
    if let Some(d) = std::env::var_os("PRUMO_HANDY_DIR") {
        return vec![PathBuf::from(d)];
    }
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    if cfg!(target_os = "macos") {
        home().map(|h| h.join("Library/Application Support/com.pais.handy")).into_iter().collect()
    } else if cfg!(target_os = "windows") {
        [env("APPDATA"), env("LOCALAPPDATA")]
            .into_iter()
            .flatten()
            .map(|d| d.join("com.pais.handy"))
            .collect()
    } else {
        home().map(|h| h.join(".local/share/com.pais.handy")).into_iter().collect()
    }
}

/// Cache do HuggingFace, onde o Handy guarda os modelos `.gguf` do catálogo.
pub fn hf_cache_roots() -> Vec<PathBuf> {
    let env = |k: &str| std::env::var_os(k).map(PathBuf::from);
    if let Some(d) = env("HF_HUB_CACHE") {
        return vec![d];
    }
    if let Some(d) = env("HF_HOME") {
        return vec![d.join("hub")];
    }
    home().map(|h| h.join(".cache/huggingface/hub")).into_iter().collect()
}

/// `selected_model` do Handy (aceita a chave na raiz ou dentro de `settings`).
fn handy_selected(dir: &Path) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("settings_store.json")).ok()?).ok()?;
    v.get("settings")
        .and_then(|s| s.get("selected_model"))
        .or_else(|| v.get("selected_model"))?
        .as_str()
        .map(str::to_string)
}

fn dir_size(p: &Path) -> u64 {
    std::fs::read_dir(p)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| !e.file_name().to_string_lossy().starts_with("._"))
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

fn has_file(dir: &Path, name: &str) -> bool {
    dir.join(name).is_file()
}

/// Layout do Parakeet (ONNX): encoder + decoder_joint + preprocessador + vocabulário.
fn quantization_if_parakeet(dir: &Path) -> Option<Quantization> {
    let common = has_file(dir, "vocab.txt") && has_file(dir, "nemo128.onnx");
    if !common {
        return None;
    }
    if has_file(dir, "encoder-model.int8.onnx") && has_file(dir, "decoder_joint-model.int8.onnx") {
        Some(Quantization::Int8)
    } else if has_file(dir, "encoder-model.onnx") && has_file(dir, "decoder_joint-model.onnx") {
        Some(Quantization::FP32)
    } else {
        None
    }
}

fn ggml_extension(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("bin") || e.eq_ignore_ascii_case("gguf"))
}

/// Descobre o motor pelo que está no caminho (pasta Parakeet ou arquivo `.bin`/`.gguf`).
fn classify(p: &Path) -> Option<Engine> {
    if p.is_dir() && quantization_if_parakeet(p).is_some() {
        Some(Engine::ParakeetOnnx)
    } else if p.is_file() && ggml_extension(p) {
        Some(Engine::Ggml)
    } else {
        None
    }
}

/// Ids que o Handy usa para os modelos Whisper `.bin` do catálogo antigo.
fn handy_id_for_bin(filename: &str) -> Option<&'static str> {
    match filename {
        "ggml-small.bin" => Some("small"),
        "whisper-medium-q4_1.bin" => Some("medium"),
        "ggml-large-v3-turbo.bin" => Some("turbo"),
        "ggml-large-v3-q5_0.bin" => Some("large"),
        "breeze-asr-q5_k.bin" => Some("breeze-asr"),
        _ => None,
    }
}

/// O `selected_model` do Handy aponta para este modelo? (comparação tolerante: o formato do
/// id varia entre o catálogo antigo e o novo)
fn is_selected(selected: Option<&str>, candidates: &[&str]) -> bool {
    let Some(sel) = selected.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()) else {
        return false;
    };
    candidates.iter().any(|c| {
        let c = c.to_lowercase();
        c == sel || c == format!("{sel}-gguf") || c.starts_with(&format!("{sel}-"))
    })
}

fn push(out: &mut Vec<ModelInfo>, id: String, path: &Path, engine: Engine, size_mb: u64, source: &str, selected: bool) {
    out.push(ModelInfo {
        id,
        path: path.to_string_lossy().into_owned(),
        engine: engine.id().into(),
        size_mb,
        source: source.into(),
        selected_in_handy: selected,
        supported: engine.supported(),
        reason: (!engine.supported()).then(|| GGML_MISSING.to_string()),
    });
}

/// Pasta `models` (do Handy ou do Prumo): pastas Parakeet ONNX e arquivos `.bin`/`.gguf`.
fn scan_models_dir(root: &Path, source: &str, selected: Option<&str>, out: &mut Vec<ModelInfo>) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        match classify(&p) {
            Some(Engine::ParakeetOnnx) => {
                let sel = is_selected(selected, &[&name]);
                push(out, name, &p, Engine::ParakeetOnnx, dir_size(&p) / 1_048_576, source, sel);
            }
            Some(Engine::Ggml) => {
                let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| name.clone());
                // Detector de idioma/VAD não são modelos de transcrição.
                let low = stem.to_lowercase();
                if low.contains("silero") || low.contains("vad") || low.contains("language-detect") {
                    continue;
                }
                let mut cands = vec![stem.as_str()];
                if let Some(h) = handy_id_for_bin(&name) {
                    cands.push(h);
                }
                let sel = is_selected(selected, &cands);
                let size = e.metadata().map(|m| m.len() / 1_048_576).unwrap_or(0);
                push(out, stem, &p, Engine::Ggml, size, source, sel);
            }
            None => {}
        }
    }
}

/// O repositório do HuggingFace parece ser de transcrição? Todos os modelos do catálogo do Handy
/// vêm de `handy-computer/*-gguf`; para outros repositórios, usa palavras-chave comuns.
fn looks_like_asr_repo(repo_id: &str) -> bool {
    let low = repo_id.to_lowercase();
    if low.contains("silero") || low.contains("vad") {
        return false;
    }
    low.starts_with("handy-computer/")
        || ["whisper", "parakeet", "canary", "moonshine", "sensevoice", "voxtral", "-asr", "asr-", "gigaam"]
            .iter()
            .any(|k| low.contains(k))
}

/// Cache do HuggingFace: `models--org--repo/snapshots/<rev>/*.gguf`.
fn scan_hf_cache(root: &Path, selected: Option<&str>, out: &mut Vec<ModelInfo>) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    let mut seen = std::collections::HashSet::new();
    for e in rd.flatten() {
        let folder = e.file_name().to_string_lossy().into_owned();
        let Some(rest) = folder.strip_prefix("models--") else { continue };
        let repo_id = rest.replacen("--", "/", 1);
        if !looks_like_asr_repo(&repo_id) {
            continue;
        }
        let repo_name = repo_id.rsplit('/').next().unwrap_or(&repo_id).to_string();
        let Ok(snaps) = std::fs::read_dir(e.path().join("snapshots")) else { continue };
        for snap in snaps.flatten() {
            let Ok(files) = std::fs::read_dir(snap.path()) else { continue };
            for f in files.flatten() {
                let fname = f.file_name().to_string_lossy().into_owned();
                let p = f.path();
                // Os arquivos do snapshot costumam ser links para blobs: `is_file` segue o link.
                if !fname.to_lowercase().ends_with(".gguf") || !p.is_file() {
                    continue;
                }
                if !seen.insert((repo_id.clone(), fname.clone())) {
                    continue;
                }
                let stem = fname.trim_end_matches(".gguf").trim_end_matches(".GGUF").to_string();
                let sel = is_selected(selected, &[&repo_name, &repo_id, &stem]);
                let size = p.metadata().map(|m| m.len() / 1_048_576).unwrap_or(0);
                push(out, format!("{repo_name}/{fname}"), &p, Engine::Ggml, size, "handy-hf", sel);
            }
        }
    }
}

/// Modelos utilizáveis (e os que o Prumo ainda não consegue usar) encontrados no Handy,
/// no cache do HuggingFace e na pasta própria do Prumo. Os utilizáveis vêm primeiro e,
/// entre eles, o selecionado no Handy.
pub fn discover() -> Discovery {
    let mut models = Vec::new();
    let mut searched = Vec::new();
    let mut note = |p: &Path| searched.push(Searched { path: p.to_string_lossy().into_owned(), exists: p.exists() });

    let mut selected: Option<String> = None;
    let handy = handy_dirs();
    for h in &handy {
        selected = selected.or_else(|| handy_selected(h));
    }
    for h in &handy {
        let dir = h.join("models");
        note(&dir);
        scan_models_dir(&dir, "handy", selected.as_deref(), &mut models);
    }
    for root in hf_cache_roots() {
        note(&root);
        scan_hf_cache(&root, selected.as_deref(), &mut models);
    }
    let own = data_dir().join("models");
    note(&own);
    scan_models_dir(&own, "prumo", None, &mut models);

    models.sort_by_key(|m| (!m.supported, !m.selected_in_handy, m.size_mb));
    Discovery { models, searched }
}

/// Modelo a usar: o escolhido nas configurações ou o melhor detectado que este build suporta.
pub fn resolve(configured: Option<&str>) -> Option<PathBuf> {
    configured
        .map(PathBuf::from)
        .filter(|p| classify(p).is_some_and(Engine::supported))
        .or_else(|| discover().models.into_iter().find(|m| m.supported).map(|m| PathBuf::from(m.path)))
}

/// `samples`: mono, f32, 16 kHz. O modelo é carregado e liberado a cada chamada,
/// para não manter ~GB de RAM ocupados com o app ocioso.
pub fn transcribe(model: &Path, samples: &[f32]) -> Result<String, String> {
    let engine = classify(model);
    // Gravado ANTES de carregar o modelo: se o processo morrer num erro nativo (C++/ONNX),
    // esta é a última linha do log.
    crate::plog!("stt: carregando modelo {} (motor={:?}, {} amostras)", model.display(), engine, samples.len());
    let t = std::time::Instant::now();
    let res = transcribe_with_engine(engine, model, samples);
    crate::plog!("stt: terminou em {:.2?} ({})", t.elapsed(), if res.is_ok() { "ok" } else { "erro" });
    res
}

fn transcribe_with_engine(engine: Option<Engine>, model: &Path, samples: &[f32]) -> Result<String, String> {
    match engine {
        Some(Engine::ParakeetOnnx) => transcribe_parakeet(model, samples),
        Some(Engine::Ggml) => transcribe_ggml(model, samples),
        None => Err("Modelo inválido: esperado uma pasta Parakeet ONNX ou um arquivo .bin/.gguf".into()),
    }
}

fn transcribe_parakeet(dir: &Path, samples: &[f32]) -> Result<String, String> {
    let q = quantization_if_parakeet(dir).ok_or("Pasta de modelo inválida (esperado Parakeet ONNX)")?;
    let mut model = ParakeetModel::load(dir, &q).map_err(|e| format!("Falha ao carregar o modelo: {e}"))?;
    let res = model
        .transcribe_with(samples, &ParakeetParams::default())
        .map_err(|e| format!("Falha na transcrição: {e}"))?;
    Ok(res.text.trim().to_string())
}

#[cfg(feature = "ggml")]
fn transcribe_ggml(path: &Path, samples: &[f32]) -> Result<String, String> {
    let res = transcribe_cpp::transcribe(path, samples, &transcribe_cpp::RunOptions::default())
        .map_err(|e| format!("Falha na transcrição (ggml): {e}"))?;
    Ok(res.text.trim().to_string())
}

#[cfg(not(feature = "ggml"))]
fn transcribe_ggml(_path: &Path, _samples: &[f32]) -> Result<String, String> {
    Err(format!("{GGML_MISSING}. Use um build com a feature `ggml`."))
}

/// Tempo máximo do processo de transcrição (carregar um modelo grande na CPU pode demorar).
const WORKER_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

/// Transcreve em um processo separado (o próprio executável, com `--stt-worker`). Se o motor
/// nativo cair, só o processo auxiliar morre: o app mostra o erro e registra o código de saída.
pub fn transcribe_isolated(model: &Path, samples: &[f32]) -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Não achei o executável do Prumo: {e}"))?;
    run_worker(&exe, &data_dir().join("tmp"), model, samples)
}

fn run_worker(exe: &Path, tmp_dir: &Path, model: &Path, samples: &[f32]) -> Result<String, String> {
    use std::process::{Command, Stdio};
    std::fs::create_dir_all(tmp_dir).map_err(|e| format!("Não consegui criar a pasta temporária: {e}"))?;
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let tag = format!("{}-{nanos}", std::process::id());
    let pcm = tmp_dir.join(format!("stt-{tag}.f32"));
    let out = tmp_dir.join(format!("stt-{tag}.json"));

    let mut bytes = Vec::with_capacity(samples.len() * 4);
    for s in samples {
        bytes.extend_from_slice(&s.to_le_bytes());
    }
    std::fs::write(&pcm, &bytes).map_err(|e| format!("Não consegui gravar o áudio temporário: {e}"))?;

    let result = (|| {
        let mut cmd = Command::new(exe);
        cmd.arg("--stt-worker").arg(model).arg(&pcm).arg(&out).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // sem janela de console
        }
        crate::plog!("stt: iniciando processo de transcrição");
        let mut child = cmd.spawn().map_err(|e| format!("Não foi possível iniciar a transcrição: {e}"))?;
        let start = std::time::Instant::now();
        let status = loop {
            match child.try_wait().map_err(|e| e.to_string())? {
                Some(s) => break s,
                None if start.elapsed() > WORKER_TIMEOUT => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let msg = format!("A transcrição não terminou em {}s e foi cancelada", WORKER_TIMEOUT.as_secs());
                    crate::plog!("stt: {msg}");
                    return Err(msg);
                }
                None => std::thread::sleep(std::time::Duration::from_millis(50)),
            }
        };
        match std::fs::read_to_string(&out).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()) {
            Some(v) if v["ok"] == true => Ok(v["text"].as_str().unwrap_or("").to_string()),
            Some(v) => Err(v["error"].as_str().unwrap_or("erro desconhecido").to_string()),
            None => {
                let how = describe_exit(&status);
                crate::plog!("stt: processo de transcrição morreu sem resultado: {how}");
                Err(format!("A transcrição fechou inesperadamente ({how}). Veja o log em Configurações > Diagnóstico."))
            }
        }
    })();
    let _ = std::fs::remove_file(&pcm);
    let _ = std::fs::remove_file(&out);
    result
}

/// Descreve como o processo terminou (sinal no Unix, código NTSTATUS no Windows).
fn describe_exit(st: &std::process::ExitStatus) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(sig) = st.signal() {
            let what = match sig {
                4 => " (instrução ilegal)",
                6 => " (abort)",
                9 => " (encerrado pelo sistema, possivelmente falta de memória)",
                11 => " (acesso inválido à memória)",
                _ => "",
            };
            return format!("sinal {sig}{what}");
        }
    }
    match st.code() {
        Some(c) => {
            let u = c as u32;
            let what = match u {
                0xC000_001D => " (instrução ilegal: a CPU não tem instruções que o motor usa)",
                0xC000_0005 => " (acesso inválido à memória)",
                0xC000_0409 => " (falha fatal / abort)",
                0xC000_00FD => " (estouro de pilha)",
                0xC000_0017 | 0xE000_0001 => " (sem memória)",
                101 => " (erro interno do Rust: veja a linha PÂNICO no log)",
                _ => "",
            };
            format!("código de saída 0x{u:08X}{what}")
        }
        None => "encerrado sem código de saída".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("prumo-stt-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn touch(dir: &Path, names: &[&str]) {
        std::fs::create_dir_all(dir).unwrap();
        for n in names {
            std::fs::write(dir.join(n), b"x").unwrap();
        }
    }

    const PARAKEET: [&str; 5] = ["encoder-model.int8.onnx", "decoder_joint-model.int8.onnx", "nemo128.onnx", "vocab.txt", "._vocab.txt"];

    #[test]
    fn discovers_parakeet_and_marks_selected() {
        let root = tmp("pk");
        let models = root.join("models");
        touch(&models.join("parakeet-tdt-0.6b-v3-int8"), &PARAKEET);
        touch(&models.join("incompleto"), &["vocab.txt"]);
        std::fs::write(root.join("settings_store.json"), r#"{"settings":{"selected_model":"parakeet-tdt-0.6b-v3"}}"#).unwrap();

        let mut out = Vec::new();
        scan_models_dir(&models, "handy", handy_selected(&root).as_deref(), &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "parakeet-tdt-0.6b-v3-int8");
        assert_eq!(out[0].engine, "parakeet-onnx");
        assert!(out[0].selected_in_handy && out[0].supported && out[0].reason.is_none());
        assert!(matches!(quantization_if_parakeet(&models.join("parakeet-tdt-0.6b-v3-int8")), Some(Quantization::Int8)));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn discovers_bin_and_gguf_files_and_reports_support_by_build() {
        let root = tmp("bin");
        let models = root.join("models");
        touch(&models, &["ggml-small.bin", "meu-modelo.gguf", "ggml-large-v3-turbo.bin.partial", ".oculto.bin", "silero-vad.gguf", "notas.txt"]);
        let mut out = Vec::new();
        scan_models_dir(&models, "handy", Some("small"), &mut out);
        out.sort_by(|a, b| a.id.cmp(&b.id));
        let ids: Vec<_> = out.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["ggml-small", "meu-modelo"]);
        assert!(out.iter().all(|m| m.engine == "ggml"));
        // "small" é o id do Handy para ggml-small.bin
        assert!(out[0].selected_in_handy && !out[1].selected_in_handy);
        // Suporte depende de o build incluir o motor ggml.
        assert!(out.iter().all(|m| m.supported == GGML_ENABLED));
        assert!(out.iter().all(|m| m.reason.is_some() == !GGML_ENABLED));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn discovers_handy_gguf_models_in_hf_cache() {
        let root = tmp("hf");
        let snap = |repo: &str| root.join(format!("models--{repo}")).join("snapshots").join("abc123");
        touch(&snap("handy-computer--whisper-small-gguf"), &["whisper-small-q5_0.gguf", "README.md"]);
        touch(&snap("handy-computer--parakeet-tdt-0.6b-v3-gguf"), &["parakeet.gguf"]);
        touch(&snap("handy-computer--silero-vad-v6.2-gguf"), &["silero.gguf"]);
        touch(&snap("alguem--llama-3-8b-gguf"), &["llama.gguf"]);
        touch(&snap("ggerganov--whisper.cpp"), &["ggml-base.gguf"]);

        let mut out = Vec::new();
        scan_hf_cache(&root, Some("whisper-small"), &mut out);
        out.sort_by(|a, b| a.id.cmp(&b.id));
        let ids: Vec<_> = out.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(
            ids,
            ["parakeet-tdt-0.6b-v3-gguf/parakeet.gguf", "whisper-small-gguf/whisper-small-q5_0.gguf", "whisper.cpp/ggml-base.gguf"]
        );
        assert!(out.iter().all(|m| m.source == "handy-hf" && m.engine == "ggml"));
        // selected_model "whisper-small" casa com o repositório "whisper-small-gguf"
        assert_eq!(out.iter().filter(|m| m.selected_in_handy).count(), 1);
        assert!(out.iter().find(|m| m.selected_in_handy).unwrap().id.starts_with("whisper-small-gguf"));
        std::fs::remove_dir_all(&root).ok();
    }


    #[cfg(unix)]
    fn fake_exe(dir: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let p = dir.join(name);
        std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    #[cfg(unix)]
    #[test]
    fn isolated_worker_returns_text_and_errors() {
        let d = tmp("iso");
        let tmpdir = d.join("t");
        // $1=--stt-worker $2=modelo $3=pcm $4=saida
        let ok = fake_exe(&d, "ok", r#"printf '{"ok":true,"text":"ola mundo"}' > "$4""#);
        let err = fake_exe(&d, "err", r#"printf '{"ok":false,"error":"modelo ruim"}' > "$4""#);
        assert_eq!(run_worker(&ok, &tmpdir, Path::new("m"), &[0.1, 0.2]).unwrap(), "ola mundo");
        assert_eq!(run_worker(&err, &tmpdir, Path::new("m"), &[0.1]).unwrap_err(), "modelo ruim");
        // arquivos temporários são removidos
        assert_eq!(std::fs::read_dir(&tmpdir).unwrap().count(), 0);
        std::fs::remove_dir_all(&d).ok();
    }

    #[cfg(unix)]
    #[test]
    fn isolated_worker_reports_a_native_crash_instead_of_dying() {
        let d = tmp("crash");
        let tmpdir = d.join("t");
        let segv = fake_exe(&d, "segv", "kill -SEGV $$");
        let ill = fake_exe(&d, "ill", "kill -ILL $$");
        let exit7 = fake_exe(&d, "exit7", "exit 7");
        let e = run_worker(&segv, &tmpdir, Path::new("m"), &[0.0]).unwrap_err();
        assert!(e.contains("fechou inesperadamente") && e.contains("sinal 11") && e.contains("acesso inválido"), "{e}");
        let e = run_worker(&ill, &tmpdir, Path::new("m"), &[0.0]).unwrap_err();
        assert!(e.contains("sinal 4") && e.contains("instrução ilegal"), "{e}");
        let e = run_worker(&exit7, &tmpdir, Path::new("m"), &[0.0]).unwrap_err();
        assert!(e.contains("0x00000007"), "{e}");
        assert_eq!(std::fs::read_dir(&tmpdir).unwrap().count(), 0);
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn missing_worker_executable_is_a_clean_error() {
        let d = tmp("missing");
        let e = run_worker(&d.join("nao-existe"), &d.join("t"), Path::new("m"), &[0.0]).unwrap_err();
        assert!(e.contains("Não foi possível iniciar"), "{e}");
        std::fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn selection_matching_is_tolerant() {
        assert!(is_selected(Some("small"), &["ggml-small", "small"]));
        assert!(is_selected(Some("parakeet-tdt-0.6b-v3"), &["parakeet-tdt-0.6b-v3-int8"]));
        assert!(is_selected(Some("whisper-small"), &["whisper-small-gguf"]));
        assert!(!is_selected(Some("small"), &["medium", "ggml-medium"]));
        assert!(!is_selected(None, &["small"]));
        assert!(!is_selected(Some("  "), &["small"]));
    }

    #[test]
    fn classifies_by_path() {
        let root = tmp("cls");
        touch(&root.join("pk"), &PARAKEET);
        touch(&root, &["a.bin", "b.txt"]);
        assert_eq!(classify(&root.join("pk")), Some(Engine::ParakeetOnnx));
        assert_eq!(classify(&root.join("a.bin")), Some(Engine::Ggml));
        assert_eq!(classify(&root.join("b.txt")), None);
        assert_eq!(classify(&root.join("nao-existe.gguf")), None);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn reads_selected_model_at_root_too() {
        let root = tmp("sel");
        std::fs::write(root.join("settings_store.json"), r#"{"selected_model":"x"}"#).unwrap();
        assert_eq!(handy_selected(&root).as_deref(), Some("x"));
        std::fs::remove_dir_all(&root).ok();
    }

    /// Teste manual com o modelo real: PRUMO_TEST_WAV=/caminho/fala.wav cargo test --release --lib real_model -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_model_transcribes_wav() {
        let wav = std::env::var("PRUMO_TEST_WAV").expect("defina PRUMO_TEST_WAV");
        let model = resolve(None).expect("nenhum modelo encontrado");
        let samples = transcribe_rs::audio::read_wav_samples(Path::new(&wav)).unwrap();
        println!("modelo: {}", model.display());
        println!("áudio: {:.1}s", samples.len() as f32 / 16000.0);
        let t = std::time::Instant::now();
        let text = transcribe(&model, &samples).unwrap();
        println!("tempo (carregar+transcrever): {:.2?}", t.elapsed());
        println!("TEXTO: {text}");
        assert!(!text.is_empty());
    }

    /// WAV → modelo → claude -p real. PRUMO_TEST_WAV=... cargo test --release --lib real_pipeline -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_pipeline_wav_to_task() {
        let wav = std::env::var("PRUMO_TEST_WAV").expect("defina PRUMO_TEST_WAV");
        let model = resolve(None).expect("nenhum modelo encontrado");
        let samples = transcribe_rs::audio::read_wav_samples(Path::new(&wav)).unwrap();
        let text = transcribe(&model, &samples).unwrap();
        println!("TRANSCRIÇÃO: {text}");
        let t = std::time::Instant::now();
        let parsed = crate::interpret::interpret(&crate::settings::Settings::default(), &text).unwrap();
        println!("INTERPRETAÇÃO ({:.1?}): {parsed:?}", t.elapsed());
    }
}
