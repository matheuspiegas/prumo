//! Tags (várias por tarefa). Tabelas `tags` e `task_tags`.
use crate::Db;
use rusqlite::{params, params_from_iter, Result};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub struct TagCount {
    pub name: String,
    /// Tarefas vivas e pendentes com a tag.
    pub count: i64,
}

/// Normaliza um nome: trim, sem `#` inicial, sem espaços nas pontas.
pub fn normalize_tag(raw: &str) -> String {
    raw.trim().trim_start_matches('#').trim().to_string()
}

impl Db {
    /// Garante as tabelas (no-op quando a migração central já as criou).
    fn ensure_tags_schema(&self) -> Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS tags (
                id   INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE
            );
            CREATE TABLE IF NOT EXISTS task_tags (
                task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (task_id, tag_id)
            );",
        )
    }

    /// Condição SQL (sobre o alias `t`) para tarefas "vivas" (não excluídas).
    fn alive_cond(&self) -> Result<&'static str> {
        let has: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = 'deleted_at'",
            [],
            |r| r.get(0),
        )?;
        Ok(if has > 0 { "t.deleted_at IS NULL" } else { "1=1" })
    }

    /// Substitui as tags da tarefa. Remove tags órfãs ao final.
    pub fn set_task_tags(&self, task_id: i64, names: &[String]) -> Result<()> {
        self.ensure_tags_schema()?;
        let mut clean: Vec<String> = Vec::new();
        for n in names {
            let n = normalize_tag(n);
            if !n.is_empty() && !clean.iter().any(|c| c.to_lowercase() == n.to_lowercase()) {
                clean.push(n);
            }
        }
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM task_tags WHERE task_id = ?1", [task_id])?;
        for n in &clean {
            tx.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [n])?;
            tx.execute(
                "INSERT OR IGNORE INTO task_tags (task_id, tag_id)
                 SELECT ?1, id FROM tags WHERE name = ?2 COLLATE NOCASE",
                params![task_id, n],
            )?;
        }
        tx.execute(
            "DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM task_tags)",
            [],
        )?;
        tx.commit()
    }

    pub fn tags_of(&self, task_id: i64) -> Result<Vec<String>> {
        self.ensure_tags_schema()?;
        let mut st = self.conn.prepare(
            "SELECT g.name FROM task_tags tt JOIN tags g ON g.id = tt.tag_id
             WHERE tt.task_id = ?1 ORDER BY g.name COLLATE NOCASE",
        )?;
        st.query_map([task_id], |r| r.get(0))?.collect()
    }

    /// Tags de várias tarefas numa consulta só (sem N+1).
    pub fn tags_for(&self, ids: &[i64]) -> Result<HashMap<i64, Vec<String>>> {
        self.ensure_tags_schema()?;
        let mut map: HashMap<i64, Vec<String>> = HashMap::new();
        if ids.is_empty() {
            return Ok(map);
        }
        let marks = vec!["?"; ids.len()].join(",");
        let mut st = self.conn.prepare(&format!(
            "SELECT tt.task_id, g.name FROM task_tags tt JOIN tags g ON g.id = tt.tag_id
             WHERE tt.task_id IN ({marks}) ORDER BY g.name COLLATE NOCASE"
        ))?;
        let rows = st.query_map(params_from_iter(ids.iter()), |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (id, name) = row?;
            map.entry(id).or_default().push(name);
        }
        Ok(map)
    }

    /// Todas as tags com a contagem de tarefas vivas e pendentes.
    pub fn list_tags(&self) -> Result<Vec<TagCount>> {
        self.ensure_tags_schema()?;
        let alive = self.alive_cond()?;
        let mut st = self.conn.prepare(&format!(
            "SELECT g.name, COUNT(t.id) FROM tags g
             LEFT JOIN task_tags tt ON tt.tag_id = g.id
             LEFT JOIN tasks t ON t.id = tt.task_id AND t.done = 0 AND t.status = 'active' AND {alive}
             GROUP BY g.id ORDER BY g.name COLLATE NOCASE"
        ))?;
        st.query_map([], |r| Ok(TagCount { name: r.get(0)?, count: r.get(1)? }))?
            .collect()
    }

    /// Tarefas vivas com a tag (case-insensitive).
    pub fn tasks_with_tag(&self, name: &str, include_done: bool) -> Result<Vec<crate::Task>> {
        self.ensure_tags_schema()?;
        let alive = self.alive_cond()?;
        let done = if include_done { "" } else { "AND t.done = 0" };
        let cols = crate::TASK_COLS
            .split(", ")
            .map(|c| format!("t.{c}"))
            .collect::<Vec<_>>()
            .join(", ");
        let mut st = self.conn.prepare(&format!(
            "SELECT {cols} FROM tasks t
             JOIN task_tags tt ON tt.task_id = t.id
             JOIN tags g ON g.id = tt.tag_id
             WHERE g.name = ?1 COLLATE NOCASE AND t.status = 'active' AND {alive} {done}
             ORDER BY t.done, t.due_date IS NULL, t.due_date, t.position, t.id"
        ))?;
        st.query_map([normalize_tag(name)], crate::row_to_task)?.collect()
    }

    /// Renomeia uma tag; se o novo nome já existir, mescla as tarefas nele.
    pub fn rename_tag(&self, old: &str, new: &str) -> Result<()> {
        self.ensure_tags_schema()?;
        let new = normalize_tag(new);
        if new.is_empty() {
            return Ok(());
        }
        let tx = self.conn.unchecked_transaction()?;
        let old_id: Option<i64> = tx
            .query_row("SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE", [normalize_tag(old)], |r| r.get(0))
            .ok();
        let Some(old_id) = old_id else { return Ok(()) };
        let other: Option<i64> = tx
            .query_row(
                "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE AND id <> ?2",
                params![new, old_id],
                |r| r.get(0),
            )
            .ok();
        match other {
            Some(dest) => {
                tx.execute(
                    "INSERT OR IGNORE INTO task_tags (task_id, tag_id) SELECT task_id, ?2 FROM task_tags WHERE tag_id = ?1",
                    params![old_id, dest],
                )?;
                tx.execute("DELETE FROM tags WHERE id = ?1", [old_id])?;
            }
            None => {
                tx.execute("UPDATE tags SET name = ?2 WHERE id = ?1", params![old_id, new])?;
            }
        }
        tx.commit()
    }

    /// Remove a tag de todas as tarefas.
    pub fn delete_tag(&self, name: &str) -> Result<()> {
        self.ensure_tags_schema()?;
        self.conn.execute(
            "DELETE FROM tags WHERE name = ?1 COLLATE NOCASE",
            [normalize_tag(name)],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn normalizes_and_dedups() {
        let db = Db::open_in_memory().unwrap();
        let t = db.add_task("a", "", None).unwrap();
        db.set_task_tags(t, &v(&["  #Casa ", "casa", "", "#", "Trabalho"])).unwrap();
        assert_eq!(db.tags_of(t).unwrap(), ["Casa", "Trabalho"]);
        let u = db.add_task("b", "", None).unwrap();
        db.set_task_tags(u, &v(&["CASA"])).unwrap();
        assert_eq!(db.tags_of(u).unwrap(), ["Casa"]);
        assert_eq!(db.list_tags().unwrap().len(), 2);
    }

    #[test]
    fn orphans_removed_and_counts() {
        let db = Db::open_in_memory().unwrap();
        let a = db.add_task("a", "", None).unwrap();
        let b = db.add_task("b", "", None).unwrap();
        db.set_task_tags(a, &v(&["x", "y"])).unwrap();
        db.set_task_tags(b, &v(&["x"])).unwrap();
        db.set_task_tags(a, &v(&["x"])).unwrap(); // y vira órfã
        let l = db.list_tags().unwrap();
        assert_eq!(l, [TagCount { name: "x".into(), count: 2 }]);
        db.set_done(b, true).unwrap();
        assert_eq!(db.list_tags().unwrap()[0].count, 1);
        assert_eq!(db.tasks_with_tag("X", false).unwrap().len(), 1);
        assert_eq!(db.tasks_with_tag("x", true).unwrap().len(), 2);
    }

    #[test]
    fn grouped_lookup_rename_delete() {
        let db = Db::open_in_memory().unwrap();
        let a = db.add_task("a", "", None).unwrap();
        let b = db.add_task("b", "", None).unwrap();
        let c = db.add_task("c", "", None).unwrap();
        db.set_task_tags(a, &v(&["x", "y"])).unwrap();
        db.set_task_tags(b, &v(&["y"])).unwrap();
        let m = db.tags_for(&[a, b, c]).unwrap();
        assert_eq!(m[&a], ["x", "y"]);
        assert_eq!(m[&b], ["y"]);
        assert!(!m.contains_key(&c));
        assert!(db.tags_for(&[]).unwrap().is_empty());

        db.rename_tag("x", "y").unwrap(); // mescla
        assert_eq!(db.tags_of(a).unwrap(), ["y"]);
        db.rename_tag("y", "z").unwrap();
        assert_eq!(db.tags_of(b).unwrap(), ["z"]);
        db.delete_tag("Z").unwrap();
        assert!(db.tags_of(a).unwrap().is_empty());
        assert!(db.list_tags().unwrap().is_empty());
    }

    #[test]
    fn deleting_task_cascades() {
        let db = Db::open_in_memory().unwrap();
        let a = db.add_task("a", "", None).unwrap();
        db.set_task_tags(a, &v(&["x"])).unwrap();
        db.delete_task(a).unwrap();
        assert!(db.tags_of(a).unwrap().is_empty());
    }
}
