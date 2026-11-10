//! Quadros brancos (Excalidraw): registro no banco + arquivos em `data_dir()/boards/`.
//!
//! Por quadro: `{id}.excalidraw` (cena em JSON) e `{id}.png` (miniatura).
//! Global: `library.json` (biblioteca de formas importada, formato `.excalidrawlib`).
//! Os caminhos são montados só a partir do id numérico; nunca de texto vindo da interface.
use crate::{data_dir, Db};
use rusqlite::{params, Result};
use std::io;
use std::path::{Path, PathBuf};

/// Tamanho máximo do nome de um quadro, em caracteres.
pub const MAX_NAME_CHARS: usize = 120;
/// Nome usado quando o usuário não informa um.
pub const DEFAULT_NAME: &str = "Quadro sem título";

#[derive(Debug, Clone, PartialEq)]
pub struct Board {
    pub id: i64,
    pub name: String,
    /// Timestamp UTC do SQLite (`YYYY-MM-DD HH:MM:SS`).
    pub created_at: String,
    pub updated_at: String,
}

fn invalid(msg: impl ToString) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(msg.to_string().into())
}

/// Aparado, não vazio e com até 120 caracteres.
fn clean_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(invalid("o nome do quadro não pode ser vazio"));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(invalid(format!("o nome do quadro pode ter no máximo {MAX_NAME_CHARS} caracteres")));
    }
    Ok(name.to_string())
}

const COLS: &str = "id, name, created_at, updated_at";

fn row_to_board(r: &rusqlite::Row) -> Result<Board> {
    Ok(Board { id: r.get(0)?, name: r.get(1)?, created_at: r.get(2)?, updated_at: r.get(3)? })
}

impl Db {
    /// Mais recentemente alterados primeiro.
    pub fn list_boards(&self) -> Result<Vec<Board>> {
        let mut st = self
            .conn
            .prepare(&format!("SELECT {COLS} FROM boards ORDER BY updated_at DESC, id DESC"))?;
        st.query_map([], row_to_board)?.collect()
    }

    pub fn get_board(&self, id: i64) -> Result<Board> {
        self.conn
            .query_row(&format!("SELECT {COLS} FROM boards WHERE id = ?1"), [id], row_to_board)
    }

    /// Sem nome (ou só espaços), usa "Quadro sem título", "Quadro sem título 2", ...
    pub fn create_board(&self, name: Option<&str>) -> Result<i64> {
        let name = match name.map(str::trim).filter(|n| !n.is_empty()) {
            Some(n) => clean_name(n)?,
            None => self.next_default_name()?,
        };
        self.conn.execute(
            "INSERT INTO boards (name, position) VALUES (?1, (SELECT COALESCE(MAX(position), 0) + 1 FROM boards))",
            [&name],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    fn next_default_name(&self) -> Result<String> {
        let exists = |n: &str| -> Result<bool> {
            self.conn
                .query_row("SELECT COUNT(*) FROM boards WHERE name = ?1", [n], |r| r.get::<_, i64>(0))
                .map(|c| c > 0)
        };
        if !exists(DEFAULT_NAME)? {
            return Ok(DEFAULT_NAME.to_string());
        }
        let mut n = 2;
        loop {
            let candidate = format!("{DEFAULT_NAME} {n}");
            if !exists(&candidate)? {
                return Ok(candidate);
            }
            n += 1;
        }
    }

    pub fn rename_board(&self, id: i64, name: &str) -> Result<()> {
        let name = clean_name(name)?;
        let n = self.conn.execute(
            "UPDATE boards SET name = ?2, updated_at = datetime('now') WHERE id = ?1",
            params![id, name],
        )?;
        if n == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(())
    }

    /// Marca o quadro como alterado agora (use ao gravar a cena).
    pub fn touch_board(&self, id: i64) -> Result<()> {
        self.conn
            .execute("UPDATE boards SET updated_at = datetime('now') WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Remove só o registro; os arquivos saem com `delete_board_files`.
    pub fn delete_board(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM boards WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Cria "Cópia de <nome>" e copia a cena e a miniatura (as que existirem) de `dir`.
    /// Se a cópia dos arquivos falhar, o registro novo é desfeito.
    pub fn duplicate_board(&self, id: i64, dir: &Path) -> io::Result<i64> {
        let orig = self.get_board(id).map_err(io::Error::other)?;
        let mut name = format!("Cópia de {}", orig.name);
        if name.chars().count() > MAX_NAME_CHARS {
            name = name.chars().take(MAX_NAME_CHARS).collect::<String>().trim_end().to_string();
        }
        let new_id = self.create_board(Some(&name)).map_err(io::Error::other)?;
        if let Err(e) = copy_board_files(dir, id, new_id) {
            self.delete_board(new_id).ok();
            delete_board_files(dir, new_id).ok();
            return Err(e);
        }
        Ok(new_id)
    }
}

// ---------------------------------------------------------------------------
// Arquivos
// ---------------------------------------------------------------------------

/// Pasta dos quadros: `data_dir()/boards`.
pub fn boards_dir() -> PathBuf {
    data_dir().join("boards")
}

fn check_id(id: i64) -> io::Result<()> {
    if id <= 0 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "id de quadro inválido"));
    }
    Ok(())
}

fn scene_path(dir: &Path, id: i64) -> io::Result<PathBuf> {
    check_id(id)?;
    Ok(dir.join(format!("{id}.excalidraw")))
}

fn thumbnail_path(dir: &Path, id: i64) -> io::Result<PathBuf> {
    check_id(id)?;
    Ok(dir.join(format!("{id}.png")))
}

fn library_path(dir: &Path) -> PathBuf {
    dir.join("library.json")
}

/// Grava de forma atômica: escreve num arquivo temporário ao lado e renomeia por cima.
/// Uma falha no meio nunca deixa o arquivo final pela metade.
fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut tmp_name = path.file_name().unwrap_or_default().to_os_string();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    let result = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        std::fs::remove_file(&tmp).ok();
    }
    result
}

fn read_optional(path: &Path) -> io::Result<Option<Vec<u8>>> {
    match std::fs::read(path) {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

fn utf8(bytes: Vec<u8>) -> io::Result<String> {
    String::from_utf8(bytes).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

/// Cena do quadro (JSON); `None` se ainda não foi gravada.
pub fn read_scene(dir: &Path, id: i64) -> io::Result<Option<String>> {
    read_optional(&scene_path(dir, id)?)?.map(utf8).transpose()
}

pub fn write_scene(dir: &Path, id: i64, scene: &str) -> io::Result<()> {
    write_atomic(&scene_path(dir, id)?, scene.as_bytes())
}

/// Miniatura PNG; `None` se não existir.
pub fn read_thumbnail(dir: &Path, id: i64) -> io::Result<Option<Vec<u8>>> {
    read_optional(&thumbnail_path(dir, id)?)
}

pub fn write_thumbnail(dir: &Path, id: i64, png: &[u8]) -> io::Result<()> {
    write_atomic(&thumbnail_path(dir, id)?, png)
}

pub fn has_thumbnail(dir: &Path, id: i64) -> bool {
    thumbnail_path(dir, id).map(|p| p.is_file()).unwrap_or(false)
}

/// Biblioteca global de formas (JSON); `None` se nunca foi gravada.
pub fn read_library(dir: &Path) -> io::Result<Option<String>> {
    read_optional(&library_path(dir))?.map(utf8).transpose()
}

pub fn write_library(dir: &Path, library: &str) -> io::Result<()> {
    write_atomic(&library_path(dir), library.as_bytes())
}

/// Apaga a cena e a miniatura do quadro; o que não existe é ignorado.
pub fn delete_board_files(dir: &Path, id: i64) -> io::Result<()> {
    for p in [scene_path(dir, id)?, thumbnail_path(dir, id)?] {
        match std::fs::remove_file(&p) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

/// Copia a cena e a miniatura (as que existirem) de `de` para `para`.
pub fn copy_board_files(dir: &Path, de: i64, para: i64) -> io::Result<()> {
    if let Some(b) = read_optional(&scene_path(dir, de)?)? {
        write_atomic(&scene_path(dir, para)?, &b)?;
    }
    if let Some(b) = read_optional(&thumbnail_path(dir, de)?)? {
        write_atomic(&thumbnail_path(dir, para)?, &b)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("prumo-boards-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn names(db: &Db) -> Vec<String> {
        db.list_boards().unwrap().into_iter().map(|b| b.name).collect()
    }

    #[test]
    fn crud() {
        let db = Db::open_in_memory().unwrap();
        let a = db.create_board(Some("  Ideias  ")).unwrap();
        let b = db.create_board(Some("Fluxo")).unwrap();
        assert_eq!(db.get_board(a).unwrap().name, "Ideias");
        assert_eq!(db.list_boards().unwrap().len(), 2);

        db.rename_board(a, " Novo nome ").unwrap();
        assert_eq!(db.get_board(a).unwrap().name, "Novo nome");
        assert!(db.rename_board(9999, "x").is_err());

        db.touch_board(b).unwrap();
        db.delete_board(a).unwrap();
        assert!(db.get_board(a).is_err());
        assert_eq!(names(&db), ["Fluxo"]);
    }

    #[test]
    fn list_orders_by_updated_at_desc() {
        let db = Db::open_in_memory().unwrap();
        let a = db.create_board(Some("a")).unwrap();
        let b = db.create_board(Some("b")).unwrap();
        let c = db.create_board(Some("c")).unwrap();
        db.conn.execute("UPDATE boards SET updated_at = '2026-01-01 10:00:00' WHERE id = ?1", [a]).unwrap();
        db.conn.execute("UPDATE boards SET updated_at = '2026-03-01 10:00:00' WHERE id = ?1", [b]).unwrap();
        db.conn.execute("UPDATE boards SET updated_at = '2026-02-01 10:00:00' WHERE id = ?1", [c]).unwrap();
        assert_eq!(names(&db), ["b", "c", "a"]);
        db.conn.execute("UPDATE boards SET updated_at = '2026-01-01 10:00:00' WHERE id = ?1", [b]).unwrap();
        db.conn.execute("UPDATE boards SET updated_at = '2026-04-01 10:00:00' WHERE id = ?1", [a]).unwrap();
        assert_eq!(names(&db), ["a", "c", "b"]);
    }

    #[test]
    fn default_name_is_incremental() {
        let db = Db::open_in_memory().unwrap();
        db.create_board(None).unwrap();
        db.create_board(Some("   ")).unwrap();
        let c = db.create_board(None).unwrap();
        let mut n = names(&db);
        n.sort();
        assert_eq!(n, ["Quadro sem título", "Quadro sem título 2", "Quadro sem título 3"]);
        // Liberar um nome o torna disponível de novo.
        db.delete_board(c).unwrap();
        let d = db.create_board(None).unwrap();
        assert_eq!(db.get_board(d).unwrap().name, "Quadro sem título 3");
    }

    #[test]
    fn name_validation() {
        let db = Db::open_in_memory().unwrap();
        let id = db.create_board(Some("ok")).unwrap();
        assert!(db.rename_board(id, "   ").is_err());
        assert!(db.rename_board(id, "").is_err());
        let longo = "a".repeat(121);
        assert!(db.rename_board(id, &longo).is_err());
        assert!(db.create_board(Some(&longo)).is_err());
        let limite = "é".repeat(120);
        db.rename_board(id, &limite).unwrap();
        assert_eq!(db.get_board(id).unwrap().name.chars().count(), 120);
        let msg = db.rename_board(id, " ").unwrap_err().to_string();
        assert!(msg.contains("vazio"), "{msg}");
    }

    #[test]
    fn migration_v2_to_v3_preserves_data_and_is_idempotent() {
        let path = std::env::temp_dir().join(format!("prumo-v3-{}.db", std::process::id()));
        for ext in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ext}", path.display()));
        }
        {
            let db = Db::open(&path).unwrap();
            db.add_task("minha tarefa", "nota", Some("2026-11-06")).unwrap();
            // Volta ao estado v2: sem a tabela de quadros.
            db.conn.execute_batch("DROP TABLE boards; PRAGMA user_version = 2;").unwrap();
        }
        let db = Db::open(&path).unwrap();
        let v: i64 = db.conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(v, 3);
        let t = db.pending().unwrap();
        assert_eq!((t.len(), t[0].title.as_str()), (1, "minha tarefa"));
        assert!(db.list_boards().unwrap().is_empty());
        let id = db.create_board(Some("q")).unwrap();
        drop(db);

        // Idempotente: reabrir mantém tudo.
        let db = Db::open(&path).unwrap();
        assert_eq!(db.get_board(id).unwrap().name, "q");
        assert_eq!(db.pending().unwrap().len(), 1);
        drop(db);
        for ext in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{ext}", path.display()));
        }
    }

    #[test]
    fn atomic_write_leaves_no_tmp() {
        let dir = tmp_dir("atomic");
        assert_eq!(read_scene(&dir, 1).unwrap(), None);
        write_scene(&dir, 1, r#"{"a":1}"#).unwrap();
        write_scene(&dir, 1, r#"{"a":2}"#).unwrap();
        assert_eq!(read_scene(&dir, 1).unwrap().as_deref(), Some(r#"{"a":2}"#));
        write_thumbnail(&dir, 1, &[1, 2, 3]).unwrap();
        write_library(&dir, "{}").unwrap();
        assert_eq!(read_thumbnail(&dir, 1).unwrap(), Some(vec![1, 2, 3]));
        assert_eq!(read_library(&dir).unwrap().as_deref(), Some("{}"));
        assert!(has_thumbnail(&dir, 1) && !has_thumbnail(&dir, 2));
        let tmp: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(tmp.is_empty(), "{tmp:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn invalid_ids_never_build_paths() {
        let dir = tmp_dir("ids");
        for id in [0, -1, i64::MIN] {
            assert!(read_scene(&dir, id).is_err());
            assert!(write_scene(&dir, id, "{}").is_err());
            assert!(write_thumbnail(&dir, id, &[1]).is_err());
            assert!(delete_board_files(&dir, id).is_err());
            assert!(copy_board_files(&dir, id, 1).is_err());
            assert!(!has_thumbnail(&dir, id));
        }
        assert!(!dir.exists());
        // O caminho montado fica sempre dentro da pasta.
        let p = scene_path(&dir, 42).unwrap();
        assert_eq!(p.parent().unwrap(), dir.as_path());
        assert_eq!(p.file_name().unwrap(), "42.excalidraw");
    }

    #[test]
    fn copy_and_delete_files() {
        let dir = tmp_dir("copy");
        write_scene(&dir, 1, "{\"x\":1}").unwrap();
        // Só a cena existe: copia sem erro e sem inventar miniatura.
        copy_board_files(&dir, 1, 2).unwrap();
        assert_eq!(read_scene(&dir, 2).unwrap().as_deref(), Some("{\"x\":1}"));
        assert_eq!(read_thumbnail(&dir, 2).unwrap(), None);
        write_thumbnail(&dir, 1, &[9, 9]).unwrap();
        copy_board_files(&dir, 1, 3).unwrap();
        assert_eq!(read_thumbnail(&dir, 3).unwrap(), Some(vec![9, 9]));
        // Origem sem arquivos: nada a copiar.
        copy_board_files(&dir, 77, 4).unwrap();
        assert_eq!(read_scene(&dir, 4).unwrap(), None);

        delete_board_files(&dir, 1).unwrap();
        assert_eq!(read_scene(&dir, 1).unwrap(), None);
        assert!(!has_thumbnail(&dir, 1));
        delete_board_files(&dir, 1).unwrap(); // já removidos: ok
        assert!(read_scene(&dir, 2).unwrap().is_some()); // os outros ficam
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn duplicate_creates_copy_with_files() {
        let dir = tmp_dir("dup");
        let db = Db::open_in_memory().unwrap();
        let a = db.create_board(Some("Projeto")).unwrap();
        write_scene(&dir, a, "{\"k\":true}").unwrap();
        write_thumbnail(&dir, a, &[5]).unwrap();

        let b = db.duplicate_board(a, &dir).unwrap();
        assert_ne!(a, b);
        assert_eq!(db.get_board(b).unwrap().name, "Cópia de Projeto");
        assert_eq!(read_scene(&dir, b).unwrap().as_deref(), Some("{\"k\":true}"));
        assert_eq!(read_thumbnail(&dir, b).unwrap(), Some(vec![5]));

        // Quadro sem arquivos também duplica.
        let c = db.create_board(Some("Vazio")).unwrap();
        let d = db.duplicate_board(c, &dir).unwrap();
        assert_eq!(read_scene(&dir, d).unwrap(), None);

        // Nome longo é cortado no limite.
        let l = db.create_board(Some(&"x".repeat(120))).unwrap();
        let l2 = db.duplicate_board(l, &dir).unwrap();
        assert_eq!(db.get_board(l2).unwrap().name.chars().count(), 120);

        assert!(db.duplicate_board(9999, &dir).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }
}
