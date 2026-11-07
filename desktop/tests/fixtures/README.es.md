# Archivo de regresión de búsqueda de audio

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

`seek-stereo.flac` es audio sintético creado para pruebas automáticas de regresión. No contiene grabaciones de usuarios ni música comercial: los canales izquierdo y derecho son ondas sinusoidales independientes de 317 Hz y 701 Hz, con amplitud del 25 %, 48 kHz, 16 bits y duración de 4,25 segundos.

Regenera el archivo con FFmpeg desde la raíz del repositorio:

```powershell
ffmpeg -f lavfi -i 'aevalsrc=0.25*sin(2*PI*317*t)|0.25*sin(2*PI*701*t):s=48000:d=4.25' -sample_fmt s16 -c:a flac -map_metadata -1 -y desktop/tests/fixtures/seek-stereo.flac
```

El archivo no contiene deliberadamente un bloque de metadatos FLAC `SEEKTABLE`. La prueba verifica esa condición, compara avances, retrocesos y búsquedas a fracciones de segundo con una decodificación secuencial completa y comprueba el último fotograma de audio. Las señales diferentes de cada canal también detectan desalineaciones accidentales del audio entrelazado.

Consulta la [guía de escritorio](../../README.es.md) para los comandos de prueba y la herramienta de búsqueda con salida de audio real. Regenerar el archivo por sí solo no verifica que las pruebas de regresión hayan pasado.
