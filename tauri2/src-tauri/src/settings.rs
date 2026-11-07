use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tarefas_core::data_dir;

pub const EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// Pasta do modelo de transcrição escolhido (ex.: a do Parakeet do Handy).
    pub stt_model_dir: Option<String>,
    pub claude_model: String,
    pub claude_effort: String,
    /// Caminho manual do executável `claude` (opcional).
    pub claude_path: Option<String>,
    /// Tarefas por voz entram direto na lista, sem passar pela caixa de entrada.
    pub auto_approve: bool,
    /// Atalho global para iniciar/parar a gravação.
    pub shortcut: String,
    /// Atalho global que abre a janelinha de tarefa rápida.
    pub quick_add_shortcut: String,
}

/// Alt+Space no Windows abre o menu do sistema (e conflita com o PowerToys Run).
pub fn default_quick_add_shortcut() -> &'static str {
    if cfg!(target_os = "macos") { "Alt+Space" } else { "Ctrl+Alt+Space" }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            stt_model_dir: None,
            claude_model: "haiku".into(),
            claude_effort: "low".into(),
            claude_path: None,
            auto_approve: false,
            shortcut: "CommandOrControl+Shift+Space".into(),
            quick_add_shortcut: default_quick_add_shortcut().into(),
        }
    }
}

impl Settings {
    /// Normaliza valores inválidos (o arquivo pode ter sido editado à mão).
    pub fn sanitized(mut self) -> Self {
        let model_ok = |m: &str| {
            !m.is_empty() && m.len() <= 64 && m.chars().all(|c| c.is_ascii_alphanumeric() || "-._:[]".contains(c))
        };
        self.claude_model = self.claude_model.trim().to_string();
        if !model_ok(&self.claude_model) {
            self.claude_model = Self::default().claude_model;
        }
        if !EFFORTS.contains(&self.claude_effort.as_str()) {
            self.claude_effort = Self::default().claude_effort;
        }
        self.shortcut = self.shortcut.trim().to_string();
        if self.shortcut.is_empty() {
            self.shortcut = Self::default().shortcut;
        }
        self.quick_add_shortcut = self.quick_add_shortcut.trim().to_string();
        if self.quick_add_shortcut.is_empty() || self.quick_add_shortcut.eq_ignore_ascii_case(&self.shortcut) {
            self.quick_add_shortcut = default_quick_add_shortcut().into();
            // Se o padrão também colidir com o atalho de voz, o de voz volta ao seu padrão.
            if self.quick_add_shortcut.eq_ignore_ascii_case(&self.shortcut) {
                self.shortcut = Self::default().shortcut;
            }
        }
        self.claude_path = self.claude_path.filter(|p| !p.trim().is_empty());
        self.stt_model_dir = self.stt_model_dir.filter(|p| !p.trim().is_empty());
        self
    }
}

pub fn path() -> PathBuf {
    data_dir().join("settings.json")
}

pub fn load() -> Settings {
    std::fs::read_to_string(path())
        .ok()
        .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        .unwrap_or_default()
        .sanitized()
}

pub fn save(s: &Settings) -> std::io::Result<Settings> {
    let s = s.clone().sanitized();
    std::fs::create_dir_all(data_dir())?;
    std::fs::write(path(), serde_json::to_string_pretty(&s).map_err(std::io::Error::other)?)?;
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_bad_values() {
        let s = Settings { claude_model: "a b;rm".into(), claude_effort: "turbo".into(), ..Default::default() }.sanitized();
        assert_eq!(s.claude_model, "haiku");
        assert_eq!(s.claude_effort, "low");
        let ok = Settings { claude_model: "claude-haiku-5-5".into(), claude_effort: "high".into(), ..Default::default() }.sanitized();
        assert_eq!((ok.claude_model.as_str(), ok.claude_effort.as_str()), ("claude-haiku-5-5", "high"));
    }

    #[test]
    fn partial_json_uses_defaults() {
        let s: Settings = serde_json::from_str(r#"{"claudeEffort":"high"}"#).unwrap();
        assert_eq!(s.claude_effort, "high");
        assert_eq!(s.claude_model, "haiku");
    }

    #[test]
    fn quick_add_shortcut_default_empty_and_conflict() {
        let d = Settings::default();
        assert_eq!(d.quick_add_shortcut, default_quick_add_shortcut());
        let vazio = Settings { quick_add_shortcut: "  ".into(), ..Default::default() }.sanitized();
        assert_eq!(vazio.quick_add_shortcut, default_quick_add_shortcut());
        let igual = Settings { shortcut: "Ctrl+K".into(), quick_add_shortcut: "ctrl+k".into(), ..Default::default() }.sanitized();
        assert_eq!(igual.quick_add_shortcut, default_quick_add_shortcut());
        assert_eq!(igual.shortcut, "Ctrl+K");
        let ok = Settings { quick_add_shortcut: "Ctrl+J".into(), ..Default::default() }.sanitized();
        assert_eq!(ok.quick_add_shortcut, "Ctrl+J");
    }
}
