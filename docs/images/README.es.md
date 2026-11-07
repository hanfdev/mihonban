# Capturas para la documentación

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

Son capturas de las interfaces reales de Mihonban con álbumes, artistas, puntuaciones y notas ficticios. Web y Android usan portadas geométricas originales; iOS utiliza las imágenes de disco de sustitución integradas. No contienen colecciones privadas ni portadas comerciales. Las capturas Web, Android nativo e iOS nativo muestran clientes distintos y no son maquetas de diseño.

## Inventario de imágenes

| Imagen | Interfaz | Fecha de captura | Versión de origen |
|---|---|---|---|
| [web-library.webp](web-library.webp) | Biblioteca Web, inglés | 2026-11-08 | Código Web `351ba8e` |
| [web-library-zh.webp](web-library-zh.webp) | Biblioteca Web, chino simplificado | 2026-11-08 | Código Web `351ba8e` |
| [web-album.webp](web-album.webp) | Detalles de álbum Web, inglés | 2026-11-08 | Código Web `351ba8e` |
| [android-library.webp](android-library.webp) | Biblioteca nativa Android | 2026-11-05 | Android 0.1.10 |
| [android-player.webp](android-player.webp) | Reproductor nativo Android | 2026-11-05 | Android 0.1.8 |
| [ios-library.webp](ios-library.webp) | Biblioteca nativa iPhone | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-album.webp](ios-album.webp) | Detalles de álbum nativos iPhone | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-player.webp](ios-player.webp) | Reproductor nativo iPhone | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-ipad-album.webp](ios-ipad-album.webp) | Detalles de álbum nativos iPad, horizontal | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |

Las imágenes Web conservan sus dimensiones de captura, 1280 × 720. Las capturas Android e iPhone se redujeron proporcionalmente para caber en 800 × 1440; la de iPad se redujo a 1600 × 1200 después de aplicar su orientación EXIF. Todas usan compresión WebP (calidad 88), sin recortar ni reorganizar elementos de la interfaz. Las capturas originales a resolución completa y los demás artefactos de prueba permanecen fuera del control de versiones.

## Reproducir la demostración Web

Desde la raíz del repositorio, con Node.js 20 o posterior:

```bash
npm --prefix cloud/web ci
npm --prefix cloud/web run build
node tools/docs-demo.mjs --check
node tools/docs-demo.mjs
```

Abre <http://127.0.0.1:8767> para la biblioteca o <http://127.0.0.1:8767/#/album/midnight-sessions> para el álbum destacado. Selecciona English o 简体中文 en el menú de idioma. Las capturas usan el tema oscuro y la ordenación predeterminada por puntuación. Detén el servidor con `Ctrl+C`. Define `MIHONBAN_DEMO_PORT` si el puerto predeterminado está ocupado.

[`tools/docs-demo.mjs`](../../tools/docs-demo.mjs) sirve la aplicación React compilada actualmente con 18 álbumes ficticios, 144 pistas y seis artistas. Solo escucha en la interfaz de bucle local, acepta únicamente solicitudes de lectura y no accede a bases de datos, credenciales, proveedores de almacenamiento ni servicios de producción. La reproducción usa audio WAV silencioso generado con soporte Range. La demostración sirve localmente las fuentes Inter y Shippori Mincho del repositorio en lugar de solicitar Google Fonts; los componentes y estilos de diseño de la aplicación no cambian.

Para renovar las imágenes, captura las páginas correspondientes de la compilación actual, inspecciónalas, conviértelas a WebP y actualiza las fechas y la versión de origen de la tabla. Al reutilizarlas, indica claramente que los nombres de álbumes y las puntuaciones son ficticios.

## Origen de Android

Los ejemplos Android proceden de los datos de prueba de la interfaz nativa en [`NativeUiTest.kt`](../../android/app/src/androidTest/java/org/mihonban/android/NativeUiTest.kt), que proporcionan un catálogo ficticio y dibujan sus propias portadas con Android Canvas. Los originales locales seleccionados son `android/build/screenshots/0110-08-library-overview.png` y `android/build/screenshots/018-player-tall.png`. Son capturas representativas de las versiones indicadas, no una afirmación de que todos los clientes o pantallas actuales se hayan vuelto a capturar a la vez.

Consulta la [guía de desarrollo Android](../../android/README.es.md) para las instrucciones de compilación y pruebas instrumentadas. Solo se versionan las imágenes documentales comprimidas seleccionadas en este directorio; las ejecuciones completas permanecen en el directorio de compilación Android ignorado.

## Origen de iOS

Las imágenes iOS nativas proceden de la [ejecución correcta de iOS preview #72](https://github.com/hanfdev/mihonban/actions/runs/42380336181), con el commit [`5e667fb`](https://github.com/hanfdev/mihonban/commit/5e667fbacfb99ab3020ae8869f4534ed7f917dc4). Las capturaron pruebas UI de Xcode el 2026-11-07 en los simuladores **iPhone 17** y **iPad Pro 13-inch (M5)**, con la interfaz en inglés y apariencia oscura. Son capturas de simulador, no fotografías de dispositivos físicos. Muestran el catálogo ficticio de [`DemoLibrary.swift`](../../ios/Sources/DemoLibrary.swift) y el disco de sustitución integrado de [`Theme.swift`](../../ios/Sources/UI/Theme.swift).

| Imagen documental | Nombre del adjunto | Prueba en `MihonbanUITests` |
|---|---|---|
| `ios-library.webp` | `01-library` | `testBrowsePlayPauseAndQueue` |
| `ios-album.webp` | `02-album` | `testBrowsePlayPauseAndQueue` |
| `ios-player.webp` | `03-now-playing` | `testBrowsePlayPauseAndQueue` |
| `ios-ipad-album.webp` | `48-album-balanced-landscape` | `testTabletAlbumHeaderBalancesArtworkAndInformation` |

El archivo descargado `iOS-screenshots-72` se verificó con el resumen SHA-256 publicado en la ejecución de GitHub: `34f1bb830c6453fe2074c77744ff23a34461b0fb32fb57688636e2542fae8457`. Los manifiestos de adjuntos registran cada prueba, dispositivo, marca de tiempo y nombre original; los adjuntos de iPad están en `ipad/`. Ninguno de los adjuntos seleccionados está asociado a un fallo de prueba.

Para actualizar las imágenes, sigue la [guía de desarrollo iOS](../../ios/README.es.md) en macOS, ejecuta las pruebas correspondientes de [`MihonbanUITests.swift`](../../ios/UITests/MihonbanUITests.swift) y exporta los adjuntos del paquete de resultados con `xcrun xcresulttool export attachments`. El [workflow iOS](../../.github/workflows/mobile.yml) ya realiza esta exportación y publica el artefacto `iOS-screenshots-<run_number>`. Elige los adjuntos indicados arriba, aplica la orientación registrada, redimensiona proporcionalmente y actualiza la tabla de capturas/versiones. Los artefactos CI caducan tras su retención; los WebP seleccionados permanecen en el repositorio.

[Volver a la documentación del proyecto](../../README.es.md)
