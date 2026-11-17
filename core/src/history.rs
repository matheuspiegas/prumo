//! Histórico de concluídas: quando cada tarefa foi concluída (`tasks.completed_at`, UTC do
//! SQLite) e consultas por período em datas LOCAIS, para agrupar por dia, semana ou mês.
use crate::{Db, LIVE, TASK_COLS, Task, row_to_task};
use rusqlite::{Result, params};

/// Tarefa concluída e o instante local da conclusão (`YYYY-MM-DD HH:MM`).
#[derive(Debug, Clone, PartialEq)]
pub struct CompletedTask {
    pub task: Task,
    pub completed_at: String,
}

/// Instante da conclusão: `completed_at`, ou `updated_at` para linhas gravadas por uma versão
/// antiga (sem a coluna preenchida).
const DONE_AT: &str = "COALESCE(completed_at, updated_at)";

impl Db {
    /// Concluídas (tarefas principais, fora da lixeira) entre `from` e `to` (datas locais
    /// `YYYY-MM-DD`, inclusivas; `None` = sem limite), da mais recente para a mais antiga.
    pub fn completed_between(&self, from: Option<&str>, to: Option<&str>) -> Result<Vec<CompletedTask>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {TASK_COLS}, strftime('%Y-%m-%d %H:%M', {DONE_AT}, 'localtime') FROM tasks
             WHERE status = 'active' AND done = 1 AND {LIVE}
               AND (?1 IS NULL OR date({DONE_AT}, 'localtime') >= ?1)
               AND (?2 IS NULL OR date({DONE_AT}, 'localtime') <= ?2)
             ORDER BY {DONE_AT} DESC, id DESC"
        ))?;
        st.query_map(params![from, to], |r| Ok(CompletedTask { task: row_to_task(r)?, completed_at: r.get(12)? }))?
            .collect()
    }

    /// Quantas concluídas entre `from` e `to` (mesmas regras de `completed_between`).
    pub fn count_completed_between(&self, from: Option<&str>, to: Option<&str>) -> Result<i64> {
        self.conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM tasks
                 WHERE status = 'active' AND done = 1 AND {LIVE}
                   AND (?1 IS NULL OR date({DONE_AT}, 'localtime') >= ?1)
                   AND (?2 IS NULL OR date({DONE_AT}, 'localtime') <= ?2)"
            ),
            params![from, to],
            |r| r.get(0),
        )
    }

    #[cfg(test)]
    fn set_completed_at(&self, id: i64, utc: &str) {
        self.conn.execute("UPDATE tasks SET completed_at = ?2 WHERE id = ?1", params![id, utc]).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use crate::Db;

    fn local_date(db: &Db, utc: &str) -> String {
        db.conn.query_row("SELECT date(?1, 'localtime')", [utc], |r| r.get(0)).unwrap()
    }

    #[test]
    fn set_done_grava_e_limpa_a_conclusao() {
        let db = Db::open_in_memory().unwrap();
        let a = db.add_task("A", "", None).unwrap();
        let at = |db: &Db| -> Option<String> {
            db.conn.query_row("SELECT completed_at FROM tasks WHERE id = ?1", [a], |r| r.get(0)).unwrap()
        };
        assert_eq!(at(&db), None);
        db.set_done(a, true).unwrap();
        let first = at(&db).expect("concluir grava completed_at");
        // Concluir de novo (ex.: duas janelas) não muda o instante; editar também não.
        db.set_completed_at(a, "2026-01-01 10:00:00");
        db.set_done(a, true).unwrap();
        db.update_task(a, "A editada", "", None).unwrap();
        assert_eq!(at(&db).as_deref(), Some("2026-01-01 10:00:00"));
        assert!(!first.is_empty());
        // Reabrir limpa.
        db.set_done(a, false).unwrap();
        assert_eq!(at(&db), None);
    }

    #[test]
    fn filtra_por_periodo_local_e_ordena_da_mais_recente() {
        let db = Db::open_in_memory().unwrap();
        let ids: Vec<i64> = ["Velha", "Meio", "Nova", "Pendente"].iter().map(|t| db.add_task(t, "", None).unwrap()).collect();
        for &id in &ids[..3] {
            db.set_done(id, true).unwrap();
        }
        // Meio-dia UTC cai no mesmo dia local em qualquer fuso entre -11 e +11.
        db.set_completed_at(ids[0], "2026-11-01 12:00:00");
        db.set_completed_at(ids[1], "2026-11-10 12:00:00");
        db.set_completed_at(ids[2], "2026-11-15 12:00:00");
        let d = |u: &str| local_date(&db, u);

        let todas = db.completed_between(None, None).unwrap();
        assert_eq!(todas.iter().map(|c| c.task.title.as_str()).collect::<Vec<_>>(), ["Nova", "Meio", "Velha"]);
        assert!(todas[0].completed_at.starts_with(&d("2026-11-15 12:00:00")));
        assert_eq!(todas[0].completed_at.len(), "YYYY-MM-DD HH:MM".len());

        let meio = db.completed_between(Some(&d("2026-11-05 12:00:00")), Some(&d("2026-11-10 12:00:00"))).unwrap();
        assert_eq!(meio.iter().map(|c| c.task.title.as_str()).collect::<Vec<_>>(), ["Meio"]);
        assert_eq!(db.count_completed_between(Some(&d("2026-11-10 12:00:00")), None).unwrap(), 2);
        assert_eq!(db.count_completed_between(None, Some(&d("2026-11-01 12:00:00"))).unwrap(), 1);
    }

    #[test]
    fn migracao_v3_para_v4_preenche_as_ja_concluidas() {
        let path = std::env::temp_dir().join(format!("prumo-v4-{}.db", std::process::id()));
        for ext in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ext}", path.display()));
        }
        {
            let db = Db::open(&path).unwrap();
            let feita = db.add_task("feita", "", None).unwrap();
            db.add_task("pendente", "", None).unwrap();
            // Volta ao estado v3: concluída sem a coluna completed_at.
            db.conn
                .execute_batch(&format!(
                    "DROP INDEX idx_tasks_completed; ALTER TABLE tasks DROP COLUMN completed_at;
                     UPDATE tasks SET done = 1, updated_at = '2026-10-20 12:00:00' WHERE id = {feita};
                     PRAGMA user_version = 3;"
                ))
                .unwrap();
        }
        let db = Db::open(&path).unwrap();
        let c = db.completed_between(None, None).unwrap();
        assert_eq!(c.len(), 1);
        assert!(c[0].completed_at.starts_with(&local_date(&db, "2026-10-20 12:00:00")));
        let raw: Option<String> = db.conn.query_row("SELECT completed_at FROM tasks WHERE title = 'pendente'", [], |r| r.get(0)).unwrap();
        assert_eq!(raw, None);
        drop(db);
        for ext in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ext}", path.display()));
        }
    }

    #[test]
    fn ignora_lixeira_subtarefas_e_caixa_de_entrada() {
        let db = Db::open_in_memory().unwrap();
        let a = db.add_task("Principal", "", None).unwrap();
        let s = db.add_subtask(a, "Sub").unwrap();
        let lixo = db.add_task("Lixo", "", None).unwrap();
        for id in [a, s, lixo] {
            db.set_done(id, true).unwrap();
        }
        db.trash_task(lixo).unwrap();
        let c = db.completed_between(None, None).unwrap();
        assert_eq!(c.iter().map(|c| c.task.title.as_str()).collect::<Vec<_>>(), ["Principal"]);
    }
}
