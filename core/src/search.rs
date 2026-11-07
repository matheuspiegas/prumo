//! Busca de tarefas por título e notas (sem diferenciar maiúsculas nem acentos).

use super::{row_to_task, Db, Task, TASK_COLS};
use rusqlite::Result;

/// Minúsculas e sem acentos comuns do português/latim.
pub fn normalize(s: &str) -> String {
    s.chars()
        .flat_map(|c| c.to_lowercase())
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            c => c,
        })
        .collect()
}

impl Db {
    fn has_column(&self, name: &str) -> Result<bool> {
        let mut st = self.conn.prepare("PRAGMA table_info(tasks)")?;
        let names = st.query_map([], |r| r.get::<_, String>(1))?;
        for n in names {
            if n? == name {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Busca tarefas vivas (ativas, fora da lixeira e sem subtarefas) cujo
    /// título ou notas contenham todos os termos da consulta.
    pub fn search(&self, query: &str) -> Result<Vec<Task>> {
        let terms: Vec<String> = normalize(query).split_whitespace().map(String::from).collect();
        if terms.is_empty() {
            return Ok(vec![]);
        }
        let mut live = String::from("status = 'active'");
        if self.has_column("deleted_at")? {
            live.push_str(" AND deleted_at IS NULL");
        }
        if self.has_column("parent_id")? {
            live.push_str(" AND parent_id IS NULL");
        }
        let mut st = self.conn.prepare(&format!(
            "SELECT {TASK_COLS} FROM tasks WHERE {live} ORDER BY done, due_date IS NULL, due_date, position, id"
        ))?;
        let all = st.query_map([], row_to_task)?.collect::<Result<Vec<_>>>()?;
        Ok(all
            .into_iter()
            .filter(|t| {
                let hay = normalize(&format!("{}\n{}", t.title, t.notes));
                terms.iter().all(|w| hay.contains(w))
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn busca_sem_acento_e_em_notas() {
        let db = Db::open_in_memory().unwrap();
        db.add_task("Reunião de planejamento", "", None).unwrap();
        db.add_task("Comprar pão", "na PADARIA da esquina", None).unwrap();
        db.add_task("Outra coisa", "", None).unwrap();
        assert_eq!(db.search("reuniao").unwrap().len(), 1);
        assert_eq!(db.search("padaria esquina").unwrap().len(), 1);
        assert_eq!(db.search("PÃO").unwrap().len(), 1);
        assert!(db.search("   ").unwrap().is_empty());
        assert!(db.search("zzz").unwrap().is_empty());
    }

    #[test]
    fn busca_ignora_inbox_e_removidas() {
        let db = Db::open_in_memory().unwrap();
        let a = db.add_task("alvo um", "", None).unwrap();
        db.add_task_from("alvo dois", "", None, "claude").unwrap();
        assert_eq!(db.search("alvo").unwrap().len(), 1);
        db.delete_task(a).unwrap();
        assert!(db.search("alvo").unwrap().is_empty());
    }
}
