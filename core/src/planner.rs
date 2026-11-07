//! Visão Semana: tarefas agrupadas por dia e movimentação entre colunas.

use chrono::{Duration, NaiveDate};
use rusqlite::{params, Result};

use crate::{Db, Task, LIVE, TASK_COLS};

/// Resultado bruto de `Db::week`: tarefas já agrupadas por coluna.
#[derive(Debug, Clone, PartialEq)]
pub struct WeekRaw {
    pub overdue: Vec<Task>,
    /// Um item por dia da janela: (`YYYY-MM-DD`, tarefas do dia).
    pub days: Vec<(String, Vec<Task>)>,
    pub undated: Vec<Task>,
}

fn invalid(msg: String) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(msg)
}

fn parse_date(s: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .ok()
        .filter(|_| s.len() == 10)
        .ok_or_else(|| invalid(format!("data inválida: {s} (use YYYY-MM-DD)")))
}

impl Db {
    /// Atrasadas (antes de `today`), os `days` dias a partir de `from` e as sem data.
    /// Os dias trazem pendentes (por `position`, `id`) e depois as concluídas.
    pub fn week(&self, from: &str, days: i64, today: &str) -> Result<WeekRaw> {
        let start = parse_date(from)?;
        if !(1..=31).contains(&days) {
            return Err(invalid(format!("days inválido: {days} (use 1 a 31)")));
        }
        let end = start + Duration::days(days - 1);
        let (start_s, end_s) = (start.format("%Y-%m-%d").to_string(), end.format("%Y-%m-%d").to_string());

        let overdue = self.overdue(today)?;

        let mut st = self.conn.prepare(&format!(
            "SELECT {TASK_COLS} FROM tasks
             WHERE status = 'active' AND {LIVE} AND due_date >= ?1 AND due_date <= ?2
             ORDER BY due_date, done, position, id"
        ))?;
        let in_range: Vec<Task> = st.query_map([&start_s, &end_s], crate::row_to_task)?.collect::<Result<_>>()?;

        let mut cols: Vec<(String, Vec<Task>)> = (0..days)
            .map(|i| ((start + Duration::days(i)).format("%Y-%m-%d").to_string(), Vec::new()))
            .collect();
        for t in in_range {
            let due = t.due_date.as_deref().unwrap_or_default();
            if let Ok(d) = NaiveDate::parse_from_str(due, "%Y-%m-%d") {
                let idx = (d - start).num_days();
                if (0..days).contains(&idx) {
                    cols[idx as usize].1.push(t);
                }
            }
        }

        let mut st = self.conn.prepare(&format!(
            "SELECT {TASK_COLS} FROM tasks
             WHERE status = 'active' AND {LIVE} AND done = 0 AND due_date IS NULL
             ORDER BY position, id"
        ))?;
        let undated = st.query_map([], crate::row_to_task)?.collect::<Result<_>>()?;

        Ok(WeekRaw { overdue, days: cols, undated })
    }

    /// Move a tarefa para `date` (`None` = sem data) na posição `index` entre as
    /// pendentes da coluna destino (sem contar ela mesma; `index` é limitado a 0..=n).
    /// Reinicia `reminded_at` se a data mudou. Tudo numa transação.
    pub fn move_task(&self, id: i64, date: Option<&str>, index: i64) -> Result<()> {
        let date = match date {
            Some(d) => Some(parse_date(d)?.format("%Y-%m-%d").to_string()),
            None => None,
        };
        let tx = self.conn.unchecked_transaction()?;
        let exists: i64 = tx.query_row(
            &format!("SELECT COUNT(*) FROM tasks WHERE id = ?1 AND {LIVE}"),
            [id],
            |r| r.get(0),
        )?;
        if exists == 0 {
            return Err(invalid(format!("tarefa {id} não existe ou está na lixeira")));
        }
        tx.execute(
            "UPDATE tasks SET reminded_at = CASE WHEN due_date IS NOT ?2 THEN NULL ELSE reminded_at END,
                              due_date = ?2, updated_at = datetime('now')
             WHERE id = ?1",
            params![id, date],
        )?;
        let mut ids: Vec<i64> = {
            let mut st = tx.prepare(&format!(
                "SELECT id FROM tasks
                 WHERE status = 'active' AND {LIVE} AND done = 0 AND due_date IS ?1 AND id != ?2
                 ORDER BY position, id"
            ))?;
            st.query_map(params![date, id], |r| r.get(0))?.collect::<Result<_>>()?
        };
        let at = index.clamp(0, ids.len() as i64) as usize;
        ids.insert(at, id);
        {
            let mut st = tx.prepare("UPDATE tasks SET position = ?2 WHERE id = ?1")?;
            for (i, tid) in ids.iter().enumerate() {
                st.execute(params![tid, i as i64])?;
            }
        }
        tx.commit()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn titles(v: &[Task]) -> Vec<&str> {
        v.iter().map(|t| t.title.as_str()).collect()
    }

    #[test]
    fn week_groups_by_day_with_all_rules() {
        let db = Db::open_in_memory().unwrap();
        db.add_task("atrasada", "", Some("2026-11-03")).unwrap();
        db.add_task("antes da janela", "", Some("2026-11-08")).unwrap();
        let feita = db.add_task("feita", "", Some("2026-11-09")).unwrap();
        db.add_task("pend", "", Some("2026-11-09")).unwrap();
        db.set_done(feita, true).unwrap();
        db.add_task("ultimo", "", Some("2026-11-15")).unwrap();
        db.add_task("fora", "", Some("2026-11-16")).unwrap();
        db.add_task("solta", "", None).unwrap();
        let lixo = db.add_task("lixo", "", Some("2026-11-10")).unwrap();
        db.trash_task(lixo).unwrap();
        let pai = db.add_task("pai", "", Some("2026-11-10")).unwrap();
        db.add_subtask(pai, "sub").unwrap();
        db.add_task_from("inbox", "", Some("2026-11-10"), "claude").unwrap();
        let sd_feita = db.add_task("sd feita", "", None).unwrap();
        db.set_done(sd_feita, true).unwrap();

        let w = db.week("2026-11-09", 7, "2026-11-07").unwrap();
        assert_eq!(titles(&w.overdue), ["atrasada"]);
        assert_eq!(w.days.len(), 7);
        assert_eq!(w.days[0].0, "2026-11-09");
        assert_eq!(w.days[6].0, "2026-11-15");
        assert_eq!(titles(&w.days[0].1), ["pend", "feita"]);
        assert_eq!(titles(&w.days[1].1), ["pai"]);
        assert_eq!(titles(&w.days[6].1), ["ultimo"]);
        assert_eq!(titles(&w.undated), ["solta"]);
    }

    #[test]
    fn week_validates_arguments() {
        let db = Db::open_in_memory().unwrap();
        assert!(db.week("2026-13-01", 7, "2026-11-07").is_err());
        assert!(db.week("x", 7, "2026-11-07").is_err());
        assert!(db.week("2026-11-09", 0, "2026-11-07").is_err());
        assert!(db.week("2026-11-09", 32, "2026-11-07").is_err());
        assert_eq!(db.week("2026-11-09", 1, "2026-11-07").unwrap().days.len(), 1);
    }

    fn col(db: &Db, d: Option<&str>) -> Vec<String> {
        let w = db.week("2026-11-09", 7, "2026-11-01").unwrap();
        match d {
            Some(d) => w.days.into_iter().find(|(x, _)| x == d).unwrap().1,
            None => w.undated,
        }
        .into_iter()
        .map(|t| t.title)
        .collect()
    }

    #[test]
    fn move_task_between_days_and_within_column() {
        let db = Db::open_in_memory().unwrap();
        let a = db.add_task("a", "", Some("2026-11-09")).unwrap();
        let b = db.add_task("b", "", Some("2026-11-09")).unwrap();
        let c = db.add_task("c", "", Some("2026-11-10")).unwrap();
        let d = db.add_task("d", "", Some("2026-11-10")).unwrap();
        let feita = db.add_task("feita", "", Some("2026-11-10")).unwrap();
        db.set_done(feita, true).unwrap();

        // outro dia, no meio
        db.move_task(a, Some("2026-11-10"), 1).unwrap();
        assert_eq!(col(&db, Some("2026-11-10")), ["c", "a", "d", "feita"]);
        assert_eq!(col(&db, Some("2026-11-09")), ["b"]);
        assert_eq!(db.get_task(a).unwrap().due_date.as_deref(), Some("2026-11-10"));

        // dentro da coluna: o index ignora a própria tarefa
        db.move_task(c, Some("2026-11-10"), 2).unwrap();
        assert_eq!(col(&db, Some("2026-11-10")), ["a", "d", "c", "feita"]);
        db.move_task(c, Some("2026-11-10"), 0).unwrap();
        assert_eq!(col(&db, Some("2026-11-10")), ["c", "a", "d", "feita"]);

        // index fora do intervalo
        db.move_task(b, Some("2026-11-10"), 99).unwrap();
        assert_eq!(col(&db, Some("2026-11-10")), ["c", "a", "d", "b", "feita"]);
        db.move_task(d, Some("2026-11-10"), -5).unwrap();
        assert_eq!(col(&db, Some("2026-11-10")), ["d", "c", "a", "b", "feita"]);

        // sem data
        db.move_task(a, None, 0).unwrap();
        assert_eq!(col(&db, None), ["a"]);
        assert_eq!(db.get_task(a).unwrap().due_date, None);
    }

    #[test]
    fn move_task_rejects_bad_input_and_resets_reminder() {
        let db = Db::open_in_memory().unwrap();
        let a = db.add_task("a", "", Some("2026-11-09")).unwrap();
        assert!(db.move_task(a, Some("amanhã"), 0).is_err());
        assert!(db.move_task(a, Some("2026-02-30"), 0).is_err());
        assert!(db.move_task(999, None, 0).is_err());
        assert_eq!(db.get_task(a).unwrap().due_date.as_deref(), Some("2026-11-09"));
        let lixo = db.add_task("lixo", "", None).unwrap();
        db.trash_task(lixo).unwrap();
        assert!(db.move_task(lixo, Some("2026-11-09"), 0).is_err());

        db.set_due_time(a, Some("09:00")).unwrap();
        db.mark_reminded(a).unwrap();
        let reminded = |db: &Db| -> Option<String> {
            db.conn.query_row("SELECT reminded_at FROM tasks WHERE id = ?1", [a], |r| r.get(0)).unwrap()
        };
        assert!(reminded(&db).is_some());
        db.move_task(a, Some("2026-11-09"), 0).unwrap(); // mesma data: mantém
        assert!(reminded(&db).is_some());
        db.move_task(a, Some("2026-11-10"), 0).unwrap();
        assert!(reminded(&db).is_none());
        assert_eq!(db.get_task(a).unwrap().due_time.as_deref(), Some("09:00"));
    }
}
