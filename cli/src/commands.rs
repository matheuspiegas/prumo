//! Camada de comandos: opera sobre um `Db` e devolve dados serializáveis.
//! Regra de produto: tudo que o CLI/MCP cria entra na CAIXA DE ENTRADA.

use std::path::Path;

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
    /// Como a imagem aparece no texto das notas (`[Image #N]`); `None` se o arquivo não foi colado nas notas.
    pub token: Option<String>,
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
            token: tarefas_core::image_number(&a.filename).map(|n| format!("[Image #{n}]")),
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

/// Acrescenta markdown ao fim das notas, separado por uma linha em branco, sem tocar no que já existe.
pub fn append_notes(db: &Db, id: i64, markdown: &str) -> Result<TaskView> {
    let cur = live(db, id)?;
    let md = markdown.trim();
    if md.is_empty() {
        return Err("o texto a acrescentar está vazio".into());
    }
    let notes = if cur.notes.trim().is_empty() {
        md.to_string()
    } else {
        format!("{}\n\n{md}", cur.notes.trim_end())
    };
    db.update_task(id, &cur.title, &notes, cur.due_date.as_deref()).map_err(e)?;
    view(db, db.get_task(id).map_err(e)?)
}

/// Tamanho máximo de uma imagem anexada por agente (bate com o limite do app).
pub const MAX_ATTACH_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

/// Resultado de `attach_image`: o `token` é o texto a colocar nas notas.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AttachedImage {
    pub token: String,
    pub filename: String,
    pub path: String,
    pub size: i64,
}

/// Confere os primeiros bytes: o conteúdo precisa ser mesmo do tipo que a extensão diz.
fn has_image_signature(b: &[u8], mime: &str) -> bool {
    match mime {
        "image/png" => b.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
        "image/jpeg" => b.starts_with(&[0xFF, 0xD8, 0xFF]),
        "image/gif" => b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a"),
        "image/webp" => b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP",
        _ => false,
    }
}

/// Copia uma imagem local como anexo `image-N.ext` da tarefa e devolve o token `[Image #N]`.
/// Só aceita png, jpg, gif e webp de verdade (extensão e assinatura do arquivo), até 25 MB.
pub fn attach_image(db: &Db, id: i64, source: &Path, attachments_dir: &Path) -> Result<AttachedImage> {
    live(db, id)?;
    let name = source.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let mime = tarefas_core::image_mime(name).ok_or("só imagens png, jpg, gif ou webp são aceitas")?;
    let meta = std::fs::metadata(source).map_err(|er| format!("não foi possível ler {}: {er}", source.display()))?;
    if !meta.is_file() {
        return Err(format!("{} não é um arquivo", source.display()));
    }
    if meta.len() == 0 || meta.len() > MAX_ATTACH_IMAGE_BYTES {
        return Err(format!("a imagem precisa ter entre 1 byte e {} MB", MAX_ATTACH_IMAGE_BYTES / 1024 / 1024));
    }
    let bytes = std::fs::read(source).map_err(|er| format!("não foi possível ler {}: {er}", source.display()))?;
    if !has_image_signature(&bytes, mime) {
        return Err("o conteúdo do arquivo não corresponde a uma imagem do tipo indicado pela extensão".into());
    }
    let n = db
        .attachments(id)
        .map_err(e)?
        .iter()
        .filter_map(|a| tarefas_core::image_number(&a.filename))
        .max()
        .unwrap_or(0)
        + 1;
    let ext = name.rsplit('.').next().unwrap_or("png").to_ascii_lowercase();
    let filename = format!("image-{n}.{ext}");
    let row = db.add_attachment_bytes(id, &filename, &bytes, attachments_dir).map_err(|er| er.to_string())?;
    let att = db.attachment(row).map_err(e)?;
    Ok(AttachedImage { token: format!("[Image #{n}]"), filename: att.filename, path: att.stored_path, size: att.size })
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
            match &a.token {
                Some(t) => s.push_str(&format!("\n  {t} -> {} ({})", a.filename, a.path)),
                None => s.push_str(&format!("\n  {} ({})", a.filename, a.path)),
            }
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
        let t = add(&db, SOURCE_CLI, "Corrigir bug", Some("passos:\n[Image #1]"), None, &[]).unwrap();
        add_subtask(&db, t.id, "reproduzir").unwrap();
        let dir = std::env::temp_dir().join(format!("prumo-cli-show-{}", std::process::id()));
        db.add_attachment_bytes(t.id, "image-1.png", b"\x89PNG", &dir).unwrap();
        db.add_attachment_bytes(t.id, "log.txt", b"x", &dir).unwrap();

        let d = show(&db, t.id).unwrap();
        assert_eq!(d.subtasks.len(), 1);
        assert_eq!(d.task.attachments.len(), 2);
        assert_eq!(d.task.attachments[0].mime.as_deref(), Some("image/png"));
        assert_eq!(d.task.attachments[0].token.as_deref(), Some("[Image #1]"));
        assert_eq!(d.task.attachments[1].token, None);
        assert_eq!(d.task.attachments[1].mime, None);
        let txt = render_detail(&d);
        assert!(txt.contains("[Image #1] -> image-1.png") && txt.contains("reproduzir") && txt.contains("log.txt"));
        assert!(show(&db, 9999).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn append_notes_keeps_existing_text() {
        let db = Db::open_in_memory().unwrap();
        let t = add(&db, SOURCE_MCP, "Revisar", None, None, &[]).unwrap();
        let a = append_notes(&db, t.id, "  ## Contexto\n\n- [ ] item  \n").unwrap();
        assert_eq!(a.notes, "## Contexto\n\n- [ ] item");
        let b = append_notes(&db, t.id, "Mais um parágrafo").unwrap();
        assert_eq!(b.notes, "## Contexto\n\n- [ ] item\n\nMais um parágrafo");
        assert_eq!(b.title, "Revisar");
        assert!(append_notes(&db, t.id, "   \n ").is_err());
        assert!(append_notes(&db, 9999, "x").is_err());
    }

    /// PNG mínimo: a assinatura basta para o teste.
    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];

    #[test]
    fn attach_image_numbers_and_validates() {
        let db = Db::open_in_memory().unwrap();
        let t = add(&db, SOURCE_MCP, "Com print", None, None, &[]).unwrap();
        let dir = std::env::temp_dir().join(format!("prumo-attach-img-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("captura.PNG");
        std::fs::write(&ok, PNG).unwrap();
        let store = dir.join("anexos");

        let a = attach_image(&db, t.id, &ok, &store).unwrap();
        assert_eq!((a.token.as_str(), a.filename.as_str()), ("[Image #1]", "image-1.png"));
        assert_eq!(std::fs::read(&a.path).unwrap(), PNG);
        let b = attach_image(&db, t.id, &ok, &store).unwrap();
        assert_eq!(b.token, "[Image #2]");
        // a imagem aparece na visão da tarefa com o mesmo token
        let d = show(&db, t.id).unwrap();
        assert_eq!(d.task.attachments.iter().filter_map(|x| x.token.clone()).collect::<Vec<_>>(), ["[Image #1]", "[Image #2]"]);

        // extensão que não é imagem, conteúdo que não bate, vazio, inexistente, pasta, tarefa inexistente
        let txt = dir.join("nota.txt");
        std::fs::write(&txt, "oi").unwrap();
        assert!(attach_image(&db, t.id, &txt, &store).is_err());
        let fake = dir.join("falsa.png");
        std::fs::write(&fake, "isto não é um png").unwrap();
        assert!(attach_image(&db, t.id, &fake, &store).unwrap_err().contains("não corresponde"));
        let empty = dir.join("vazia.png");
        std::fs::write(&empty, b"").unwrap();
        assert!(attach_image(&db, t.id, &empty, &store).is_err());
        assert!(attach_image(&db, t.id, &dir.join("nao-existe.png"), &store).is_err());
        assert!(attach_image(&db, t.id, &dir, &store).is_err());
        assert!(attach_image(&db, 9999, &ok, &store).is_err());
        assert_eq!(show(&db, t.id).unwrap().task.attachments.len(), 2);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn image_signatures() {
        assert!(has_image_signature(b"\xFF\xD8\xFF\xE0xx", "image/jpeg"));
        assert!(has_image_signature(b"GIF89a....", "image/gif"));
        assert!(has_image_signature(b"RIFF\0\0\0\0WEBPVP8 ", "image/webp"));
        assert!(!has_image_signature(b"RIFF\0\0\0\0WAVEfmt ", "image/webp"));
        assert!(!has_image_signature(PNG, "image/jpeg"));
        assert!(!has_image_signature(PNG, "text/plain"));
    }

    #[test]
    fn filter_parse_and_render() {
        assert_eq!(Filter::parse("hoje").unwrap(), Filter::Today);
        assert!(Filter::parse("zzz").is_err());
        assert_eq!(render_tasks(&[]), "Nenhuma tarefa.");
    }
}
