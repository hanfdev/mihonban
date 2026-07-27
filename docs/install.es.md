# Instalar y desplegar

[English](install.md) · [简体中文](install.zh.md) · [繁體中文](install.zh-Hant.md) · [日本語](install.ja.md) · [한국어](install.ko.md) · [Français](install.fr.md) · [Español](install.es.md)

Esta guía cubre los tres runtimes compatibles y el Python local opcional de acompañante. Elige una aplicación runtime; el compañero es una herramienta adicional de flujo de trabajo, no un requisito del servidor.

## 1. Requisitos previos

- Node.js 22 o más recientes
- Git
- Cloudflare cuenta solo al desplegar en Cloudflare
- OneDrive, WebDAV o Google Drive para un despliegue Cloudflare
- Python 3.11 o más reciente y 7-Zip (`7z`, `7zz` o `7za`) solo para el compañero local
- `rclone` opcional para sincronización de archivos local a nube impulsada por compañeros

No coloques bases de datos SQLite en vivo, `music_root`, `data_dir`, directorios temporales ni `node_modules` en OneDrive, Dropbox, iCloud u otra carpeta sincronizada. El propio repositorio puede sincronizarse si los datos de compilación y mutables se almacenan en otro lugar.

Clona el repositorio canónico:

```bash
git clone https://github.com/hanfdev/mihonban.git
cd mihonban
```

## 2. Elegir un runtime

| Runtime | URL predeterminada | Base de datos | Almacenamiento en carpetas locales |
|---|---|---|---:|
| Wrangler local | `http://127.0.0.1:8787` | Emulador local de D1/KV | No |
| Node | `http://127.0.0.1:8788` | `<DATA_DIR>/mihonban.sqlite` | Sí |
| Cloudflare | Worker URL/dominio personalizado | D1 remoto + KV | No |

Wrangler local se asemeja más a Cloudflare de producción. Node es mejor para un servicio local/NAS permanente y es el único runtime que puede leer un backend de carpeta local en servidor.

## 3. Desarrollo Wrangler local

### Ayudante de Windows

Cuando el repositorio esté bajo OneDrive, utiliza:

```powershell
tools\cloud-dev.cmd
```

El ayudante copia `cloud/` a `%TEMP%\mihonban-cloud-build` por defecto, instala las dependencias allí, compila React, aplica el esquema local y comienza Wrangler en `127.0.0.1:8787` (loopback) por defecto. Establece `MIHONBAN_DEV_LAN=1` antes de ejecutarlo para exponerlo en `0.0.0.0:8787` y probar desde un teléfono en la red local. Establece `MIHONBAN_STAGE` a otro directorio no sincronizado para conservar su D1 local durante la limpieza temporal de directorios.

En la primera ejecución genera `.dev.vars` donde todos los valores, incluidas ambas contraseñas, son aleatorios:

```text
APP_PASSWORD=<aleatoria>
ADMIN_PASSWORD=<aleatoria>
```

Las contraseñas de oyente y de administrador pueden leerse en `%TEMP%\mihonban-cloud-build\worker\.dev.vars` (o `%MIHONBAN_STAGE%\worker\.dev.vars`). Cámbialas en Admin antes de permitir que otra persona se conecte.

### Configuración manual Wrangler

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
# Crea .dev.vars a partir de .env.example y sustituye todos los valores de ejemplo.
# Establece DEV_INSECURE_COOKIE=1 para HTTP local.
npx wrangler d1 execute DB --local --file schema.sql
npx wrangler dev --ip 0.0.0.0 --port 8787
```

Sin el ayudante de preparación, el estado local está bajo `cloud/worker/.wrangler/`. Tanto `.wrangler/` como `.dev.vars` son ignorados por Git.

Para probar el teléfono, conecta el teléfono a la misma LAN, permite Node.js pasar por el cortafuegos del host y abre `http://<computer-lan-ip>:8787`. No expongas este servidor de desarrollo en HTTP simple a Internet.

## 4. Node + SQLite en local

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
# Windows: Copy-Item .env.example .env
# POSIX:   cp .env.example .env
npm run node
```

Antes de empezar, edición `.env`:

```dotenv
APP_PASSWORD=choose-a-listener-password
ADMIN_PASSWORD=choose-a-separate-admin-password
SESSION_SECRET=at-least-32-random-characters
DEV_INSECURE_COOKIE=1
DATA_DIR=D:/mihonban-data
PORT=8788
```

No hay contraseñas Node integradas. `APP_PASSWORD` es la contraseña del oyente; el acceso de invitado sin contraseña es un interruptor de administrador separado. El servidor vincula `0.0.0.0`, así que `http://<computer-lan-ip>:8788` funciona en la LAN después de que el cortafuegos permite el puerto.

La base de datos es `<DATA_DIR>/mihonban.sqlite`; cuando `DATA_DIR` está desactivada, por defecto se configura a `cloud/worker/data/`. Haz una copia de seguridad mientras la app está detenida o con herramientas compatibles con SQLite. Los despliegues de Node pública requieren HTTPS detrás de una plataforma confiable o proxy inverso. Configura `TRUST_PROXY=1` solo cuando las solicitudes siempre pasen por un proxy que controles.

## 5. Compañero Python opcional

Salta esta sección cuando la subida o importación web sea suficiente. Instala el complemento para la visualización de la bandeja de entrada, carpetas o archivos únicos/anidados, reparación de etiquetas, organización local y conciliación local/cloud.

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
pip install -e ./pipeline
mihonban setup
mihonban doctor
```

`mihonban setup` escribe un TOML privado fuera del repositorio. `MIHONBAN_CONFIG` es la variable de anulación actual, no un alias heredado. El orden de búsqueda es explícito `--config`, `MIHONBAN_CONFIG`, `./mihonban.toml` y luego el directorio de configuración de usuario de la plataforma.

Comandos comunes:

```text
mihonban ingest --apply
mihonban watch
mihonban cloud sync
mihonban cloud pull
```

El compañero no puede ejecutarse dentro de Cloudflare Workers porque requiere un sistema de archivos local persistente y herramientas externas como 7-Zip y beets.

## 6. Despliegue en Cloudflare

El camino manual es canónico y no requiere el compañero.

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
npx wrangler login
npx wrangler d1 create mihonban
npx wrangler kv namespace create mihonban-kv --binding KV
```

Añade `--location apac` (u otra pista de ubicación compatible) a `d1 create` cuando
Necesitas una región primaria explícita. Copia la configuración pública a la ignorada
configuración de despliegue local, luego reemplazar sus ceros marcadores de posición por los que se devolvieron
D1 y KV identificaciones:

Si Wrangler ofrece actualizar la configuración actual mientras se crea cualquiera de los recursos,
respuesta **No**; los IDs reales pertenecen a la copia privada creada a continuación.

```bash
cp wrangler.jsonc wrangler.local.jsonc
```

PowerShell usa `Copy-Item wrangler.jsonc wrangler.local.jsonc`. Sé realista
IDs de cuenta y todos los secretos fuera del `wrangler.jsonc` público. Luego ejecuta:

```bash
npx wrangler d1 execute mihonban --remote --file schema.sql --config wrangler.local.jsonc
npx wrangler secret put APP_PASSWORD --config wrangler.local.jsonc
npx wrangler secret put ADMIN_PASSWORD --config wrangler.local.jsonc
npx wrangler secret put SESSION_SECRET --config wrangler.local.jsonc
npx wrangler deploy --config wrangler.local.jsonc
```

Cloudflare despliegue no tiene contraseña predeterminada de oyente ni de administrador. Introduce valores únicos y usa al menos 32 caracteres aleatorios para `SESSION_SECRET`. Añade `COMPANION_KEY` solo cuando un compañero local llame al despliegue:

```bash
npx wrangler secret put COMPANION_KEY --config wrangler.local.jsonc
npx wrangler deploy --config wrangler.local.jsonc
```

La misma Worker sirve a `/api/*` y a los activos React construidos. Un host frontend separado no es necesario.

### Asistente combinado opcional de Windows

`tools\deploy-cloud.cmd` proporciona recursos Cloudflare, solicita ambas contraseñas, sube secretos aleatorios de sesión/compañeros, escribe la sección `[cloud]` compañera, realiza la primera sincronización e instala el watcher. Úsalo solo para el flujo de trabajo combinado de Windows; los usuarios que solo usan en la nube deben usar los comandos manuales anteriores.

## 7. Configurar almacenamiento

Inicia sesión como administrador y añade un backend con nombre. Debe seleccionarse un backend como destino de escritura antes de subir.

### OneDrive

Crea una aplicación Azure con lectura/escritura de archivos delegados y acceso sin conexión. Introduce el ID del cliente, el secreto del cliente, el token de actualización y el ID de la unidad en Admin, y luego prueba el backend. OneDrive reproducción normalmente usa una URL temporal y puede saltarse el Worker.

### WebDAV

Introduce la URL raíz de la biblioteca y las credenciales. La reproducción y la subida pasan por la Worker principal porque WebDAV no tiene una URL pública temporal para descargar.

### Google Drive

Activa la API de Drive y crea un cliente OAuth de escritorio. Genera la URL de autorización en Admin, apruébala, copia el `code` desde el `http://localhost` redirige cuando sea necesario, cámbialo y luego prueba y añade el backend. Se requiere el alcance de la unidad escriturable para descubrir y subir bibliotecas existentes.

### Carpeta local

Disponible solo en el Node runtime. La raíz configurada debe permanecer dentro del sistema de archivos del servidor y no es portable para Cloudflare. Véase [Backends de almacenamiento y migración de archivos](storage.es.md).

## 8. Espejo de imagen R2 opcional

R2 es un espejo de imagen reconstruible, no la base de datos del catálogo ni un backend de audio. Crea un bucket, una URL pública de lectura y un token de lectura/escritura compatible con S3; introdúcelos en Admin, probar, habilitar y precalentar. Mantén la clave de acceso y el secreto fuera de Git. Al migrar manteniendo el mismo bucket, preserva `r2_cache` con `-IncludeCache`; para un bucket nuevo, omitítelo y precalenta.

## 9. Mover una base de datos existente

No crees un despliegue vacío y asumas que la restauración de configuración devolverá los álbumes. Los datos de catálogo, los ajustes runtime secretos y el audio son capas separadas. Sigue [Copia de seguridad de la base de datos, migración y recuperación](database-migration.es.md) antes de cambiar runtimes.

## 10. Proxy de audio opcional

El Worker principal ya proxies backends que necesitan credenciales privadas. Despliega `cloud/proxy-worker` solo cuando una segunda ruta Cloudflare o dominio personalizado mejore de forma medible la reproducción temporal de URLs. Véase [Proxy de audio Cloudflare opcional](audio-proxy.es.md).

## 11. Actualizaciones

Antes de una actualización importante, haz una copia de seguridad en JSON de la base de datos y de los ajustes de administrador.

Cloudflare:

```bash
git pull
cd cloud/web && npm ci && npm run build
cd ../worker && npm ci
npx wrangler d1 execute mihonban --remote --file schema.sql --config wrangler.local.jsonc
npx wrangler deploy --config wrangler.local.jsonc
```

Node: reconstruir `cloud/web`, reinstalar Worker dependencias, detener el proceso antiguo y reiniciar `npm run node`. `schema.sql` es repetible y runtime migraciones añaden columnas requeridas por bases de datos antiguas.

## 12. Verificación

- Iniciar sesión con contraseñas del oyente y administrador; probar el modo invitado sin contraseña solo si está habilitado.
- Abrir biblioteca, pistas, artistas, favoritos, importación y rutas de administración.
- Reproduce una pista, busca cerca del final y prueba los controles multimedia del sistema en iOS/Android.
- Abrir una portada, avatar del artista y galería de álbum; deslizar la galería de pruebas desde el móvil.
- Verificar que álbumes, temas, artistas, estilos, imágenes, resultados de búsqueda y favoritos ocultos no están disponibles para los oyentes.
- Subir un álbum desechable al objetivo de escritura seleccionado y luego eliminarlo.
- Exportar tanto una copia de seguridad de la base de datos como la configuración de administrador en JSON.

## Solución de problemas

| Síntoma | Comprobar |
|---|---|
| El inicio de sesión regresa inmediatamente a la página de inicio de sesión | HTTP local necesita `DEV_INSECURE_COOKIE=1`; despliegue público necesita HTTPS |
| Se rechaza la contraseña antigua del entorno | Una contraseña guardada en Admin se almacena como hash y tiene prioridad |
| Retornos de flujo 502 | Vinculación backend nombrada, credenciales, ruta relativa y soporte de Range upstream |
| Faltan álbumes existentes | Restaurar la base de datos del catálogo; ajustes JSON no incluye álbumes |
| Wrangler aparece vacío | Confirma si el comando está usando `--local` o `--remote`, y qué directorio de etapas posee `.wrangler/` |
| Node aparece vacío | Confirma `DATA_DIR` apunta a la `mihonban.sqlite` prevista |
| El teléfono no puede conectarse | Usa la IP de la LAN, asigna `0.0.0.0` y permite que el puerto seleccionado pase por el cortafuegos |
| El inicio de sesión devuelve 429 | Deja de intentarlo de nuevo y espera 15 minutos a que expire el bloqueo de la IP fuente |
