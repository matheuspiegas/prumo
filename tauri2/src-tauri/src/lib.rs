mod audio;
mod boards;
mod interpret;
mod logging;
mod quickadd;
mod reminders;
mod settings;
mod stt;
mod tags_cmds;
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
    /// Progresso do checklist (preenchido em `list_tasks`).
    subtasks_done: i64,
    subtasks_total: i64,
    tags: Vec<String>,
}

/// Converte tarefas em DTOs preenchendo tags e progresso do checklist (uma consulta agrupada cada).
fn with_tags(db: &Db, tasks: Vec<Task>) -> Result<Vec<TaskDto>, String> {
    let ids: Vec<i64> = tasks.iter().map(|t| t.id).collect();
    let mut map = db.tags_for(&ids).map_err(err)?;
    let progress = db.subtask_progress(&ids).map_err(err)?;
    Ok(tasks
        .into_iter()
        .map(|t| {
            let tags = map.remove(&t.id).unwrap_or_default();
            let (done, total) = progress.get(&t.id).copied().unwrap_or((0, 0));
            TaskDto { tags, subtasks_done: done, subtasks_total: total, ..t.into() }
        })
        .collect())
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
            subtasks_done: 0,
            subtasks_total: 0,
            tags: Vec::new(),
        }
    }
}

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

/// Comando para registrar o servidor MCP do Prumo no Claude Code.
#[tauri::command]
fn mcp_command() -> String {
    let exe = if cfg!(windows) { "prumo-cli.exe" } else { "prumo-cli" };
    let mut cands: Vec<PathBuf> = vec![];
    // Produção (e `tauri dev`): o sidecar fica ao lado do executável do app.
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())) {
        cands.push(dir.join(exe));
    }
    // Fallback em desenvolvimento: binário compilado em cli/target.
    let cli = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../cli/target");
    cands.push(cli.join("release").join(exe));
    cands.push(cli.join("debug").join(exe));
    let path = cands
        .into_iter()
        .find(|p| p.is_file())
        .and_then(|p| p.canonicalize().ok())
        .map(|p| p.display().to_string().trim_start_matches(r"\\?\").replace('\\', "/"))
        .unwrap_or_else(|| "prumo-cli".to_string());
    format!("claude mcp add prumo -- \"{path}\" mcp")
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
    with_tags(&db, tasks)
}

#[derive(Serialize)]
struct DayDto {
    date: String,
    tasks: Vec<TaskDto>,
}

#[derive(Serialize)]
struct WeekDto {
    overdue: Vec<TaskDto>,
    days: Vec<DayDto>,
    undated: Vec<TaskDto>,
}

/// Visão Semana: atrasadas, `days` dias a partir de `from` (YYYY-MM-DD) e tarefas sem data.
#[tauri::command]
fn list_week(db: State<AppDb>, from: String, days: i64) -> Result<WeekDto, String> {
    let db = lock(&db)?;
    let raw = db.week(&from, days, &today()).map_err(err)?;
    // Uma só chamada de `with_tags` para a união; depois redistribui nos grupos.
    let (n_over, n_undated) = (raw.overdue.len(), raw.undated.len());
    let lens: Vec<usize> = raw.days.iter().map(|(_, t)| t.len()).collect();
    let dates: Vec<String> = raw.days.iter().map(|(d, _)| d.clone()).collect();
    let all: Vec<Task> = raw
        .overdue
        .into_iter()
        .chain(raw.days.into_iter().flat_map(|(_, t)| t))
        .chain(raw.undated)
        .collect();
    let mut it = with_tags(&db, all)?.into_iter();
    let overdue = it.by_ref().take(n_over).collect();
    let days = dates
        .into_iter()
        .zip(lens)
        .map(|(date, n)| DayDto { date, tasks: it.by_ref().take(n).collect() })
        .collect();
    let undated = it.by_ref().take(n_undated).collect();
    Ok(WeekDto { overdue, days, undated })
}

/// Move a tarefa para `date` (None = sem data) na posição `index` entre as pendentes da coluna.
#[tauri::command]
fn move_task(app: AppHandle, db: State<AppDb>, id: i64, date: Option<String>, index: i64) -> Result<(), String> {
    let date = date.filter(|d| !d.is_empty());
    lock(&db)?.move_task(id, date.as_deref(), index).map_err(err)?;
    let _ = app.emit("tasks-changed", ());
    Ok(())
}

#[tauri::command]
fn add_subtask(db: State<AppDb>, parent_id: i64, title: String) -> Result<i64, String> {
    lock(&db)?.add_subtask(parent_id, &title).map_err(err)
}

#[tauri::command]
fn list_subtasks(db: State<AppDb>, parent_id: i64) -> Result<Vec<TaskDto>, String> {
    Ok(lock(&db)?
        .subtasks(parent_id)
        .map_err(err)?
        .into_iter()
        .map(Into::into)
        .collect())
}

#[tauri::command]
fn rename_subtask(db: State<AppDb>, id: i64, title: String) -> Result<(), String> {
    lock(&db)?.rename_subtask(id, &title).map_err(err)
}

#[tauri::command]
fn reorder_subtasks(db: State<AppDb>, parent_id: i64, ids: Vec<i64>) -> Result<(), String> {
    lock(&db)?.reorder_subtasks(parent_id, &ids).map_err(err)
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
fn set_done(app: AppHandle, db: State<AppDb>, id: i64, done: bool) -> Result<(), String> {
    let spawned = {
        let db = lock(&db)?;
        // Concluir uma tarefa recorrente pendente gera a próxima ocorrência.
        let repeats = done && db.get_recurrence(id).map_err(err)?.is_some() && !db.get_task(id).map_err(err)?.done;
        db.set_done(id, done).map_err(err)?;
        repeats
    };
    if spawned {
        let _ = app.emit("tasks-changed", ());
    }
    Ok(())
}

#[tauri::command]
fn set_recurrence(db: State<AppDb>, id: i64, recurrence: Option<String>) -> Result<(), String> {
    lock(&db)?.set_recurrence(id, recurrence.as_deref()).map_err(err)
}

#[tauri::command]
fn approve_task(db: State<AppDb>, id: i64) -> Result<(), String> {
    lock(&db)?.approve_task(id).map_err(err)
}

#[tauri::command]
fn delete_task(db: State<AppDb>, id: i64) -> Result<(), String> {
    // Excluir = mover para a lixeira (recuperável por 30 dias).
    lock(&db)?.trash_task(id).map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrashDto {
    task: TaskDto,
    days_ago: i64,
    days_left: i64,
}

#[tauri::command]
fn list_trash(db: State<AppDb>) -> Result<Vec<TrashDto>, String> {
    Ok(lock(&db)?
        .list_trash()
        .map_err(err)?
        .into_iter()
        .map(|i| TrashDto { task: i.task.into(), days_ago: i.days_ago, days_left: i.days_left })
        .collect())
}

#[tauri::command]
fn restore_task(app: AppHandle, db: State<AppDb>, id: i64) -> Result<(), String> {
    lock(&db)?.restore_task(id).map_err(err)?;
    let _ = app.emit("tasks-changed", ());
    Ok(())
}

#[tauri::command]
fn purge_task(db: State<AppDb>, id: i64) -> Result<(), String> {
    lock(&db)?.purge_task(id).map_err(err)
}

#[tauri::command]
fn empty_trash(db: State<AppDb>) -> Result<usize, String> {
    lock(&db)?.empty_trash().map_err(err)
}

#[tauri::command]
fn search_tasks(db: State<AppDb>, query: String) -> Result<Vec<TaskDto>, String> {
    let tasks = lock(&db)?.search(&query).map_err(err)?;
    Ok(tasks.into_iter().map(Into::into).collect())
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

/// Tamanho máximo de uma imagem colada (bytes).
const MAX_PASTED_BYTES: usize = 25 * 1024 * 1024;

/// Recebe os bytes crus de uma imagem colada (corpo binário da chamada, sem base64). O id da
/// tarefa e o nome do arquivo vêm nos cabeçalhos `x-task-id` e `x-filename`.
#[tauri::command]
fn add_attachment_bytes(db: State<AppDb>, request: tauri::ipc::Request<'_>) -> Result<i64, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("corpo da chamada inválido".into());
    };
    if bytes.is_empty() || bytes.len() > MAX_PASTED_BYTES {
        return Err(format!("a imagem precisa ter entre 1 byte e {} MB", MAX_PASTED_BYTES / 1024 / 1024));
    }
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok());
    let task_id: i64 = header("x-task-id").and_then(|v| v.parse().ok()).ok_or("x-task-id ausente")?;
    let filename = header("x-filename").unwrap_or("imagem.png");
    lock(&db)?
        .add_attachment_bytes(task_id, filename, bytes, &data_dir().join("attachments"))
        .map_err(err)
}

/// Bytes de um anexo, para mostrar a miniatura. Procura pelo id: a interface não escolhe caminhos.
#[tauri::command]
fn read_attachment(db: State<AppDb>, id: i64) -> Result<tauri::ipc::Response, String> {
    let a = lock(&db)?.attachment(id).map_err(err)?;
    let bytes = std::fs::read(&a.stored_path).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
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

/// Detecta escritas de OUTRO processo (CLI/MCP) no mesmo banco: `PRAGMA data_version`
/// só muda quando outra conexão faz commit. Usa conexão própria (sem o Mutex do AppDb).
/// Escritas do próprio app também a alteram (conexão distinta), gerando no máximo
/// um `tasks-changed` extra por escrita, que é inofensivo.
fn watch_external_changes(app: AppHandle, path: std::path::PathBuf) {
    std::thread::spawn(move || {
        let db = match Db::open(&path) {
            Ok(d) => d,
            Err(e) => {
                plog!("watcher: {e}");
                return;
            }
        };
        let mut last = db.data_version().ok();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            if let Ok(v) = db.data_version() {
                if last != Some(v) {
                    last = Some(v);
                    let _ = app.emit("tasks-changed", ());
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init();
    tauri::Builder::default()
        // Deve ser o primeiro plugin: uma segunda execução só mostra a janela existente.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
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
            if let Ok(n) = app.state::<AppDb>().0.lock().map(|d| d.purge_expired(30)) { plog!("lixeira: {n:?} descartadas"); }
            app.manage(voice::VoiceState(Mutex::new(None)));
            quickadd::create(app.handle())?;
            let cfg = settings::load();
            if let Err(e) = voice::register_shortcut(app.handle(), &cfg.shortcut, &cfg.quick_add_shortcut) {
                plog!("atalhos: {e}");
            }
            tray::setup(app.handle())?;
            reminders::start(app.handle());
            watch_external_changes(app.handle().clone(), dir.join("prumo.db"));
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
            list_week,
            move_task,
            counts,
            add_task,
            update_task,
            set_done,
            set_recurrence,
            approve_task,
            delete_task,
            list_trash,
            restore_task,
            purge_task,
            empty_trash,
            reorder_tasks,
            list_overdue,
            reschedule_to_today,
            set_priority,
            add_subtask,
            list_subtasks,
            rename_subtask,
            reorder_subtasks,
            search_tasks,
            list_attachments,
            add_attachment,
            add_attachment_bytes,
            read_attachment,
            delete_attachment,
            open_attachment,
            dates,
            open_logs,
            quickadd::quick_add_task,
            reminders::set_task_time,
            tags_cmds::list_tags,
            tags_cmds::set_task_tags,
            tags_cmds::list_tasks_by_tag,
            tags_cmds::rename_tag,
            tags_cmds::delete_tag,
            boards::list_boards,
            boards::create_board,
            boards::rename_board,
            boards::duplicate_board,
            boards::delete_board,
            boards::read_board,
            boards::write_board,
            boards::write_board_thumbnail,
            boards::read_board_thumbnail,
            boards::read_board_library,
            boards::write_board_library,
            boards::read_text_file,
            voice::voice_start,
            voice::voice_stop,
            voice::voice_cancel,
            voice::get_settings,
            mcp_command,
            voice::save_settings,
            voice::discover_models,
            voice::detect_claude,
            voice::test_claude
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
