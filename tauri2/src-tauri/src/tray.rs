//! Segundo plano: tray, esconder a janela principal ao fechar e instância única.

use tauri::{
    AppHandle, Manager, Runtime,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

/// Mostra e foca a janela principal (no macOS volta a política para Regular).
pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Esconde a janela principal (no macOS some do Dock e do Cmd+Tab).
pub fn hide_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

/// Cria o ícone da bandeja com o menu "Abrir Prumo", "Nova tarefa rápida" e "Sair".
pub fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let abrir = MenuItem::with_id(app, "open", "Abrir Prumo", true, None::<&str>)?;
    let rapida = MenuItem::with_id(app, "quickadd", "Nova tarefa rápida", true, None::<&str>)?;
    let sair = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&abrir, &rapida, &sair])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Prumo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quickadd" => crate::quickadd::open(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
