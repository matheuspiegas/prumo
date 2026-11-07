mod audio;
mod interpret;
mod logging;
mod quickadd;
mod settings;
mod stt;
mod tray;
mod voice;
pub mod worker;

use serde::Serialize;
use std::{path::PathBuf, sync::Mutex};
use tarefas_core::{Db, Task, data_dir, today, tomorrow};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

pub struct AppDb(pub Mutex<Db>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskDto {
    id: i64,
    title: String,
    notes: String,
    due: Option<String>,
    done: bool,
    source: String,
    status: String,
    priority: i64,
    due_time: Option<String>,
    recurrence: Option<String>,
    parent_id: Option<i64>,
    deleted_at: Option<String>,
}

#[derive(Serialize)]
struct AttachmentDto {
    id: i64,
    filename: String,
    path: String,
    size: i64,
}

#[derive(Serialize)]
struct Counts {
    today: i64,
    tomorrow: i64,
    inbox: i64,
}

impl From<Task> for TaskDto {
    fn from(t: Task) -> Self {
        Self {
            id: t.id,
            title: t.title,
            notes: t.notes,
            due: t.due_date,
            done: t.done,
            source: t.source,
            status: t.status,
            priority: t.priority,
            due_time: t.due_time,
            recurrence: t.recurrence,
            parent_id: t.parent_id,
            deleted_at: t.deleted_at,
        }
    }
}

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

fn lock<'a>(db: &'a State<AppDb>) -> Result<std::sync::MutexGuard<'a, Db>, String> {
    db.0.lock().map_err(err)
}

/// filter: 0 Hoje, 1 Amanhã, 2 Todas, 3 Concluídas, 4 Caixa de entrada
#[tauri::command]
fn list_tasks(db: State<AppDb>, filter: i32) -> Result<Vec<TaskDto>, String> {
    let db = lock(&db)?;
    let tasks = match filter {
        0 => db.tasks_on(&today()),
        1 => db.tasks_on(&tomorrow()),
        2 => db.pending(),
        3 => db.completed(),
        _ => db.inbox(),
    }
    .map_err(err)?;
    Ok(tasks.into_iter().map(Into::into).collect())
}

#[tauri::command]
fn counts(db: State<AppDb>) -> Result<Counts, String> {
    let db = lock(&db)?;
    Ok(Counts {
        today: db.count_pending_on(&today()).map_err(err)?,
        tomorrow: db.count_pending_on(&tomorrow()).map_err(err)?,
        inbox: db.inbox_count().map_err(err)?,
    })
}

#[tauri::command]
fn add_task(db: State<AppDb>, title: String, notes: String, date: Option<String>) -> Result<i64, String> {
    let date = date.filter(|d| !d.is_empty());
    lock(&db)?.add_task(&title, &notes, date.as_deref()).map_err(err)
}

#[tauri::command]
fn update_task(
    db: State<AppDb>,
    id: i64,
    title: String,
    notes: String,
    date: Option<String>,
) -> Result<(), String> {
    let date = date.filter(|d| !d.is_empty());
    lock(&db)?.update_task(id, &title, &notes, date.as_deref()).map_err(err)
}

#[tauri::command]
fn set_done(db: State<AppDb>, id: i64, done: bool) -> Result<(), String> {
    lock(&db)?.set_done(id, done).map_err(err)
}

#[tauri::command]
fn approve_task(db: State<AppDb>, id: i64) -> Result<(), String> {
    lock(&db)?.approve_task(id).map_err(err)
}

#[tauri::command]
fn delete_task(db: State<AppDb>, id: i64) -> Result<(), String> {
    lock(&db)?.delete_task(id).map_err(err)
}

#[tauri::command]
fn reorder_tasks(db: State<AppDb>, ids: Vec<i64>) -> Result<(), String> {
    lock(&db)?.reorder(&ids).map_err(err)
}

/// Tarefas atrasadas (vencimento anterior a hoje, não concluídas).
#[tauri::command]
fn list_overdue(db: State<AppDb>) -> Result<Vec<TaskDto>, String> {
    let tasks = lock(&db)?.overdue(&today()).map_err(err)?;
    Ok(tasks.into_iter().map(Into::into).collect())
}

/// Reagenda para hoje: só a tarefa `id` ou, sem `id`, todas as atrasadas.
#[tauri::command]
fn reschedule_to_today(db: State<AppDb>, id: Option<i64>) -> Result<(), String> {
    let db = lock(&db)?;
    match id {
        Some(id) => db.set_due_date(id, Some(&today())).map_err(err),
        None => db.reschedule_overdue(&today()).map(|_| ()).map_err(err),
    }
}

/// Prioridade: 0 nenhuma, 1 baixa, 2 média, 3 alta.
#[tauri::command]
fn set_priority(db: State<AppDb>, id: i64, priority: i64) -> Result<(), String> {
    lock(&db)?.set_priority(id, priority).map_err(err)
}

#[tauri::command]
fn list_attachments(db: State<AppDb>, task_id: i64) -> Result<Vec<AttachmentDto>, String> {
    Ok(lock(&db)?
        .attachments(task_id)
        .map_err(err)?
        .into_iter()
        .map(|a| AttachmentDto { id: a.id, filename: a.filename, path: a.stored_path, size: a.size })
        .collect())
}

#[tauri::command]
fn add_attachment(db: State<AppDb>, task_id: i64, path: String) -> Result<i64, String> {
    lock(&db)?
        .add_attachment(task_id, &PathBuf::from(path), &data_dir().join("attachments"))
        .map_err(err)
}

#[tauri::command]
fn delete_attachment(db: State<AppDb>, id: i64) -> Result<(), String> {
    lock(&db)?.delete_attachment(id).map_err(err)
}

#[tauri::command]
fn open_attachment(app: AppHandle, path: String) -> Result<(), String> {
    app.opener().open_path(path, None::<&str>).map_err(err)
}

/// Abre a pasta de logs no explorador de arquivos e devolve o caminho.
#[tauri::command]
fn open_logs(app: AppHandle) -> Result<String, String> {
    let dir = logging::log_dir();
    std::fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.to_string_lossy().into_owned();
    app.opener().open_path(path.clone(), None::<&str>).map_err(err)?;
    Ok(path)
}

#[tauri::command]
fn dates() -> (String, String) {
    (today(), tomorrow())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init();
    tauri::Builder::default()
        // Deve ser o primeiro plugin: uma segunda execução só mostra a janela existente.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if voice::is_quick_add(shortcut) {
                            quickadd::open(app);
                        } else {
                            // Só a janela principal trata a voz (o quick-add tem o próprio fluxo).
                            let _ = app.emit_to("main", "voice-toggle", ());
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let dir = data_dir();
            std::fs::create_dir_all(&dir)?;
            app.manage(AppDb(Mutex::new(Db::open(dir.join("prumo.db"))?)));
            app.manage(voice::VoiceState(Mutex::new(None)));
            quickadd::create(app.handle())?;
            let cfg = settings::load();
            if let Err(e) = voice::register_shortcut(app.handle(), &cfg.shortcut, &cfg.quick_add_shortcut) {
                plog!("atalhos: {e}");
            }
            tray::setup(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // A janelinha do quick-add some ao perder o foco ou ser fechada.
            if window.label() == quickadd::LABEL {
                match event {
                    tauri::WindowEvent::Focused(false) => {
                        let _ = window.hide();
                    }
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    _ => {}
                }
            }
            // Fechar a janela principal só a esconde; "Sair" no tray encerra o app.
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    tray::hide_main(window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_tasks,
            counts,
            add_task,
            update_task,
            set_done,
            approve_task,
            delete_task,
            reorder_tasks,
            list_overdue,
            reschedule_to_today,
            set_priority,
            list_attachments,
            add_attachment,
            delete_attachment,
            open_attachment,
            dates,
            open_logs,
            quickadd::quick_add_task,
            voice::voice_start,
            voice::voice_stop,
            voice::voice_cancel,
            voice::get_settings,
            voice::save_settings,
            voice::discover_models,
            voice::detect_claude,
            voice::test_claude
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
