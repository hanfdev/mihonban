# Proxy de audio Cloudflare opcional

[English](audio-proxy.md) · [简体中文](audio-proxy.zh.md) · [繁體中文](audio-proxy.zh-Hant.md) · [日本語](audio-proxy.ja.md) · [한국어](audio-proxy.ko.md) · [Français](audio-proxy.fr.md) · [Español](audio-proxy.es.md)

`cloud/proxy-worker` es un Worker independiente que retransmite URLs de audio temporales para la aplicación principal de mihonban. Es útil cuando una segunda ruta Worker o un dominio personalizado ofrece un mejor camino hacia la CDN de almacenamiento.

No almacena audio en caché y no puede garantizar una mayor velocidad. Mide antes y después.

## Modelo de seguridad

- Main Worker firma la URL de origen y un plazo de expiración de cinco minutos con `STREAM_PROXY_SECRET`.
- Proxy verifica el mismo valor que `PROXY_SECRET`.
- Solo se aceptan GET, HEAD y OPTIONS.
- Solo se aceptan HTTPS upstream en `ALLOWED_HOSTS`.
- Cada redirección ascendente se comprueba contra la lista de permisos.
- Las cabeceras de Range y condicionales se reenvían por completo; las cookies y encabezados de autorización no.
- Las respuestas son privadas/sin tienda.

No actives el modo sin signo en producción ni configures un comodín de host sin restricciones.

## 1. Configurar y desplegar el proxy

Edición `cloud/proxy-worker/wrangler.jsonc`:

- `ALLOWED_HOSTS`: anfitriones exactos separados por comas o sufijos que comienzan por un punto.
- `ALLOWED_ORIGINS`: tu origen principal mihonban; `*` funciona, pero se prefiere un origen específico.

Los sufijos de OneDrive por defecto son un punto de partida. Microsoft puede redirigir a un inquilino o a un dominio de descarga regional; añadir solo el sufijo exacto observado en una solicitud fallida.

```bash
cd cloud/proxy-worker
npm ci
npm test
npx wrangler login
npx wrangler secret put PROXY_SECRET
npx wrangler deploy
```

Utiliza al menos 32 caracteres aleatorios; se recomienda una cadena hexadecimal generada a partir de 32 bytes aleatorios. Conservarla temporalmente para que se pueda añadir exactamente el mismo valor a la Worker principal.

## 2. Configurar el Worker principal

```bash
cd ../worker
npx wrangler secret put STREAM_PROXY_SECRET
npx wrangler deploy
```

Pega exactamente el mismo secreto que se usa para `PROXY_SECRET`.

En el panel de módulos administrativos de mihonban:

1. Activar el proxy de audio.
2. Establecer URL de proxy personalizada a:

```text
https://mihonban-audio-proxy.<account>.workers.dev/?url={url}
```

3. Guarda y reproduce una pista respaldada por OneDrive.

El Worker principal añade `expires` y `sig` automáticamente. Nunca pongas el secreto compartido en la URL.

## 3. Verificar

```bash
curl https://mihonban-audio-proxy.<account>.workers.dev/healthz
```

Luego usa herramientas de red del navegador mientras juegas:

- Main `/api/stream/<id>` devuelve 302 al proxy.
- Proxy devuelve 200 o 206.
- Seeking envía `Range` y recibe `Content-Range`.
- Una solicitud de `?url=...` sin firmar devuelve el 401.
- Un host no autorizado devuelve 403.

## Alcance

El proxy externo se utiliza solo cuando el Worker principal puede obtener una URL de descarga temporal, actualmente backends de estilo OneDrive. WebDAV, Google Drive y Node almacenamiento local requieren credenciales privadas y permanecen detrás del Worker principal.

## Solución de problemas

| Estado | Significado/acción |
|---|---|
| 401 | Los secretos difieren, la firma caducada o la Worker principal no fue redistribuida |
| 403 | El host fuente inicial no está permitido en la lista |
| 502 con mensaje de host | Una redirección ha llegado a otro host; revísalo antes de añadir el sufijo |
| 416 | Upstream rechazó el rango de bytes solicitado |
| La reproducción es más lenta | Desactiva la URL externa y usa la ruta directa/Worker principal |

Rota ambos secretos juntos si el valor de firma queda expuesto. Las URLs firmadas existentes expiran en cinco minutos.
