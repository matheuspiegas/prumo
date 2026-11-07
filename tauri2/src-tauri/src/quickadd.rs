//! Quick-add: janelinha flutuante (`quickadd`) para criar uma tarefa de qualquer app.
use crate::AppDb;
use tarefas_core::Db;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "quickadd";

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

/// Cria a tarefa (origem "rápida"); aprova direto se `auto_approve`. Sem AppHandle, para testar.
pub fn add_quick(db: &Db, title: &str, date: Option<&str>, auto_approve: bool) -> Result<i64, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("O título não pode ficar vazio".into());
    }
    let date = date.map(str::trim).filter(|d| !d.is_empty());
    if let Some(d) = date {
        chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| format!("Data inválida: {d}"))?;
    }
    let id = db.add_task_from(title, "", date, "rápida").map_err(err)?;
    if auto_approve {
        db.approve_task(id).map_err(err)?;
    }
    Ok(id)
}

#[tauri::command]
pub fn quick_add_task(
    app: AppHandle,
    db: State<AppDb>,
    title: String,
    date: Option<String>,
    time: Option<String>,
) -> Result<i64, String> {
    let auto = crate::settings::load().auto_approve;
    // Valida a hora antes de criar, para não deixar tarefa pela metade.
    let time = time.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    if let Some(t) = &time {
        tarefas_core::parse_hhmm(t).ok_or_else(|| format!("Hora inválida: {t}"))?;
    }
    let id = {
        let db = db.0.lock().map_err(err)?;
        let id = add_quick(&db, &title, date.as_deref(), auto)?;
        if let Some(t) = &time {
            db.set_due_time(id, Some(t)).map_err(err)?;
        }
        id
    };
    let _ = app.emit("tasks-changed", ());
    Ok(id)
}

/// Cria a janela escondida no setup, para abrir instantaneamente depois.
pub fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("quickadd.html".into()))
        .title("Prumo - tarefa rápida")
        .inner_size(560.0, 104.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .center()
        .visible(false)
        .build()?;
    Ok(())
}

/// Mostra a janelinha, foca e avisa o frontend para limpar o campo.
pub fn open<R: Runtime>(app: &AppHandle<R>) {
    // No macOS o app precisa estar ativo, senão o campo não recebe teclas.
    #[cfg(target_os = "macos")]
    let _ = app.show();
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit_to(LABEL, "quickadd-open", ());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejeita_titulo_vazio() {
        let db = Db::open_in_memory().unwrap();
        assert!(add_quick(&db, "   ", None, false).is_err());
        assert_eq!(db.inbox_count().unwrap(), 0);
    }

    #[test]
    fn vai_para_caixa_de_entrada_ou_aprova() {
        let db = Db::open_in_memory().unwrap();
        let id = add_quick(&db, "  comprar pão ", None, false).unwrap();
        let t = db.inbox().unwrap();
        assert_eq!((t.len(), t[0].id, t[0].title.as_str(), t[0].source.as_str()), (1, id, "comprar pão", "rápida"));
        add_quick(&db, "outra", None, true).unwrap();
        assert_eq!(db.inbox_count().unwrap(), 1);
    }

    #[test]
    fn grava_a_data_e_rejeita_data_invalida() {
        let db = Db::open_in_memory().unwrap();
        let id = add_quick(&db, "dentista", Some("2026-11-20"), false).unwrap();
        let t = db.inbox().unwrap();
        assert_eq!((t[0].id, t[0].due_date.as_deref()), (id, Some("2026-11-20")));
        assert!(add_quick(&db, "x", Some("amanhã"), false).is_err());
        assert_eq!(add_quick(&db, "sem data", Some(" "), false).is_ok(), true);
    }
}
