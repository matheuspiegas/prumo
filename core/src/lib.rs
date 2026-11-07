use rusqlite::{params, Connection, Result};
use std::path::{Path, PathBuf};

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
}

#[derive(Debug, Clone, PartialEq)]
pub struct Attachment {
    pub id: i64,
    pub task_id: i64,
    pub filename: String,
    pub stored_path: String,
    pub size: i64,
}

pub struct Db {
    conn: Connection,
}

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

fn row_to_task(r: &rusqlite::Row) -> Result<Task> {
    Ok(Task {
        id: r.get(0)?,
        title: r.get(1)?,
        notes: r.get(2)?,
        due_date: r.get(3)?,
        done: r.get::<_, i64>(4)? != 0,
        source: r.get(5)?,
        status: r.get(6)?,
    })
}

const TASK_COLS: &str = "id, title, notes, due_date, done, source, status";

impl Db {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        // WAL permite que outro processo (ex.: servidor MCP) leia/escreva junto.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(SCHEMA)?;
        let db = Self { conn };
        db.migrate()?;
        Ok(db)
    }

    /// Adiciona colunas novas em bancos criados por versões anteriores.
    fn migrate(&self) -> Result<()> {
        let has = |col: &str| -> Result<bool> {
            self.conn.query_row(
                "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = ?1",
                [col],
                |r| r.get::<_, i64>(0).map(|n| n > 0),
            )
        };
        if !has("source")? {
            self.conn
                .execute_batch("ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'")?;
        }
        if !has("status")? {
            self.conn
                .execute_batch("ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")?;
        }
        Ok(())
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
            "INSERT INTO tasks (title, notes, due_date, source, status) VALUES (?1, ?2, ?3, ?4, ?5)",
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
            "SELECT {TASK_COLS} FROM tasks WHERE status = 'inbox' ORDER BY id DESC"
        ))?;
        st.query_map([], row_to_task)?.collect()
    }

    pub fn inbox_count(&self) -> Result<i64> {
        self.conn
            .query_row("SELECT COUNT(*) FROM tasks WHERE status = 'inbox'", [], |r| r.get(0))
    }

    /// Quantidade de tarefas ativas e pendentes numa data.
    pub fn count_pending_on(&self, date: &str) -> Result<i64> {
        self.conn.query_row(
            "SELECT COUNT(*) FROM tasks WHERE status = 'active' AND done = 0 AND due_date = ?1",
            [date],
            |r| r.get(0),
        )
    }

    pub fn set_done(&self, id: i64, done: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE tasks SET done = ?2, updated_at = datetime('now') WHERE id = ?1",
            params![id, done as i64],
        )?;
        Ok(())
    }

    pub fn update_task(&self, id: i64, title: &str, notes: &str, due_date: Option<&str>) -> Result<()> {
        self.conn.execute(
            "UPDATE tasks SET title = ?2, notes = ?3, due_date = ?4, updated_at = datetime('now') WHERE id = ?1",
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
            "SELECT {TASK_COLS} FROM tasks WHERE status = 'active' AND due_date = ?1 ORDER BY done, id"
        ))?;
        st.query_map([date], row_to_task)?.collect()
    }

    /// Todas as tarefas pendentes, ordenadas por data (sem data por último).
    pub fn pending(&self) -> Result<Vec<Task>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {TASK_COLS} FROM tasks WHERE status = 'active' AND done = 0 ORDER BY due_date IS NULL, due_date, id"
        ))?;
        st.query_map([], row_to_task)?.collect()
    }

    pub fn completed(&self) -> Result<Vec<Task>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {TASK_COLS} FROM tasks WHERE status = 'active' AND done = 1 ORDER BY updated_at DESC"
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
