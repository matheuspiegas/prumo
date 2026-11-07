//! Subtarefas / checklist: linhas de `tasks` com `parent_id` preenchido.
//!
//! Regras:
//! - Um nível só: subtarefa não tem filha.
//! - Concluir o pai NÃO conclui as filhas (decisão de produto: o checklist é
//!   independente). Apagar o pai apaga as filhas (FK `ON DELETE CASCADE`).
//! - Concluir/excluir uma subtarefa reaproveita `set_done` e `delete_task`,
//!   que funcionam por id e não olham `parent_id`.
//! - As listagens principais escondem subtarefas via `LIVE`.

use rusqlite::{params, params_from_iter, Result};
use std::collections::HashMap;

use crate::{row_to_task, Db, Task, TASK_COLS};

fn invalid(msg: &str) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(msg.to_string().into())
}

impl Db {
    /// Cria uma subtarefa no fim do checklist de `parent_id`.
    pub fn add_subtask(&self, parent_id: i64, title: &str) -> Result<i64> {
        let title = title.trim();
        if title.is_empty() {
            return Err(invalid("o título da subtarefa não pode ser vazio"));
        }
        let parent = self.get_task(parent_id)?;
        if parent.parent_id.is_some() {
            return Err(invalid("subtarefa não pode ter subtarefas"));
        }
        if parent.deleted_at.is_some() {
            return Err(invalid("a tarefa está na lixeira"));
        }
        self.conn.execute(
            "INSERT INTO tasks (title, parent_id, source, status, position)
             VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks))",
            params![title, parent_id, parent.source, parent.status],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Subtarefas de uma tarefa, na ordem do checklist (fora da lixeira).
    pub fn subtasks(&self, parent_id: i64) -> Result<Vec<Task>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {TASK_COLS} FROM tasks WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY position, id"
        ))?;
        st.query_map([parent_id], row_to_task)?.collect()
    }

    /// Renomeia uma subtarefa.
    pub fn rename_subtask(&self, id: i64, title: &str) -> Result<()> {
        let title = title.trim();
        if title.is_empty() {
            return Err(invalid("o título da subtarefa não pode ser vazio"));
        }
        self.conn.execute(
            "UPDATE tasks SET title = ?2, updated_at = datetime('now') WHERE id = ?1 AND parent_id IS NOT NULL",
            params![id, title],
        )?;
        Ok(())
    }

    /// Reordena o checklist de `parent_id`: `position` = índice em `ids`.
    /// Ids que não são filhas de `parent_id` são ignorados.
    pub fn reorder_subtasks(&self, parent_id: i64, ids: &[i64]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        {
            let mut st = tx.prepare("UPDATE tasks SET position = ?3 WHERE id = ?1 AND parent_id = ?2")?;
            for (i, id) in ids.iter().enumerate() {
                st.execute(params![id, parent_id, i as i64])?;
            }
        }
        tx.commit()
    }

    /// (feitas, total) das subtarefas de cada pai, numa única consulta agrupada.
    /// Pais sem subtarefas ficam fora do mapa.
    pub fn subtask_progress(&self, parent_ids: &[i64]) -> Result<HashMap<i64, (i64, i64)>> {
        let mut out = HashMap::new();
        if parent_ids.is_empty() {
            return Ok(out);
        }
        let marks = vec!["?"; parent_ids.len()].join(",");
        let mut st = self.conn.prepare(&format!(
            "SELECT parent_id, COALESCE(SUM(done), 0), COUNT(*) FROM tasks
             WHERE parent_id IN ({marks}) AND deleted_at IS NULL GROUP BY parent_id"
        ))?;
        let rows = st.query_map(params_from_iter(parent_ids), |r| {
            Ok((r.get::<_, i64>(0)?, (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))
        })?;
        for row in rows {
            let (id, p) = row?;
            out.insert(id, p);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checklist_basico() {
        let db = Db::open_in_memory().unwrap();
        let p = db.add_task("Mudança", "", None).unwrap();
        let a = db.add_subtask(p, "caixas").unwrap();
        let b = db.add_subtask(p, "  frete ").unwrap();
        let c = db.add_subtask(p, "internet").unwrap();
        let titles = |v: Vec<Task>| v.into_iter().map(|t| t.title).collect::<Vec<_>>();
        assert_eq!(titles(db.subtasks(p).unwrap()), ["caixas", "frete", "internet"]);
        // não aparecem nas listagens principais
        assert_eq!(db.pending().unwrap().len(), 1);

        db.reorder_subtasks(p, &[c, a, b]).unwrap();
        assert_eq!(titles(db.subtasks(p).unwrap()), ["internet", "caixas", "frete"]);

        db.rename_subtask(a, "caixas e fita").unwrap();
        assert!(db.rename_subtask(a, "  ").is_err());
        assert_eq!(db.get_task(a).unwrap().title, "caixas e fita");

        // set_done/delete_task existentes funcionam em subtarefas
        db.set_done(a, true).unwrap();
        db.set_done(b, true).unwrap();
        db.delete_task(b).unwrap();
        let prog = db.subtask_progress(&[p]).unwrap();
        assert_eq!(prog[&p], (1, 2));
    }

    #[test]
    fn um_nivel_e_validacoes() {
        let db = Db::open_in_memory().unwrap();
        let p = db.add_task("pai", "", None).unwrap();
        let s = db.add_subtask(p, "filha").unwrap();
        assert!(db.add_subtask(s, "neta").is_err());
        assert!(db.add_subtask(p, "").is_err());
        assert!(db.add_subtask(9999, "órfã").is_err());
    }

    #[test]
    fn progresso_agrupado_e_cascade() {
        let db = Db::open_in_memory().unwrap();
        let p1 = db.add_task("p1", "", None).unwrap();
        let p2 = db.add_task("p2", "", None).unwrap();
        let p3 = db.add_task("p3", "", None).unwrap();
        let a = db.add_subtask(p1, "a").unwrap();
        db.add_subtask(p1, "b").unwrap();
        db.add_subtask(p2, "c").unwrap();
        db.set_done(a, true).unwrap();
        assert!(db.subtask_progress(&[]).unwrap().is_empty());
        let prog = db.subtask_progress(&[p1, p2, p3]).unwrap();
        assert_eq!(prog[&p1], (1, 2));
        assert_eq!(prog[&p2], (0, 1));
        assert!(!prog.contains_key(&p3));

        // concluir o pai não conclui as filhas
        db.set_done(p1, true).unwrap();
        assert_eq!(db.subtask_progress(&[p1]).unwrap()[&p1], (1, 2));

        // apagar o pai apaga as filhas
        db.delete_task(p1).unwrap();
        assert!(db.subtasks(p1).unwrap().is_empty());
        assert!(db.get_task(a).is_err());
    }
}
