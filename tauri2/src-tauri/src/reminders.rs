//! Lembretes: uma thread em segundo plano consulta as tarefas com hora vencida e
//! dispara notificações nativas. A hora de cada tarefa é opcional (`tasks.due_time`).
use crate::{AppDb, plog};
use std::time::Duration;
use tarefas_core::Task;
use tauri::{AppHandle, Emitter, Manager, State};

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

/// Esperas antes de cada nova tentativa quando o envio falha (ex.: logo após o login, com o
/// serviço de notificações do Windows ainda subindo). Duas tentativas extras, sem avisar o usuário.
const ESPERAS_RETRY: [Duration; 2] = [Duration::from_secs(3), Duration::from_secs(10)];

/// Uma tentativa de mostrar o toast. No Windows chama o `notify-rust` direto: o plugin de
/// notificação despacha numa task e descarta o erro, o que impede logar e tentar de novo.
#[cfg(windows)]
fn enviar(app: &AppHandle, titulo: &str, corpo: &str) -> Result<(), String> {
    let mut n = notify_rust::Notification::new();
    n.summary(titulo)
        .body(corpo)
        // Sem `sound_name` o toast sai mudo (`<audio silent="true"/>`).
        .sound_name("Reminder")
        // Duração longa (~25 s) em vez da curta (~7 s).
        .timeout(notify_rust::Timeout::Never);
    if let Some(id) = app_id(app) {
        n.app_id(&id);
    }
    let handle = n.show().map_err(err)?;
    // Clique no toast (enquanto está na tela) abre o Prumo.
    let app = app.clone();
    std::thread::spawn(move || {
        let _ = handle.wait_for_response(|r: &notify_rust::NotificationResponse| {
            if !matches!(r, notify_rust::NotificationResponse::Closed(_)) {
                crate::tray::show_main(&app);
            }
        });
    });
    Ok(())
}

/// AppUserModelID do toast. O instalador registra o `identifier` no atalho do menu Iniciar; um
/// exe fora do instalador (target/debug, target/release) não tem esse registro e o Windows
/// descartaria o toast, então ali vale o padrão do notify-rust (PowerShell), como faz o plugin.
#[cfg(windows)]
fn app_id(app: &AppHandle) -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let sem_instalar = dir.ends_with("target/debug") || dir.ends_with("target/release");
    (!sem_instalar).then(|| app.config().identifier.clone())
}

#[cfg(not(windows))]
fn enviar(app: &AppHandle, titulo: &str, corpo: &str) -> Result<(), String> {
        app.notification().builder().title(titulo).body(corpo).sound("default").show().map_err(err)
}

/// Mostra a notificação, tentando de novo em silêncio se falhar. Devolve o último erro.
pub fn notificar(app: &AppHandle, titulo: &str, corpo: &str) -> Result<(), String> {
    let mut r = enviar(app, titulo, corpo);
    for espera in ESPERAS_RETRY {
        let Err(e) = &r else { break };
        plog!("lembretes: notificação falhou ({e}); tentando de novo em {}s", espera.as_secs());
        std::thread::sleep(espera);
        r = enviar(app, titulo, corpo);
    }
    r
}

/// Uma passada: pega os lembretes vencidos (lock curto), notifica e marca como lembrados.
fn verificar(app: &AppHandle) {
    let agora = chrono::Local::now().naive_local();
    let state = app.state::<AppDb>();
    let lembretes: Vec<Task> = {
        let Ok(db) = state.0.lock() else { return };
        match db.due_reminders(agora) {
            Ok(v) => v,
            Err(e) => {
                plog!("lembretes: {e}");
                return;
            }
        }
    };
    for t in lembretes {
        let hora = t.due_time.as_deref().unwrap_or_default();
        if let Err(e) = notificar(app, &t.title, &corpo(hora, &t.notes)) {
            plog!("lembretes: notificação de \"{}\" desistida: {e}", t.title);
        }
        // Marca mesmo se todas as tentativas falharem, para não repetir a cada 20 s.
        if let Ok(db) = state.0.lock() {
            let _ = db.mark_reminded(t.id);
        }
    }
}

/// Mostra uma notificação de exemplo (botão "Testar" em Configurações).
#[tauri::command]
pub async fn test_reminder(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let hora = chrono::Local::now().format("%H:%M").to_string();
        notificar(&app, "Lembrete de teste", &corpo(&hora, "Se você ouviu um som e está lendo isto, está tudo certo."))
    })
    .await
    .map_err(err)?
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
