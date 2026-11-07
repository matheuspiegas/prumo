//! Comandos de voz: gravar → transcrever (local) → interpretar (claude -p) → tarefa.
use crate::interpret::{self, Parsed};
use crate::settings::{self, Settings};
use crate::stt::{self, Discovery};
use crate::{AppDb, audio};
use serde::Serialize;
use std::{sync::Mutex, time::Instant};
use tauri::{AppHandle, Emitter, State};
use std::sync::atomic::{AtomicU32, Ordering};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

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
    crate::plog!("voz: iniciando gravação");
    *slot = Some(audio::start(app).inspect_err(|e| crate::plog!("voz: ERRO ao iniciar gravação: {e}"))?);
    crate::plog!("voz: gravando");
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
    let samples = rec.finish().inspect_err(|e| crate::plog!("voz: ERRO ao encerrar gravação: {e}"))?;
    crate::plog!("voz: gravação encerrada: {} amostras ({:.1}s a 16 kHz)", samples.len(), samples.len() as f32 / audio::TARGET_RATE as f32);
    if samples.len() < (audio::TARGET_RATE as usize * 4 / 10) {
        return Err("Gravação muito curta".into());
    }
    let model = stt::resolve(s.stt_model_dir.as_deref()).ok_or_else(|| {
        let msg = if stt::discover().models.iter().any(|m| !m.supported) {
            "Encontrei modelos do Handy, mas este build do Prumo não consegue usá-los (falta o motor ggml). Veja Configurações > Voz.".to_string()
        } else {
            "Nenhum modelo de transcrição encontrado. Instale o Handy ou escolha um modelo em Configurações.".to_string()
        };
        // Sem isto a falha não deixava rastro no log (o build sem ggml parecia travar em silêncio).
        crate::plog!("voz: ERRO ao escolher o modelo: {msg}");
        msg
    })?;

    let _ = app.emit("voice-status", "transcribing");
    let t_stt = Instant::now();
    let transcript = stt::transcribe_isolated(&model, &samples).inspect_err(|e| crate::plog!("voz: ERRO na transcrição: {e}"))?;
    crate::plog!("voz: transcrição ok ({} caracteres) em {:.2?} (inclui iniciar o processo auxiliar)", transcript.chars().count(), t_stt.elapsed());
    if transcript.is_empty() {
        return Err("Não consegui ouvir nada na gravação".into());
    }

    let _ = app.emit("voice-status", "interpreting");
    match interpret::interpret(s, &transcript) {
        Ok(parsed) => {
            crate::plog!("voz: interpretação ok (data={:?})", parsed.date);
            Ok(Outcome { transcript, parsed, warning: None })
        }
        Err(e) => {
            crate::plog!("voz: interpretação falhou, usando texto bruto: {e}");
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
        .map_err(|e| {
            crate::plog!("voz: a tarefa de transcrição terminou de forma inesperada: {e}");
            format!("A transcrição falhou de forma inesperada ({e}). Veja o log em Configurações > Diagnóstico.")
        })??;
    crate::plog!("voz: tarefa criada");

    let s = settings::load();
    let db = db.0.lock().map_err(err)?;
    let id = db
        .add_task_from(&out.parsed.title, &out.parsed.notes, out.parsed.date.as_deref(), "voz")
        .map_err(err)?;
    if s.auto_approve {
        db.approve_task(id).map_err(err)?;
    }
    drop(db);
    let _ = app.emit("tasks-changed", ());
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

/// Id do atalho do quick-add, para o handler distinguir qual atalho foi pressionado.
static QUICK_ADD_ID: AtomicU32 = AtomicU32::new(0);

pub fn is_quick_add(shortcut: &Shortcut) -> bool {
    shortcut.id() == QUICK_ADD_ID.load(Ordering::Relaxed)
}

/// (Re)registra os dois atalhos globais: voz (`voice-toggle`) e quick-add (abre a janelinha).
/// Um atalho inválido ou em uso não impede o outro; os erros são reunidos na resposta.
pub fn register_shortcut(app: &AppHandle, voice: &str, quick_add: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(err)?;
    QUICK_ADD_ID.store(0, Ordering::Relaxed);
    if voice.eq_ignore_ascii_case(quick_add) {
        return Err("O atalho de voz e o da tarefa rápida precisam ser diferentes".into());
    }
    let mut erros = Vec::new();
    if let Err(e) = gs.register(voice) {
        erros.push(format!("Atalho de voz inválido ou já em uso ({voice}): {e}"));
    }
    match quick_add.parse::<Shortcut>() {
        Ok(sc) => match gs.register(sc) {
            Ok(()) => QUICK_ADD_ID.store(sc.id(), Ordering::Relaxed),
            Err(e) => erros.push(format!("Atalho da tarefa rápida inválido ou já em uso ({quick_add}): {e}")),
        },
        Err(e) => erros.push(format!("Atalho da tarefa rápida inválido ({quick_add}): {e}")),
    }
    if erros.is_empty() { Ok(()) } else { Err(erros.join("\n")) }
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    let saved = settings::save(&settings).map_err(err)?;
    register_shortcut(&app, &saved.shortcut, &saved.quick_add_shortcut)?;
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
