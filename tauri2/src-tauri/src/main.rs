// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Chamado como processo auxiliar de transcrição? (veja worker.rs)
    if let Some(code) = prumo_lib::worker::maybe_run() {
        std::process::exit(code);
    }
    prumo_lib::run()
}
