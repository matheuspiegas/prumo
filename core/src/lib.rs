use rusqlite::{params, Connection, Result};
use std::path::{Path, PathBuf};

// Cada assunto vive no seu arquivo, com seu próprio `impl Db { ... }`.
// Assim agentes diferentes não conflitam ao editar.
mod overdue; // atrasadas, reagendar e prioridade
mod planner; // visão Semana (week, move_task)
pub use planner::WeekRaw;
pub mod recurrence; // recorrência de tarefas
mod reminders; // lembretes com hora (due_time / reminded_at)
pub use reminders::parse_hhmm;
mod search; // busca
mod subtasks; // subtarefas (parent_id)
pub mod tags; // etiquetas (tags / task_tags)
mod trash; // lixeira e desfazer (deleted_at)

#[derive(Debug, Clone, PartialEq)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub notes: String,
    /// Data no formato ISO `YYYY-MM-DD`.
    pub due_date: Option<String>,
    pub done: bool,
    /// Quem criou: `manual`, `claude`, `codex`, ...
    pub source: String,
    /// `active` ou `inbox` (aguardando aprovação, criada por um agente).
    pub status: String,
    /// 0 nenhuma, 1 baixa, 2 média, 3 alta.
    pub priority: i64,
    /// Hora no formato `HH:MM` (opcional).
    pub due_time: Option<String>,
    /// Recorrência no formato `<unidade>:<n>`, com unidade `day`, `week` ou
    /// `month` (ex.: `week:2` = a cada 2 semanas). `None` = não repete.
    pub recurrence: Option<String>,
    /// Se preenchido, esta tarefa é subtarefa da tarefa com esse id.
    pub parent_id: Option<i64>,
    /// Se preenchido (timestamp UTC do SQLite), a tarefa está na lixeira.
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Attachment {
    pub id: i64,
    pub task_id: i64,
    pub filename: String,
    pub stored_path: String,
    pub size: i64,
}

pub use search::normalize;

pub struct Db {
    conn: Connection,
}

/// Schema base (versão 1): tabelas originais. Colunas adicionadas depois
/// (source, status, position e as da v2) entram via migração.
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS tasks (
    id         INTEGER PRIMARY KEY,
    title      TEXT NOT NULL,
    notes      TEXT NOT NULL DEFAULT '',
    due_date   TEXT,
    done       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE TABLE IF NOT EXISTS attachments (
    id          INTEGER PRIMARY KEY,
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    stored_path TEXT NOT NULL,
    size        INTEGER NOT NULL DEFAULT 0
);
";

/// Versão atual do schema (`PRAGMA user_version`).
const SCHEMA_VERSION: i64 = 2;

/// Filtro das listagens "normais": fora da lixeira e sem subtarefas.
pub(crate) const LIVE: &str = "deleted_at IS NULL AND parent_id IS NULL";

pub(crate) fn row_to_task(r: &rusqlite::Row) -> Result<Task> {
    Ok(Task {
        id: r.get(0)?,
        title: r.get(1)?,
        notes: r.get(2)?,
        due_date: r.get(3)?,
        done: r.get::<_, i64>(4)? != 0,
        source: r.get(5)?,
        status: r.get(6)?,
        priority: r.get(7)?,
        due_time: r.get(8)?,
        recurrence: r.get(9)?,
        parent_id: r.get(10)?,
        deleted_at: r.get(11)?,
    })
}

/// Lidas por posição em `row_to_task`: mantenha as duas em sincronia.
pub(crate) const TASK_COLS: &str =
    "id, title, notes, due_date, done, source, status, priority, due_time, recurrence, parent_id, deleted_at";

impl Db {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    /// `PRAGMA data_version`: muda quando OUTRA conexão (outro processo ou outra
    /// `Db`) faz commit. Não muda com escritas da própria conexão.
    pub fn data_version(&self) -> Result<i64> {
        self.conn.query_row("PRAGMA data_version", [], |r| r.get(0))
    }

    fn init(conn: Connection) -> Result<Self> {
        // WAL permite que outro processo (ex.: servidor MCP) leia/escreva junto.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    fn has_column(&self, table: &str, col: &str) -> Result<bool> {
        self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
            [table, col],
            |r| r.get::<_, i64>(0).map(|n| n > 0),
        )
    }

    /// Migrações versionadas (`PRAGMA user_version`), não destrutivas e
    /// idempotentes. Bancos novos e antigos chegam ao mesmo schema.
    /// Para uma mudança futura: incremente `SCHEMA_VERSION` e adicione um bloco
    /// `if version < N`.
    fn migrate(&self) -> Result<()> {
        let version: i64 = self.conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version >= SCHEMA_VERSION {
            return Ok(());
        }
        let tx = self.conn.unchecked_transaction()?;
        if version < 1 {
            // Bancos anteriores ao versionamento (user_version = 0) podem estar
            // em qualquer estágio das colunas antigas; cada passo se protege.
            tx.execute_batch(SCHEMA)?;
            if !self.has_column("tasks", "source")? {
                tx.execute_batch("ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'")?;
            }
            if !self.has_column("tasks", "status")? {
                tx.execute_batch("ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")?;
            }
            if !self.has_column("tasks", "position")? {
                // Preserva a ordem atual: position inicial = id.
                tx.execute_batch(
                    "ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
                     UPDATE tasks SET position = id;",
                )?;
            }
        }
        if version < 2 {
            let cols = [
                // 0 nenhuma, 1 baixa, 2 média, 3 alta
                ("priority", "INTEGER NOT NULL DEFAULT 0"),
                // "HH:MM"
                ("due_time", "TEXT"),
                // "<unidade>:<n>", unidade = day|week|month (ex.: "week:2")
                ("recurrence", "TEXT"),
                // quando o lembrete já foi disparado
                ("reminded_at", "TEXT"),
                // lixeira (soft delete)
                ("deleted_at", "TEXT"),
                // subtarefa = tarefa com parent_id
                ("parent_id", "INTEGER REFERENCES tasks(id) ON DELETE CASCADE"),
            ];
            for (name, def) in cols {
                if !self.has_column("tasks", name)? {
                    tx.execute_batch(&format!("ALTER TABLE tasks ADD COLUMN {name} {def}"))?;
                }
            }
            tx.execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_tasks_deleted ON tasks(deleted_at);
                 CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
                 CREATE TABLE IF NOT EXISTS tags (
                     id   INTEGER PRIMARY KEY,
                     name TEXT NOT NULL UNIQUE COLLATE NOCASE
                 );
                 CREATE TABLE IF NOT EXISTS task_tags (
                     task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                     tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                     PRIMARY KEY (task_id, tag_id)
                 );
                 CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);",
            )?;
        }
        // PRAGMA user_version não aceita parâmetros; o valor é uma constante nossa.
        tx.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))?;
        tx.commit()
    }

    /// Define a ordem manual: `position` = índice em `ids`, numa transação.
    pub fn reorder(&self, ids: &[i64]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        {
            let mut st = tx.prepare("UPDATE tasks SET position = ?2 WHERE id = ?1")?;
            for (i, id) in ids.iter().enumerate() {
                st.execute(params![id, i as i64])?;
            }
        }
        tx.commit()
    }

    pub fn add_task(&self, title: &str, notes: &str, due_date: Option<&str>) -> Result<i64> {
        self.add_task_from(title, notes, due_date, "manual")
    }

    /// Cria uma tarefa. Fontes diferentes de `manual` (agentes de IA) entram na
    /// caixa de entrada (`inbox`) até serem aprovadas.
    pub fn add_task_from(
        &self,
        title: &str,
        notes: &str,
        due_date: Option<&str>,
        source: &str,
    ) -> Result<i64> {
        let status = if source == "manual" { "active" } else { "inbox" };
        self.conn.execute(
            "INSERT INTO tasks (title, notes, due_date, source, status, position)
             VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks))",
            params![title, notes, due_date, source, status],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn get_task(&self, id: i64) -> Result<Task> {
        self.conn.query_row(
            &format!("SELECT {TASK_COLS} FROM tasks WHERE id = ?1"),
            [id],
            row_to_task,
        )
    }

    pub fn approve_task(&self, id: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE tasks SET status = 'active', updated_at = datetime('now') WHERE id = ?1",
            [id],
        )?;
        Ok(())
    }

    /// Tarefas criadas por agentes, aguardando aprovação.
    pub fn inbox(&self) -> Result<Vec<Task>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {TASK_COLS} FROM tasks WHERE status = 'inbox' AND {LIVE} ORDER BY id DESC"
        ))?;
        st.query_map([], row_to_task)?.collect()
    }

    pub fn inbox_count(&self) -> Result<i64> {
        self.conn
            .query_row(
                &format!("SELECT COUNT(*) FROM tasks WHERE status = 'inbox' AND {LIVE}"),
                [],
                |r| r.get(0),
            )
    }

    /// Quantidade de tarefas ativas e pendentes numa data.
    pub fn count_pending_on(&self, date: &str) -> Result<i64> {
        self.conn.query_row(
            &format!("SELECT COUNT(*) FROM tasks WHERE status = 'active' AND done = 0 AND due_date = ?1 AND {LIVE}"),
            [date],
            |r| r.get(0),
        )
    }

    pub fn set_done(&self, id: i64, done: bool) -> Result<()> {
        let was_done = self.conn.query_row("SELECT done FROM tasks WHERE id = ?1", [id], |r| r.get::<_, i64>(0))? != 0;
        self.conn.execute(
            "UPDATE tasks SET done = ?2, updated_at = datetime('now') WHERE id = ?1",
            params![id, done as i64],
        )?;
        if done && !was_done {
            self.spawn_next_occurrence(id)?; // recorrência: cria a próxima ocorrência
        }
        Ok(())
    }

    pub fn update_task(&self, id: i64, title: &str, notes: &str, due_date: Option<&str>) -> Result<()> {
        self.conn.execute(
            "UPDATE tasks SET title = ?2, notes = ?3, due_date = ?4,
             reminded_at = CASE WHEN due_date IS NOT ?4 THEN NULL ELSE reminded_at END,
             updated_at = datetime('now') WHERE id = ?1",
            params![id, title, notes, due_date],
        )?;
        Ok(())
    }

    pub fn delete_task(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Tarefas pendentes de uma data específica (`YYYY-MM-DD`).
    pub fn tasks_on(&self, date: &str) -> Result<Vec<Task>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {TASK_COLS} FROM tasks WHERE status = 'active' AND {LIVE} AND due_date = ?1 ORDER BY done, position, id"
        ))?;
        st.query_map([date], row_to_task)?.collect()
    }

    /// Todas as tarefas pendentes, ordenadas por data (sem data por último).
    pub fn pending(&self) -> Result<Vec<Task>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {TASK_COLS} FROM tasks WHERE status = 'active' AND {LIVE} AND done = 0 ORDER BY due_date IS NULL, due_date, position, id"
        ))?;
        st.query_map([], row_to_task)?.collect()
    }

    pub fn completed(&self) -> Result<Vec<Task>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {TASK_COLS} FROM tasks WHERE status = 'active' AND {LIVE} AND done = 1 ORDER BY updated_at DESC"
        ))?;
        st.query_map([], row_to_task)?.collect()
    }

    /// Copia o arquivo para `attachments_dir` e registra no banco.
    pub fn add_attachment(
        &self,
        task_id: i64,
        source: &Path,
        attachments_dir: &Path,
    ) -> std::io::Result<i64> {
        std::fs::create_dir_all(attachments_dir)?;
        let filename = source
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_else(|| "anexo".into());
        let mut dest: PathBuf = attachments_dir.join(format!("{task_id}-{filename}"));
        let mut n = 1;
        while dest.exists() {
            dest = attachments_dir.join(format!("{task_id}-{n}-{filename}"));
            n += 1;
        }
        let size = std::fs::copy(source, &dest)? as i64;
        self.conn
            .execute(
                "INSERT INTO attachments (task_id, filename, stored_path, size) VALUES (?1, ?2, ?3, ?4)",
                params![task_id, filename, dest.to_string_lossy(), size],
            )
            .map_err(std::io::Error::other)?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Grava `bytes` (ex.: imagem colada da área de transferência) como arquivo em
    /// `attachments_dir` e registra no banco. O nome é saneado: só o último componente conta.
    pub fn add_attachment_bytes(
        &self,
        task_id: i64,
        filename: &str,
        bytes: &[u8],
        attachments_dir: &Path,
    ) -> std::io::Result<i64> {
        std::fs::create_dir_all(attachments_dir)?;
        let clean: String = filename
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or("")
            .chars()
            .filter(|c| !c.is_control() && !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
            .collect();
        let clean = clean.trim().trim_matches('.').to_string();
        let filename = if clean.is_empty() { "anexo".to_string() } else { clean };
        let mut dest: PathBuf = attachments_dir.join(format!("{task_id}-{filename}"));
        let mut n = 1;
        while dest.exists() {
            dest = attachments_dir.join(format!("{task_id}-{n}-{filename}"));
            n += 1;
        }
        std::fs::write(&dest, bytes)?;
        self.conn
            .execute(
                "INSERT INTO attachments (task_id, filename, stored_path, size) VALUES (?1, ?2, ?3, ?4)",
                params![task_id, filename, dest.to_string_lossy(), bytes.len() as i64],
            )
            .map_err(std::io::Error::other)?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Remove o anexo do banco e apaga o arquivo copiado.
    pub fn delete_attachment(&self, id: i64) -> Result<()> {
        let path: Option<String> = self
            .conn
            .query_row("SELECT stored_path FROM attachments WHERE id = ?1", [id], |r| r.get(0))
            .ok();
        self.conn.execute("DELETE FROM attachments WHERE id = ?1", [id])?;
        if let Some(p) = path {
            std::fs::remove_file(p).ok();
        }
        Ok(())
    }

    /// Um anexo pelo id (para o app ler o arquivo sem aceitar caminhos vindos da interface).
    pub fn attachment(&self, id: i64) -> Result<Attachment> {
        self.conn.query_row(
            "SELECT id, task_id, filename, stored_path, size FROM attachments WHERE id = ?1",
            [id],
            |r| {
                Ok(Attachment {
                    id: r.get(0)?,
                    task_id: r.get(1)?,
                    filename: r.get(2)?,
                    stored_path: r.get(3)?,
                    size: r.get(4)?,
                })
            },
        )
    }

    pub fn attachments(&self, task_id: i64) -> Result<Vec<Attachment>> {
        let mut st = self.conn.prepare(
            "SELECT id, task_id, filename, stored_path, size FROM attachments WHERE task_id = ?1 ORDER BY id",
        )?;
        st.query_map([task_id], |r| {
            Ok(Attachment {
                id: r.get(0)?,
                task_id: r.get(1)?,
                filename: r.get(2)?,
                stored_path: r.get(3)?,
                size: r.get(4)?,
            })
        })?
        .collect()
    }
}

/// Tipo MIME de uma imagem pela extensão do arquivo; `None` se não for uma imagem que os
/// agentes costumam aceitar (png, jpeg, gif, webp).
pub fn image_mime(filename: &str) -> Option<&'static str> {
    match filename.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// Número N de um arquivo `image-N.ext`, o nome das imagens coladas nas notas (que aparecem no texto
/// como `[Image #N]`); `None` se o nome não segue esse padrão.
pub fn image_number(filename: &str) -> Option<u32> {
    let lower = filename.to_ascii_lowercase();
    let rest = lower.strip_prefix("image-")?;
    let (num, ext) = rest.split_once('.')?;
    let digits = !num.is_empty() && num.bytes().all(|b| b.is_ascii_digit());
    let ext_ok = !ext.is_empty() && ext.bytes().all(|b| b.is_ascii_alphanumeric());
    if digits && ext_ok { num.parse().ok() } else { None }
}

/// Pasta de dados do Prumo (banco + anexos), compartilhada por app, CLI e MCP.
/// Pode ser sobrescrita com a variável `PRUMO_DATA_DIR`.
pub fn data_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("PRUMO_DATA_DIR") {
        return PathBuf::from(d);
    }
    let home = || std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    if cfg!(target_os = "macos") {
        home().join("Library/Application Support/Prumo")
    } else if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(home)
            .join("Prumo")
    } else {
        home().join(".local/share/prumo")
    }
}

/// Data de hoje/amanhã no fuso local, formato `YYYY-MM-DD`.
pub fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

pub fn tomorrow() -> String {
    (chrono::Local::now() + chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crud_and_filters() {
        let db = Db::open_in_memory().unwrap();
        let a = db.add_task("Hoje", "", Some("2026-11-06")).unwrap();
        db.add_task("Amanhã", "n", Some("2026-11-07")).unwrap();
        db.add_task("Sem data", "", None).unwrap();

        assert_eq!(db.tasks_on("2026-11-06").unwrap().len(), 1);
        let pending = db.pending().unwrap();
        assert_eq!(pending.len(), 3);
        assert_eq!(pending[2].title, "Sem data");

        db.set_done(a, true).unwrap();
        assert_eq!(db.pending().unwrap().len(), 2);
        assert_eq!(db.completed().unwrap()[0].title, "Hoje");

        db.update_task(a, "Editada", "x", None).unwrap();
        assert_eq!(db.completed().unwrap()[0].title, "Editada");
        db.delete_task(a).unwrap();
        assert!(db.completed().unwrap().is_empty());
    }

    #[test]
    fn data_version_changes_on_external_write_only() {
        let path = std::env::temp_dir().join(format!("prumo-dv-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let watcher = Db::open(&path).unwrap();
        let writer = Db::open(&path).unwrap();
        let v0 = watcher.data_version().unwrap();
        watcher.add_task_from("própria", "", None, "manual").unwrap();
        assert_eq!(watcher.data_version().unwrap(), v0);
        writer.add_task_from("externa", "", None, "cli").unwrap();
        assert_ne!(watcher.data_version().unwrap(), v0);
        drop((watcher, writer));
        for ext in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ext}", path.display()));
        }
    }

    #[test]
    fn agent_tasks_go_to_inbox_until_approved() {
        let db = Db::open_in_memory().unwrap();
        let id = db.add_task_from("Do Claude", "", Some("2026-11-07"), "claude").unwrap();
        assert_eq!(db.get_task(id).unwrap().status, "inbox");
        assert_eq!(db.inbox_count().unwrap(), 1);
        assert!(db.tasks_on("2026-11-07").unwrap().is_empty());
        assert!(db.pending().unwrap().is_empty());

        db.approve_task(id).unwrap();
        assert_eq!(db.inbox_count().unwrap(), 0);
        assert_eq!(db.tasks_on("2026-11-07").unwrap().len(), 1);
        assert_eq!(db.count_pending_on("2026-11-07").unwrap(), 1);
        assert_eq!(db.get_task(id).unwrap().source, "claude");
    }

    #[test]
    fn migrates_old_database() {
        let path = std::env::temp_dir().join(format!("prumo-mig-{}.db", std::process::id()));
        std::fs::remove_file(&path).ok();
        {
            let c = Connection::open(&path).unwrap();
            c.execute_batch(
                "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', due_date TEXT, done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
                 INSERT INTO tasks (title) VALUES ('antiga');",
            )
            .unwrap();
        }
        let db = Db::open(&path).unwrap();
        let t = db.pending().unwrap();
        assert_eq!(t.len(), 1);
        assert_eq!((t[0].source.as_str(), t[0].status.as_str()), ("manual", "active"));
        drop(db);
        std::fs::remove_file(&path).ok();
    }

    /// Schema antigo (v0, antes do versionamento) com dados reais de usuário.
    const OLD_SCHEMA: &str = "
        CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', due_date TEXT, done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), source TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'active', position INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX idx_tasks_due ON tasks(due_date);
        CREATE TABLE attachments (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, filename TEXT NOT NULL, stored_path TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0);
        INSERT INTO tasks (title, notes, due_date, done, source, status, position) VALUES
            ('a', 'nota', '2026-11-06', 0, 'manual', 'active', 1),
            ('b', '', NULL, 1, 'claude', 'active', 2),
            ('c', '', '2026-11-07', 0, 'claude', 'inbox', 3);
        INSERT INTO attachments (task_id, filename, stored_path, size) VALUES (1, 'x.txt', 'p', 3);
    ";

    fn user_version(db: &Db) -> i64 {
        db.conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap()
    }

    #[test]
    fn migrates_v0_to_current_preserving_data_and_is_idempotent() {
        let path = std::env::temp_dir().join(format!("prumo-v2-{}.db", std::process::id()));
        std::fs::remove_file(&path).ok();
        Connection::open(&path).unwrap().execute_batch(OLD_SCHEMA).unwrap();

        let db = Db::open(&path).unwrap();
        assert_eq!(user_version(&db), SCHEMA_VERSION);
        let pending = db.pending().unwrap();
        assert_eq!(pending.len(), 1);
        let a = &pending[0];
        assert_eq!((a.title.as_str(), a.notes.as_str()), ("a", "nota"));
        assert_eq!(a.priority, 0);
        assert!(a.due_time.is_none() && a.recurrence.is_none() && a.parent_id.is_none() && a.deleted_at.is_none());
        assert_eq!(db.completed().unwrap().len(), 1);
        assert_eq!(db.inbox_count().unwrap(), 1);
        assert_eq!(db.attachments(1).unwrap().len(), 1);
        for tbl in ["tags", "task_tags"] {
            let n: i64 = db
                .conn
                .query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = ?1", [tbl], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 1, "{tbl}");
        }
        drop(db);

        // Idempotente: reabrir não muda nada.
        let db = Db::open(&path).unwrap();
        assert_eq!(user_version(&db), SCHEMA_VERSION);
        assert_eq!(db.pending().unwrap().len(), 1);
        drop(db);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn new_and_migrated_databases_have_same_columns() {
        let cols = |db: &Db| -> Vec<String> {
            let mut st = db
                .conn
                .prepare("SELECT name FROM pragma_table_info('tasks') ORDER BY name")
                .unwrap();
            st.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
        };
        let path = std::env::temp_dir().join(format!("prumo-cmp-{}.db", std::process::id()));
        std::fs::remove_file(&path).ok();
        Connection::open(&path).unwrap().execute_batch(OLD_SCHEMA).unwrap();
        let old = Db::open(&path).unwrap();
        let new = Db::open_in_memory().unwrap();
        assert_eq!(cols(&old), cols(&new));
        drop(old);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn listings_hide_trashed_and_subtasks() {
        let db = Db::open_in_memory().unwrap();
        let a = db.add_task("a", "", Some("2026-11-06")).unwrap();
        let b = db.add_task("b", "", Some("2026-11-06")).unwrap();
        let c = db.add_task("c", "", Some("2026-11-06")).unwrap();
        db.conn.execute("UPDATE tasks SET deleted_at = datetime('now') WHERE id = ?1", [b]).unwrap();
        db.conn.execute("UPDATE tasks SET parent_id = ?2 WHERE id = ?1", [c, a]).unwrap();
        assert_eq!(db.tasks_on("2026-11-06").unwrap().len(), 1);
        assert_eq!(db.pending().unwrap().len(), 1);
        assert_eq!(db.count_pending_on("2026-11-06").unwrap(), 1);
        assert!(db.get_task(b).unwrap().deleted_at.is_some());
        assert_eq!(db.get_task(c).unwrap().parent_id, Some(a));
    }

    #[test]
    fn new_tasks_go_last_and_reorder_works() {
        let db = Db::open_in_memory().unwrap();
        let a = db.add_task("a", "", Some("2026-11-06")).unwrap();
        let b = db.add_task("b", "", Some("2026-11-06")).unwrap();
        let c = db.add_task("c", "", Some("2026-11-06")).unwrap();
        let titles = |v: Vec<Task>| v.into_iter().map(|t| t.title).collect::<Vec<_>>();
        assert_eq!(titles(db.tasks_on("2026-11-06").unwrap()), ["a", "b", "c"]);

        db.reorder(&[c, a, b]).unwrap();
        assert_eq!(titles(db.tasks_on("2026-11-06").unwrap()), ["c", "a", "b"]);
        assert_eq!(titles(db.pending().unwrap()), ["c", "a", "b"]);

        db.add_task("d", "", Some("2026-11-06")).unwrap();
        assert_eq!(titles(db.tasks_on("2026-11-06").unwrap()), ["c", "a", "b", "d"]);

        // concluídas vão para o fim em tasks_on
        db.set_done(c, true).unwrap();
        assert_eq!(titles(db.tasks_on("2026-11-06").unwrap()), ["a", "b", "d", "c"]);
    }

    #[test]
    fn migration_backfills_position_in_id_order() {
        let path = std::env::temp_dir().join(format!("prumo-pos-{}.db", std::process::id()));
        std::fs::remove_file(&path).ok();
        {
            let c = Connection::open(&path).unwrap();
            c.execute_batch(
                "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', due_date TEXT, done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), source TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'active');
                 INSERT INTO tasks (title) VALUES ('um'), ('dois');",
            )
            .unwrap();
        }
        let db = Db::open(&path).unwrap();
        db.add_task("tres", "", None).unwrap();
        let t: Vec<_> = db.pending().unwrap().into_iter().map(|t| t.title).collect();
        assert_eq!(t, ["um", "dois", "tres"]);
        drop(db);
        // reabrir não refaz o backfill
        let db = Db::open(&path).unwrap();
        db.reorder(&[3, 2, 1]).unwrap();
        drop(db);
        let db = Db::open(&path).unwrap();
        assert_eq!(db.pending().unwrap()[0].title, "tres");
        drop(db);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn pasted_bytes_become_attachment_with_clean_name() {
        let dir = std::env::temp_dir().join(format!("prumo-bytes-{}", std::process::id()));
        let db = Db::open_in_memory().unwrap();
        let t = db.add_task("t", "", None).unwrap();
        let a = db.add_attachment_bytes(t, "..\\..\\evil:name.png", b"abc", &dir.join("anexos")).unwrap();
        let b = db.add_attachment_bytes(t, "evilname.png", b"abcd", &dir.join("anexos")).unwrap();
        let list = db.attachments(t).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, a);
        assert_eq!(list[0].filename, "evilname.png");
        assert_eq!(list[0].size, 3);
        assert!(list[0].stored_path.starts_with(dir.join("anexos").to_string_lossy().as_ref()));
        assert_eq!(std::fs::read(&list[1].stored_path).unwrap(), b"abcd");
        assert_ne!(list[0].stored_path, list[1].stored_path);
        assert_eq!(b, list[1].id);
        assert_eq!(db.add_attachment_bytes(t, "", b"x", &dir.join("anexos")).is_ok(), true);
        assert_eq!(db.attachment(a).unwrap().filename, "evilname.png");
        assert!(db.attachment(9999).is_err());
        assert_eq!(image_mime("A.PNG"), Some("image/png"));
        assert_eq!(image_mime("nota.txt"), None);
        assert_eq!(image_number("image-3.png"), Some(3));
        assert_eq!(image_number("IMAGE-12.JPG"), Some(12));
        assert_eq!(image_number("image-.png"), None);
        assert_eq!(image_number("image-1.tar.gz"), None);
        assert_eq!(image_number("foto.png"), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn attachments_are_copied() {
        let dir = std::env::temp_dir().join(format!("tarefas-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("a.txt");
        std::fs::write(&src, b"ola").unwrap();

        let db = Db::open_in_memory().unwrap();
        let t = db.add_task("t", "", None).unwrap();
        db.add_attachment(t, &src, &dir.join("anexos")).unwrap();
        db.add_attachment(t, &src, &dir.join("anexos")).unwrap();

        let list = db.attachments(t).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].size, 3);
        assert_ne!(list[0].stored_path, list[1].stored_path);
        assert!(Path::new(&list[0].stored_path).exists());

        let first = list[0].clone();
        db.delete_attachment(first.id).unwrap();
        assert_eq!(db.attachments(t).unwrap().len(), 1);
        assert!(!Path::new(&first.stored_path).exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
