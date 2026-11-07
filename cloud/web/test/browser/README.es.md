# Pruebas de regresión de listas en el navegador

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

Este banco de pruebas monta las vistas de listas React reales y compara el código actual con la revisión Git `95eed448dd80ca49de0de2703d1db1f7e78e8e94`, inmediatamente anterior al cambio de memoización de listas. Comprueba los resultados de ordenación y filtrado, los callbacks de reproducción, la reorganización de favoritos, el trabajo de las consultas y el número de renderizados de las filas de canciones. La ordenación por incorporación reciente ha cambiado de forma intencionada desde esa revisión, por lo que otros casos verifican las vistas actuales Library, Artists e Import: fecha de incorporación original, cambios de puntuación o título, orden tras actualizar, nuevas importaciones, fechas iguales, fechas desconocidas y álbumes ocultos.

Desde la raíz del repositorio, instala las dependencias Web y construye el banco de pruebas:

```sh
npm --prefix cloud/web ci
node cloud/web/tools/build-performance-browser.mjs
python -m http.server 8766 --bind 127.0.0.1 --directory backups/web-perf-browser
```

Abre `http://127.0.0.1:8766` en un navegador de escritorio con un área de visualización visible y pulsa **Run all tests**. La página muestra cada caso y el recuento final de éxitos y fallos. Para automatizar el navegador, llama a `await window.runPerformanceTests()` y lee `window.performanceTestResults`. Las pruebas de reorganización con el puntero usan la detección de elementos dentro del área visible, por lo que no admiten un viewport de tamaño cero.

La construcción lee los archivos de referencia directamente desde Git y no necesita un directorio privado `backups/web-perf-baseline`. Utiliza un clon cuyo historial incluya la revisión fijada. Un clon completo la incluye; un ZIP del código fuente por sí solo no. En un clon superficial, obtén la revisión antes de construir, o descarga todo el historial con `git fetch --unshallow`:

```sh
git fetch origin 95eed448dd80ca49de0de2703d1db1f7e78e8e94
```

Los archivos generados se guardan en el directorio ignorado `backups/web-perf-browser`. Su `manifest.json` registra la revisión de referencia y los hashes del código. Las respuestas API y las portadas usan datos locales de prueba, y la página bloquea las conexiones externas. Nunca escribe en una biblioteca real. Estas comprobaciones son independientes de `npm test`; una construcción correcta no demuestra por sí sola que los casos del navegador hayan pasado.
