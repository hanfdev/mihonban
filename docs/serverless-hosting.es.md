# Alojamiento Serverless en Cloudflare

[English](serverless-hosting.md) · [简体中文](serverless-hosting.zh.md) · [繁體中文](serverless-hosting.zh-Hant.md) · [日本語](serverless-hosting.ja.md) · [한국어](serverless-hosting.ko.md) · [Français](serverless-hosting.fr.md) · [Español](serverless-hosting.es.md)

El objetivo serverless es mantener el inicio de sesión, navegación y reproducción online mientras el ordenador doméstico está apagado. La forma soportada es una Worker que sirve a la app React y API, D1 + KV, R2 opcionales para imágenes y audio almacenado en OneDrive, WebDAV o Google Drive.

## Cargas de trabajo adecuadas

| Trabajo | Cloudflare Workers encaja |
|---|---|
| React activos y solicitudes cortas de API | Bien |
| D1 catálogo/ajustes y KV caché corta | Bien |
| Recordatorios de fuentes RSS/Atom/Blogger | Bueno con Cron Trigger |
| Range streaming desde almacenamiento | Soportado, sujeto a límites de red y planes |
| Seguimiento de bandeja de entrada, extracción de archivos, remolachas, ediciones masivas de etiquetas | No soportado; usar el complemento local |
| Transcodificación o escaneos persistentes de carpetas locales | No soportado; usar herramientas Node/NAS |

## Arquitectura recomendada

```text
Browser
  |
Cloudflare Worker (API + React assets)
  |-- D1: catalog and settings
  |-- KV: rate limits and short-lived cache
  |-- optional R2: image mirror
  +-- OneDrive / WebDAV / Google Drive: audio and originals
```

Sigue [Instalar y desplegar ](install.es.md). Antes de mover un catálogo local, sigue [Migración de base de datos](database-migration.es.md); importar solo la configuración de administrador no restaura álbumes.

## ¿Tiene que quedarse encendido el ordenador de casa?

No, no para inicio de sesión web, navegación, reproducción, importaciones web o escaneo de código fuente programado. Actívalo solo para procesamiento local de la bandeja de entrada, conciliación local/nube, copias de seguridad offline u otras tareas complementarias.

Cloudflare Workers no puede ver un directorio principal ni esperar a los eventos del sistema de archivos. Para ejecutar la bandeja de entrada de forma continua, coloque el Python compañero en un NAS siempre activo o en un host de bajo consumo. Ese dispositivo organiza y sincroniza los archivos; la aplicación web sigue funcionando de forma independiente en Cloudflare.

## Libre no significa ilimitado

Workers, D1, KV y R2 cuotas y precios pueden cambiar; usar el panel de control de Cloudflare actual y la documentación oficial como autoridad. La suposición de la plataforma gratuita del proyecto es una biblioteca personal o unos pocos oyentes, no una gran distribución pública ni un relé de audio sin pérdida a escala continua a escala de terabytes.

OneDrive URLs temporales suelen saltarse el Worker. WebDAV, Google Drive y un byte de transferencia proxy de audio explícitamente habilitado a través de un Worker y consumen más recursos de plataforma.

## Proxy de audio externo

Prueba primero el despliegue principal. Añade el proxy separado solo cuando la medición muestre que otra ruta Worker o dominio personalizado mejora la ruta. Es un relé firmado y autorizado, no una CDN pública, y no garantiza una mayor velocidad. Véase [Opcional Cloudflare proxy de audio](audio-proxy.es.md).

## Lista de comprobación previa a la publicación

- Worker URL/dominio personalizado se abre sobre HTTPS.
- Los permisos de oyente, administrador y opcionales invitados sin contraseña son correctos.
- Reproducción y búsqueda de trabajo en escritorio, Safari para iOS y Chrome para Android.
- El contenido oculto no está disponible para los oyentes a nivel de API.
- Se prueba cada backend de almacenamiento con nombre; se selecciona un objetivo de escritura.
- Las imágenes opcionales de R2 y el proxy se prueban de forma independiente.
- D1 SQL, configuración de administrador JSON, secretos runtime y copias de seguridad de audio están todos contabilizados.
- No aparece ningún secreto en Git, documentación, registros o capturas de pantalla.
