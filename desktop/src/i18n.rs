use std::{collections::HashMap, sync::OnceLock};

pub const LANGUAGES: [(&str, &str, &str); 7] = [
    ("en", "EN", "English"),
    ("ja", "JP", "日本語"),
    ("ko", "KR", "한국어"),
    ("fr", "FR", "Français"),
    ("es", "ES", "Español"),
    ("zh-Hans", "简", "简体中文"),
    ("zh-Hant", "繁", "繁體中文"),
];

type Catalog = HashMap<String, String>;

fn catalogs() -> &'static HashMap<&'static str, Catalog> {
    static CATALOGS: OnceLock<HashMap<&str, Catalog>> = OnceLock::new();
    CATALOGS.get_or_init(|| {
        [
            ("en", include_str!("../assets/locales/en.json")),
            ("ja", include_str!("../assets/locales/ja.json")),
            ("ko", include_str!("../assets/locales/ko.json")),
            ("fr", include_str!("../assets/locales/fr.json")),
            ("es", include_str!("../assets/locales/es.json")),
            ("zh-Hans", include_str!("../assets/locales/zh-Hans.json")),
            ("zh-Hant", include_str!("../assets/locales/zh-Hant.json")),
        ]
        .into_iter()
        .map(|(id, json)| {
            (
                id,
                serde_json::from_str(json).expect("bundled locale catalog"),
            )
        })
        .collect()
    })
}

pub fn text(language: &str, key: &str) -> &'static str {
    let catalogs = catalogs();
    catalogs
        .get(language)
        .and_then(|catalog| catalog.get(key))
        .or_else(|| catalogs.get("en").and_then(|catalog| catalog.get(key)))
        .map(String::as_str)
        .unwrap_or("—")
}

pub fn format(language: &str, key: &str, values: &[&str]) -> String {
    let mut value = text(language, key).to_owned();
    for (index, replacement) in values.iter().enumerate() {
        value = value.replace(&format!("{{{index}}}"), replacement);
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_locale_covers_the_same_interface() {
        let catalogs = catalogs();
        for (id, _, _) in LANGUAGES {
            let catalog = &catalogs[id];
            for key in catalogs["en"].keys() {
                assert!(
                    catalog.get(key).is_some_and(|value| !value.is_empty()),
                    "{id}: {key}"
                );
            }
        }
        assert_eq!(format("en", "count.albums", &["340"]), "340 albums");
        assert_eq!(format("zh-Hans", "count.tracks", &["16"]), "16 曲");
    }
}
