//! Comandos de voz: gravar → transcrever (local) → interpretar (Claude Code ou Codex) → tarefas.
use crate::interpret::{self, Agent, Parsed};
use crate::quickadd::{Created, create_parsed};
use crate::settings::{self, Settings};
use crate::stt::{self, Discovery};
use crate::{AppDb, audio};
use serde::Serialize;
use std::{sync::Mutex, time::Instant};
use tauri::{AppHandle, Emitter, State};
use std::sync::atomic::{AtomicU32, Ordering};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

pub struct VoiceState(pub Mutex<Option<audio::Recording>>);

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceResult {
    transcript: String,
    /// Primeira tarefa (atalho para quem mostra uma só).
    title: String,
    date: Option<String>,
    /// Todas as tarefas criadas a partir da fala.
    tasks: Vec<Created>,
    /// A interpretação por IA falhou: a tarefa usa o texto bruto.
    fallback: bool,
    warning: Option<String>,
    task_id: i64,
    inbox: bool,
}

struct Outcome {
    transcript: String,
    parsed: Vec<Parsed>,
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
            crate::plog!("voz: interpretação ok ({} tarefa(s))", parsed.len());
            Ok(Outcome { transcript, parsed, warning: None })
        }
        Err(e) => {
            crate::plog!("voz: interpretação falhou, usando texto bruto: {e}");
            // Nunca perder a gravação: usa o texto bruto como título.
            let title: String = transcript.chars().take(80).collect();
            let notes = if transcript.chars().count() > 80 { transcript.clone() } else { String::new() };
            let parsed = vec![Parsed { title, date: None, time: None, notes }];
            Ok(Outcome { transcript, parsed, warning: Some(e) })
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
    let s = settings::load();
    let tasks = {
        let db = db.0.lock().map_err(err)?;
        create_parsed(&db, &out.parsed, "voz", s.auto_approve, None, None)?
    };
    crate::plog!("voz: {} tarefa(s) criada(s)", tasks.len());
    let _ = app.emit("tasks-changed", ());
    let first = tasks.first().cloned().ok_or("Nenhuma tarefa criada")?;
    Ok(VoiceResult {
        transcript: out.transcript,
        title: first.title,
        date: first.date,
        tasks,
        fallback: out.warning.is_some(),
        warning: out.warning,
        task_id: first.id,
        inbox: !s.auto_approve,
    })
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    let mut s = settings::load();
    // O usuário pode ter desligado pelo Gerenciador de Tarefas: vale o que está no sistema.
    if let Ok(on) = app.autolaunch().is_enabled() {
        s.launch_at_login = on;
    }
    s
}

/// Regrava a entrada de autostart com o caminho do executável atual, se ela estiver ligada.
/// Corrige entradas apontando para outro lugar (build de debug antigo, app movido/reinstalado).
/// Não liga nada que o usuário tenha desligado, e não roda em build de debug.
pub fn refresh_autostart(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let al = app.autolaunch();
    if al.is_enabled().unwrap_or(false) {
        if let Err(e) = al.enable() {
            crate::plog!("autostart: não consegui atualizar a entrada: {e}");
        }
    }
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
    // Build de debug (tauri dev) não mexe no autostart: gravaria no Registro o caminho de
    // `target\debug\prumo.exe`, que no boot abre console e não acha o servidor do front.
    if !cfg!(debug_assertions) {
        let al = app.autolaunch();
        if al.is_enabled().ok() != Some(saved.launch_at_login) {
            let r = if saved.launch_at_login { al.enable() } else { al.disable() };
            r.map_err(|e| format!("Não consegui alterar o início com o sistema: {e}"))?;
        }
    }
    register_shortcut(&app, &saved.shortcut, &saved.quick_add_shortcut)?;
    Ok(saved)
}

#[tauri::command]
pub async fn discover_models() -> Result<Discovery, String> {
    tauri::async_runtime::spawn_blocking(stt::discover).await.map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    path: Option<String>,
    version: Option<String>,
    error: Option<String>,
}

/// Procura a CLI do agente (`claude` ou `codex`) e lê a versão.
#[tauri::command]
pub async fn detect_agent(agent: String, path: Option<String>) -> Result<AgentStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = Agent::from_setting(&agent);
        let Some(p) = interpret::find_cli(agent, path.as_deref()) else {
            return AgentStatus { path: None, version: None, error: Some(format!("CLI do {} não encontrada", agent.name())) };
        };
        match interpret::cli_version(&p) {
            Ok(v) => AgentStatus { path: Some(p.to_string_lossy().into()), version: Some(v), error: None },
            Err(e) => AgentStatus { path: Some(p.to_string_lossy().into()), version: None, error: Some(e) },
        }
    })
    .await
    .map_err(err)
}

/// Catálogo de modelos do Codex instalado (para a lista em Configurações).
#[tauri::command]
pub async fn codex_models(path: Option<String>) -> Result<Vec<interpret::CodexModel>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cli = interpret::find_cli(Agent::Codex, path.as_deref()).ok_or("CLI do Codex não encontrada")?;
        interpret::codex_models(&cli)
    })
    .await
    .map_err(err)?
}

#[derive(Serialize)]
pub struct TestResult {
    tasks: Vec<Parsed>,
    ms: u128,
}

/// Frase do botão "Testar interpretação".
pub const TEST_PHRASE: &str = "amanhã preciso ir ao dentista às 16 e ir ao mercado às 18, depois de amanhã viajar a Porto Alegre";

/// Faz uma interpretação de teste com as configurações informadas (ainda não salvas).
#[tauri::command]
pub async fn test_agent(settings: Settings) -> Result<TestResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = settings.sanitized();
        let t = Instant::now();
        let tasks = interpret::interpret(&s, TEST_PHRASE)?;
        Ok(TestResult { tasks, ms: t.elapsed().as_millis() })
    })
    .await
    .map_err(err)?
}
