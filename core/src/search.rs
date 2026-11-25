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

/// O termo é o identificador da tarefa? Aceita `42` ou `#42` (o número inteiro, não um trecho).
fn is_id_term(term: &str, id: i64) -> bool {
    term.strip_prefix('#').unwrap_or(term).parse::<i64>() == Ok(id)
}

impl Db {
    /// Busca tarefas vivas (ativas, fora da lixeira e sem subtarefas) cujo
    /// título ou notas contenham todos os termos da consulta, ou cujo id seja um dos termos
    /// (`#42` ou `42`).
    pub fn search(&self, query: &str) -> Result<Vec<Task>> {
        let terms: Vec<String> = normalize(query).split_whitespace().map(String::from).collect();
        if terms.is_empty() {
            return Ok(vec![]);
        }
        // Só tarefas ativas e vivas (fora da lixeira, sem subtarefas): ver a constante LIVE.
        let live = format!("status = 'active' AND {}", crate::LIVE);
        let mut st = self.conn.prepare(&format!(
            "SELECT {TASK_COLS} FROM tasks WHERE {live} ORDER BY done, due_date IS NULL, due_date, position, id"
        ))?;
        let all = st.query_map([], row_to_task)?.collect::<Result<Vec<_>>>()?;
        Ok(all
            .into_iter()
            .filter(|t| {
                let hay = normalize(&format!("{}\n{}", t.title, t.notes));
                terms.iter().all(|w| hay.contains(w) || is_id_term(w, t.id))
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
    fn busca_por_id_com_ou_sem_cerquilha() {
        let db = Db::open_in_memory().unwrap();
        let a = db.add_task("primeira", "", None).unwrap();
        let b = db.add_task("segunda", "", None).unwrap();
        for q in [format!("#{b}"), b.to_string()] {
            let r = db.search(&q).unwrap();
            assert_eq!(r.iter().map(|t| t.id).collect::<Vec<_>>(), vec![b], "consulta {q}");
        }
        // O id é o número inteiro: "#1" não casa com a tarefa 11, e combina com texto (todos os termos).
        assert_eq!(db.search(&format!("#{a} primeira")).unwrap().len(), 1);
        assert!(db.search(&format!("#{a} segunda")).unwrap().is_empty());
        assert!(db.search("#999").unwrap().is_empty());
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
