# Contrato de compatibilidad del cliente nativo

[English](API_COMPATIBILITY.md) · [简体中文](API_COMPATIBILITY.zh.md) · [繁體中文](API_COMPATIBILITY.zh-Hant.md) · [日本語](API_COMPATIBILITY.ja.md) · [한국어](API_COMPATIBILITY.ko.md) · [Français](API_COMPATIBILITY.fr.md) · [Español](API_COMPATIBILITY.es.md)

El cliente nativo es independiente de `cloud/web`. El servidor Mihonban puede cambiar la interfaz web y desplegarse de forma independiente mientras los siguientes comportamientos de la API sigan siendo compatibles.

## Sesión y catálogo

El cliente conserva las cookies de sesión entre solicitudes. Una sesión de invitado configurada permite explorar sin contraseña; los despliegues protegidos requieren iniciar sesión. Los álbumes ocultos y los cambios en favoritos compartidos siguen sujetos a los permisos del servidor.

- `GET /api/health` devuelve una respuesta satisfactoria.
- `GET /api/me` devuelve el objeto de sesión actual. Un `401` indica que el cliente debe mostrar el flujo de contraseña.
- `POST /api/login` acepta `{ "password": "..." }` y devuelve `{ "ok": true, "role": "user|admin" }`.
- `GET /api/library` devuelve la matriz de álbumes visibles.
- `GET /api/tracks` devuelve la matriz de pistas visibles.
- `GET /api/album/:id` devuelve un objeto de álbum con una matriz `tracks`.
- `GET /api/artists` devuelve los metadatos de artistas.
- `GET /api/favorites` devuelve un objeto con matrices `albums` y `tracks`, cuyas entradas incluyen un `id`.
- `PUT /api/favorites/:kind/:id` añade un favorito compartido y `DELETE` en la misma ruta lo elimina. `kind` es `album` o `track`. Estas escrituras requieren permisos de administrador.

Las listas de álbumes y pistas aceptan `?hidden=1` para administradores autorizados. El detalle del álbum también puede contener `note`, `images` y `similar`. Los nombres de artista y los identificadores se codifican como URL en las rutas de solicitud.

## Imágenes y audio

- `GET /api/art/:albumId?s=480` devuelve el cuerpo de una imagen.
- `GET /api/image/:id?s=:size` devuelve una imagen de galería del álbum.
- `GET /api/artist-bio/:name` devuelve un objeto que contiene la cadena `bio`.
- `GET /api/artist-art/:name` devuelve la imagen del artista; el cliente añade `?v=c` para una imagen personalizada.
- `GET /api/stream/:trackId` devuelve los bytes de audio originales o una redirección que permite obtenerlos.

El cliente de escritorio descarga un archivo de audio completo para decodificarlo y desplazarse localmente; no depende de la disposición de streaming del reproductor web. Las imágenes se limitan a 32 MiB por respuesta. Consulta [`src/api.rs`](src/api.rs) para las rutas exactas y los valores predeterminados de deserialización.

## Compatibilidad y actualizaciones del cliente

El cliente ignora campos JSON desconocidos y asigna valores predeterminados a los campos opcionales definidos en sus modelos. Los campos obligatorios, como identificadores de álbum, nombres de artista y títulos, deben mantener tipos compatibles. Aceptar campos nuevos desconocidos no convierte en opcionales los campos ya obligatorios. El cliente no accede a la base Mihonban, credenciales de almacenamiento ni archivos de despliegue. Las migraciones del servidor, el almacenamiento y las versiones del cliente pueden evolucionar de manera independiente dentro de este contrato.

Las versiones del cliente pueden usar un manifiesto JSON alojado aparte con `latest`, `download_url`, `sha256` y `notes`. Publica una suma SHA-256: el cliente actual solo la comprueba cuando el campo no está vacío. Las descargas preparan la sustitución manual del ejecutable, sin instalación automática ni actualización del servidor. La [guía de escritorio](README.es.md) describe configuración, compilación y reproducción.
