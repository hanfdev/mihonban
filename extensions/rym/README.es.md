# Herramienta RYM de Mihonban para el navegador

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

Extensión opcional Chrome/Edge Manifest V3 que envía metadatos de ediciones RYM a una biblioteca Mihonban existente. La versión 1.1.0 también ofrece una cola iniciada por el usuario que actualiza puntuaciones y cantidades de votos de álbumes con un enlace de origen existente.

## Compilación e instalación

Desde la raíz del repositorio, instala las dependencias Web y compila:

```sh
npm --prefix cloud/web ci
npm --prefix cloud/web run build
```

La compilación copia la extensión y el analizador compartido a `cloud/web/dist/rym-browser-tool/` y crea `cloud/web/dist/rym-browser-tool.zip`. En Extensiones de Chrome/Edge, usa Cargar descomprimida (**Load unpacked**) con la carpeta generada que contiene `manifest.json`. El directorio fuente por sí solo está incompleto: la compilación aporta `rym-capture.js` y `batch-reader.js`. Tras reemplazar una copia instalada, pulsa Recargar (**Reload**) en Extensiones.

En un servidor desplegado, **Admin → RYM updates → Batch update ratings** ofrece el mismo ZIP. Consulta el [manual](../../docs/manual.es.md#rym-metadatos) para instalación, asociación de fuentes y revisión de clasificaciones.

## Modos de uso

- **Enviar la página actual:** actualiza una página de edición RYM, abre la extensión, configura la dirección Mihonban y envía. Confirma los álbumes coincidentes en Mihonban. Las clasificaciones llegan como sugerencias que debes adoptar explícitamente.
- **Actualizar puntuaciones por lotes:** abre Mihonban como administrador, inicia la extensión desde esa pestaña, selecciona álbumes vinculados y arranca la cola. Solo actualiza nota y cantidad de votos, comparte una observación entre ediciones con la misma fuente y conserva clasificaciones mantenidas y posiciones.

Mantén abiertas las pestañas de biblioteca y cola. Las navegaciones están separadas al menos 30 segundos. Una verificación o limitación pausa la cola: completa la verificación en la pestaña de origen y reanuda explícitamente. La limitación impone al menos cinco minutos de espera. Admite pausa/reanudación y reintentos, pero no ejecuta un servicio programado en segundo plano ni evita verificaciones del sitio.

La extensión solicita acceso opcional a RYM al iniciar el modo por lotes. Usa la sesión existente de administrador a través de la pestaña abierta de biblioteca y no guarda contraseñas, cookies ni HTML completo. Dirección de biblioteca, progreso y puntuaciones capturadas se guardan en el dispositivo; elegir otro lote reemplaza el trabajo anterior.

## Comprobaciones

```sh
node --test cloud/web/test/rym-capture.test.js cloud/web/test/rym-batch.test.js
```

Las pruebas Worker de `cloud/worker/test/rym-updates.test.js` cubren asociación de fuentes, ediciones concurrentes, vigencia de observaciones, clasificaciones mantenidas y endpoint exclusivo de puntuaciones.
