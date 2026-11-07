//! Lembretes: uma thread em segundo plano consulta as tarefas com hora vencida e
//! dispara notificações nativas. A hora de cada tarefa é opcional (`tasks.due_time`).
use crate::{AppDb, plog};
use std::time::Duration;
use tarefas_core::Task;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

/// Intervalo entre consultas.
const INTERVALO: Duration = Duration::from_secs(20);

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

/// Corpo da notificação: hora + notas resumidas (primeira linha, até 120 caracteres).
pub fn corpo(hora: &str, notas: &str) -> String {
    let linha = notas.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    if linha.is_empty() {
        return hora.to_string();
    }
    let resumo: String = if linha.chars().count() > 120 {
        linha.chars().take(117).collect::<String>() + "…"
    } else {
        linha.to_string()
    };
    format!("{hora} · {resumo}")
}

/// Uma passada: pega os lembretes vencidos (lock curto), notifica e marca como lembrados.
fn verificar(app: &AppHandle) {
    let agora = chrono::Local::now().naive_local();
    let state = app.state::<AppDb>();
    let lembretes: Vec<(Task, String)> = {
        let Ok(db) = state.0.lock() else { return };
        match db.due_reminders(agora) {
            Ok(v) => v
                .into_iter()
                .map(|t| {
                    let hora = t.due_time.clone().unwrap_or_default();
                    (t, hora)
                })
                .collect(),
            Err(e) => {
                plog!("lembretes: {e}");
                return;
            }
        }
    };
    for (t, hora) in lembretes {
        let r = app
            .notification()
            .builder()
            .title(&t.title)
            .body(corpo(&hora, &t.notes))
            .show();
        if let Err(e) = r {
            plog!("lembretes: notificação falhou: {e}");
        }
        // Marca mesmo se a notificação falhar, para não repetir a cada 20 s.
        if let Ok(db) = state.0.lock() {
            let _ = db.mark_reminded(t.id);
        }
    }
}

/// Inicia a thread de lembretes (chamada uma vez no setup).
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            // A opção pode ser desligada em Configurações sem reiniciar o app.
            if crate::settings::load().reminders {
                verificar(&app);
            }
            std::thread::sleep(INTERVALO);
        }
    });
}

/// Define ou limpa a hora ("HH:MM") de uma tarefa.
#[tauri::command]
pub fn set_task_time(app: AppHandle, db: State<AppDb>, id: i64, time: Option<String>) -> Result<(), String> {
    db.0.lock().map_err(err)?.set_due_time(id, time.as_deref()).map_err(err)?;
    let _ = app.emit("tasks-changed", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corpo_resume_as_notas() {
        assert_eq!(corpo("14:30", ""), "14:30");
        assert_eq!(corpo("14:30", "\n  levar o contrato \nsegunda linha"), "14:30 · levar o contrato");
        let longa = "a".repeat(300);
        assert_eq!(corpo("09:00", &longa).chars().count(), "09:00 · ".chars().count() + 118);
    }
}
