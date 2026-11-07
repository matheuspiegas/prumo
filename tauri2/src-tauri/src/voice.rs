//! Comandos de voz: gravar → transcrever (local) → interpretar (claude -p) → tarefa.
use crate::interpret::{self, Parsed};
use crate::settings::{self, Settings};
use crate::stt::{self, Discovery};
use crate::{AppDb, audio};
use serde::Serialize;
use std::{sync::Mutex, time::Instant};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

pub struct VoiceState(pub Mutex<Option<audio::Recording>>);

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceResult {
    transcript: String,
    title: String,
    date: Option<String>,
    /// A interpretação por IA falhou: a tarefa usa o texto bruto.
    fallback: bool,
    warning: Option<String>,
    task_id: i64,
    inbox: bool,
}

struct Outcome {
    transcript: String,
    parsed: Parsed,
    warning: Option<String>,
}

#[tauri::command]
pub fn voice_start(app: AppHandle, voice: State<VoiceState>) -> Result<(), String> {
    let mut slot = voice.0.lock().map_err(err)?;
    if slot.is_some() {
        return Err("Já existe uma gravação em andamento".into());
    }
    *slot = Some(audio::start(app)?);
    Ok(())
}

#[tauri::command]
pub fn voice_cancel(voice: State<VoiceState>) -> Result<(), String> {
    if let Some(rec) = voice.0.lock().map_err(err)?.take() {
        let _ = rec.finish();
    }
    Ok(())
}

fn process(app: &AppHandle, rec: audio::Recording, s: &Settings) -> Result<Outcome, String> {
    let samples = rec.finish()?;
    if samples.len() < (audio::TARGET_RATE as usize * 4 / 10) {
        return Err("Gravação muito curta".into());
    }
    let model = stt::resolve(s.stt_model_dir.as_deref()).ok_or_else(|| {
        if stt::discover().models.iter().any(|m| !m.supported) {
            "Encontrei modelos do Handy, mas este build do Prumo não consegue usá-los (falta o motor ggml). Veja Configurações > Voz.".to_string()
        } else {
            "Nenhum modelo de transcrição encontrado. Instale o Handy ou escolha um modelo em Configurações.".to_string()
        }
    })?;

    let _ = app.emit("voice-status", "transcribing");
    let transcript = stt::transcribe(&model, &samples)?;
    if transcript.is_empty() {
        return Err("Não consegui ouvir nada na gravação".into());
    }

    let _ = app.emit("voice-status", "interpreting");
    match interpret::interpret(s, &transcript) {
        Ok(parsed) => Ok(Outcome { transcript, parsed, warning: None }),
        Err(e) => {
            // Nunca perder a gravação: usa o texto bruto como título.
            let title: String = transcript.chars().take(80).collect();
            let notes = if transcript.chars().count() > 80 { transcript.clone() } else { String::new() };
            Ok(Outcome { transcript, parsed: Parsed { title, date: None, notes }, warning: Some(e) })
        }
    }
}

#[tauri::command]
pub async fn voice_stop(
    app: AppHandle,
    db: State<'_, AppDb>,
    voice: State<'_, VoiceState>,
) -> Result<VoiceResult, String> {
    let rec = voice.0.lock().map_err(err)?.take().ok_or("Nenhuma gravação em andamento")?;
    let settings = settings::load();
    let app2 = app.clone();
    let out = tauri::async_runtime::spawn_blocking(move || process(&app2, rec, &settings))
        .await
        .map_err(err)??;

    let s = settings::load();
    let db = db.0.lock().map_err(err)?;
    let id = db
        .add_task_from(&out.parsed.title, &out.parsed.notes, out.parsed.date.as_deref(), "voz")
        .map_err(err)?;
    if s.auto_approve {
        db.approve_task(id).map_err(err)?;
    }
    Ok(VoiceResult {
        transcript: out.transcript,
        title: out.parsed.title,
        date: out.parsed.date,
        fallback: out.warning.is_some(),
        warning: out.warning,
        task_id: id,
        inbox: !s.auto_approve,
    })
}

#[tauri::command]
pub fn get_settings() -> Settings {
    settings::load()
}

/// (Re)registra o atalho global; ao ser pressionado o plugin emite `voice-toggle`.
pub fn register_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(err)?;
    gs.register(shortcut).map_err(|e| format!("Atalho inválido ou já em uso ({shortcut}): {e}"))
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    let saved = settings::save(&settings).map_err(err)?;
    register_shortcut(&app, &saved.shortcut)?;
    Ok(saved)
}

#[tauri::command]
pub async fn discover_models() -> Result<Discovery, String> {
    tauri::async_runtime::spawn_blocking(stt::discover).await.map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStatus {
    path: Option<String>,
    version: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub async fn detect_claude(path: Option<String>) -> Result<ClaudeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(p) = interpret::find_claude(path.as_deref()) else {
            return ClaudeStatus { path: None, version: None, error: Some("CLI `claude` não encontrada".into()) };
        };
        match interpret::claude_version(&p) {
            Ok(v) => ClaudeStatus { path: Some(p.to_string_lossy().into()), version: Some(v), error: None },
            Err(e) => ClaudeStatus { path: Some(p.to_string_lossy().into()), version: None, error: Some(e) },
        }
    })
    .await
    .map_err(err)
}

#[derive(Serialize)]
pub struct TestResult {
    title: String,
    date: Option<String>,
    notes: String,
    ms: u128,
}

/// Faz uma interpretação de teste com as configurações informadas (ainda não salvas).
#[tauri::command]
pub async fn test_claude(settings: Settings) -> Result<TestResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = settings.sanitized();
        let t = Instant::now();
        let p = interpret::interpret(&s, "ligar para o João amanhã de manhã")?;
        Ok(TestResult { title: p.title, date: p.date, notes: p.notes, ms: t.elapsed().as_millis() })
    })
    .await
    .map_err(err)?
}
