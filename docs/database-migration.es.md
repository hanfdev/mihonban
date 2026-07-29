# Copia de seguridad, migración y recuperación de bases de datos

[English](database-migration.md) · [简体中文](database-migration.zh.md) · [繁體中文](database-migration.zh-Hant.md) · [日本語](database-migration.ja.md) · [한국어](database-migration.ko.md) · [Français](database-migration.fr.md) · [Español](database-migration.es.md)

Este documento mueve un catálogo entre Node SQLite locales, Wrangler D1 locales y Cloudflare D1 remotas.

Si permaneces local, haz una copia de seguridad `<DATA_DIR>/mihonban.sqlite`, la configuración de administrador JSON, runtime secretos y audio por separado. Las secciones remotas solo se aplican cuando realmente existe un despliegue Cloudflare.

## Lo que debe moverse

| Datos | Ruta de migración |
|---|---|
| Álbumes, temas, artistas, galerías, favoritos, notas, publicaciones fuente | D1 Exportación/importación SQL |
| OneDrive/R2/configuración de módulos y configuraciones de almacenamiento nombrado | Configuración de administrador JSON |
| Contraseña de app/administrador, secreto de sesión, clave de acompañante, secreto de firma de proxy | Configurar como secretos Worker destino |
| KV límites de tasa y cachés de corta duración | No migrar |
| R2 índice de caché | Mismo cubo: exportar con `--include-cache`; nuevo cubo: omitir y precalentar |
| Audio e imágenes originales | Copiar/migrar en la capa de almacenamiento; no forma parte de D1 |

El JSON de administrador por sí solo no es una copia de seguridad de catálogo. Un archivo SQL D1 por sí solo no contiene audio ni, por defecto, credenciales.

Los créditos ordenados del álbum se guardan en `album_artists`. Los créditos propios de una pista solo se guardan en `track_artists` cuando son necesarios; sin filas, la pista hereda los artistas del álbum. Las exportaciones SQL lógicas incluyen ambas tablas. Tras una actualización, Mihonban las crea y conserva el texto de artista anterior como un único crédito exacto. No lo divide por comas, pues también son válidas en nombres y claves de ordenación. Usa el editor del álbum para una colaboración completa o el botón de artista en la gestión de pistas para invitados que aparecen solo en algunas canciones.

## Antes de trasladar el almacenamiento local Node a Cloudflare

Cloudflare no puede leer un backend Node `local`. Aunque la antigua Node app sigue disponible:

1. Añadir y probar OneDrive, WebDAV o Google Drive.
2. Migrar todos los álbumes vinculados a almacenamiento local.
3. Verificar los flujos e imágenes desde el backend en la nube.
4. Luego exporta la base de datos.

## 1. Crear una copia de seguridad del origen

En la app antigua, inicia sesión como administrador y descarga **Configuración de administrador → copia de seguridad**. Guarda ese JSON cifrado.

Para Node, la base de datos es `<DATA_DIR>/mihonban.sqlite`. Los archivos locales de Wrangler D1 están bajo `cloud/worker/.wrangler/state/v3/d1/`.

Detener las escrituras durante el corte final. El exportador utiliza una transacción de lectura SQLite, pero evitar ediciones concurrentes facilita la verificación.

## 2. Preparar el destino

Crear D1/KV, copiar la plantilla pública a la configuración local ignorada, colocar el
Real IDs en ese archivo local, y aplicar el esquema:

```bash
cd cloud/worker
npm ci
cp wrangler.jsonc wrangler.local.jsonc
# Sustituye en wrangler.local.jsonc los identificadores D1／KV rellenos con ceros.
npx wrangler d1 execute mihonban --remote --file schema.sql \
  --config wrangler.local.jsonc
```

En PowerShell, usa `Copy-Item wrangler.jsonc wrangler.local.jsonc`. El D1
El recurso se llama `mihonban`, coincide con la configuración y la Worker. Nunca pongas cuenta
IDs de recursos o secretos de despliegue en la plantilla pública.

Si el objetivo ya tiene datos importantes, expórtalos primero:

```bash
mkdir -p ../../backups
npx wrangler d1 export mihonban --remote \
  --output ../../backups/remote-before-import.sql \
  --config wrangler.local.jsonc
```

## 3. Exportar e importar datos de bibliotecas

### Ayudante de Windows

De la raíz del repositorio:

```powershell
powershell -File tools\migrate-d1.ps1 -ImportRemote
```

El ayudante detecta automáticamente el Node SQLite más reciente o Wrangler D1 local y escribe un archivo SQL con marca de tiempo bajo `backups/` ignorado. Escribe D1 remotas solo cuando `-ImportRemote` está presente; omite ese cambio solo para exportación. Antes de cada importación remota también exporta el destino actual a `backups/` y aborta si esa copia de seguridad falla. `-SkipRemoteBackup` es una sobreescritura explícita de emergencia.

El ayudante prefiere ignorar `cloud/worker/wrangler.local.jsonc` cuando está presente y usar la plantilla pública. Pasa `-WranglerConfig <path>` para seleccionar otra configuración privada.

Cuando el destino mantiene exactamente el mismo cubo de R2 y URL pública, añade
`-IncludeCache` para que Prewarm pueda saltarse objetos ya reflejados allí:

```powershell
powershell -File tools\migrate-d1.ps1 `
  -Source "D:\mihonban-data\mihonban.sqlite" `
  -IncludeCache -ImportRemote
```

No incluyas ese índice al moverte a un cubo vacío/diferente: sus filas
apuntaría a objetos que no están presentes. Si se omitiera un índice mientras que el
Los mismos objetos públicos siguen existiendo, los precalentamientos actuales comprueban esos deterministas
URL de objeto con HEAD y recupera el índice sin volver a subir bytes de imagen.

Cuando existen varias bases de datos locales, siempre se pasa `-Source` en lugar de depender del tiempo de modificación.

Fuente explícita:

```powershell
powershell -File tools\migrate-d1.ps1 `
  -Source "D:\mihonban-data\mihonban.sqlite" `
  -Database "mihonban" `
  -WranglerConfig "cloud\worker\wrangler.local.jsonc" `
  -ImportRemote
```

### Manual/multiplataforma

```bash
cd cloud/worker
npm ci
npm run db:export -- \
  --source /path/to/mihonban.sqlite \
  --output ../../backups/mihonban-d1.sql

npx wrangler d1 execute mihonban --remote \
  --file ../../backups/mihonban-d1.sql \
  --config wrangler.local.jsonc
```

El modo por defecto utiliza UPSERT de clave primaria y mantiene ausentes las filas de destino de la fuente. Una ruta única en conflicto con un ID diferente falla en lugar de eliminar datos de forma silenciosa. Para un destino nuevo, esto produce un catálogo de fuente exacto. `--replace` borra primero las tablas de catálogo incluidas; solo se usa después de una copia de seguridad remota.

El SQL generado intencionadamente no tiene `BEGIN TRANSACTION` explícita ni
`COMMIT`: las importaciones actuales de D1 remotas rechazan esas declaraciones y se aplica Wrangler
un archivo subido de forma atómica. El exportador sigue leyendo el código fuente en una SQLite
transacción, así que su instantánea es consistente.

`--include-config` también exporta almacenes con nombre y los mismos ajustes permitidos
como copia de seguridad de administrador, por lo que el SQL contiene el almacenamiento y las credenciales de servicio. Es
excluye deliberadamente los hashes de contraseñas de oyente/administrador, Session Epoch, Companion
latido, marcas de tiempo de escaneo y errores. Configurar Worker contraseñas de destino y
runtime secretos de forma independiente. El JSON administrativo separado sigue siendo el recomendado
Ruta de configuración. Incluso con `--replace`, solo las claves de configuración permitidas.
se reemplazan; la autenticación de destino y las filas de runtime estado permanecen intactas.
Para el mismo cubo R2, añade `--include-cache`; omitítelo y pon un cubo nuevo.

## 4. Restaurar configuración y secretos

1. Desplegar el Worker principal con nuevos secretos de `APP_PASSWORD`, `ADMIN_PASSWORD`, `SESSION_SECRET` y `COMPANION_KEY`.
2. Iniciar sesión usando la nueva contraseña de administrador.
3. Configuración de administrador → copia de seguridad → importar el JSON antiguo.
4. Prueba cada almacenamiento y configuración R2.
5. Si usas el proxy de audio externo, establece `STREAM_PROXY_SECRET` en la Worker principal y el mismo valor que `PROXY_SECRET` en la Worker proxy.

El JSON de configuración intencionadamente no restaura los hashes de contraseña ni el estado de la sesión.

## 5. Verificar recuentos y funcionamiento

```bash
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS albums FROM albums"
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS tracks FROM tracks"
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS artists FROM artists"
```

Luego verifica:

- Álbumes, temas, artistas, favoritos, notas, estado oculto y orden.
- Una pista por backend de almacenamiento, incluyendo búsqueda.
- Imágenes de portada, avatar y galería.
- El oyente no puede acceder a objetos ocultos.
- La exportación de configuración de administrador funciona en el nuevo despliegue.
- Si se omitió el índice de R2, ejecuta prewarm: los objetos públicos existentes se recuperan con HEAD y solo se suben los objetos faltantes.

## 6. Corte y retroceso

Solo actualiza el `[cloud].url` complementario después de la verificación. Conserva la base de datos antigua, el despliegue antiguo, la copia de seguridad SQL, la configuración JSON y el audio fuente hasta que el nuevo despliegue pase la prueba de restauración.

El rollback consiste en cambiar la URL de vuelta al despliegue antiguo o importar la copia de seguridad SQL remota pre-importada a una base de datos D1 limpia. Nunca borres la única copia de audio durante un cambio de base de datos.

## Migración entre despliegues remotos

Para dos despliegues Cloudflare, exporta el D1 remoto antiguo e impórtalo al nuevo remoto después de aplicar el esquema. Mantén la misma separación: D1 SQL para el catálogo, JSON de administrador para la configuración Worker secretos establecidos de forma independiente.
