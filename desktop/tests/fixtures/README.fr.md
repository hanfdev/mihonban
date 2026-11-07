# Fichier de régression du déplacement audio

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

`seek-stereo.flac` est un son synthétique créé pour les tests automatisés de régression. Il ne contient aucun enregistrement personnel ni musique commerciale : les canaux gauche et droit sont des sinusoïdes distinctes de 317 Hz et 701 Hz, à 25 % d’amplitude, 48 kHz, 16 bits, sur 4,25 secondes.

Pour le régénérer avec FFmpeg depuis la racine du dépôt :

```powershell
ffmpeg -f lavfi -i 'aevalsrc=0.25*sin(2*PI*317*t)|0.25*sin(2*PI*701*t):s=48000:d=4.25' -sample_fmt s16 -c:a flac -map_metadata -1 -y desktop/tests/fixtures/seek-stereo.flac
```

Le fichier est volontairement dépourvu de bloc de métadonnées FLAC `SEEKTABLE`. Le test vérifie cette condition, compare les déplacements avant/arrière et à des fractions de seconde avec un décodage séquentiel complet, puis contrôle la dernière trame audio. Les canaux distincts révèlent également un éventuel décalage dans leur entrelacement.

Le [guide de bureau](../../README.fr.md) présente les commandes de test et la sonde de déplacement avec sortie audio réelle. Régénérer le fichier seul ne confirme pas la réussite des tests de régression.
