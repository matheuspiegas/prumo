//! Transcrição local reaproveitando modelos já instalados (Handy).
//! Os arquivos do Handy são só lidos, nunca modificados.
use serde::Serialize;
use std::path::{Path, PathBuf};
use tarefas_core::data_dir;
use transcribe_rs::onnx::Quantization;
use transcribe_rs::onnx::parakeet::{ParakeetModel, ParakeetParams};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub path: String,
    pub engine: String,
    pub size_mb: u64,
    /// "handy" ou "prumo"
    pub source: String,
    /// É o modelo selecionado no Handy.
    pub selected_in_handy: bool,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

/// Pasta de dados do Handy (identificador `com.pais.handy`).
pub fn handy_dir() -> Option<PathBuf> {
    if let Some(d) = std::env::var_os("PRUMO_HANDY_DIR") {
        return Some(PathBuf::from(d));
    }
    if cfg!(target_os = "macos") {
        home().map(|h| h.join("Library/Application Support/com.pais.handy"))
    } else if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("com.pais.handy"))
    } else {
        home().map(|h| h.join(".local/share/com.pais.handy"))
    }
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

fn scan(root: &Path, source: &str, selected: Option<&str>, out: &mut Vec<ModelInfo>) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if !p.is_dir() || quantization_if_parakeet(&p).is_none() {
            continue;
        }
        let id = e.file_name().to_string_lossy().into_owned();
        // O Handy guarda o id sem o sufixo de quantização ("parakeet-tdt-0.6b-v3").
        let is_sel = selected.is_some_and(|s| id == s || id.starts_with(&format!("{s}-")));
        out.push(ModelInfo {
            id,
            path: p.to_string_lossy().into_owned(),
            engine: "parakeet".into(),
            size_mb: dir_size(&p) / 1_048_576,
            source: source.into(),
            selected_in_handy: is_sel,
        });
    }
}

/// Modelos utilizáveis encontrados no Handy e na pasta própria do Prumo.
/// O selecionado no Handy vem primeiro.
pub fn discover() -> Vec<ModelInfo> {
    let mut out = Vec::new();
    if let Some(h) = handy_dir() {
        let sel = handy_selected(&h);
        scan(&h.join("models"), "handy", sel.as_deref(), &mut out);
    }
    scan(&data_dir().join("models"), "prumo", None, &mut out);
    out.sort_by_key(|m| (!m.selected_in_handy, m.size_mb));
    out
}

/// Modelo a usar: o escolhido nas configurações ou o melhor detectado.
pub fn resolve(configured: Option<&str>) -> Option<PathBuf> {
    configured
        .map(PathBuf::from)
        .filter(|p| quantization_if_parakeet(p).is_some())
        .or_else(|| discover().into_iter().next().map(|m| PathBuf::from(m.path)))
}

/// `samples`: mono, f32, 16 kHz. O modelo é carregado e liberado a cada chamada,
/// para não manter ~GB de RAM ocupados com o app ocioso.
pub fn transcribe(model_dir: &Path, samples: &[f32]) -> Result<String, String> {
    let q = quantization_if_parakeet(model_dir).ok_or("Pasta de modelo inválida (esperado Parakeet ONNX)")?;
    let mut model = ParakeetModel::load(model_dir, &q).map_err(|e| format!("Falha ao carregar o modelo: {e}"))?;
    let res = model
        .transcribe_with(samples, &ParakeetParams::default())
        .map_err(|e| format!("Falha na transcrição: {e}"))?;
    Ok(res.text.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &Path, names: &[&str]) {
        std::fs::create_dir_all(dir).unwrap();
        for n in names {
            std::fs::write(dir.join(n), b"x").unwrap();
        }
    }

    #[test]
    fn discovers_handy_parakeet_and_marks_selected() {
        let root = std::env::temp_dir().join(format!("prumo-stt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let models = root.join("models");
        let good = ["encoder-model.int8.onnx", "decoder_joint-model.int8.onnx", "nemo128.onnx", "vocab.txt", "._vocab.txt"];
        touch(&models.join("parakeet-tdt-0.6b-v3-int8"), &good);
        touch(&models.join("incompleto"), &["vocab.txt"]);
        std::fs::write(root.join("settings_store.json"), r#"{"settings":{"selected_model":"parakeet-tdt-0.6b-v3"}}"#).unwrap();

        let mut out = Vec::new();
        scan(&models, "handy", handy_selected(&root).as_deref(), &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "parakeet-tdt-0.6b-v3-int8");
        assert!(out[0].selected_in_handy);
        assert!(matches!(quantization_if_parakeet(&models.join("parakeet-tdt-0.6b-v3-int8")), Some(Quantization::Int8)));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn reads_selected_model_at_root_too() {
        let root = std::env::temp_dir().join(format!("prumo-stt2-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
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

    /// WAV → Parakeet → claude -p real. PRUMO_TEST_WAV=... cargo test --release --lib real_pipeline -- --ignored --nocapture
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
