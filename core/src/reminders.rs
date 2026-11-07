//! Lembretes com hora: `tasks.due_time` ("HH:MM", horário local, opcional) e
//! `tasks.reminded_at` (quando o lembrete já foi disparado).
use crate::{Db, LIVE, TASK_COLS, Task, row_to_task};
use chrono::{Duration, NaiveDate, NaiveDateTime, NaiveTime};
use rusqlite::{Result, params};

/// Lembretes mais antigos que isto não disparam (evita enxurrada ao abrir o app).
const MAX_ATRASO_H: i64 = 24;

/// Valida e normaliza "H:MM"/"HH:MM" para "HH:MM".
pub fn parse_hhmm(s: &str) -> Option<String> {
    let t = NaiveTime::parse_from_str(s.trim(), "%H:%M").ok()?;
    Some(t.format("%H:%M").to_string())
}

impl Db {
    /// Define (ou limpa, com `None`) a hora da tarefa e rearma o lembrete.
    pub fn set_due_time(&self, id: i64, time: Option<&str>) -> Result<()> {
        let time = match time.map(str::trim).filter(|t| !t.is_empty()) {
            Some(t) => Some(
                parse_hhmm(t)
                    .ok_or_else(|| rusqlite::Error::InvalidParameterName(format!("Hora inválida: {t}")))?,
            ),
            None => None,
        };
        self.conn.execute(
            "UPDATE tasks SET due_time = ?2, reminded_at = NULL, updated_at = datetime('now') WHERE id = ?1",
            params![id, time],
        )?;
        Ok(())
    }

    /// Rearma o lembrete (ex.: depois de a data mudar).
    pub fn reset_reminder(&self, id: i64) -> Result<()> {
        self.conn.execute("UPDATE tasks SET reminded_at = NULL WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn mark_reminded(&self, id: i64) -> Result<()> {
        self.conn
            .execute("UPDATE tasks SET reminded_at = datetime('now') WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Tarefas vivas, ativas e não concluídas, com data e hora, cujo instante já chegou
    /// (e não passou de 24 h), ainda sem lembrete disparado.
    pub fn due_reminders(&self, now_local: NaiveDateTime) -> Result<Vec<Task>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {TASK_COLS} FROM tasks
             WHERE status = 'active' AND done = 0 AND {LIVE}
               AND due_date IS NOT NULL AND due_time IS NOT NULL AND reminded_at IS NULL
             ORDER BY due_date, due_time, id"
        ))?;
        let rows = st.query_map([], row_to_task)?;
        let mut out = Vec::new();
        for row in rows {
            let task = row?;
            let Some(date) = task
                .due_date
                .as_deref()
                .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
            else {
                continue;
            };
            let Some(time) = task.due_time.as_deref().and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok())
            else {
                continue;
            };
            let instante = date.and_time(time);
            if instante <= now_local && now_local - instante <= Duration::hours(MAX_ATRASO_H) {
                out.push(task);
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }

    #[test]
    fn valida_hora() {
        let db = Db::open_in_memory().unwrap();
        let id = db.add_task("a", "", Some("2026-11-07")).unwrap();
        assert!(db.set_due_time(id, Some("25:00")).is_err());
        assert!(db.set_due_time(id, Some("abc")).is_err());
        db.set_due_time(id, Some("9:05")).unwrap();
        assert_eq!(db.get_task(id).unwrap().due_time.as_deref(), Some("09:05"));
        db.set_due_time(id, Some(" ")).unwrap();
        assert_eq!(db.get_task(id).unwrap().due_time, None);
    }

    #[test]
    fn dispara_so_depois_da_hora_e_uma_vez() {
        let db = Db::open_in_memory().unwrap();
        let id = db.add_task("reunião", "", Some("2026-11-07")).unwrap();
        db.set_due_time(id, Some("14:30")).unwrap();
        assert!(db.due_reminders(at("2026-11-07 14:29")).unwrap().is_empty());
        assert_eq!(db.due_reminders(at("2026-11-07 14:30")).unwrap().len(), 1);
        db.mark_reminded(id).unwrap();
        assert!(db.due_reminders(at("2026-11-07 15:00")).unwrap().is_empty());
        // mudar a hora rearma
        db.set_due_time(id, Some("14:45")).unwrap();
        assert_eq!(db.due_reminders(at("2026-11-07 15:00")).unwrap().len(), 1);
        db.mark_reminded(id).unwrap();
        db.reset_reminder(id).unwrap();
        assert_eq!(db.due_reminders(at("2026-11-07 15:00")).unwrap().len(), 1);
    }

    #[test]
    fn ignora_antigas_concluidas_e_sem_hora() {
        let db = Db::open_in_memory().unwrap();
        let velha = db.add_task("velha", "", Some("2026-11-05")).unwrap();
        db.set_due_time(velha, Some("10:00")).unwrap();
        let feita = db.add_task("feita", "", Some("2026-11-07")).unwrap();
        db.set_due_time(feita, Some("08:00")).unwrap();
        db.set_done(feita, true).unwrap();
        db.add_task("sem hora", "", Some("2026-11-07")).unwrap();
        let sem_data = db.add_task("sem data", "", None).unwrap();
        db.set_due_time(sem_data, Some("08:00")).unwrap();
        let inbox = db.add_task_from("agente", "", Some("2026-11-07"), "claude").unwrap();
        db.set_due_time(inbox, Some("08:00")).unwrap();
        assert!(db.due_reminders(at("2026-11-07 12:00")).unwrap().is_empty());
    }

    #[test]
    fn mudar_a_data_rearma_o_lembrete() {
        let db = Db::open_in_memory().unwrap();
        let id = db.add_task("x", "", Some("2026-11-07")).unwrap();
        db.set_due_time(id, Some("08:00")).unwrap();
        db.mark_reminded(id).unwrap();
        // mesma data: continua lembrado
        db.update_task(id, "x2", "", Some("2026-11-07")).unwrap();
        assert!(db.due_reminders(at("2026-11-07 09:00")).unwrap().is_empty());
        // data nova: rearma
        db.update_task(id, "x2", "", Some("2026-11-08")).unwrap();
        assert_eq!(db.due_reminders(at("2026-11-08 09:00")).unwrap().len(), 1);
    }
}
