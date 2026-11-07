//! Tarefas atrasadas, reagendamento e prioridade.
//!
//! Ordenação: a ordem manual (`position`, via `reorder`) sempre manda. A
//! prioridade é só um indicador visual e NÃO altera o `ORDER BY` das listagens,
//! pois qualquer critério antes de `position` quebraria o arrastar-e-soltar.

use rusqlite::{params, Result};

use crate::{Db, Task, LIVE, TASK_COLS};

impl Db {
    /// Tarefas ativas, não concluídas, com vencimento anterior a `today`
    /// (da mais antiga para a mais recente, respeitando a ordem manual no empate).
    pub fn overdue(&self, today: &str) -> Result<Vec<Task>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {TASK_COLS} FROM tasks
             WHERE status = 'active' AND {LIVE} AND done = 0 AND due_date IS NOT NULL AND due_date < ?1
             ORDER BY due_date, position, id"
        ))?;
        st.query_map([today], crate::row_to_task)?.collect()
    }

    pub fn overdue_count(&self, today: &str) -> Result<i64> {
        self.conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM tasks
                 WHERE status = 'active' AND {LIVE} AND done = 0 AND due_date IS NOT NULL AND due_date < ?1"
            ),
            [today],
            |r| r.get(0),
        )
    }

    /// Muda só a data de vencimento (`None` remove).
    pub fn set_due_date(&self, id: i64, date: Option<&str>) -> Result<()> {
        self.conn.execute(
            "UPDATE tasks SET reminded_at = CASE WHEN due_date IS NOT ?2 THEN NULL ELSE reminded_at END,
                              due_date = ?2, updated_at = datetime('now') WHERE id = ?1",
            params![id, date],
        )?;
        Ok(())
    }

    /// Move todas as atrasadas para `today`; devolve quantas foram movidas.
    pub fn reschedule_overdue(&self, today: &str) -> Result<usize> {
        self.conn.execute(
            &format!(
                "UPDATE tasks SET due_date = ?1, reminded_at = NULL, updated_at = datetime('now')
                 WHERE status = 'active' AND {LIVE} AND done = 0 AND due_date IS NOT NULL AND due_date < ?1"
            ),
            [today],
        )
    }

    /// 0 nenhuma, 1 baixa, 2 média, 3 alta. Valores fora disso dão erro.
    pub fn set_priority(&self, id: i64, priority: i64) -> Result<()> {
        if !(0..=3).contains(&priority) {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "prioridade inválida: {priority} (use 0 a 3)"
            )));
        }
        self.conn.execute(
            "UPDATE tasks SET priority = ?2, updated_at = datetime('now') WHERE id = ?1",
            params![id, priority],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overdue_lists_only_past_pending_live_tasks() {
        let db = Db::open_in_memory().unwrap();
        let old = db.add_task("velha", "", Some("2026-11-01")).unwrap();
        db.add_task("ontem", "", Some("2026-11-06")).unwrap();
        db.add_task("hoje", "", Some("2026-11-07")).unwrap();
        db.add_task("sem data", "", None).unwrap();
        let done = db.add_task("feita", "", Some("2026-11-02")).unwrap();
        db.set_done(done, true).unwrap();
        db.add_task_from("do agente", "", Some("2026-11-03"), "claude").unwrap();

        let t: Vec<_> = db.overdue("2026-11-07").unwrap().into_iter().map(|t| t.title).collect();
        assert_eq!(t, ["velha", "ontem"]);
        assert_eq!(db.overdue_count("2026-11-07").unwrap(), 2);

        db.set_due_date(old, Some("2026-11-07")).unwrap();
        assert_eq!(db.overdue_count("2026-11-07").unwrap(), 1);
        assert_eq!(db.reschedule_overdue("2026-11-07").unwrap(), 1);
        assert!(db.overdue("2026-11-07").unwrap().is_empty());
        assert_eq!(db.tasks_on("2026-11-07").unwrap().len(), 3);
    }

    #[test]
    fn set_priority_validates_and_keeps_manual_order() {
        let db = Db::open_in_memory().unwrap();
        let a = db.add_task("a", "", Some("2026-11-07")).unwrap();
        let b = db.add_task("b", "", Some("2026-11-07")).unwrap();
        assert_eq!(db.get_task(a).unwrap().priority, 0);
        db.set_priority(b, 3).unwrap();
        assert_eq!(db.get_task(b).unwrap().priority, 3);
        assert!(db.set_priority(a, 4).is_err());
        assert!(db.set_priority(a, -1).is_err());
        assert_eq!(db.get_task(a).unwrap().priority, 0);
        // prioridade não muda a ordem manual
        let t: Vec<_> = db.tasks_on("2026-11-07").unwrap().into_iter().map(|t| t.title).collect();
        assert_eq!(t, ["a", "b"]);
    }

    #[test]
    fn rescheduling_rearms_the_reminder() {
        let db = Db::open_in_memory().unwrap();
        let a = db.add_task("a", "", Some("2026-11-01")).unwrap();
        let b = db.add_task("b", "", Some("2026-11-02")).unwrap();
        for id in [a, b] {
            db.set_due_time(id, Some("09:00")).unwrap();
            db.mark_reminded(id).unwrap();
        }
        let reminded = |id: i64| -> Option<String> {
            db.conn.query_row("SELECT reminded_at FROM tasks WHERE id = ?1", [id], |r| r.get(0)).unwrap()
        };
        db.set_due_date(a, Some("2026-11-01")).unwrap(); // mesma data: mantém
        assert!(reminded(a).is_some());
        db.set_due_date(a, Some("2026-11-07")).unwrap();
        assert!(reminded(a).is_none());
        assert!(reminded(b).is_some());
        db.reschedule_overdue("2026-11-07").unwrap();
        assert!(reminded(b).is_none());
    }
}
