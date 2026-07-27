"""Configuration safety and compatibility behavior."""

from __future__ import annotations

import tomllib
from pathlib import Path
from types import SimpleNamespace

import pytest

from mihonban import cli, config as config_mod
from mihonban.config import ConfigError


def test_suite_imports_pipeline_from_current_worktree():
    expected = (Path(__file__).parents[1] / "pipeline").resolve()
    actual = Path(config_mod.__file__).resolve()

    assert actual.is_relative_to(expected), (
        f"tests imported mihonban from {actual}, expected it under {expected}"
    )


@pytest.mark.parametrize("folder", [
    "OneDrive",
    "OneDrive - Personal",
    "Dropbox (Personal)",
    "iCloudDrive",
])
def test_live_data_rejects_known_cloud_sync_folders(cfg, tmp_path, folder):
    sevenzip = tmp_path / "7z.exe"
    sevenzip.touch()
    cfg.sevenzip = sevenzip
    cfg.data_dir = tmp_path / folder / "mihonban-data"

    with pytest.raises(ConfigError, match="cloud-sync folder"):
        cfg.validate()


def test_unrelated_path_containing_brand_text_is_allowed(cfg, tmp_path):
    sevenzip = tmp_path / "7z.exe"
    sevenzip.touch()
    cfg.sevenzip = sevenzip
    cfg.music_root = Path(tmp_path) / "my-onedrive-notes" / "Library"
    cfg.data_dir = Path(tmp_path) / "ordinary-data"

    cfg.validate()


def test_setup_writes_valid_toml_for_quoted_user_input(tmp_path, monkeypatch):
    target = tmp_path / "config.toml"
    home = tmp_path / "Music's Home"
    answers = iter([
        str(home), "", "", "", "",
        'pa"ss,back\\slash', 'tok"en',
        'https://example.test/library?name="mine"',
        "mihonban:Music/Library",
    ])
    monkeypatch.setattr("builtins.input", lambda _prompt: next(answers))
    monkeypatch.setattr(config_mod, "find_sevenzip", lambda: None)
    monkeypatch.setattr(config_mod, "find_rclone", lambda: None)

    args = SimpleNamespace(config=str(target), force=False)
    assert cli.cmd_setup(None, args) == 0

    parsed = tomllib.loads(target.read_text(encoding="utf-8"))
    assert parsed["paths"]["music_root"] == (home / "Library").as_posix()
    assert parsed["archive"]["passwords"] == ['pa"ss', "back\\slash"]
    assert parsed["discogs"]["token"] == 'tok"en'
    assert parsed["cloud"]["url"].endswith('name="mine"')
    assert parsed["cloud"]["remote"] == "mihonban:Music/Library"


def test_load_rejects_config_file_inside_cloud_sync_folder(tmp_path):
    target = tmp_path / "OneDrive - Personal" / "config.toml"
    target.parent.mkdir()
    target.write_text("[paths]\n", encoding="utf-8")

    with pytest.raises(ConfigError, match="Config file.*cloud-sync folder"):
        config_mod.load(target)


def test_setup_rejects_config_target_inside_cloud_sync_folder(tmp_path):
    target = tmp_path / "Dropbox" / "config.toml"
    args = SimpleNamespace(config=str(target), force=False)

    assert cli.cmd_setup(None, args) == 2
    assert not target.exists()
