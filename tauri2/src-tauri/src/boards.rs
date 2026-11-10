//! Comandos Tauri dos quadros brancos (Excalidraw).
//!
//! O id do quadro vem da interface, mas só vira caminho dentro de `boards/` depois de o quadro
//! existir no banco e através das funções do `core`, que montam o nome a partir do número.
use crate::{err, lock, AppDb};
use serde::Serialize;
use std::path::Path;
use tarefas_core::boards as files;
use tarefas_core::{Board, Db};
use tauri::{AppHandle, Emitter, State};

/// Tamanho máximo da cena de um quadro (texto JSON).
const MAX_SCENE_BYTES: usize = 100 * 1024 * 1024;
/// Tamanho máximo da miniatura (PNG).
const MAX_THUMBNAIL_BYTES: usize = 10 * 1024 * 1024;
/// Tamanho máximo da biblioteca de formas.
const MAX_LIBRARY_BYTES: usize = 50 * 1024 * 1024;
/// Tamanho máximo de um arquivo aberto por `read_text_file`.
const MAX_TEXT_FILE_BYTES: u64 = 20 * 1024 * 1024;
/// Extensões aceitas por `read_text_file` (sem o ponto, em minúsculas).
const TEXT_EXTENSIONS: [&str; 3] = ["excalidrawlib", "excalidraw", "json"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardDto {
    id: i64,
    name: String,
    created_at: String,
    updated_at: String,
    has_thumbnail: bool,
}

fn dto(b: Board, dir: &Path) -> BoardDto {
    BoardDto {
        has_thumbnail: files::has_thumbnail(dir, b.id),
        id: b.id,
        name: b.name,
        created_at: b.created_at,
        updated_at: b.updated_at,
    }
}

fn changed(app: &AppHandle) {
    let _ = app.emit("boards-changed", ());
}

/// Garante que o quadro existe antes de tocar em arquivos (evita arquivos órfãos).
fn ensure_exists(db: &Db, id: i64) -> Result<(), String> {
    db.get_board(id).map(|_| ()).map_err(|_| format!("o quadro {id} não existe"))
}

/// O texto precisa ser JSON válido e caber no limite.
fn validate_json(text: &str, max: usize, what: &str) -> Result<(), String> {
    if text.len() > max {
        return Err(format!("{what} grande demais (máximo {} MB)", max / 1024 / 1024));
    }
    serde_json::from_str::<serde::de::IgnoredAny>(text).map_err(|e| format!("{what} não é um JSON válido: {e}"))?;
    Ok(())
}

/// Extensão permitida para `read_text_file` (sem diferenciar maiúsculas).
fn text_extension_ok(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| TEXT_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn check_text_size(len: u64) -> Result<(), String> {
    if len > MAX_TEXT_FILE_BYTES {
        return Err(format!("arquivo grande demais (máximo {} MB)", MAX_TEXT_FILE_BYTES / 1024 / 1024));
    }
    Ok(())
}

#[tauri::command]
pub fn list_boards(db: State<AppDb>) -> Result<Vec<BoardDto>, String> {
    let list = lock(&db)?.list_boards().map_err(err)?;
    let dir = files::boards_dir();
    Ok(list.into_iter().map(|b| dto(b, &dir)).collect())
}

#[tauri::command]
pub fn create_board(app: AppHandle, db: State<AppDb>, name: Option<String>) -> Result<BoardDto, String> {
    let board = {
        let db = lock(&db)?;
        let id = db.create_board(name.as_deref()).map_err(err)?;
        db.get_board(id).map_err(err)?
    };
    changed(&app);
    Ok(dto(board, &files::boards_dir()))
}

#[tauri::command]
pub fn rename_board(app: AppHandle, db: State<AppDb>, id: i64, name: String) -> Result<(), String> {
    lock(&db)?.rename_board(id, &name).map_err(err)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
pub fn duplicate_board(app: AppHandle, db: State<AppDb>, id: i64) -> Result<BoardDto, String> {
    let dir = files::boards_dir();
    let board = {
        let db = lock(&db)?;
        let new_id = db.duplicate_board(id, &dir).map_err(err)?;
        db.get_board(new_id).map_err(err)?
    };
    changed(&app);
    Ok(dto(board, &dir))
}

#[tauri::command]
pub fn delete_board(app: AppHandle, db: State<AppDb>, id: i64) -> Result<(), String> {
    lock(&db)?.delete_board(id).map_err(err)?;
    // O registro já saiu; se um arquivo não puder ser apagado, sobra lixo inofensivo na pasta.
    let _ = files::delete_board_files(&files::boards_dir(), id);
    changed(&app);
    Ok(())
}

/// Cena do quadro (JSON) ou `None` se ainda não foi salva.
#[tauri::command]
pub fn read_board(db: State<AppDb>, id: i64) -> Result<Option<String>, String> {
    { let g = lock(&db)?; ensure_exists(&g, id)?; }
    files::read_scene(&files::boards_dir(), id).map_err(err)
}

/// Grava a cena (atômico) e marca o quadro como alterado. Não emite `boards-changed`.
#[tauri::command]
pub fn write_board(db: State<AppDb>, id: i64, scene: String) -> Result<(), String> {
    validate_json(&scene, MAX_SCENE_BYTES, "a cena")?;
    { let g = lock(&db)?; ensure_exists(&g, id)?; }
    files::write_scene(&files::boards_dir(), id, &scene).map_err(err)?;
    lock(&db)?.touch_board(id).map_err(err)
}

/// Recebe o PNG cru (corpo binário da chamada); o id do quadro vai no cabeçalho `x-board-id`.
#[tauri::command]
pub fn write_board_thumbnail(db: State<AppDb>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("corpo da chamada inválido".into());
    };
    if bytes.is_empty() || bytes.len() > MAX_THUMBNAIL_BYTES {
        return Err(format!("a miniatura precisa ter entre 1 byte e {} MB", MAX_THUMBNAIL_BYTES / 1024 / 1024));
    }
    let id: i64 = request
        .headers()
        .get("x-board-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or("x-board-id ausente")?;
    { let g = lock(&db)?; ensure_exists(&g, id)?; }
    files::write_thumbnail(&files::boards_dir(), id, bytes).map_err(err)
}

/// Bytes do PNG da miniatura.
#[tauri::command]
pub fn read_board_thumbnail(db: State<AppDb>, id: i64) -> Result<tauri::ipc::Response, String> {
    { let g = lock(&db)?; ensure_exists(&g, id)?; }
    let bytes = files::read_thumbnail(&files::boards_dir(), id)
        .map_err(err)?
        .ok_or("o quadro não tem miniatura")?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Biblioteca de formas importada; `"[]"` (JSON válido e vazio) se nunca houve importação.
#[tauri::command]
pub fn read_board_library() -> Result<String, String> {
    Ok(files::read_library(&files::boards_dir()).map_err(err)?.unwrap_or_else(|| "[]".to_string()))
}

#[tauri::command]
pub fn write_board_library(library: String) -> Result<(), String> {
    validate_json(&library, MAX_LIBRARY_BYTES, "a biblioteca")?;
    files::write_library(&files::boards_dir(), &library).map_err(err)
}

/// Lê um arquivo de texto escolhido pelo usuário (importar biblioteca ou cena). Só aceita
/// `.excalidrawlib`, `.excalidraw` e `.json`, até 20 MB.
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    if !text_extension_ok(path) {
        return Err("tipo de arquivo não suportado (use .excalidrawlib, .excalidraw ou .json)".into());
    }
    let meta = std::fs::metadata(path).map_err(err)?;
    if !meta.is_file() {
        return Err("o caminho não é um arquivo".into());
    }
    check_text_size(meta.len())?;
    let bytes = std::fs::read(path).map_err(err)?;
    check_text_size(bytes.len() as u64)?; // o arquivo pode ter crescido desde a consulta
    String::from_utf8(bytes).map_err(|_| "o arquivo não é um texto UTF-8 válido".to_string())
}

/// Tamanho máximo de um arquivo solto no quadro (imagem ou biblioteca).
const MAX_DROPPED_FILE_BYTES: u64 = 25 * 1024 * 1024;
/// Extensões aceitas em `read_dropped_file` (sem o ponto, em minúsculas): imagens que o Excalidraw
/// insere e bibliotecas `.excalidrawlib`.
const DROPPED_EXTENSIONS: [&str; 8] = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "excalidrawlib"];

fn dropped_extension_ok(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| DROPPED_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Lê os bytes de um arquivo solto no quadro. O Tauri intercepta o arrastar de arquivos da janela e só
/// entrega o caminho, então a interface pede os bytes por aqui e os insere por código.
fn read_dropped_bytes(path: &Path) -> Result<Vec<u8>, String> {
    if !dropped_extension_ok(path) {
        return Err("tipo de arquivo não suportado (imagens png, jpg, gif, webp, svg, bmp ou .excalidrawlib)".into());
    }
    let meta = std::fs::metadata(path).map_err(err)?;
    if !meta.is_file() {
        return Err("o caminho não é um arquivo".into());
    }
    let too_big = || format!("arquivo grande demais (máximo {} MB)", MAX_DROPPED_FILE_BYTES / 1024 / 1024);
    if meta.len() > MAX_DROPPED_FILE_BYTES {
        return Err(too_big());
    }
    let bytes = std::fs::read(path).map_err(err)?;
    if bytes.len() as u64 > MAX_DROPPED_FILE_BYTES {
        return Err(too_big()); // o arquivo pode ter crescido desde a consulta
    }
    Ok(bytes)
}

/// Bytes de uma imagem ou biblioteca arrastada para o quadro (bytes crus, sem base64).
#[tauri::command]
pub fn read_dropped_file(path: String) -> Result<tauri::ipc::Response, String> {
    read_dropped_bytes(Path::new(&path)).map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dropped_files_accept_only_images_and_libraries() {
        for ok in ["a.png", "b.JPG", "c.jpeg", "d.Gif", "e.webp", "f.svg", "g.bmp", "h.excalidrawlib", "C:\\x\\y.PNG"] {
            assert!(dropped_extension_ok(Path::new(ok)), "{ok}");
        }
        for bad in ["a.exe", "a.txt", "a.json", "a.excalidraw", "a", "a.png.exe", ".png", "a.pngx", "a.png "] {
            assert!(!dropped_extension_ok(Path::new(bad)), "{bad}");
        }
    }

    #[test]
    fn read_dropped_bytes_rules() {
        let dir = std::env::temp_dir().join(format!("prumo-drop-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let png = dir.join("foto.PNG");
        std::fs::write(&png, [0x89, b'P', b'N', b'G', 0, 1, 2]).unwrap();
        assert_eq!(read_dropped_bytes(&png).unwrap(), vec![0x89, b'P', b'N', b'G', 0, 1, 2]);

        let txt = dir.join("nota.txt");
        std::fs::write(&txt, "x").unwrap();
        assert!(read_dropped_bytes(&txt).unwrap_err().contains("não suportado"));

        // Pasta com nome de extensão aceita não é arquivo.
        let folder = dir.join("pasta.png");
        std::fs::create_dir_all(&folder).unwrap();
        assert!(read_dropped_bytes(&folder).unwrap_err().contains("não é um arquivo"));

        assert!(read_dropped_bytes(&dir.join("nao-existe.png")).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn extensions_are_whitelisted() {
        for ok in ["a.excalidrawlib", "b.EXCALIDRAW", "c.Json", "C:\\x\\y.json", "/tmp/z.excalidraw"] {
            assert!(text_extension_ok(Path::new(ok)), "{ok}");
        }
        for bad in ["a.txt", "a.exe", "a", "a.json.exe", ".json", "a.png", "a.jsonx", "a.json "] {
            assert!(!text_extension_ok(Path::new(bad)), "{bad}");
        }
    }

    #[test]
    fn size_limit() {
        assert!(check_text_size(0).is_ok());
        assert!(check_text_size(MAX_TEXT_FILE_BYTES).is_ok());
        assert!(check_text_size(MAX_TEXT_FILE_BYTES + 1).is_err());
    }

    #[test]
    fn json_validation_and_limit() {
        assert!(validate_json(r#"{"elements":[]}"#, 1024, "a cena").is_ok());
        assert!(validate_json("não é json", 1024, "a cena").unwrap_err().contains("JSON"));
        assert!(validate_json("", 1024, "a cena").is_err());
        assert!(validate_json(r#"{"a":1}"#, 3, "a cena").unwrap_err().contains("grande demais"));
    }

    #[test]
    fn read_text_file_rules() {
        let dir = std::env::temp_dir().join(format!("prumo-rtf-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("lib.excalidrawlib");
        std::fs::write(&ok, "{\"a\":1}").unwrap();
        assert_eq!(read_text_file(ok.to_string_lossy().into_owned()).unwrap(), "{\"a\":1}");

        let bad_ext = dir.join("nota.txt");
        std::fs::write(&bad_ext, "x").unwrap();
        assert!(read_text_file(bad_ext.to_string_lossy().into_owned()).unwrap_err().contains("não suportado"));

        // Pasta com nome de extensão aceita não é arquivo.
        let folder = dir.join("pasta.json");
        std::fs::create_dir_all(&folder).unwrap();
        assert!(read_text_file(folder.to_string_lossy().into_owned()).is_err());

        assert!(read_text_file(dir.join("nao-existe.json").to_string_lossy().into_owned()).is_err());

        let binary = dir.join("bin.json");
        std::fs::write(&binary, [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_text_file(binary.to_string_lossy().into_owned()).unwrap_err().contains("UTF-8"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ensure_exists_rejects_unknown_ids() {
        let db = Db::open_in_memory().unwrap();
        let id = db.create_board(None).unwrap();
        assert!(ensure_exists(&db, id).is_ok());
        assert!(ensure_exists(&db, id + 1).is_err());
        assert!(ensure_exists(&db, -1).is_err());
    }
}
