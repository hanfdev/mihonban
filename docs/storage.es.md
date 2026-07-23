# Backends de almacenamiento y migración de archivos

[English](storage.md) · [简体中文](storage.zh.md) · [繁體中文](storage.zh-Hant.md) · [日本語](storage.ja.md) · [한국어](storage.ko.md) · [Français](storage.fr.md) · [Español](storage.es.md)

mihonban separa los metadatos del catálogo del almacenamiento de archivos. D1 sabe qué backend con nombre posee cada álbum; el audio y las imágenes fuente permanecen en ese backend.

## Modelo de datos

| Campo/tabla | Significado |
|---|---|
| `storages` | Denominado configuración OneDrive, WebDAV, Google Drive o Node-local |
| `albums.storage_id` | Backend que contiene la carpeta del álbum; requerido |
| `artists.storage_id` | Backend que contiene el avatar del artista |
| `storages.is_write` | El único objetivo nombrado para nuevas subidas; selecciona uno antes de subir |

Las rutas de pista y galería son rutas de almacenamiento relativas. Las pistas heredan el backend del álbum; las imágenes de la galería también usan el backend del álbum. Los avatares de los artistas tienen su propia encuadernación porque un artista puede abarcar varios discos.

## Backends soportados

| Backend | Cloudflare | Node runtime | Ruta de reproducción |
|---|---:|---:|---|
| OneDrive | Sí | Sí | URL temporal, normalmente 302 |
| WebDAV | Sí | Sí | Principal Worker Range proxy |
| Google Drive | Sí | Sí | Proxy Worker Range principal |
| Carpeta local | No | Sí | Node Range stream |

Una asignación de carpeta local no puede reproducirse después de mover la API a Cloudflare. Migra esos álbumes a un backend en la nube antes de exportar D1.

## Destino de escritura

Cambiar el destino de escritura afecta solo a futuras subidas. No mueve álbumes existentes. Las lecturas pueden abarcar cualquier número de backends configurados.

Las subidas se rechazan cuando no hay backend `is_write = 1`. Solo puede estar activo un backend a la vez.

## Migración de álbumes

Para un álbum, el Worker:

1. Enumera pistas, portadas, imágenes de galería y el avatar del artista si pertenece al mismo backend de origen.
2. Copia cada objeto al mismo camino relativo en el objetivo.
3. Se actualiza `albums.storage_id` solo después de que cada copia requerida tenga éxito.
4. Reenlaza el avatar copiado y invalida los índices espejo de imagen.
5. Deja intactos los objetos fuente.

La migración masiva repite la misma operación reanudable. Los álbumes ya encadernados se omiten. Actualizar la página detiene el bucle del cliente sin deshacer los álbumes completados.

## Limitaciones importantes

- Migración copia bytes; no reescribe etiquetas de audio ni disposiciones de directorios.
- Los archivos fuente no se eliminan automáticamente.
- Las transferencias grandes basadas en proxy consumen Worker solicitudes y tiempo de ejecución. Mueve grandes bibliotecas en lotes.
- R2 es un espejo de imagen, no un backend de audio.
- Una migración de base de datos no mueve archivos. Las mismas rutas relativas deben existir en el backend restaurado.

## Estrategias prácticas

| Objetivo | Procedimiento |
|---|---|
| Añadir capacidad | Añadir un backend y ponerlo como objetivo de composición; mantener los álbumes antiguos donde están |
| Mover todo | Añade y prueba el destino, migra en bloque, verifica la reproducción y después archiva el almacenamiento de origen |
| Mover Node almacenamiento local a Cloudflare | Mientras Node siga funcionando, añade un backend en la nube y migra los álbumes destinados localmente antes de D1 exportar |
| Revertir un movimiento de archivo | Migrar de nuevo a un backend probado; puede que ya existan copias de origen |

## Comportamiento de las copias de seguridad

La copia de seguridad de configuración de administrador incluye `storages` y sus credenciales. No incluye álbumes ni audio. Trata el JSON como un secreto.

El exportador de base de datos por defecto omite las configuraciones de almacenamiento pero preserva cada `storage_id` de álbum/avatar. Restaura el JSON de administrador después de importar D1 para que esos IDs se resuelvan en los backends con el mismo nombre.

Consulta [database-migration.md](database-migration.es.md) para la orden completa de restauración.

## Verificación tras la migración

- Prueba el backend objetivo en Admin.
- Toca al menos una pista pequeña y una grande; busca cerca del final.
- Consulta las imágenes de portada, avatar y galería.
- Confirma que el álbum informa del backend objetivo.
- Conservar el código fuente hasta que haya tenido éxito una copia de seguridad y una prueba de restauración separadas.

## Solución de problemas

| Síntoma | Causa/comprobación |
|---|---|
| El backend no puede ser eliminado | Uno o más álbumes siguen vinculados a él |
| Los metadatos del álbum funcionan pero el stream es 502 | ID del backend falta, credenciales incorrectas o archivo no copiado en la misma ruta |
| Avatar se interrumpe tras la migración del álbum | Verifica `artists.storage_id` y migra el álbum que posee ese avatar |
| falla el backend local en Cloudflare | Esperado; el almacenamiento local solo existe en el Node runtime |
| La migración se detiene en un archivo grande | Reintenta desde `fileIndex` reportada, o mueve el archivo fuera de Worker y conserva la misma ruta |
