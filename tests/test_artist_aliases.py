# -*- coding: utf-8 -*-
"""Artist alias library plus layered ``resolve_original`` lookup."""

from __future__ import annotations

import json
from pathlib import Path

from mihonban.mb_artist import (ALIAS_PATH, _ALIAS_MISS, ArtistCache,
                             alias_lookup, norm_alias_key, resolve_original)


USER_ARTISTS = """
ADARAPTA
AKANE IKEMA
AKANE ODA
AKIHIRO MIWA
AKIKO HINAGATA
AKIKO MIZUHARA
AKIKO NAKAMURA
AKIKO NAKAZATO
AKINA NAKAMORI
AMAZONS
ANNA TSUCHIYA
ANRI
APHASIA
ASUKA SUITA
AYA SUGIMOTO
AYUMI NAKAMURA
BC LEMMON
BUCK-TICK
BUDDHA BRAND
CANDY ASADA
CHAKRA
CHARA
CHIEMI MANABE
CHIKACO SAWADA
CHISATO MORITAKA
CHIYONO YOSHINO
CLIFF EDGE
COCO
CYBER NATION NETWORK
DA CAPO
DARIA KAWASHIMA
DOUBLE
EAST END × YURI
ERI NAKATANI
ERI SUGAI & ITARU WATANABE
ERIKA HANEDA
EVE
FLORENCE HAGA
FOLDER 5
FUJII ICHIKO
GENKI ROCKETS
GORO NOGUCHI
GOTO KUMIKO
HEAVY METAL ARMY
HIDEKI SAIJO
HIDEMI ISHIKAWA
HIKARU MIDORIKAWA
HINANO YOSHIKAWA
HIROAKI IGARASHI
HIROKO CHIBA
HIROKO YAKUSHIMARU
HIROMI GO
HIROMI OHTA
HIROMI OTA
HIRONORI KANEKO
HITOE
HITOMI OZAKI
HITOMI TAKAHASHI
HITOSHI KOMURO
HOKI TOKUDA
HYODO MIKI
IKUE SAKAKIBARA
ISSA x SoulJa
ITSUTSU NO AKAI FUSEN
JANUARY CHRISTY
JENNY01
JUN & NENE
JUN FUBUKI
JUN SHIBATA
JUNGLE SMILE
KANAKO WADA
KAORI SHIMIZU
KAORI SHIMURA
KAORI TSUCHIYA
KAORU AIZAWA
KAZUMI KAAI
KEIKO GOTO
KEIKO TAKESHITA
KEN MURAMATSU
KENGO KUROZUMI
KEY WEST CLUB
KIYOTAKA SUGIYAMA & OMEA TRIBE
KODA KUMI
KOJIRO SHIMIZU
LOVE
LUU HUYNH CHAU
MAGIC
MAKI ASAKAWA
MAKI MOCHIDA
MAMI HORIE
MAMI TAKAHASHI
MAMKO TAKADA
MÁRCIA
MARI AMACHI
MARI HAMADA
MARI IIJIMA
MARI IZUMI
MARIKO TAKAHASHI
MARIKO TONE
MARINO
MARIYA TAKEUCHI
MARLENE
MASA TAKAGI
MASAHARU FUKUYAMA
MASAHIRO KUWANA
MASAKO MORI
MASATO MINAMI
MAYUKO SAKAI
MEG
MEGUMI OKINA
MICHIKO TANAKA
MICHIYO NAKAJIMA
MIDORI EBINA
MIDORI KARASHIMA
MIHARA JUNKO
MIHO GOMI
MIHO MORIKAWA
MIHO NAKAYAMA
MIKI IMAI
MIKI ITOU
MIKI MATSUBARA
MIKI SAKAI
MIMI HIYOSHI
MINAKO HONDA
MINAKO ITO
MINNIE
MISATO WATANABE
MISHIO OGAWA
MIURA RIEKO
MIWAKO ICHIKAWA
MIYAKO CHAKI
MIYOKO YOSHIMOTO
MIYUKI KAJITANI
MIYUKI SUGIURA
MOMOKO KIKUCHI
MONTA & BROTHERS
MORIO YUMI
MOTOYOSHI IWASAKI & WINDY
N.S.P
NAGISA NI TE
NAMI SHIMADA
NAMIE AMURO
NANA KONDO
NANAKO MINAMI
NAO MATSUZAKI
NARUMI & THE MISTERS
NATSUKO HEKI
NITO YUKO
NONA REEVES
NORIKO MATSUMOTO
NORIKO OGAWA
NORIO SAKAI
ONYANKO CLUB
ORIGINAL LOVE
PAIR SUZURAN
PAO
PARK YOUNG-MI
PICKY PICNIC
PINK PINCLES
POPPIES
REIKO KASHIWAGI
REIKO TAKAHASHI
REIMY
RIE IDA & 42ND STREET
RIEKO MIURA
RISA HONDA
RITSUKO TANAKA
ROMI NARITA
ROSE
ROSE ROXY ROLLER
RUMI NAKASHIMA
RUMI TAKAHARA
RUMIKO KAWAHARA
RURIKO OHGAMI
RYOHEI YAMANASHI
RYOKO SAKAGUCHI
RYOKO SHINOHARA
RYUICHI SAKAMOTO
RYUSENKEI
SACHIKO KOBAYASHI
SANSHIRO
SATSUKI SHIBANO
SAWAKO KITAHARA
SAYURI KOKUSHO
SEIKO MATSUDA
SERANI POJI
SHIBUGAKITAI
SHINKO TERADA
SHINOBU HORIE
SHINOBU NAKAYAMA
SHOKO ARAI
SHOKO INOUE
SONIA ROSA
SPACE A
SPAED
SPICA
SPITZ
SUMIKA YAMANAKA
TAKAHASHI YOKO
TAKAKO MAMIYA
TAKESHI TERAUCHI & BLUE JEANS
TANPOPO
TATSURO YAMASHITA
TERUKO FUJII
THE BLUE HEARTS
THE BRILLIANT GREEN
THE GOLDEN CUPS
THE LILIES
THE PANTYHOSE
TOKO OKABE
TOMMY FEBRUARY6
TOMMY HEAVENLY6
TOMOKO FUJITA
TOMOMI KAHALA
TOMOYO HARADA
TOMOYO YOSHIDA
TORU WATANABE
TOSHIO KUROSAWA & KAZUKO KANO
TOSHITARO
TRIANGLE
TWIST
UTSUMI KAZUKO
V.A
VARIOUS ARTISTS
W-NAO
WORLD STANDARD
YASUYUKI OKAMURA
YOKO KON
YOKO MAENO
YOKO MIZUSAWA
YOKO NAKAMURA
YOKO NISHI
YOON BOK-HEE
YORIYUKI HARADA
YOSHIE KASHIWABARA
YOSHIKO GOSHIMA
YOSHIKO YAMAGUCHI
YOSHIMURA HIROSHI
YOSHINORI SUNAHARA
YOSHITO FUCHIGAMI
YUI ASAKA
YUKA OHNISHI
YUKA ONISHI
YUKA OONISHI
YUKI KURODA
YUKIKO HANEDA
YUKIKO OKADA
YUKO KAWAI
YUKO KOTEGAWA
YUKO KUMAI
YUMA NAKAMURA
YUMIKO KOSAKA
YURI NAKAE
ZARD
ZONE TIME
""".strip().splitlines()


def test_alias_file_exists_and_loads():
    assert ALIAS_PATH.exists(), ALIAS_PATH
    assert alias_lookup("tatsuro yamashita")["name"] == "山下達郎"


def test_new_japanese_artists_have_verified_romanized_aliases():
    assert alias_lookup("ryusenkei") == {
        "name": "流線形", "sort": "Ryusenkei",
    }


def test_requested_artist_catalog_is_explicitly_covered():
    raw = json.loads(ALIAS_PATH.read_text("utf-8"))["aliases"]
    keys = {norm_alias_key(key) for key in raw}
    assert len(USER_ARTISTS) == 255
    assert [name for name in USER_ARTISTS if norm_alias_key(name) not in keys] == []
    assert [name for name in USER_ARTISTS
            if alias_lookup(name) is _ALIAS_MISS] == []


def test_ambiguous_and_misspelled_source_names_use_verified_identities():
    assert alias_lookup("MAMKO TAKADA") == {
        "name": "高田真樹子", "sort": "Takada, Makiko",
    }
    assert alias_lookup("Makiko Takada") == alias_lookup("MAMKO TAKADA")
    assert alias_lookup("PINK PINCLES")["name"] == "ピンク・ピクルス"
    assert alias_lookup("Pink Pickles")["name"] == "ピンク・ピクルス"
    assert alias_lookup("KEIKO GOTO")["name"] == "後藤啓子"
    assert alias_lookup("YUKI KURODA")["name"] == "黒田有紀"
    assert alias_lookup("TOSHITARO")["name"] == "稗島寿太郎"
    assert alias_lookup("TOSHIO KUROSAWA & KAZUKO KANO")["name"] == (
        "黒沢年男 & 叶和貴子"
    )


def test_non_japanese_original_names_are_preserved_without_network():
    for name in ("ADARAPTA", "BC LEMMON", "CoCo", "EVE", "SPICA",
                 "W-NAO", "ZONE TIME"):
        assert alias_lookup(name) is None
    assert alias_lookup("hidemi ishikawa") == {
        "name": "石川秀美", "sort": "Ishikawa, Hidemi",
    }


def test_lookup_is_case_and_order_insensitive():
    a = alias_lookup("GOTO KUMIKO")
    b = alias_lookup("Kumiko Goto")
    assert a and b and a["name"] == b["name"] == "後藤久美子"


def test_lookup_strips_accents():
    assert alias_lookup("MÁRCIA")["name"] == "マルシア"


def test_norm_key_folds_x_sign():
    assert norm_alias_key("EAST END × YURI") == "east end x yuri"


def test_unknown_name_returns_miss_sentinel():
    assert alias_lookup("Totally Unknown Artist 42") is _ALIAS_MISS


def test_resolve_prefers_alias_and_skips_resolver(tmp_path: Path):
    calls = []
    def resolver(name):
        calls.append(name)
        return None
    cache = ArtistCache(tmp_path / "cache.json")
    entry = resolve_original("Miki Matsubara", cache, resolver)
    assert entry["name"] == "松原みき"
    assert calls == []            # An alias hit must never access the network.


def test_explicit_null_keeps_latin_without_network(tmp_path: Path):
    calls = []
    def resolver(name):
        calls.append(name)
        return {"name": "偽物", "sort": "x"}
    cache = ArtistCache(tmp_path / "cache.json")
    # Explicit null for ZARD means its official name is Latin.
    assert resolve_original("ZARD", cache, resolver) is None
    assert calls == []            # Do not query MusicBrainz or write the cache.


def test_miss_falls_through_to_resolver(tmp_path: Path):
    def resolver(name):
        return {"name": "架空アーティスト", "sort": "Kakuu, Artist"}
    cache = ArtistCache(tmp_path / "cache.json")
    entry = resolve_original("Totally Unknown Artist 42", cache, resolver)
    assert entry["name"] == "架空アーティスト"
