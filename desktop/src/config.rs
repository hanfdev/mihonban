use anyhow::{Context, Result};
use directories::ProjectDirs;
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

const SERVICE: &str = "mihonban-native";

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ServerProfile {
    pub name: String,
    pub base_url: String,
    #[serde(default)]
    pub update_manifest_url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "default_language")]
    pub language: String,
    pub active_profile: usize,
    pub profiles: Vec<ServerProfile>,
    #[serde(default = "default_cache_enabled")]
    pub cache_enabled: bool,
    #[serde(default)]
    pub cache_dir: String,
    #[serde(default = "default_cache_max_bytes")]
    pub cache_max_bytes: u64,
    #[serde(default)]
    pub preload_next_track: bool,
    #[serde(default = "default_minimize_to_tray")]
    pub minimize_to_tray: bool,
    #[serde(default)]
    pub close_to_tray: bool,
}

fn default_language() -> String {
    "zh-Hans".into()
}

fn default_cache_enabled() -> bool {
    true
}

fn default_minimize_to_tray() -> bool {
    true
}

fn default_cache_max_bytes() -> u64 {
    10 * 1024 * 1024 * 1024
}

pub fn default_cache_dir() -> PathBuf {
    dirs()
        .map(|dirs| dirs.cache_dir().join("media"))
        .unwrap_or_else(|_| std::env::temp_dir().join("mihonban-cache"))
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            language: default_language(),
            active_profile: 0,
            profiles: vec![ServerProfile {
                name: "My Mihonban server".into(),
                base_url: "http://127.0.0.1:8788".into(),
                update_manifest_url: String::new(),
            }],
            cache_enabled: true,
            cache_dir: default_cache_dir().to_string_lossy().into_owned(),
            cache_max_bytes: default_cache_max_bytes(),
            preload_next_track: false,
            minimize_to_tray: true,
            close_to_tray: false,
        }
    }
}

impl AppConfig {
    pub fn remove_profile(&mut self, index: usize) -> Result<ServerProfile> {
        if index >= self.profiles.len() {
            anyhow::bail!("the selected server profile no longer exists");
        }
        if self.profiles.len() <= 1 {
            anyhow::bail!("at least one server profile must be retained");
        }
        let removed = self.profiles.remove(index);
        if self.active_profile > index {
            self.active_profile -= 1;
        }
        self.active_profile = self.active_profile.min(self.profiles.len() - 1);
        Ok(removed)
    }
}

fn dirs() -> Result<ProjectDirs> {
    ProjectDirs::from("com", "Mihonban", "Mihonban")
        .context("cannot locate the Windows application data directory")
}

fn config_path() -> Result<PathBuf> {
    let path = dirs()?.config_dir().join("config.json");
    Ok(path)
}

pub fn load() -> AppConfig {
    config_path()
        .ok()
        .and_then(|path| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .filter(|config: &AppConfig| !config.profiles.is_empty())
        .unwrap_or_default()
}

pub fn save(config: &AppConfig) -> Result<()> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).context("cannot create the application data directory")?;
    }
    let bytes = serde_json::to_vec_pretty(config).context("cannot encode configuration")?;
    fs::write(path, bytes).context("cannot save configuration")
}

fn credential(profile_name: &str) -> Result<Entry> {
    Entry::new(SERVICE, &format!("profile:{profile_name}"))
        .context("cannot access Windows Credential Manager")
}

pub fn load_password(profile_name: &str) -> Option<String> {
    credential(profile_name).ok()?.get_password().ok()
}

pub fn save_password(profile_name: &str, password: &str) -> Result<()> {
    credential(profile_name)?
        .set_password(password)
        .context("cannot save password in Windows Credential Manager")
}

pub fn clear_password(profile_name: &str) -> Result<()> {
    match credential(profile_name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error).context("cannot remove password from Windows Credential Manager"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile_config(active_profile: usize) -> AppConfig {
        AppConfig {
            active_profile,
            profiles: ["First", "Middle", "Last"]
                .into_iter()
                .map(|name| ServerProfile {
                    name: name.into(),
                    base_url: format!("https://{}.example", name.to_lowercase()),
                    update_manifest_url: format!(
                        "https://{}.example/latest.json",
                        name.to_lowercase()
                    ),
                })
                .collect(),
            ..AppConfig::default()
        }
    }

    #[test]
    fn deleting_the_active_profile_selects_the_next_available_profile() {
        for (index, removed_name, selected_name, selected_index) in [
            (0, "First", "Middle", 0),
            (1, "Middle", "Last", 1),
            (2, "Last", "Middle", 1),
        ] {
            let mut config = profile_config(index);
            let removed = config.remove_profile(index).unwrap();
            assert_eq!(removed.name, removed_name);
            assert_eq!(config.profiles.len(), 2);
            assert_eq!(config.active_profile, selected_index);
            assert_eq!(config.profiles[config.active_profile].name, selected_name);
        }
    }

    #[test]
    fn deleting_another_profile_preserves_the_active_profile() {
        for (active_index, removed_index, expected_index) in [(2, 0, 1), (1, 0, 0), (0, 2, 0)] {
            let mut config = profile_config(active_index);
            let selected = serde_json::to_value(&config.profiles[active_index]).unwrap();
            config.remove_profile(removed_index).unwrap();
            assert_eq!(config.active_profile, expected_index);
            assert_eq!(
                serde_json::to_value(&config.profiles[config.active_profile]).unwrap(),
                selected
            );
        }
    }

    #[test]
    fn rejected_profile_deletions_leave_configuration_unchanged() {
        let mut config = profile_config(1);
        let before = serde_json::to_value(&config).unwrap();
        assert!(config.remove_profile(3).is_err());
        assert!(config.remove_profile(usize::MAX).is_err());
        assert_eq!(serde_json::to_value(&config).unwrap(), before);

        let mut config = AppConfig::default();
        let before = serde_json::to_value(&config).unwrap();
        assert!(config.remove_profile(0).is_err());
        assert_eq!(serde_json::to_value(&config).unwrap(), before);
    }

    #[test]
    fn deleted_profiles_and_repaired_selection_survive_a_roundtrip() {
        let mut config = profile_config(2);
        config.remove_profile(0).unwrap();
        let saved = serde_json::to_string(&config).unwrap();
        let reloaded: AppConfig = serde_json::from_str(&saved).unwrap();
        assert_eq!(reloaded.active_profile, 1);
        assert_eq!(reloaded.profiles.len(), 2);
        assert_eq!(reloaded.profiles[0].name, "Middle");
        assert_eq!(reloaded.profiles[1].name, "Last");
        assert_eq!(
            serde_json::to_value(&config).unwrap(),
            serde_json::to_value(&reloaded).unwrap()
        );
    }

    #[test]
    fn legacy_configuration_gets_safe_tray_defaults() {
        let legacy = r#"{"active_profile":0,"profiles":[{"name":"Local","base_url":"http://127.0.0.1:8788"}]}"#;
        let mut config: AppConfig = serde_json::from_str(legacy).unwrap();
        assert!(config.minimize_to_tray);
        assert!(!config.close_to_tray);
        assert_eq!(config.profiles[0].name, "Local");
        config.minimize_to_tray = false;
        config.close_to_tray = true;
        let saved = serde_json::to_string(&config).unwrap();
        let reloaded: AppConfig = serde_json::from_str(&saved).unwrap();
        assert!(!reloaded.minimize_to_tray);
        assert!(reloaded.close_to_tray);
    }
}
