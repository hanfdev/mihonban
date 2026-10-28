use super::settings_ui as controls;
use super::*;

impl MihonbanApp {
    pub(super) fn settings(&mut self, ui: &mut egui::Ui) {
        ui.spacing_mut().item_spacing = Vec2::new(12.0, 12.0);
        ui.add_space(8.0);
        let version = i18n::format(
            &self.config.language,
            "desktop.settingsVersion",
            &[env!("CARGO_PKG_VERSION")],
        );
        ui.label(
            RichText::new(self.t("desktop.settingsEyebrow"))
                .size(10.5)
                .color(GOLD_DIM),
        );
        ui.horizontal(|ui| {
            ui.label(
                RichText::new(self.t("desktop.settings"))
                    .font(display(34.0))
                    .color(INK),
            );
            if ui.available_width() > 430.0 {
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    ui.label(RichText::new(&version).size(11.5).color(FAINT));
                });
            }
        });
        ui.add(
            egui::Label::new(
                RichText::new(self.t("desktop.settingsIntro"))
                    .size(13.5)
                    .color(DIM),
            )
            .wrap(),
        );
        ui.add_space(14.0);
        let width = ui.available_width();
        if width >= 1040.0 {
            let sidebar = 352.0;
            let main = width - sidebar - 22.0;
            ui.horizontal_top(|ui| {
                ui.spacing_mut().item_spacing.x = 22.0;
                ui.allocate_ui_with_layout(
                    Vec2::new(main, 0.0),
                    egui::Layout::top_down(egui::Align::Min),
                    |ui| {
                        ui.set_width(main);
                        self.settings_connection(ui);
                    },
                );
                ui.allocate_ui_with_layout(
                    Vec2::new(sidebar, 0.0),
                    egui::Layout::top_down(egui::Align::Min),
                    |ui| {
                        ui.set_width(sidebar);
                        self.settings_window(ui);
                        ui.add_space(10.0);
                        self.settings_updates(ui);
                    },
                );
            });
        } else {
            self.settings_connection(ui);
            ui.add_space(10.0);
            self.settings_window(ui);
            ui.add_space(10.0);
            self.settings_updates(ui);
        }
        ui.add_space(10.0);
        self.settings_cache(ui);
        ui.add_space(8.0);
        ui.add(
            egui::Label::new(
                RichText::new(self.t("desktop.compatibility"))
                    .size(11.5)
                    .color(FAINT),
            )
            .wrap(),
        );
        if !self.status.is_empty() {
            ui.add(egui::Label::new(RichText::new(&self.status).size(12.0).color(DIM)).wrap());
        }
        ui.add_space(6.0);
    }

    fn settings_connection(&mut self, ui: &mut egui::Ui) {
        controls::card(
            ui,
            "settings-service",
            self.t("desktop.connection"),
            self.t("desktop.connectionDescription"),
            |ui| {
                let profile = self
                    .config
                    .profiles
                    .get(self.config.active_profile)
                    .map(|profile| profile.name.clone())
                    .unwrap_or_else(|| self.t("desktop.profile").into());
                ui.horizontal_wrapped(|ui| {
                    Pill::new("settings-profile", &profile, 230.0).show(ui, |ui| {
                        let profiles: Vec<_> = self
                            .config
                            .profiles
                            .iter()
                            .enumerate()
                            .map(|(index, profile)| (index, profile.name.clone()))
                            .collect();
                        for (index, name) in profiles {
                            if ui
                                .selectable_label(index == self.config.active_profile, name)
                                .clicked()
                            {
                                self.select_profile(index);
                                ui.close_menu();
                            }
                        }
                    });
                    if controls::action(ui, self.t("desktop.addProfile"), false).clicked() {
                        self.add_profile();
                    }
                    ui.add_enabled_ui(self.config.profiles.len() > 1, |ui| {
                        if controls::action(ui, self.t("desktop.deleteProfile"), false)
                            .on_disabled_hover_text(self.t("desktop.keepOneProfile"))
                            .clicked()
                        {
                            if let Some(profile) =
                                self.config.profiles.get(self.config.active_profile)
                            {
                                self.pending_profile_delete = Some(ProfileDeletion {
                                    index: self.config.active_profile,
                                    profile: profile.clone(),
                                    focus_cancel: true,
                                });
                            }
                        }
                    });
                });
                controls::divider(ui);
                controls::field(
                    ui,
                    self.t("desktop.profileName"),
                    egui::TextEdit::singleline(&mut self.profile_name),
                );
                controls::field(
                    ui,
                    self.t("desktop.address"),
                    egui::TextEdit::singleline(&mut self.base_url)
                        .hint_text("https://your-mihonban.example"),
                )
                .on_hover_text(self.t("desktop.serviceAddressHint"));
                controls::field(
                    ui,
                    self.t("login.password"),
                    egui::TextEdit::singleline(&mut self.password).password(true),
                );
                controls::toggle(
                    ui,
                    "remember-credentials",
                    &mut self.remember_password,
                    i18n::text(&self.config.language, "desktop.remember"),
                    i18n::text(&self.config.language, "desktop.credentialsHint"),
                );
                controls::divider(ui);
                ui.horizontal_wrapped(|ui| {
                    if controls::action(ui, self.t("desktop.saveProfile"), true).clicked() {
                        self.save_profile();
                    }
                    if controls::action(ui, self.t("desktop.connect"), false).clicked() {
                        self.connect();
                    }
                });
                if self.role.as_deref() == Some("admin") {
                    controls::divider(ui);
                    ui.add(
                        egui::Label::new(
                            RichText::new(self.t("desktop.adminPortalDescription"))
                                .size(12.0)
                                .color(FAINT),
                        )
                        .wrap(),
                    );
                    if controls::action(ui, self.t("desktop.openAdminPortal"), false).clicked() {
                        match crate::api::admin_console_url(&self.base_url)
                            .and_then(|url| webbrowser::open(&url).map_err(Into::into))
                        {
                            Ok(()) => self.status = self.t("desktop.adminPortalOpened").into(),
                            Err(error) => self.status = error.to_string(),
                        }
                    }
                }
            },
        );
    }

    pub(super) fn profile_delete_dialog(&mut self, ctx: &egui::Context) {
        let Some(pending) = self.pending_profile_delete.clone() else {
            return;
        };
        let result = controls::confirm_profile_delete(
            ctx,
            &self.config.language,
            &pending.profile.name,
            &pending.profile.base_url,
            pending.focus_cancel,
        );
        if let Some(pending) = self.pending_profile_delete.as_mut() {
            pending.focus_cancel = false;
        }
        match result {
            Some(true) => {
                self.pending_profile_delete = None;
                if let Err(error) = self.delete_profile(pending) {
                    self.status = self.tf("desktop.profileDeleteFailed", &[&error.to_string()]);
                }
            }
            Some(false) => self.pending_profile_delete = None,
            None => {}
        }
    }

    fn settings_window(&mut self, ui: &mut egui::Ui) {
        #[cfg(target_os = "windows")]
        controls::card(
            ui,
            "settings-window",
            self.t("desktop.windowBehavior"),
            self.t("desktop.windowDescription"),
            |ui| {
                if let Err(error) = &self.tray {
                    ui.add(
                        egui::Label::new(
                            RichText::new(format!(
                                "{}: {error}",
                                self.t("desktop.trayUnavailable")
                            ))
                            .size(12.0)
                            .color(ACCENT_HI),
                        )
                        .wrap(),
                    );
                }
                let mut changed = false;
                ui.add_enabled_ui(self.tray.is_ok(), |ui| {
                    changed |= controls::toggle(
                        ui,
                        "minimize-to-tray",
                        &mut self.config.minimize_to_tray,
                        i18n::text(&self.config.language, "desktop.minimizeToTray"),
                        i18n::text(&self.config.language, "desktop.minimizeHint"),
                    )
                    .changed();
                    controls::divider(ui);
                    changed |= controls::toggle(
                        ui,
                        "close-to-tray",
                        &mut self.config.close_to_tray,
                        i18n::text(&self.config.language, "desktop.closeToTray"),
                        i18n::text(&self.config.language, "desktop.closeHint"),
                    )
                    .changed();
                });
                ui.label(
                    RichText::new(self.t("desktop.autoSaved"))
                        .size(10.5)
                        .color(FAINT),
                );
                if changed {
                    self.status = match config::save(&self.config) {
                        Ok(()) => self.t("desktop.saved").into(),
                        Err(error) => error.to_string(),
                    };
                }
            },
        );
    }

    fn settings_updates(&mut self, ui: &mut egui::Ui) {
        controls::card(
            ui,
            "settings-updates",
            self.t("desktop.updateSection"),
            self.t("desktop.updateDescription"),
            |ui| {
                controls::field(
                    ui,
                    self.t("desktop.manifest"),
                    egui::TextEdit::singleline(&mut self.manifest_url)
                        .hint_text("https://…/latest.json"),
                )
                .on_hover_text(self.t("desktop.manifestHint"));
                ui.add(
                    egui::Label::new(
                        RichText::new(self.t("desktop.updateSourceHelp"))
                            .size(11.5)
                            .color(FAINT),
                    )
                    .wrap(),
                );
                ui.horizontal_wrapped(|ui| {
                    if controls::action(ui, self.t("desktop.saveProfile"), false).clicked() {
                        self.save_profile();
                    }
                    ui.add_enabled_ui(!self.manifest_url.trim().is_empty(), |ui| {
                        if controls::action(ui, self.t("desktop.checkUpdates"), false).clicked() {
                            let url = self.manifest_url.clone();
                            self.spawn(async move {
                                let result = async {
                                    let response = reqwest::Client::new().get(url).send().await?;
                                    if !response.status().is_success() {
                                        anyhow::bail!(
                                            "update manifest returned {}",
                                            response.status()
                                        );
                                    }
                                    Ok(response.json::<crate::api::UpdateManifest>().await?)
                                }
                                .await
                                .map_err(|error: anyhow::Error| error.to_string());
                                Message::UpdateChecked(result)
                            });
                        }
                    });
                });
                if let Some(update) = self.update.clone() {
                    if updates::is_newer(&update.latest, env!("CARGO_PKG_VERSION")) {
                        ui.label(
                            RichText::new(i18n::format(
                                &self.config.language,
                                "desktop.updateReady",
                                &[&update.latest],
                            ))
                            .size(12.0)
                            .color(GOLD),
                        );
                        if controls::action(ui, self.t("desktop.downloadUpdate"), true).clicked() {
                            self.spawn(async move {
                                Message::UpdateDownloaded(
                                    updates::download_and_verify(
                                        &update.download_url,
                                        &update.sha256,
                                    )
                                    .await
                                    .map_err(|error| error.to_string()),
                                )
                            });
                        }
                    }
                }
            },
        );
    }

    fn settings_cache(&mut self, ui: &mut egui::Ui) {
        controls::card(
            ui,
            "settings-storage",
            self.t("desktop.cache"),
            self.t("desktop.cacheDescription"),
            |ui| {
                controls::toggle(
                    ui,
                    "enable-local-cache",
                    &mut self.config.cache_enabled,
                    i18n::text(&self.config.language, "desktop.cacheEnable"),
                    i18n::text(&self.config.language, "desktop.cacheKeepHint"),
                );
                ui.add_enabled_ui(self.config.cache_enabled, |ui| {
                    controls::toggle(
                        ui,
                        "preload-next-track",
                        &mut self.config.preload_next_track,
                        i18n::text(&self.config.language, "desktop.preloadNextTrack"),
                        i18n::text(&self.config.language, "desktop.preloadNextTrackHint"),
                    );
                });
                controls::divider(ui);
                let used = self.cache.size_bytes();
                let limit = self.cache.max_bytes();
                ui.horizontal(|ui| {
                    ui.label(
                        RichText::new(self.t("desktop.cacheUsage"))
                            .size(12.0)
                            .color(DIM),
                    );
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.label(
                            RichText::new(format!(
                                "{} / {}",
                                format_bytes(used),
                                format_bytes(limit)
                            ))
                            .size(12.0)
                            .color(INK),
                        );
                    });
                });
                let (meter, _) = ui.allocate_exact_size(
                    Vec2::new(ui.available_width(), 5.0),
                    egui::Sense::hover(),
                );
                ui.painter().rect_filled(meter, 2.5, BG3);
                let ratio = (used as f64 / limit as f64).clamp(0.0, 1.0) as f32;
                if ratio > 0.0 {
                    ui.painter().rect_filled(
                        Rect::from_min_size(
                            meter.min,
                            Vec2::new((meter.width() * ratio).max(2.0), 5.0),
                        ),
                        2.5,
                        GOLD_DIM,
                    );
                }
                ui.add_enabled_ui(self.config.cache_enabled, |ui| {
                    controls::field(
                        ui,
                        i18n::text(&self.config.language, "desktop.cacheDirectory"),
                        egui::TextEdit::singleline(&mut self.config.cache_dir).hint_text(
                            i18n::text(&self.config.language, "desktop.cacheDefaultHint"),
                        ),
                    );
                    ui.label(
                        RichText::new(self.t("desktop.cacheLimit"))
                            .size(12.0)
                            .color(DIM),
                    );
                    ui.scope(|ui| {
                        let slider_width = (ui.available_width() - 140.0).max(100.0);
                        ui.spacing_mut().slider_width = slider_width;
                        ui.spacing_mut().interact_size.y = 30.0;
                        let visuals = ui.visuals_mut();
                        visuals.widgets.inactive.bg_fill = BG3;
                        visuals.widgets.inactive.weak_bg_fill = BG0;
                        visuals.widgets.inactive.bg_stroke = Stroke::new(1.0, LINE);
                        visuals.widgets.inactive.fg_stroke = Stroke::new(1.0, DIM);
                        visuals.widgets.hovered.bg_fill = GOLD_DIM;
                        visuals.widgets.hovered.weak_bg_fill = BG2;
                        visuals.widgets.hovered.bg_stroke = Stroke::new(1.0, GOLD_DIM);
                        visuals.widgets.active.bg_fill = ACCENT;
                        visuals.widgets.active.weak_bg_fill = BG2;
                        visuals.widgets.active.bg_stroke = Stroke::new(1.0, ACCENT);
                        visuals.selection.bg_fill = ACCENT;
                        let mut gb = self.config.cache_max_bytes as f64 / 1_073_741_824.0;
                        ui.horizontal(|ui| {
                            let slider = ui.add(
                                egui::Slider::new(&mut gb, 1.0..=200.0)
                                    .step_by(1.0)
                                    .trailing_fill(true)
                                    .show_value(false),
                            );
                            let number = ui.add(
                                egui::DragValue::new(&mut gb)
                                    .range(1.0..=200.0)
                                    .speed(1.0)
                                    .fixed_decimals(0)
                                    .suffix(" GB"),
                            );
                            if slider.changed() || number.changed() {
                                self.config.cache_max_bytes = (gb.round() * 1_073_741_824.0) as u64;
                            }
                        });
                    });
                    ui.add(
                        egui::Label::new(
                            RichText::new(self.t("desktop.cacheLimitHint"))
                                .size(11.5)
                                .color(FAINT),
                        )
                        .wrap(),
                    );
                });
                if self.config.cache_max_bytes != limit {
                    ui.label(
                        RichText::new(self.t("desktop.cachePending"))
                            .size(11.5)
                            .color(GOLD),
                    );
                }
                controls::divider(ui);
                ui.horizontal_wrapped(|ui| {
                    if controls::action(ui, self.t("desktop.saveCache"), true).clicked() {
                        match config::save(&self.config) {
                            Ok(()) => {
                                self.cache = cache_for(&self.config, &self.base_url);
                                self.status = self.t("desktop.saved").into();
                            }
                            Err(error) => self.status = error.to_string(),
                        }
                    }
                    if controls::action(ui, self.t("desktop.defaultDirectory"), false).clicked() {
                        self.config.cache_dir =
                            config::default_cache_dir().to_string_lossy().into_owned();
                    }
                    if controls::action(ui, self.t("desktop.openDirectory"), false).clicked() {
                        let _ = std::process::Command::new("explorer.exe")
                            .arg(self.cache.root())
                            .spawn();
                    }
                    if controls::action(ui, self.t("desktop.clearCache"), false).clicked() {
                        self.status = match self.cache.clear() {
                            Ok(()) => self.t("desktop.cacheCleared").into(),
                            Err(error) => error.to_string(),
                        };
                    }
                });
                ui.add(
                    egui::Label::new(
                        RichText::new(self.t("desktop.cacheSaveHint"))
                            .size(11.5)
                            .color(FAINT),
                    )
                    .wrap(),
                );
            },
        );
    }
}
