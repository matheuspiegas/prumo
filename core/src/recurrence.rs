//! Recorrência de tarefas: formato `<unidade>:<n>` (`day|week|month`) em `tasks.recurrence`.

use crate::{Db, today};
use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::{Result, params};
use std::{fmt, str::FromStr};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Day,
    Week,
    Month,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Recurrence {
    pub unit: Unit,
    pub n: u32,
}

impl fmt::Display for Recurrence {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let u = match self.unit {
            Unit::Day => "day",
            Unit::Week => "week",
            Unit::Month => "month",
        };
        write!(f, "{u}:{}", self.n)
    }
}

impl FromStr for Recurrence {
    type Err = String;

    fn from_str(s: &str) -> std::result::Result<Self, String> {
        let (u, n) = s.trim().split_once(':').ok_or_else(|| format!("recorrência inválida: {s:?}"))?;
        let unit = match u {
            "day" => Unit::Day,
            "week" => Unit::Week,
            "month" => Unit::Month,
            _ => return Err(format!("unidade de recorrência desconhecida: {u:?}")),
        };
        let n: u32 = n.parse().map_err(|_| format!("intervalo inválido: {n:?}"))?;
        if !(1..=999).contains(&n) {
            return Err(format!("intervalo fora de 1..=999: {n}"));
        }
        Ok(Self { unit, n })
    }
}

fn last_day_of_month(y: i32, m: u32) -> u32 {
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    NaiveDate::from_ymd_opt(ny, nm, 1).unwrap().pred_opt().unwrap().day()
}

/// Próxima data a partir de `due`. Mês: mantém o dia, com clamp no fim do mês
/// (31 jan + 1 mês = 28/29 fev). O dia original não é guardado, então depois
/// do clamp a série segue a partir do dia ajustado (28 fev -> 28 mar).
pub fn next_date(due: NaiveDate, rec: Recurrence) -> NaiveDate {
    match rec.unit {
        Unit::Day => due + Duration::days(rec.n as i64),
        Unit::Week => due + Duration::weeks(rec.n as i64),
        Unit::Month => {
            let total = due.year() * 12 + due.month0() as i32 + rec.n as i32;
            let (y, m) = (total.div_euclid(12), total.rem_euclid(12) as u32 + 1);
            NaiveDate::from_ymd_opt(y, m, due.day().min(last_day_of_month(y, m))).unwrap()
        }
    }
}

impl Db {
    /// Garante a coluna `recurrence` (idempotente; a migração oficial pode já tê-la criado).
    pub(crate) fn ensure_recurrence_column(&self) -> Result<()> {
        if !self.has_column("recurrence")? {
            self.conn.execute_batch("ALTER TABLE tasks ADD COLUMN recurrence TEXT")?;
        }
        Ok(())
    }

    fn has_column(&self, col: &str) -> Result<bool> {
        self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = ?1",
            [col],
            |r| r.get::<_, i64>(0).map(|n| n > 0),
        )
    }

    pub fn get_recurrence(&self, id: i64) -> Result<Option<String>> {
        self.conn.query_row("SELECT recurrence FROM tasks WHERE id = ?1", [id], |r| r.get(0))
    }

    /// Define (ou remove, com `None`) a recorrência. Valida o formato. Uma tarefa
    /// recorrente precisa de data: se não tiver `due_date`, usa hoje.
    pub fn set_recurrence(&self, id: i64, rec: Option<&str>) -> Result<()> {
        let rec = match rec.map(str::trim).filter(|s| !s.is_empty()) {
            Some(s) => Some(
                s.parse::<Recurrence>()
                    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?
                    .to_string(),
            ),
            None => None,
        };
        let fallback = if rec.is_some() { Some(today()) } else { None };
        self.conn.execute(
            "UPDATE tasks SET recurrence = ?2, due_date = COALESCE(due_date, ?3),
             updated_at = datetime('now') WHERE id = ?1",
            params![id, rec, fallback],
        )?;
        Ok(())
    }

    /// Cria a próxima ocorrência de uma tarefa recorrente (cópia sem anexos nem
    /// subtarefas) e tira a recorrência da original, que vira histórico.
    /// Devolve o id da nova tarefa, ou `None` se não era recorrente.
    pub fn spawn_next_occurrence(&self, id: i64) -> Result<Option<i64>> {
        let Some(rec_s) = self.get_recurrence(id)? else { return Ok(None) };
        let Ok(rec) = rec_s.parse::<Recurrence>() else { return Ok(None) };
        let due: Option<String> = self.conn.query_row("SELECT due_date FROM tasks WHERE id = ?1", [id], |r| r.get(0))?;
        let now = chrono::Local::now().date_naive();
        let base = due.and_then(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok()).unwrap_or(now);
        let mut next = next_date(base, rec);
        while next < now {
            next = next_date(next, rec);
        }

        // Colunas opcionais (priority, due_time) só se existirem neste banco.
        let mut cols = String::from("title, notes, due_date, source, status, recurrence, position");
        let mut vals = String::from(
            "title, notes, ?2, source, 'active', recurrence, (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks)",
        );
        for c in ["priority", "due_time"] {
            if self.has_column(c)? {
                cols.push_str(&format!(", {c}"));
                vals.push_str(&format!(", {c}"));
            }
        }
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            &format!("INSERT INTO tasks ({cols}) SELECT {vals} FROM tasks WHERE id = ?1"),
            params![id, next.format("%Y-%m-%d").to_string()],
        )?;
        let new_id = tx.last_insert_rowid();
        let has_tags: bool = tx.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'task_tags'",
            [],
            |r| r.get::<_, i64>(0).map(|n| n > 0),
        )?;
        if has_tags {
            tx.execute(
                "INSERT INTO task_tags (task_id, tag_id) SELECT ?2, tag_id FROM task_tags WHERE task_id = ?1",
                params![id, new_id],
            )?;
        }
        tx.execute("UPDATE tasks SET recurrence = NULL WHERE id = ?1", [id])?;
        tx.commit()?;
        Ok(Some(new_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }
    fn rec(s: &str) -> Recurrence {
        s.parse().unwrap()
    }

    #[test]
    fn parse_and_display() {
        assert_eq!(rec("week:2").to_string(), "week:2");
        for bad in ["", "week", "year:1", "day:0", "day:x", "day:-1", "month:1000"] {
            assert!(bad.parse::<Recurrence>().is_err(), "{bad}");
        }
    }

    #[test]
    fn month_end_and_leap_year() {
        assert_eq!(next_date(d("2027-01-31"), rec("month:1")), d("2027-02-28"));
        assert_eq!(next_date(d("2028-01-31"), rec("month:1")), d("2028-02-29"));
        assert_eq!(next_date(d("2026-12-15"), rec("month:1")), d("2027-01-15"));
        assert_eq!(next_date(d("2026-11-30"), rec("month:3")), d("2027-02-28"));
        assert_eq!(next_date(d("2026-11-07"), rec("day:10")), d("2026-11-17"));
        assert_eq!(next_date(d("2026-11-07"), rec("week:2")), d("2026-11-21"));
    }

    #[test]
    fn set_recurrence_validates_and_defaults_date() {
        let db = Db::open_in_memory().unwrap();
        let id = db.add_task("t", "", None).unwrap();
        assert!(db.set_recurrence(id, Some("foo:1")).is_err());
        db.set_recurrence(id, Some("day:1")).unwrap();
        assert_eq!(db.get_task(id).unwrap().due_date, Some(today()));
        db.set_recurrence(id, None).unwrap();
        assert_eq!(db.get_recurrence(id).unwrap(), None);
    }

    #[test]
    fn completing_spawns_next_once() {
        let db = Db::open_in_memory().unwrap();
        let id = db.add_task("Pagar", "n", Some("2999-01-31")).unwrap();
        db.set_recurrence(id, Some("month:1")).unwrap();
        db.set_done(id, true).unwrap();
        db.set_done(id, true).unwrap(); // dupla conclusão não duplica
        let p = db.pending().unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!((p[0].title.as_str(), p[0].notes.as_str()), ("Pagar", "n"));
        assert_eq!(p[0].due_date.as_deref(), Some("2999-02-28"));
        assert_eq!(db.get_recurrence(p[0].id).unwrap().as_deref(), Some("month:1"));
        assert_eq!(db.get_recurrence(id).unwrap(), None);
        // desmarcar e marcar de novo a antiga (sem recorrência) não gera nada
        db.set_done(id, false).unwrap();
        db.set_done(id, true).unwrap();
        assert_eq!(db.pending().unwrap().len(), 1);
    }

    #[test]
    fn overdue_task_advances_to_today_or_later() {
        let db = Db::open_in_memory().unwrap();
        let id = db.add_task("Semanal", "", Some("2020-01-01")).unwrap();
        db.set_recurrence(id, Some("week:1")).unwrap();
        db.set_done(id, true).unwrap();
        let next = db.pending().unwrap().remove(0).due_date.unwrap();
        assert!(d(&next) >= chrono::Local::now().date_naive());
        assert_eq!(d(&next).weekday(), d("2020-01-01").weekday());
    }

    #[test]
    fn copies_tags_when_present() {
        let db = Db::open_in_memory().unwrap();
        db.conn
            .execute_batch("CREATE TABLE IF NOT EXISTS task_tags (task_id INTEGER, tag_id INTEGER);")
            .unwrap();
        let id = db.add_task("t", "", Some("2999-01-01")).unwrap();
        db.conn.execute("INSERT INTO task_tags VALUES (?1, 7)", [id]).unwrap();
        db.set_recurrence(id, Some("day:1")).unwrap();
        db.set_done(id, true).unwrap();
        let new = db.pending().unwrap()[0].id;
        let n: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM task_tags WHERE task_id = ?1 AND tag_id = 7", [new], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }
}
