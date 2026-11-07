//! Lixeira (soft delete via `deleted_at`) e descarte definitivo.

use crate::{row_to_task, Db, Task, TASK_COLS};
use rusqlite::Result;

/// Dias que uma tarefa fica na lixeira antes do descarte automático.
pub const TRASH_DAYS: i64 = 30;

/// Tarefa na lixeira com a idade calculada.
#[derive(Debug, Clone, PartialEq)]
pub struct TrashItem {
    pub task: Task,
    /// Há quantos dias foi excluída.
    pub days_ago: i64,
    /// Quantos dias faltam para o descarte automático.
    pub days_left: i64,
}

impl Db {
    /// Move a tarefa e suas subtarefas para a lixeira (mesmo `deleted_at`).
    pub fn trash_task(&self, id: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE tasks SET deleted_at = datetime('now')
             WHERE (id = ?1 OR parent_id = ?1) AND deleted_at IS NULL",
            [id],
        )?;
        Ok(())
    }

    /// Tira da lixeira a tarefa e as subtarefas excluídas junto com ela.
    pub fn restore_task(&self, id: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE tasks SET deleted_at = NULL, updated_at = datetime('now')
             WHERE id = ?1
                OR (parent_id = ?1 AND deleted_at = (SELECT deleted_at FROM tasks WHERE id = ?1))",
            [id],
        )?;
        Ok(())
    }

    /// Itens na lixeira, mais recentes primeiro. Subtarefas excluídas junto
    /// com a mãe não aparecem separadas.
    pub fn list_trash(&self) -> Result<Vec<TrashItem>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {TASK_COLS},
                    CAST(julianday('now') - julianday(deleted_at) AS INTEGER)
             FROM tasks t
             WHERE deleted_at IS NOT NULL
               AND (parent_id IS NULL
                    OR NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id = t.parent_id AND p.deleted_at = t.deleted_at))
             ORDER BY deleted_at DESC, id DESC"
        ))?;
        let rows = st.query_map([], |r| Ok((row_to_task(r)?, r.get::<_, i64>(12)?)))?;
        rows.map(|r| {
            let (task, days_ago) = r?;
            Ok(TrashItem { task, days_ago, days_left: (TRASH_DAYS - days_ago).max(0) })
        })
        .collect()
    }

    /// Apaga de verdade a tarefa e suas subtarefas, com anexos (inclusive os
    /// arquivos em disco, como em `delete_attachment`).
    pub fn purge_task(&self, id: i64) -> Result<()> {
        self.purge_ids(&self.ids_where("id = ?1", id)?)
    }

    /// Esvazia a lixeira. Devolve quantas tarefas (raízes) foram apagadas.
    pub fn empty_trash(&self) -> Result<usize> {
        let ids = self.ids_where("deleted_at IS NOT NULL AND ?1 = ?1", 0)?;
        let n = ids.len();
        self.purge_ids(&ids)?;
        Ok(n)
    }

    /// Apaga o que está na lixeira há `days` dias ou mais. Devolve a quantidade.
    pub fn purge_expired(&self, days: i64) -> Result<usize> {
        let ids = self.ids_where(
            "deleted_at IS NOT NULL AND julianday('now') - julianday(deleted_at) >= ?1",
            days,
        )?;
        let n = ids.len();
        self.purge_ids(&ids)?;
        Ok(n)
    }

    fn ids_where(&self, cond: &str, arg: i64) -> Result<Vec<i64>> {
        let mut st = self.conn.prepare(&format!("SELECT id FROM tasks WHERE {cond}"))?;
        let v = st.query_map([arg], |r| r.get(0))?.collect();
        v
    }

    /// Apaga as tarefas (subtarefas, anexos e etiquetas saem em cascata) e os arquivos.
    fn purge_ids(&self, ids: &[i64]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        let mut files = Vec::new();
        for id in ids {
            let mut st = tx.prepare(
                "SELECT stored_path FROM attachments
                 WHERE task_id = ?1 OR task_id IN (SELECT id FROM tasks WHERE parent_id = ?1)",
            )?;
            for p in st.query_map([id], |r| r.get::<_, String>(0))? {
                files.push(p?);
            }
            drop(st);
            tx.execute("DELETE FROM tasks WHERE id = ?1", [id])?;
        }
        tx.commit()?;
        for f in files {
            std::fs::remove_file(f).ok();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn age(db: &Db, id: i64, days: i64) {
        db.conn
            .execute(
                "UPDATE tasks SET deleted_at = datetime('now', ?2) WHERE id = ?1",
                rusqlite::params![id, format!("-{days} days")],
            )
            .unwrap();
    }

    #[test]
    fn trash_hides_and_restore_brings_back_with_subtasks() {
        let db = Db::open_in_memory().unwrap();
        let a = db.add_task("a", "", Some("2026-11-07")).unwrap();
        let sub = db.add_task("sub", "", None).unwrap();
        db.conn.execute("UPDATE tasks SET parent_id = ?1 WHERE id = ?2", [a, sub]).unwrap();
        db.add_task("b", "", Some("2026-11-07")).unwrap();

        db.trash_task(a).unwrap();
        assert_eq!(db.tasks_on("2026-11-07").unwrap().len(), 1);
        let t = db.list_trash().unwrap();
        assert_eq!(t.len(), 1); // subtarefa não aparece separada
        assert_eq!((t[0].task.id, t[0].days_ago, t[0].days_left), (a, 0, 30));
        assert!(db.get_task(sub).unwrap().deleted_at.is_some());

        db.restore_task(a).unwrap();
        assert!(db.list_trash().unwrap().is_empty());
        assert_eq!(db.tasks_on("2026-11-07").unwrap().len(), 2);
        assert!(db.get_task(sub).unwrap().deleted_at.is_none());
    }

    #[test]
    fn purge_expired_only_old_items() {
        let db = Db::open_in_memory().unwrap();
        let old = db.add_task("velha", "", None).unwrap();
        let new = db.add_task("nova", "", None).unwrap();
        db.trash_task(old).unwrap();
        db.trash_task(new).unwrap();
        age(&db, old, 31);
        age(&db, new, 5);

        let t = db.list_trash().unwrap();
        assert_eq!((t[0].task.id, t[0].days_ago, t[0].days_left), (new, 5, 25));
        assert_eq!(t[1].days_left, 0);

        assert_eq!(db.purge_expired(30).unwrap(), 1);
        assert!(db.get_task(old).is_err());
        assert_eq!(db.list_trash().unwrap().len(), 1);
    }

    #[test]
    fn purge_and_empty_remove_files_and_subtasks() {
        let dir = std::env::temp_dir().join(format!("prumo-trash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("a.txt");
        std::fs::write(&src, b"x").unwrap();

        let db = Db::open_in_memory().unwrap();
        let a = db.add_task("a", "", None).unwrap();
        let sub = db.add_task("sub", "", None).unwrap();
        db.conn.execute("UPDATE tasks SET parent_id = ?1 WHERE id = ?2", [a, sub]).unwrap();
        db.add_attachment(a, &src, &dir.join("anexos")).unwrap();
        let path = db.attachments(a).unwrap()[0].stored_path.clone();
        let b = db.add_task("b", "", None).unwrap();

        db.trash_task(a).unwrap();
        db.trash_task(b).unwrap();
        db.purge_task(a).unwrap();
        assert!(db.get_task(a).is_err() && db.get_task(sub).is_err());
        assert!(!std::path::Path::new(&path).exists());
        assert_eq!(db.list_trash().unwrap().len(), 1);

        assert_eq!(db.empty_trash().unwrap(), 1);
        assert!(db.list_trash().unwrap().is_empty());
        // tarefas vivas não são tocadas
        let c = db.add_task("c", "", None).unwrap();
        assert_eq!(db.empty_trash().unwrap(), 0);
        assert!(db.get_task(c).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }
}
