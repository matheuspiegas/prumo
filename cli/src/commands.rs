//! Camada de comandos: opera sobre um `Db` e devolve dados serializáveis.
//! Regra de produto: tudo que o CLI/MCP cria entra na CAIXA DE ENTRADA.

use serde::Serialize;
use tarefas_core::{Db, Task};

pub const SOURCE_CLI: &str = "cli";
pub const SOURCE_MCP: &str = "mcp";

pub type Result<T> = std::result::Result<T, String>;

fn e(err: rusqlite::Error) -> String {
    match err {
        rusqlite::Error::QueryReturnedNoRows => "tarefa não encontrada".to_string(),
        other => other.to_string(),
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TaskView {
    pub id: i64,
    pub title: String,
    pub notes: String,
    pub due_date: Option<String>,
    pub done: bool,
    pub status: String,
    pub source: String,
    pub priority: i64,
    pub tags: Vec<String>,
    pub parent_id: Option<i64>,
    /// Arquivos anexados (inclui imagens coladas nas notas). `path` é o caminho local do arquivo.
    pub attachments: Vec<AttachmentView>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AttachmentView {
    pub id: i64,
    pub filename: String,
    pub path: String,
    /// Tipo MIME quando é uma imagem (png, jpeg, gif, webp); `None` nos demais arquivos.
    pub mime: Option<String>,
    pub size: i64,
}

/// Tarefa com as subtarefas, para a visão detalhada (`show` / `get_task`).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TaskDetail {
    #[serde(flatten)]
    pub task: TaskView,
    pub subtasks: Vec<TaskView>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TagView {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Filter {
    Today,
    Tomorrow,
    All,
    Done,
    Inbox,
    Overdue,
}

impl Filter {
    pub fn parse(s: &str) -> Result<Self> {
        match s.trim().to_lowercase().as_str() {
            "today" | "hoje" => Ok(Self::Today),
            "tomorrow" | "amanha" | "amanhã" => Ok(Self::Tomorrow),
            "all" | "todas" => Ok(Self::All),
            "done" | "concluidas" | "concluídas" => Ok(Self::Done),
            "inbox" | "entrada" => Ok(Self::Inbox),
            "overdue" | "atrasadas" => Ok(Self::Overdue),
            other => Err(format!(
                "filtro inválido: {other} (use today|tomorrow|all|done|inbox|overdue)"
            )),
        }
    }
}

/// Aceita `YYYY-MM-DD`, `hoje` ou `amanhã`/`amanha` (e `today`/`tomorrow`).
pub fn parse_date(s: &str) -> Result<String> {
    let t = s.trim().to_lowercase();
    match t.as_str() {
        "hoje" | "today" => Ok(tarefas_core::today()),
        "amanhã" | "amanha" | "tomorrow" => Ok(tarefas_core::tomorrow()),
        _ => chrono::NaiveDate::parse_from_str(&t, "%Y-%m-%d")
            .map(|d| d.format("%Y-%m-%d").to_string())
            .map_err(|_| format!("data inválida: {s} (use YYYY-MM-DD, hoje ou amanhã)")),
    }
}

fn view(db: &Db, t: Task) -> Result<TaskView> {
    let tags = db.tags_of(t.id).map_err(e)?;
    let attachments = db
        .attachments(t.id)
        .map_err(e)?
        .into_iter()
        .map(|a| AttachmentView {
            id: a.id,
            mime: tarefas_core::image_mime(&a.filename).map(str::to_string),
            filename: a.filename,
            path: a.stored_path,
            size: a.size,
        })
        .collect();
    Ok(TaskView {
        id: t.id,
        title: t.title,
        notes: t.notes,
        due_date: t.due_date,
        done: t.done,
        status: t.status,
        source: t.source,
        priority: t.priority,
        tags,
        parent_id: t.parent_id,
        attachments,
    })
}

fn views(db: &Db, ts: Vec<Task>) -> Result<Vec<TaskView>> {
    ts.into_iter().map(|t| view(db, t)).collect()
}

/// Tarefa existente e fora da lixeira.
fn live(db: &Db, id: i64) -> Result<Task> {
    let t = db.get_task(id).map_err(e)?;
    if t.deleted_at.is_some() {
        return Err("tarefa não encontrada (está na lixeira)".into());
    }
    Ok(t)
}

/// Cria uma tarefa na caixa de entrada (`source` precisa ser diferente de `manual`).
pub fn add(
    db: &Db,
    source: &str,
    title: &str,
    notes: Option<&str>,
    due: Option<&str>,
    tags: &[String],
) -> Result<TaskView> {
    if source == "manual" {
        return Err("fonte 'manual' não é permitida aqui".into());
    }
    let title = title.trim();
    if title.is_empty() {
        return Err("o título não pode ser vazio".into());
    }
    let due = due.map(parse_date).transpose()?;
    let id = db
        .add_task_from(title, notes.unwrap_or(""), due.as_deref(), source)
        .map_err(e)?;
    if !tags.is_empty() {
        db.set_task_tags(id, tags).map_err(e)?;
    }
    view(db, db.get_task(id).map_err(e)?)
}

pub fn list(db: &Db, filter: Filter) -> Result<Vec<TaskView>> {
    let ts = match filter {
        Filter::Today => db.tasks_on(&tarefas_core::today()),
        Filter::Tomorrow => db.tasks_on(&tarefas_core::tomorrow()),
        Filter::All => db.pending(),
        Filter::Done => db.completed(),
        Filter::Inbox => db.inbox(),
        Filter::Overdue => db.overdue(&tarefas_core::today()),
    }
    .map_err(e)?;
    views(db, ts)
}

/// Uma tarefa com notas, anexos e subtarefas.
pub fn show(db: &Db, id: i64) -> Result<TaskDetail> {
    let task = view(db, live(db, id)?)?;
    let subtasks = views(db, db.subtasks(id).map_err(e)?)?;
    Ok(TaskDetail { task, subtasks })
}

pub fn complete(db: &Db, id: i64) -> Result<TaskView> {
    live(db, id)?;
    db.set_done(id, true).map_err(e)?;
    view(db, db.get_task(id).map_err(e)?)
}

pub fn search(db: &Db, query: &str) -> Result<Vec<TaskView>> {
    let ts = db.search(query).map_err(e)?;
    views(db, ts)
}

/// Atualiza só os campos informados. `due`: string vazia remove a data.
pub fn update(
    db: &Db,
    id: i64,
    title: Option<&str>,
    notes: Option<&str>,
    due: Option<&str>,
    tags: Option<&[String]>,
    priority: Option<i64>,
) -> Result<TaskView> {
    let cur = live(db, id)?;
    let title = match title {
        Some(t) if t.trim().is_empty() => return Err("o título não pode ser vazio".into()),
        Some(t) => t.trim().to_string(),
        None => cur.title.clone(),
    };
    let notes = notes.map(str::to_string).unwrap_or(cur.notes.clone());
    let due_date = match due {
        Some(d) if d.trim().is_empty() => None,
        Some(d) => Some(parse_date(d)?),
        None => cur.due_date.clone(),
    };
    db.update_task(id, &title, &notes, due_date.as_deref()).map_err(e)?;
    if let Some(tags) = tags {
        db.set_task_tags(id, tags).map_err(e)?;
    }
    if let Some(p) = priority {
        db.set_priority(id, p).map_err(e)?;
    }
    view(db, db.get_task(id).map_err(e)?)
}

pub fn add_subtask(db: &Db, parent_id: i64, title: &str) -> Result<TaskView> {
    live(db, parent_id)?;
    let id = db.add_subtask(parent_id, title).map_err(e)?;
    view(db, db.get_task(id).map_err(e)?)
}

pub fn tags(db: &Db) -> Result<Vec<TagView>> {
    Ok(db
        .list_tags()
        .map_err(e)?
        .into_iter()
        .map(|t| TagView { name: t.name, count: t.count })
        .collect())
}

// ---------- renderização em texto ----------

pub fn render_task(t: &TaskView) -> String {
    let mark = if t.done { "[x]" } else { "[ ]" };
    let mut s = format!("{mark} #{} {}", t.id, t.title);
    if let Some(d) = &t.due_date {
        s.push_str(&format!("  ({d})"));
    }
    for g in &t.tags {
        s.push_str(&format!("  #{g}"));
    }
    if t.status == "inbox" {
        s.push_str("  [caixa de entrada]");
    }
    s
}

/// Texto da visão detalhada: a linha da tarefa, as notas, as subtarefas e os caminhos dos anexos.
pub fn render_detail(d: &TaskDetail) -> String {
    let mut s = render_task(&d.task);
    if !d.task.notes.trim().is_empty() {
        s.push_str(&format!("\n\nNotas:\n{}", d.task.notes.trim_end()));
    }
    if !d.subtasks.is_empty() {
        s.push_str("\n\nSubtarefas:");
        for t in &d.subtasks {
            s.push_str(&format!("\n  {}", render_task(t)));
        }
    }
    if !d.task.attachments.is_empty() {
        s.push_str("\n\nAnexos:");
        for a in &d.task.attachments {
            s.push_str(&format!("\n  {} ({})", a.filename, a.path));
        }
    }
    s
}

pub fn render_tasks(ts: &[TaskView]) -> String {
    if ts.is_empty() {
        return "Nenhuma tarefa.".into();
    }
    ts.iter().map(render_task).collect::<Vec<_>>().join("\n")
}

pub fn render_tags(ts: &[TagView]) -> String {
    if ts.is_empty() {
        return "Nenhuma tag.".into();
    }
    ts.iter().map(|t| format!("#{} ({})", t.name, t.count)).collect::<Vec<_>>().join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags_of(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn add_goes_to_inbox_not_today() {
        let db = Db::open_in_memory().unwrap();
        let t = add(&db, SOURCE_CLI, " Comprar pão ", Some("n"), Some("hoje"), &tags_of(&["casa"])).unwrap();
        assert_eq!(t.title, "Comprar pão");
        assert_eq!(t.status, "inbox");
        assert_eq!(t.source, "cli");
        assert_eq!(t.due_date, Some(tarefas_core::today()));
        assert_eq!(t.tags, ["casa"]);
        assert!(list(&db, Filter::Today).unwrap().is_empty());
        assert!(list(&db, Filter::All).unwrap().is_empty());
        assert_eq!(list(&db, Filter::Inbox).unwrap().len(), 1);

        let m = add(&db, SOURCE_MCP, "x", None, None, &[]).unwrap();
        assert_eq!((m.status.as_str(), m.source.as_str()), ("inbox", "mcp"));
        assert!(add(&db, "manual", "y", None, None, &[]).is_err());
    }

    #[test]
    fn date_parsing() {
        assert_eq!(parse_date("amanhã").unwrap(), tarefas_core::tomorrow());
        assert_eq!(parse_date("2026-12-01").unwrap(), "2026-12-01");
        assert!(parse_date("2026-13-01").is_err());
        assert!(parse_date("abc").is_err());
        let db = Db::open_in_memory().unwrap();
        assert!(add(&db, SOURCE_CLI, "x", None, Some("31/12"), &[]).is_err());
        assert!(add(&db, SOURCE_CLI, "  ", None, None, &[]).is_err());
    }

    #[test]
    fn complete_search_update_subtask_tags() {
        let db = Db::open_in_memory().unwrap();
        let a = add(&db, SOURCE_MCP, "Pagar conta de luz", None, Some("2026-01-01"), &tags_of(&["Casa"])).unwrap();
        db.approve_task(a.id).unwrap();

        assert_eq!(list(&db, Filter::Overdue).unwrap().len(), 1);
        assert_eq!(search(&db, "luz").unwrap().len(), 1);
        assert_eq!(tags(&db).unwrap(), [TagView { name: "Casa".into(), count: 1 }]);

        let u = update(&db, a.id, Some("Pagar luz"), None, Some(""), Some(&tags_of(&["x"])), Some(3)).unwrap();
        assert_eq!((u.title.as_str(), u.due_date.clone(), u.priority), ("Pagar luz", None, 3));
        assert_eq!(u.tags, ["x"]);

        let s = add_subtask(&db, a.id, "ligar").unwrap();
        assert_eq!(s.parent_id, Some(a.id));

        let c = complete(&db, a.id).unwrap();
        assert!(c.done);
        assert_eq!(list(&db, Filter::Done).unwrap().len(), 1);
        assert!(complete(&db, 9999).is_err());
        assert!(add_subtask(&db, 9999, "x").is_err());
    }

    #[test]
    fn show_has_notes_subtasks_and_attachments() {
        let db = Db::open_in_memory().unwrap();
        let t = add(&db, SOURCE_CLI, "Corrigir bug", Some("passos:\n![erro.png](anexo:erro.png)"), None, &[]).unwrap();
        add_subtask(&db, t.id, "reproduzir").unwrap();
        let dir = std::env::temp_dir().join(format!("prumo-cli-show-{}", std::process::id()));
        db.add_attachment_bytes(t.id, "erro.png", b"\x89PNG", &dir).unwrap();
        db.add_attachment_bytes(t.id, "log.txt", b"x", &dir).unwrap();

        let d = show(&db, t.id).unwrap();
        assert_eq!(d.subtasks.len(), 1);
        assert_eq!(d.task.attachments.len(), 2);
        assert_eq!(d.task.attachments[0].mime.as_deref(), Some("image/png"));
        assert_eq!(d.task.attachments[1].mime, None);
        let txt = render_detail(&d);
        assert!(txt.contains("anexo:erro.png") && txt.contains("reproduzir") && txt.contains("log.txt"));
        assert!(show(&db, 9999).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn filter_parse_and_render() {
        assert_eq!(Filter::parse("hoje").unwrap(), Filter::Today);
        assert!(Filter::parse("zzz").is_err());
        assert_eq!(render_tasks(&[]), "Nenhuma tarefa.");
    }
}
