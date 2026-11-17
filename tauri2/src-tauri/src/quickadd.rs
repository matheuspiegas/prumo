//! Quick-add: janelinha flutuante (`quickadd`) para criar tarefas de qualquer app.
//! O texto digitado passa pelo agente (Claude Code ou Codex), que pode separá-lo em várias tarefas.
use crate::AppDb;
use crate::interpret::{self, Parsed};
use serde::Serialize;
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
    // Digitada por quem está criando (sem IA): vai direto para as tarefas, sem passar pela caixa de entrada.
    let auto = true;
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

/// Tarefa criada, para o feedback da interface.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Created {
    pub id: i64,
    pub title: String,
    pub date: Option<String>,
    pub time: Option<String>,
}

/// Valida "YYYY-MM-DD" e "HH:MM" vindos da interface; vazio vira `None`.
fn picker(date: Option<String>, time: Option<String>) -> Result<(Option<String>, Option<String>), String> {
    let date = date.map(|d| d.trim().to_string()).filter(|d| !d.is_empty());
    if let Some(d) = &date {
        chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| format!("Data inválida: {d}"))?;
    }
    let time = match time.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
        Some(t) => Some(tarefas_core::parse_hhmm(&t).ok_or_else(|| format!("Hora inválida: {t}"))?),
        None => None,
    };
    Ok((date, time))
}

/// Cria as tarefas interpretadas. A data e a hora escolhidas na janelinha servem de padrão:
/// a data vale para as tarefas sem data; a hora só quando há uma única tarefa, sem hora.
pub fn create_parsed(
    db: &Db,
    tasks: &[Parsed],
    source: &str,
    approve: bool,
    default_date: Option<&str>,
    default_time: Option<&str>,
) -> Result<Vec<Created>, String> {
    let single = tasks.len() == 1;
    let mut out = Vec::with_capacity(tasks.len());
    for t in tasks {
        let date = t.date.as_deref().or(default_date);
        let time = t.time.as_deref().or(if single { default_time } else { None });
        let id = db.add_task_from(&t.title, &t.notes, date, source).map_err(err)?;
        if let Some(h) = time {
            db.set_due_time(id, Some(h)).map_err(err)?;
        }
        if approve {
            db.approve_task(id).map_err(err)?;
        }
        out.push(Created { id, title: t.title.clone(), date: date.map(str::to_string), time: time.map(str::to_string) });
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct QuickAddResult {
    tasks: Vec<Created>,
    /// A interpretação falhou e o texto foi salvo literalmente (motivo).
    warning: Option<String>,
}

/// Tarefa rápida digitada: o agente interpreta o texto (pode virar várias tarefas, com data e
/// hora). Se a interpretação falhar, salva o texto como está, para não perder nada.
#[tauri::command]
pub async fn quick_add_smart(
    app: AppHandle,
    text: String,
    date: Option<String>,
    time: Option<String>,
) -> Result<QuickAddResult, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("O título não pode ficar vazio".into());
    }
    let (date, time) = picker(date, time)?;
    let settings = crate::settings::load();
    let t = text.clone();
    let parsed = tauri::async_runtime::spawn_blocking(move || interpret::interpret(&settings, &t))
        .await
        .map_err(err)?;
    let (tasks, warning) = match parsed {
        Ok(p) => {
            crate::plog!("tarefa rápida: {} tarefa(s) interpretada(s)", p.len());
            (p, None)
        }
        Err(e) => {
            crate::plog!("tarefa rápida: interpretação falhou, salvando o texto: {e}");
            (vec![Parsed { title: text, date: None, time: None, notes: String::new() }], Some(e))
        }
    };
    let created = {
        let state = app.state::<AppDb>();
        let db = state.0.lock().map_err(err)?;
        // Digitada por quem está criando: vai direto para as tarefas, sem caixa de entrada.
        create_parsed(&db, &tasks, "rápida", true, date.as_deref(), time.as_deref())?
    };
    let _ = app.emit("tasks-changed", ());
    Ok(QuickAddResult { tasks: created, warning })
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

    fn p(title: &str, date: Option<&str>, time: Option<&str>) -> Parsed {
        Parsed { title: title.into(), date: date.map(Into::into), time: time.map(Into::into), notes: String::new() }
    }

    #[test]
    fn cria_varias_tarefas_com_hora() {
        let db = Db::open_in_memory().unwrap();
        let tasks = [
            p("Ir ao dentista", Some("2026-11-18"), Some("16:00")),
            p("Ir ao mercado", Some("2026-11-18"), Some("18:00")),
            p("Viajar a Porto Alegre", Some("2026-11-19"), None),
        ];
        let c = create_parsed(&db, &tasks, "voz", true, None, None).unwrap();
        assert_eq!(c.len(), 3);
        assert_eq!(db.inbox_count().unwrap(), 0);
        let t = db.get_task(c[0].id).unwrap();
        assert_eq!((t.due_date.as_deref(), t.due_time.as_deref(), t.source.as_str()), (Some("2026-11-18"), Some("16:00"), "voz"));
        assert_eq!(db.get_task(c[2].id).unwrap().due_time, None);
    }

    #[test]
    fn data_e_hora_da_janelinha_sao_padrao() {
        let db = Db::open_in_memory().unwrap();
        // Uma tarefa sem data nem hora: herda as duas.
        let c = create_parsed(&db, &[p("Ligar", None, None)], "rápida", true, Some("2026-11-20"), Some("09:00")).unwrap();
        assert_eq!((c[0].date.as_deref(), c[0].time.as_deref()), (Some("2026-11-20"), Some("09:00")));
        // Várias: a data vale para quem não tem; a hora não é copiada para todas.
        let c = create_parsed(&db, &[p("A", None, None), p("B", Some("2026-11-25"), None)], "rápida", true, Some("2026-11-20"), Some("09:00")).unwrap();
        assert_eq!((c[0].date.as_deref(), c[0].time.as_deref()), (Some("2026-11-20"), None));
        assert_eq!(c[1].date.as_deref(), Some("2026-11-25"));
        // Sem aprovar: tudo na caixa de entrada.
        create_parsed(&db, &[p("C", None, None), p("D", None, None)], "voz", false, None, None).unwrap();
        assert_eq!(db.inbox_count().unwrap(), 2);
    }

    #[test]
    fn valida_data_e_hora_da_janelinha() {
        assert_eq!(picker(Some(" ".into()), Some("".into())).unwrap(), (None, None));
        assert_eq!(picker(Some("2026-11-20".into()), Some("9:05".into())).unwrap(), (Some("2026-11-20".into()), Some("09:05".into())));
        assert!(picker(Some("amanhã".into()), None).is_err());
        assert!(picker(None, Some("25:00".into())).is_err());
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
