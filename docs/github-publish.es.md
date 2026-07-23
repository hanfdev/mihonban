# Publica el código de forma segura

[English](github-publish.md) · [简体中文](github-publish.zh.md) · [繁體中文](github-publish.zh-Hant.md) · [日本語](github-publish.ja.md) · [한국어](github-publish.ko.md) · [Français](github-publish.fr.md) · [Español](github-publish.es.md)

El repositorio público oficial es [hanfdev/mihonban](https://github.com/hanfdev/mihonban). Solo debe contener código fuente, pruebas, documentación pública y plantillas seguras.

## Elementos que nunca deben rastrearse

- `.dev.vars`, `.env`, `mihonban.toml`, `rclone.conf`, `wrangler.local.jsonc` o configuración del proveedor
- `backups/`, `*.sqlite`, `*.db`, exportaciones SQL o configuraciones de administrador en JSON
- Audio, portadas/galerías personales, páginas RYM guardadas o archivos de la bandeja de entrada
- Cloudflare, Azure, Google, WebDAV, Discogs, R2, proxy o credenciales complementarias
- `GOAL.local.md` y otras notas privadas de planificación/agentes
- Generados `node_modules`, `.wrangler`, salidas de compilación, registros o archivos temporales

La raíz `.gitignore` cubre las ubicaciones estándar, pero las reglas de ignorancia no eliminan un archivo que ya fue commitido.

## Antes de cada push

```bash
git status --short
git diff --check
git diff --stat
git grep -n -I -i -E "refresh[_-]?token|client[_-]?secret|access[_-]?key|proxy[_-]?secret" -- .
```

Revisa cada coincidencia manualmente. Se esperan nombres de variables y ejemplos censurados; los valores reales no. También comprueba la identidad del autor del commit:

```bash
git log -5 --format='%h %an <%ae> %s'
```

Antes de la primera publicación pública o tras una reescritura del historial, ejecuta un escáner dedicado como Gitleaks con todas las referencias.

## Validar el repositorio

De la raíz del repositorio:

```bash
python -m pytest -q
```

Luego, en cada paquete:

```bash
cd cloud/web
npm ci
npm test
npm run build

cd ../worker
npm ci
npm test
npx wrangler deploy --dry-run

cd ../proxy-worker
npm ci
npm test
npx wrangler deploy --dry-run
```

No añadas la salida de compilación ignorada, el estado local de D1, bases de datos o copias de seguridad solo para que el CI pase.

## Remotes y forks

Confirma el destino antes de lanzar:

```bash
git remote -v
git branch --show-current
```

El origen canónico es:

```text
https://github.com/hanfdev/mihonban.git
```

Para un fork personal, apunta `origin` al fork y conserva el repositorio canónico como `upstream`:

```bash
git remote add upstream https://github.com/hanfdev/mihonban.git
git fetch upstream
```

No push ramas locales de recuperación ni el material de respaldo ignorado.

## Secretos de CI y despliegue

- Las pruebas de compilación y unidades no requieren secretos de producción.
- Los pull requests no confiables no deben recibir secretos de despliegue.
- Utilizar GitHub entornos y tokens de Cloudflare API de menor privilegio para el despliegue.
- Nunca colocar almacenamiento o credenciales de R2 en las variables de compilación frontend.
- Rotar cualquier secreto de producción que apareciera en chat, registros, capturas de pantalla, salida de CI o historial de Git.

## Lista de estreno

- Cada guía pública tiene versiones en inglés, chino simplificado, chino tradicional, japonés, coreano, francés y español, con enlaces válidos entre idiomas.
- Un clon fresco se instala con `npm ci` y `pip install -e ./pipeline`.
- Python, frontend, Worker principal, Worker proxy y pruebas en seco superadas.
- La documentación no contiene una ruta específica de la máquina, ni URL de servicio personal ni credencial.
- Las notas de migración de bases de datos/esquemas coinciden con el código publicado.
- No se incluye música privada ni activo protegido por derechos de autor de terceros.
- `LICENSE` permanece presente y los metadatos del paquete siguen declarando `AGPL-3.0-only`.

## Si se ha incluido un secreto en un commit

1. Revocarla o rotarla inmediatamente en el proveedor.
2. Elimínalo de los archivos y despliegues actuales.
3. Reescribir la historia afectada con `git filter-repo` o BFG cuando sea necesario.
4. Forza-push solo después de coordinar con cada colaborador.
5. Tratar todos los clones antiguos, registros y artefactos como copias comprometidas.

Eliminar el valor en un commit posterior no lo elimina del historial.

## Ámbito de la licencia

El AGPL cubre el software de este repositorio. No concede permiso para publicar música, imágenes de bibliotecas personales ni metadatos de terceros. Cada versión debe preservar esa distinción.
