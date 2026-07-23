# Guía de uso diario

[English](manual.md) · [简体中文](manual.zh.md) · [繁體中文](manual.zh-Hant.md) · [日本語](manual.ja.md) · [한국어](manual.ko.md) · [Français](manual.fr.md) · [Español](manual.es.md)

Esta guía es para administradores de bibliotecas. Las rutas y URLs dependen del runtime seleccionado y de tu configuración privada.

## Puntos de entrada

| Punto de entrada | Propósito |
|---|---|
| Aplicación web | Navegar, reproducir, buscar, marcar favoritos, importar y administrar |
| Bandeja de entrada local | Carpetas opcionales o archivos RAR/ZIP/7z procesados por el Python compañero |
| `mihonban` CLI | Diagnosticar, ingerir, vigilar, sincronizar, extraer y procesar RYM páginas guardadas |

El Python compañero ni ningún reproductor de escritorio son necesarios para la reproducción web.

## Identidades

- Contraseña del oyente: navegar y reproducir contenido autenticado.
- Contraseña de administrador: subir, editar, ocultar, eliminar, marcar como favoritos, ordenar y configurar infraestructura.
- Modo invitado sin contraseña: acceso opcional de solo lectura sin introducir contraseña.
- Clave complementaria: credencial de máquina para la tubería local opcional.

`mihonban-guest` y `mihonban-admin` son valores predeterminados generados solo por `tools\cloud-dev.cmd`. Node y los despliegues manuales de Cloudflare no tienen contraseñas predeterminadas. Cambia los valores predeterminados del asistente local antes de compartir acceso.

Las contraseñas guardadas en Admin anulan los valores de arranque del entorno de Bootstrap. Cambiar cualquiera de las contraseñas revoca las sesiones existentes.

## Reproducción e interacción móvil

- El volumen, el idioma y la ordenación se guardan por origin del navegador. Un nombre de host o dominio personalizado nuevo empieza con preferencias nuevas; si no hay volumen guardado, comienza al 85 %.
- La reproducción comienza dentro del toque/clic original para que Android Chrome pueda establecer audio y una sesión multimedia del sistema. En navegadores compatibles, la pantalla de bloqueo/notificación permite reproducir, pausar, cambiar de pista y buscar.
- En móvil, toca la portada o el espacio vacío del minirreproductor, o deslízalo hacia arriba, para abrir la pantalla de reproducción. Los enlaces del álbum y del artista siguen siendo independientes.
- Al cambiar una imagen del libreto se muestra un estado de carga; desliza horizontalmente para ver la imagen anterior o siguiente.

## Carpetas y archivos de la bandeja de entrada

1. Coloca una carpeta de álbumes o un archivo autorizado para usar en la `inbox` configurada.
2. Ejecutar `mihonban watch`, o procesar una vez con `mihonban ingest --apply`.
3. Revisar registros e informes de cuarentena; los fallos graves nunca se descartan silenciosamente.
4. Cuando se configure la sincronización en la nube, ejecuta `mihonban cloud sync`.

La tubería soporta carpetas directas, un archivo y archivos anidados. Espera tres encuestas sin cambios antes de procesar, por lo que no se abren archivos parcialmente copiados. El trabajo se realiza en un área temporal privada. Los elementos fuente exitosos se trasladan a `_done`; fallos graves y su informe se trasladan a `_quarantine`.

La tubería extrae, repara la codificación japonesa de nombres de archivo, ejecuta la organización de metadatos/etiquetas, normaliza la disposición de la biblioteca y puede registrar el resultado con la API. Los metadatos ambiguos permanecen disponibles para revisión manual.

## Escaneo de fuentes cloud y vigilancia local

El módulo fuente de Administrador lee los títulos y enlaces compatibles con RSS/Atom/Blogger. Cloudflare Cron o el intervalo de Node pueden ejecutarlo mientras el ordenador doméstico está apagado. No descarga ni descomprime música.

`mihonban watch` requiere acceso a la `inbox` local, archivos persistentes, 7-Zip y Beets. Ejecuta en Windows, macOS, Linux o un NAS; no puede ejecutarse dentro de Cloudflare Workers.

## Importación web

1. Iniciar sesión como administrador y abrir Importación.
2. Seleccionar pistas pertenecientes a un álbum y reseñar al artista, título, año, nombres de archivo y orden.
3. Elegir/recortar una cubierta y seleccionar el almacenamiento objetivo de escritura previsto.
4. Comienza la subida y espera a que terminen todas las pistas antes de salir de la página.
5. Abre el álbum terminado, pon una pista y busca cerca del final.

Usa `mihonban cloud pull` cuando la copia web deba regresar a la biblioteca local. Añade `--retag` solo cuando los metadatos en la nube deban actualizar las etiquetas locales existentes.

## RYM metadatos

Mihonban no automatiza las solicitudes a Rate Your Music. Guarda manualmente una página de lanzamiento en el navegador, importa el HTML guardado en la página del álbum y valora las críticas, el recuento de votos, géneros primarios/secundarios y descriptores antes de guardar. La CLI puede analizar, emparejar y escribir manualmente las páginas guardadas en bloque.

## Discogs

Los administradores pueden buscar lanzamientos o artistas y previsualizar la importación de imágenes, géneros/estilos y texto biográfico. Configura un token de Discogs personal en Admin. La integración utiliza la API oficial.

## Favoritos y contenido oculto

- Los administradores pueden añadir álbumes o pistas como favoritas y arrastrarlas para reordenarlas.
- Los oyentes pueden ver las páginas de favoritos seleccionados pero no pueden editarlas.
- Los álbumes, temas, artistas, estilos ocultos que solo existen en contenido oculto, imágenes, búsquedas y entradas favoritas se excluyen de las respuestas de los oyentes.
- “Mostrar ocultos” es un estado de vista exclusivo para administradores y compartido por las listas de álbumes, pistas y artistas.
- El contador de álbumes de la cabecera sigue ese mismo estado: solo incluye los álbumes ocultos cuando la opción está activada.
- En la galería de álbumes, cambiar de imagen borra inmediatamente la imagen anterior y muestra un indicador de carga hasta que la imagen seleccionada esté lista; una solicitud fallida muestra un estado de error explícito.

Después de cambiar el estado oculto, verifica con una sesión de escucha separada en lugar de depender solo de la interfaz de administrador.

## Almacenamiento con nombre

- El destino de escritura afecta solo a futuras subidas.
- Los álbumes existentes siguen leyendo desde el almacenamiento indicado por su propio `storage_id`.
- La migración copia los objetos necesarios y solo cambia las vinculaciones cuando todas las copias imprescindibles se han completado correctamente.
- Los objetos fuente no se eliminan automáticamente.
- Tras un traslado masivo, prueba la reproducción, búsqueda, portadas, avatares y galerías antes de archivar copias antiguas.

Véase [Backends de almacenamiento y migración de archivos](storage.es.md).

## Pantalla de administración

- Estado del sistema: totales de álbum/pista/almacenamiento y latido del corazón acompañante.
- Contraseñas y acceso de invitados.
- Configuración de copia de seguridad y restauración: configuración sensible, no filas de catálogo.
- Backends de almacenamiento con nombre y destino de escritura.
- R2 imagen espejo y precalentamiento.
- Discogs ficha.
- Módulos opcionales de escaneo de fuente y proxy de audio.

El JSON de configuración contiene credenciales. Guárdalo en una bóveda cifrada y nunca lo adjuntes a issues, chat, correo electrónico o Git.

## Rutina de copias de seguridad

| Cuando | Acción |
|---|---|
| Tras una importación importante | Haz una copia de seguridad Node SQLite o exporta D1 SQL; confirma que existe una segunda copia de audio |
| Después de cambios en almacenamiento/R2/módulo | Exportar un nuevo JSON de configuración de administrador |
| Antes de una actualización de aplicación | Base de datos + ajustes JSON + identificador actual de commit/despliegue |
| Periódicamente | Realizar una prueba de restauración en lugar de comprobar solo que existen archivos |

Consulta [Copia de seguridad de la base de datos, migración y recuperación](database-migration.es.md).

## Comandos habituales

```text
mihonban doctor
mihonban ingest --apply
mihonban watch
mihonban cloud sync
mihonban cloud pull
mihonban cloud pull --retag
mihonban rym parse
mihonban rym match
mihonban rym write --apply

cd cloud/worker && npm test
cd cloud/web && npm test && npm run build
```

## Solución de problemas

| Síntoma | Acción |
|---|---|
| La bandeja de entrada no hace nada | Confirma que el elemento está soportado y completamente copiado, que solo se ejecuta un vigilante, e inspecciona `data_dir/logs` |
| El elemento está en cuarentena | Lee su informe; comprueba corrupción, contraseña de archivo, archivos no soportados y confianza de coincidencia |
| La aplicación web no tiene álbumes antiguos | Restaurar la base de datos del catálogo; Configuración de administrador JSON no contiene álbumes |
| La reproducción regresa 502 | Prueba el almacenamiento con nombre del álbum y confirma que ningún archivo se ha movido fuera de Mihonban |
| El progreso avanza pero no se oye sonido | Comprueba el volumen del reproductor, la pestaña y la salida del sistema; fuerza la recarga después de actualizar. Un origin nuevo empieza al 85 % |
| Fallar la búsqueda o la duración de iOS es incorrecta | Verifica que los retornos de ascendencia/proxy sean correctos 206, `Content-Range` y longitud total |
| Las imágenes son lentas o Graph está limitado | Prueba y activa R2, luego precalenta |
| La portada aparece en la lista pero falla en la página de detalle | Fuerza una recarga. La versión actual vuelve al almacenamiento propietario y repara el espejo R2 ausente; si continúa, prueba ese almacenamiento y R2 |
| Google Drive no pueden encontrar archivos existentes | Reautorizar el alcance actual de la unidad y verificar el ID raíz |
| La subida web no está disponible localmente | Ejecuta `mihonban cloud pull` y verifica el remoto RCLONE configurado |
| El inicio de sesión devuelve 429 | Deja de intentarlo de nuevo y espera 15 minutos |
| El inicio de sesión local HTTP no persiste | Establecer `DEV_INSECURE_COOKIE=1`; nunca usarlo en HTTPS público |
