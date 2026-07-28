# Arquitectura y modelo runtime

[English](cloud.md) · [简体中文](cloud.zh.md) · [繁體中文](cloud.zh-Hant.md) · [日本語](cloud.ja.md) · [한국어](cloud.ko.md) · [Français](cloud.fr.md) · [Español](cloud.es.md)

Mihonban utiliza la misma interfaz React y la misma API compatible con Worker en los despliegues locales y en la nube. Solo cambian los adaptadores de persistencia y acceso a archivos según el entorno de ejecución.

## Componentes

| Componente | Node | Wrangler local | Cloudflare | Naturaleza de los datos |
|---|---:|---:|---:|---|
| Recursos React | Sí | Sí | Sí | Reconstruibles |
| Hono API | Sí | Sí | Sí | Capa de aplicación sin estado |
| Base de datos del catálogo | SQLite | D1 local | D1 remota | Metadatos autoritativos |
| Límite de velocidad/caché KV | Adaptador SQLite | KV local | Cloudflare KV | Reconstruible |
| Espejo de imágenes R2 | Opcional | Enlace opcional | Opcional | Caché de imágenes reconstruible |
| Backend de carpeta local | Sí | No | No | Archivos originales cuando está configurado |
| OneDrive/WebDAV/Google Drive | Sí | Sí | Sí | Archivos originales |
| Compañero Python | Proceso externo | Proceso externo | Proceso externo | Flujo de trabajo local opcional |

Los archivos de audio nunca pertenecen a D1, KV, R2 caché de imágenes o Git.

## Ruta de solicitud

```text
Browser --HTTP/HTTPS--> API runtime
                         |-- catalog metadata: SQLite or D1
                         |-- short cache/rate limit: KV adapter
                         |-- image mirror: optional R2
                         +-- named storage backend

OneDrive temporary URL ---------> usually 302 direct playback
WebDAV / Google Drive ----------> main API Range proxy
Node local folder --------------> Node Range stream
Optional external proxy --------> signed five-minute relay for temporary URLs
```

El proxy externo solo recibe fuentes para las que la API principal puede obtener una URL temporal. Nunca recibe credenciales de WebDAV, Google Drive o de carpeta local.

## Autenticación y roles

- Contraseña del oyente (`APP_PASSWORD` bootstrap): navegar y reproducir.
- Contraseña de administrador (`ADMIN_PASSWORD` bootstrap): todas las escrituras y configuraciones de infraestructura.
- Modo invitado sin contraseña: un interruptor explícito de Admin que otorga al oyente el rol sin contraseña.
- Clave de compañero (`COMPANION_KEY`): opcional `X-Api-Key` usada por el compañero Python local.

Las contraseñas cambiadas en Admin se almacenan como hashes PBKDF2 y tienen prioridad sobre los valores del entorno bootstrap. Cambiar una contraseña incrementa la época de la sesión y revoca las cookies de inicio de sesión existentes. Los fallos de inicio de sesión se cuentan por IP de origen; seis fallos bloquean esa fuente durante 15 minutos.

Las cookies de producción requieren HTTPS. `DEV_INSECURE_COOKIE=1` existe solo para pruebas HTTP locales confiables.

## Modelo de datos

- `albums`: metadatos del álbum, `storage_id` nombrados, estados ocultos y campos de orden.
- `tracks`: metadatos de las pistas y ruta relativa al almacenamiento; las pistas heredan el backend del álbum.
- `artists`: metadatos del artista, estado oculto, ruta de avatar y avatar independiente `storage_id`.
- `album_images`: rutas de galería en el backend del álbum y una identidad de origen estable opcional para que las importaciones externas sean idempotentes.
- `favorites`: favoritos de álbumes/temas y orden.
- `notes`: notas del álbum, notas del artista y biografías.
- `storages`: configuraciones denominadas OneDrive, WebDAV, Google Drive o Node-locales.
- `settings`: hashes de contraseñas, flags de módulo, configuración de R2, configuración de código fuente y otros estados runtime.
- Tablas de `source_posts`, `track_imports` y caché de imágenes: metadatos operativos.

El JSON de configuración de administrador exporta un subconjunto de configuraciones permitidas más configuraciones de almacenamiento nombradas, incluyendo credenciales. Excluye filas de catálogo, hashes de contraseñas y sesiones antiguas. Guárdalo cifrado.

## Subir y reproducir

- Se selecciona un único backend con nombre como destino de escritura para nuevas subidas.
- Los álbumes existentes conservan su propia `storage_id`; cambiar el objetivo de composición no los mueve.
- OneDrive utiliza una sesión de subida y URLs de descarga temporales.
- WebDAV y Google Drive subidas/streams pasan por la API principal.
- Node archivos de carpeta local son transmitidos solo por la Node runtime.
- El comportamiento de Range y `Content-Range` son necesarios para una búsqueda fiable, especialmente en iOS.

## Imágenes

Sin R2, la API lee las imágenes desde el almacenamiento que las posee y aplica cabeceras de caché para el edge y el navegador. Cuando R2 está habilitado, la primera solicitud o el precalentamiento copia la imagen al espejo; las solicitudes posteriores pueden redirigirse a su URL pública. Sustituir una imagen invalida su índice para permitir que vuelva a reflejarse. Si se perdió el índice de D1 pero aún existe el mismo objeto público en R2, el precalentamiento lo registra de nuevo mediante un número limitado de solicitudes HEAD, sin volver a descargar ni subir los datos de la imagen.

Las redirecciones de imágenes públicas de R2 se almacenan en la caché del navegador y del edge de Cloudflare durante cinco minutos, con `stale-while-revalidate`. El destino es una URL R2 versionada e inmutable, así que al actualizar la biblioteca no se invoca al Worker para cada portada; los cambios de portada se aplican después de esa ventana. Las redirecciones de imágenes ocultas y de audio siguen siendo privadas y no se almacenan en caché.

Las portadas de álbum leen directamente el archivo de origen almacenado. Es importante para las portadas recortadas manualmente o desde Discogs: las miniaturas del proveedor `c480x480` y `c1000x1000` pueden elegir encuadres distintos y volver a recortar una imagen vertical. Todas las vistas de portada comparten por eso el espejo `art:<album-id>:original`; el navegador reduce esa misma composición cuadrada sin pedir otro recorte al proveedor.

Si una redirección al espejo público termina en un objeto ausente u obsoleto, la aplicación web vuelve a intentarlo desde el almacenamiento propietario. El Worker valida los bytes de la imagen, recurre del thumbnail del proveedor al archivo original cuando es necesario y, tras recuperarlo, repara el objeto R2 y su índice D1 versionado. Así, un 404 antiguo almacenado en caché se repara automáticamente sin exponer al navegador las credenciales del almacenamiento privado.

R2 no es un backend de audio ni la base de datos del catálogo.

## Tareas programadas

Cloudflare utiliza el disparador Wrangler Cron en el minuto 17 cada seis horas. Node usa `SOURCE_SCAN_HOURS` (`6` por defecto, `0` lo desactiva). El escaneo de código fuente lee títulos y enlaces compatibles con RSS/Atom/Blogger; no descarga música.

`mihonban watch` es diferente: vigila una bandeja de entrada local real e invoca 7-Zip/beets. Debe ejecutarse en un ordenador o NAS que pueda acceder a ese directorio y no pueda ejecutarse dentro de Cloudflare Workers.

## Capas de copia de seguridad y recuperación

1. Catálogo: copia compatible con SQLite o exportación SQL lógica de D1.
2. Configuración: Configuración de administrador JSON, cifrado en reposo.
3. Secretos de ejecución: gestor de contraseñas o almacén de secretos del despliegue.
4. Audio e imágenes originales: copia de seguridad independiente a nivel de almacenamiento.
5. KV: se reconstruye. El índice de imágenes R2 solo se migra si se conserva el mismo bucket; de lo contrario, se recuperan los objetos públicos existentes o se reconstruye mediante precalentamiento.

Consulta [Copia de seguridad de la base de datos, migración y recuperación](database-migration.es.md) para el pedido completo.

## Límites del alojamiento

El plan gratuito de Cloudflare puede adaptarse a una biblioteca personal o a unos pocos oyentes, pero las cuotas y términos cambian. Las solicitudes de API, filas de D1, operaciones de KV, R2 y audio proxy consumen recursos de la plataforma. OneDrive URLs temporales suelen saltarse la Worker; WebDAV, Google Drive, los flujos locales de Node y las rutas proxy habilitadas no lo hacen.

Workers no puede acceder a las carpetas de un ordenador doméstico, permanecer residente para eventos del sistema de archivos, transcodificar audio, ejecutar Beets ni extraer archivos. Mantén esos trabajos en el complemento opcional.

## Diagnósticos

Cloudflare:

```bash
cd cloud/worker
npx wrangler tail
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc \
  --command "SELECT COUNT(*) AS albums FROM albums"
```

Wrangler local usa el mismo comando con `--local`. En Node, comprueba `DATA_DIR`, el registro de inicio y el estado del sistema en Administración. Nunca escribas en los registros tokens de actualización, URL de audio firmadas, exportaciones de ajustes ni las cabeceras de autorización de las solicitudes.
