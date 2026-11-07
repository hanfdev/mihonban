# Cliente nativo de Mihonban para Windows

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

Este directorio contiene el cliente de escritorio nativo escrito en Rust. Dibuja su interfaz con `egui`, accede directamente a la API HTTP de Mihonban mediante `reqwest` y decodifica localmente los formatos de audio compatibles con `rodio` / Symphonia. No incorpora un navegador ni carga la aplicación web de Mihonban.

El cliente admite varios perfiles de servicio Mihonban. La dirección se modifica en Ajustes, las contraseñas se guardan en el Administrador de credenciales de Windows y el manifiesto opcional de actualización del cliente es independiente de las versiones del servidor. Las compilaciones etiquetadas se publican en [GitHub Releases](https://github.com/hanfdev/mihonban/releases), con etiquetas `desktop-v*`, y adjuntan el exe portátil y un archivo de sumas SHA-256.

## Interfaz, ajustes y caché

El cliente inicia maximizado en su monitor, respetando la escala de Windows y el área de trabajo disponible junto a la barra de tareas. La ventana inicial omite deliberadamente un tamaño interior fijo: eframe 0.29 aplica ese tamaño después de crear la ventana maximizada, lo que puede reducirla sin quitarle su estado maximizado.

La tarjeta de conexión ajusta su tamaño al contenido y permanece centrada debajo de la navegación, incluso cuando una traducción o un error cambia su altura. Un distintivo compacto muestra el host, el puerto y la ruta de despliegue; su ayuda emergente conserva la dirección completa. Los fallos de conexión ofrecen directamente Reintentar y Ajustes.

La interfaz sigue el diseño oscuro de archivo y vinilo de Mihonban: cabecera fija, búsqueda centrada, mosaico de portadas, presentación del álbum y lista de pistas, además de un reproductor nativo permanente. Las portadas y el audio usan una caché persistente por perfil. Ajustes permite consultar la carpeta, el límite de 1–200 GB, el uso actual, vaciar la caché y abrir el Explorador. Las entradas usan escrituras atómicas y se eliminan según el uso menos reciente; un archivo mayor que el límite configurado se reproduce una vez sin conservarse.

Elegir otra pista cancela la descarga de audio que sustituye. Detener la reproducción y cancelar la precarga también liberan sus conexiones y archivos incompletos, incluso con la caché de disco desactivada. Vaciar una caché activa cancela sus descargas para impedir que la vuelvan a llenar después. Los archivos terminados siguen disponibles para reproducir; las descargas incompletas se limpian al terminar o cancelar sus tareas. Si otro proceso bloquea temporalmente un archivo incompleto, un inicio posterior elimina los fragmentos abandonados durante más de diez minutos.

Las fotos de artistas usan un recorte centrado que respeta la proporción, tanto en la cuadrícula como en el detalle. Coincide con el comportamiento `object-fit: cover` del cliente web para fotografías horizontales y verticales.

En Windows, minimizar oculta por defecto el cliente en su icono nativo de la bandeja; la reproducción y el avance de la cola continúan en segundo plano. Haz doble clic en el icono original de Mihonban o elige Mostrar ventana principal en su menú contextual para restaurarla. El menú también incluye Reproducir/Pausar y Salir. Ajustes → Comportamiento de la ventana guarda por separado las opciones de minimizar y cerrar a la bandeja. Cerrar sigue saliendo de la aplicación por defecto, y Salir en la bandeja siempre la termina. Si falla la inicialización de la bandeja, se mantiene el funcionamiento normal de la ventana.

La caché predeterminada está en el directorio local de datos de aplicaciones de Windows. Cambiar su carpeta o límite afecta únicamente al cliente nativo y nunca modifica el servidor Mihonban ni su almacenamiento.

Los ajustes se guardan por usuario de Windows en `%APPDATA%\Mihonban\Mihonban\config\config.json`. Todas las copias ejecutadas con la misma cuenta leen los mismos perfiles, preferencias de ventana y ajustes de caché, independientemente de la carpeta del exe. Las contraseñas permanecen separadas en el Administrador de credenciales de Windows, usando el nombre del perfil como clave. Una máquina sin perfiles guardados comienza con la dirección local de ejemplo integrada.

Los ajustes usan las mismas superficies negras cálidas, títulos con serifas, bordes finos y acciones naranjas que la biblioteca. La página centrada alterna entre un formulario de servicio con columna lateral de ventana/actualizaciones y tarjetas apiladas a todo el ancho en ventanas pequeñas. Los campos nativos, interruptores accesibles por teclado, filas de acciones que se ajustan al ancho y medidor de almacenamiento local admiten los siete idiomas. Guarda los ajustes de caché para aplicar cambios de activación, carpeta o límite; las opciones de bandeja siguen guardándose automáticamente.

Elimina un perfil de servidor desde la tarjeta del servicio. Un diálogo identifica el perfil y su dirección, selecciona Cancelar por defecto y requiere una segunda confirmación explícita. Siempre se conserva al menos un perfil. Eliminar el seleccionado cambia a otro perfil guardado y detiene su reproducción; no elimina música del servidor, favoritos ni medios locales en caché. Las credenciales guardadas se borran salvo que otro perfil siga compartiendo el mismo nombre de credencial.

## Memoria y rendimiento del catálogo

La caché de disco y la memoria de imágenes decodificadas se administran por separado. Portadas y fotos de artistas usan un presupuesto de texturas LRU que cambia según el número de portadas visibles (40–72 MiB, suficiente para una pantalla 4K al 200 %); la galería usa 16 MiB. Las cargas de texturas pendientes respetan las texturas visibles del fotograma anterior antes del siguiente cálculo de visibilidad. La expulsión libera los identificadores de texturas nativas; volver a una imagen la recarga desde disco. Solo solicitan imágenes las tarjetas visibles de galería/recomendaciones. Se conservan simultáneamente como máximo dos descargas de imágenes, decodificaciones o resultados decodificados en espera, y la decodificación y el redimensionado se ejecutan fuera del hilo de interfaz. Portadas y fotos conservan sus proporciones dentro de 512 px; la galería se limita a 2048 px. El sombreado original de las portadas se mantiene y las fotos de artistas ya no reservan una copia oscurecida sin uso. Estos presupuestos cubren los datos de texturas, no todo el proceso, el controlador gráfico, las fuentes ni las asignaciones temporales de decodificación.

Para inspeccionar sin red el presupuesto de texturas de una caché local existente, ejecuta desde la raíz `cargo run --locked --manifest-path desktop/Cargo.toml --example texture_memory_probe -- <cache-directory>`. El informe estima los datos RGBA decodificados a partir de dimensiones reales y simula la política LRU de producción; no mide el conjunto de trabajo del proceso.

El mosaico de álbumes virtualiza las filas: solo crean widgets las que están a la vista y una fila adyacente a cada lado; los espacios de igual altura conservan todo el recorrido de desplazamiento. El filtrado y la ordenación reutilizan una lista compartida de índices hasta que cambia un filtro o la biblioteca. Las opciones de década, artista y género solo se reconstruyen al cambiar los datos. Los identificadores de interacción siguen la identidad del álbum, manteniendo estables el estado de puntero y los clics cuando entran filas a la vista. Se conservan el desplazamiento suave nativo, los tiempos de animación y el estilo de la barra del borde derecho.

La página del artista reutiliza entre fotogramas sus totales de álbumes, opciones de género y datos de búsqueda. Actualizar metadatos o cambiar el perfil de servicio invalida esa instantánea, incluso si no cambia el número de álbumes o artistas. Los géneros que solo difieren en mayúsculas ASCII comparten una opción de filtro y muestran la escritura más frecuente. Solo se conserva el resultado filtrado actual, por lo que nuevas búsquedas no acumulan una caché de historial.

La lista de pistas omite la línea del artista cuando repite exactamente los créditos ordenados del álbum. Las pistas con créditos distintos conservan sus enlaces individuales. Los álbumes sin diferencias usan filas compactas; si una pista requiere una segunda línea, todas usan la misma altura mayor. Las bandas de galería y álbumes similares tienen barras de desplazamiento que ocupan todo el ancho disponible.

Los aciertos de caché actualizan en memoria la hora de acceso LRU y la guardan en la siguiente modificación de la caché, sin reescribir todo el índice por cada imagen. Las imágenes fallidas esperan 30 segundos antes de reintentarse, evitando solicitudes continuas de portadas ausentes. Desde la raíz ejecuta `cargo run --release --locked --manifest-path desktop/Cargo.toml --example scroll_layout_probe` para comparar sin interfaz la cuadrícula completa con la disposición egui virtualizada. Este benchmark sintético de CPU comprueba la equivalencia de las tarjetas visibles y la altura de desplazamiento; no mide FPS de la aplicación, renderizado GPU, decodificación de imágenes ni latencia de la rueda.

## Reproducción

El reproductor sigue la disposición web: la barra compacta alinea portada, información de la pista, controles, posición y volumen en una fila. Seleccionar la portada abre En reproducción con fondo de portada desenfocado, composición centrada de dos columnas y control naranja durante la reproducción. El título abre el álbum, el nombre del artista abre su página y Escape contrae En reproducción. Espacio alterna reproducción y pausa en ambas vistas.

Las dos vistas comparten aleatorio, repetición desactivada/todas/una y silencio. El modo aleatorio recorre cada pista de la cola una vez antes de detenerse o repetir; Anterior retrocede en ese orden. Al arrastrar la posición se previsualiza el tiempo y se aplica al soltar. La barra enfocada admite flechas (cinco segundos, treinta con Mayús) e Inicio/Fin; el volumen admite flechas y restaura el último nivel audible al quitar el silencio.

Los archivos de audio usan el constructor de decodificador Rodio que recibe información del archivo, con su longitud completa y capacidad de búsqueda. Esto permite desplazarse en FLAC sin tabla de búsqueda. La posición procede directamente de la salida de audio; si falla el desplazamiento se muestra un aviso breve, en vez de ocultarlo con una posición temporal forzada. El [material de regresión de búsqueda](tests/fixtures/README.es.md) contiene audio generado sin tabla de búsqueda, y las pruebas comparan muestras después de avances y retrocesos con una decodificación secuencial. Para una comprobación adicional con salida de audio real y archivos locales completos, ejecuta desde la raíz `cargo run --locked --manifest-path desktop/Cargo.toml --example seek_backend_probe -- <audio-file> [<audio-file> ...]`.

## Compilación y pruebas

Desde la raíz del repositorio, compila y ejecuta el cliente Windows optimizado:

```powershell
cargo run --release --locked --manifest-path desktop/Cargo.toml
```

Antes de publicar cambios del cliente, ejecuta desde la raíz `cargo test --locked --manifest-path desktop/Cargo.toml`. La suite cubre interrupciones de descarga HTTP local, cambios de pista, vaciado y expulsión de caché, invalidación de la caché de artistas y regresiones de disposición de filas. Los dos benchmarks sintéticos no forman parte de las pruebas normales; ejecuta `cargo test --release --locked --manifest-path desktop/Cargo.toml -- --ignored --nocapture` para comparar costes de agregación de artistas o expulsión. Sus tiempos miden algoritmos, no FPS ni memoria del proceso.

El perfil release prioriza un ejecutable pequeño. Las fuentes integradas se comprimen dentro del exe de distribución y se descomprimen al iniciar, conservando la tipografía de los idiomas y los metadatos musicales admitidos. Los ejecutables Debug son mayores porque incluyen código de desarrollo sin optimizar. Los Release usan el subsistema GUI de Windows y se abren sin ventana de terminal.

## Actualizaciones

La URL opcional de origen de actualizaciones la proporciona el editor del cliente Windows. Déjala vacía si no hay un canal de distribución; es independiente de la dirección del servicio Mihonban y no actualiza el servidor. Buscar actualizaciones lee los metadatos de versión, y Descargar y verificar prepara el nuevo exe para sustituirlo manualmente, sin instalarlo de forma silenciosa.

El origen apunta a un pequeño documento JSON alojado por el canal de distribución del cliente. Por ejemplo:

```json
{
  "latest": "0.2.0",
  "download_url": "https://github.com/hanfdev/mihonban/releases/download/desktop-v0.2.0/mihonban_desktop.exe",
  "sha256": "...",
  "notes": "..."
}
```

Consulta el [contrato de compatibilidad de la API nativa](API_COMPATIBILITY.es.md) para los requisitos del servidor y la [guía del proyecto](../README.es.md) para instalarlo y conocer los demás clientes.
