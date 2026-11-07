# mihonban / 見本盤

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

Mihonban est une bibliothèque musicale privée et auto-hébergée dotée d’un lecteur web adaptatif. Elle peut fonctionner localement avec Node et SQLite, utiliser l’émulateur D1 local de Wrangler, ou être déployée telle quelle sur Cloudflare Workers et D1. Les fichiers audio restent dans un stockage que vous contrôlez.

## Aperçu de l’interface

Captures de l’application réelle, avec des données fictives et des pochettes originales de démonstration ou des images de remplacement intégrées. [Détails des captures](docs/images/README.fr.md).

![Bibliothèque Web](docs/images/web-library.webp)

<details>
<summary>Détails d’album et applications Android / iOS natives</summary>

**Détails d’album Web**

![Détails d’album Web](docs/images/web-album.webp)

| Bibliothèque Android | Lecteur Android |
|:---:|:---:|
| <img src="docs/images/android-library.webp" height="480" alt="Bibliothèque Android"> | <img src="docs/images/android-player.webp" height="480" alt="Lecteur Android"> |

Application iOS native capturée dans le simulateur, avec des données fictives et des images de remplacement intégrées.

| Bibliothèque iPhone | Lecteur iPhone |
|:---:|:---:|
| <img src="docs/images/ios-library.webp" height="480" alt="Bibliothèque iPhone"> | <img src="docs/images/ios-player.webp" height="480" alt="Lecteur iPhone"> |

**Détails d’album sur iPad**

![Détails d’album sur iPad](docs/images/ios-ipad-album.webp)

</details>

## Points forts

- Interfaces adaptatives pour les albums, morceaux, artistes, favoris, importations et réglages d’administration
- Crédits d’album multi-artistes ordonnés et collaborations définies par morceau, avec recherche, page et lien du lecteur pour chaque artiste
- Mots de passe distincts pour les auditeurs et les administrateurs, avec un mode invité facultatif, sans mot de passe et en lecture seule
- File d’attente persistante, commandes mobiles complètes piste précédente／lecture-pause／piste suivante, démarrage lié au geste utilisateur, lecture aléatoire/répétée, navigation Range et contrôles Media Session
- Client de bureau natif pour Windows dans [`desktop/`](desktop/README.fr.md) (egui + Rodio), distribué sous forme d’exe portable sur la [page Releases](https://github.com/hanfdev/mihonban/releases)
- Client Android natif dans [`android/`](android/README.fr.md) (Kotlin + Jetpack Compose + Media3), avec lecture en arrière-plan, téléchargements hors ligne et administration native
- Client iPhone/iPad natif dans [`ios/`](ios/README.fr.md) (SwiftUI + SFBAudioEngine), avec lecture en arrière-plan, téléchargements et interfaces adaptées aux deux formats
- Stockages nommés OneDrive, WebDAV, Google Drive et dossiers locaux réservés au runtime Node
- Miroir d’images R2 facultatif et auto-réparable pour les pochettes, galeries et portraits d’artistes
- Importation via l’API Discogs et mises à jour RYM depuis du HTML enregistré ou une extension Chrome/Edge facultative, avec actualisation des notes par lots lancée par l’utilisateur
- Compagnon Python facultatif pour les dossiers d’arrivée, les archives simples ou imbriquées, la réparation des tags et la synchronisation cloud
- Interfaces en anglais, chinois simplifié, chinois traditionnel, japonais, coréen, français et espagnol
- Outils de migration SQLite／D1 et Worker proxy audio signé facultatif

## Modes d’exécution

| Runtime | Base de métadonnées | Stockages de fichiers | Usage courant |
|---|---|---|---|
| Node | `<DATA_DIR>/mihonban.sqlite` | OneDrive, WebDAV, Google Drive, dossier local | Réseau local, NAS, VPS |
| Wrangler local | D1／KV locaux sous `.wrangler/` | OneDrive, WebDAV, Google Drive | Développement compatible Cloudflare |
| Cloudflare | D1 + KV, R2 facultatif | OneDrive, WebDAV, Google Drive | Déploiement serverless disponible en permanence |

Le compagnon Python est facultatif dans tous les modes. Installez-le uniquement si vous avez besoin de surveiller un dossier d’arrivée local, d’extraire des archives, d’organiser les tags ou de réconcilier les données locales et cloud.

## Démarrage rapide

Clonez le dépôt officiel :

```bash
git clone https://github.com/hanfdev/mihonban.git
cd mihonban
```

### Application Wrangler locale

Sous Windows, le script d’assistance prépare les fichiers de build en dehors de OneDrive et démarre Wrangler.

```powershell
tools\cloud-dev.cmd
```

Ouvrez `http://127.0.0.1:8787` ; par défaut, le serveur de développement n’écoute que sur `http://127.0.0.1:8787` (boucle locale). Définissez `MIHONBAN_DEV_LAN=1` et autorisez Node.js dans le pare-feu Windows pour tester depuis un téléphone via `http://<computer-lan-ip>:8787`. Le premier fichier de secrets généré par l’assistant contient des mots de passe auditeur et administrateur générés aléatoirement (voir `.dev.vars` dans le répertoire de préparation). Modifiez-les tous les deux dans l’administration avant de partager le service.

Pour une installation manuelle avec Wrangler, consultez [Installer et déployer](docs/install.fr.md).

### Application locale Node + SQLite

```bash
cd cloud/web
npm ci
npm run build
cd ../worker
npm ci
# Copiez .env.example vers .env, remplacez chaque valeur fictive et définissez DEV_INSECURE_COOKIE=1 pour le HTTP local.
npm run node
```

Node écoute par défaut sur `0.0.0.0:8788`. Si `DATA_DIR` n’est pas défini, sa base de données se trouve dans `cloud/worker/data/mihonban.sqlite`. Aucun mot de passe n’est intégré au runtime Node : `.env` doit définir `APP_PASSWORD`, `ADMIN_PASSWORD` et un `SESSION_SECRET` d’au moins 32 caractères.

### Cloudflare

Compilez l’application web, créez D1 et KV, configurez les secrets du Worker, appliquez `schema.sql`, puis déployez. La procédure manuelle est la référence et le compagnon Python local n’est pas obligatoire. Consultez [Installer et déployer](docs/install.fr.md) et [Migration de la base de données](docs/database-migration.fr.md) avant de déplacer un catalogue local existant.

### Compagnon Python facultatif

```bash
python -m venv .venv
# Windows : .venv\Scripts\activate
# POSIX :   source .venv/bin/activate
pip install -e ./pipeline
mihonban setup
mihonban doctor
```

Conservez `music_root`, `data_dir`, les bases de données et les fichiers temporaires hors de OneDrive, Dropbox, iCloud et de tout autre dossier synchronisé.

## Données et sauvegardes

| Données | Source faisant autorité | Méthode de sauvegarde |
|---|---|---|
| Albums, morceaux, artistes, favoris et notes | SQLite sous Node ou D1 | Sauvegarde compatible SQLite ou export SQL logique |
| Stockages nommés, R2 et réglages des modules | Réglages de la base de données | Fichier JSON des réglages d’administration, conservé chiffré |
| Secrets d’initialisation des mots de passe, de session, du compagnon et du proxy | Environnement d’exécution | Enregistrement séparé dans un gestionnaire de mots de passe |
| Audio et images originales | Stockage configuré | Sauvegarde indépendante au niveau du fournisseur de stockage |
| Miroir d’images R2 et caches KV | Cache reconstructible | Même compartiment R2 : migrer ou récupérer l’index. Nouveau compartiment : préchauffer. Ne jamais migrer KV |

Le fichier JSON des réglages d’administration n’est pas une sauvegarde du catalogue, et la sauvegarde de la base de données ne contient pas les fichiers audio.

## Organisation du dépôt

| Chemin | Rôle |
|---|---|
| `cloud/web/` | Lecteur React et interface d’administration |
| `cloud/worker/` | API Hono, schéma D1 et runtime compatible Node |
| `cloud/proxy-worker/` | Relais audio signé facultatif |
| `desktop/` | Client de bureau natif pour Windows (Rust, egui) |
| `android/` | Client Android natif (Kotlin, Jetpack Compose, Media3) |
| `ios/` | Client iPhone/iPad natif (SwiftUI, SFBAudioEngine) |
| `extensions/rym/` | Extension Chrome/Edge facultative pour capturer RYM et actualiser les notes |
| `pipeline/` | CLI Python `mihonban` et pipeline d’importation／synchronisation |
| `config/` | Modèles de configuration sans secrets |
| `tools/` | Outils de développement local, déploiement, surveillance et migration |
| `tests/` | Tests de régression Python |

## Commandes courantes

```text
mihonban setup                  create local companion config
mihonban doctor                 verify dependencies and paths
mihonban ingest --apply         process inbox archives or album folders
mihonban watch                  watch the inbox and reconcile cloud data
mihonban cloud sync             upload/register local albums
mihonban cloud pull             pull web imports back to the local library
mihonban rym parse|match|write  process manually saved RYM HTML

node tools/check-docs.mjs
cd cloud/worker && npm test
cd cloud/proxy-worker && npm test
cd cloud/web && npm test && npm run build
python -m pytest -q
```

## Sécurité

- Ne versionnez jamais `.dev.vars`, `.env`, `mihonban.toml`, `rclone.conf`, les bases de données, les exports de réglages, les jetons ou les fichiers audio.
- Le HTTP local nécessite `DEV_INSECURE_COOKIE=1`. Les déploiements publics doivent utiliser HTTPS et laisser cette variable non définie.
- Les mots de passe enregistrés dans l’administration remplacent les valeurs d’initialisation de l’environnement et révoquent les sessions existantes.
- Lorsque le proxy externe est activé, conservez `STREAM_PROXY_SECRET` et `PROXY_SECRET` identiques et confidentiels.
- Les lots RYM s’exécutent uniquement après le démarrage de la file par un administrateur et s’arrêtent en cas de vérification ou de limitation. Le serveur ne parcourt pas RYM. Voir le [guide d’utilisation](docs/manual.fr.md).
- Conservez au moins une copie indépendante de tout fichier audio irremplaçable.

## Documentation

| Guide | Langues |
|---|---|
| Installation et déploiement | [English](docs/install.md) · [简体中文](docs/install.zh.md) · [繁體中文](docs/install.zh-Hant.md) · [日本語](docs/install.ja.md) · [한국어](docs/install.ko.md) · [Français](docs/install.fr.md) · [Español](docs/install.es.md) |
| Architecture et runtimes | [English](docs/cloud.md) · [简体中文](docs/cloud.zh.md) · [繁體中文](docs/cloud.zh-Hant.md) · [日本語](docs/cloud.ja.md) · [한국어](docs/cloud.ko.md) · [Français](docs/cloud.fr.md) · [Español](docs/cloud.es.md) |
| Utilisation quotidienne | [English](docs/manual.md) · [简体中文](docs/manual.zh.md) · [繁體中文](docs/manual.zh-Hant.md) · [日本語](docs/manual.ja.md) · [한국어](docs/manual.ko.md) · [Français](docs/manual.fr.md) · [Español](docs/manual.es.md) |
| Migration de la base de données | [English](docs/database-migration.md) · [简体中文](docs/database-migration.zh.md) · [繁體中文](docs/database-migration.zh-Hant.md) · [日本語](docs/database-migration.ja.md) · [한국어](docs/database-migration.ko.md) · [Français](docs/database-migration.fr.md) · [Español](docs/database-migration.es.md) |
| Stockage et migration des fichiers | [English](docs/storage.md) · [简体中文](docs/storage.zh.md) · [繁體中文](docs/storage.zh-Hant.md) · [日本語](docs/storage.ja.md) · [한국어](docs/storage.ko.md) · [Français](docs/storage.fr.md) · [Español](docs/storage.es.md) |
| Hébergement serverless | [English](docs/serverless-hosting.md) · [简体中文](docs/serverless-hosting.zh.md) · [繁體中文](docs/serverless-hosting.zh-Hant.md) · [日本語](docs/serverless-hosting.ja.md) · [한국어](docs/serverless-hosting.ko.md) · [Français](docs/serverless-hosting.fr.md) · [Español](docs/serverless-hosting.es.md) |
| Proxy audio facultatif | [English](docs/audio-proxy.md) · [简体中文](docs/audio-proxy.zh.md) · [繁體中文](docs/audio-proxy.zh-Hant.md) · [日本語](docs/audio-proxy.ja.md) · [한국어](docs/audio-proxy.ko.md) · [Français](docs/audio-proxy.fr.md) · [Español](docs/audio-proxy.es.md) |
| Publication sécurisée | [English](docs/github-publish.md) · [简体中文](docs/github-publish.zh.md) · [繁體中文](docs/github-publish.zh-Hant.md) · [日本語](docs/github-publish.ja.md) · [한국어](docs/github-publish.ko.md) · [Français](docs/github-publish.fr.md) · [Español](docs/github-publish.es.md) |
| Client Windows natif | [English](desktop/README.md) · [简体中文](desktop/README.zh.md) · [繁體中文](desktop/README.zh-Hant.md) · [日本語](desktop/README.ja.md) · [한국어](desktop/README.ko.md) · [Français](desktop/README.fr.md) · [Español](desktop/README.es.md) |
| Contrat de compatibilité API des clients natifs | [English](desktop/API_COMPATIBILITY.md) · [简体中文](desktop/API_COMPATIBILITY.zh.md) · [繁體中文](desktop/API_COMPATIBILITY.zh-Hant.md) · [日本語](desktop/API_COMPATIBILITY.ja.md) · [한국어](desktop/API_COMPATIBILITY.ko.md) · [Français](desktop/API_COMPATIBILITY.fr.md) · [Español](desktop/API_COMPATIBILITY.es.md) |
| Données de régression du déplacement audio | [English](desktop/tests/fixtures/README.md) · [简体中文](desktop/tests/fixtures/README.zh.md) · [繁體中文](desktop/tests/fixtures/README.zh-Hant.md) · [日本語](desktop/tests/fixtures/README.ja.md) · [한국어](desktop/tests/fixtures/README.ko.md) · [Français](desktop/tests/fixtures/README.fr.md) · [Español](desktop/tests/fixtures/README.es.md) |
| Client Android | [English](android/README.md) · [简体中文](android/README.zh.md) · [繁體中文](android/README.zh-Hant.md) · [日本語](android/README.ja.md) · [한국어](android/README.ko.md) · [Français](android/README.fr.md) · [Español](android/README.es.md) |
| Validation Android | [English](android/VERIFICATION.md) · [简体中文](android/VERIFICATION.zh.md) · [繁體中文](android/VERIFICATION.zh-Hant.md) · [日本語](android/VERIFICATION.ja.md) · [한국어](android/VERIFICATION.ko.md) · [Français](android/VERIFICATION.fr.md) · [Español](android/VERIFICATION.es.md) |
| Client iPhone et iPad | [English](ios/README.md) · [简体中文](ios/README.zh.md) · [繁體中文](ios/README.zh-Hant.md) · [日本語](ios/README.ja.md) · [한국어](ios/README.ko.md) · [Français](ios/README.fr.md) · [Español](ios/README.es.md) |
| Extension de navigateur RYM | [English](extensions/rym/README.md) · [简体中文](extensions/rym/README.zh.md) · [繁體中文](extensions/rym/README.zh-Hant.md) · [日本語](extensions/rym/README.ja.md) · [한국어](extensions/rym/README.ko.md) · [Français](extensions/rym/README.fr.md) · [Español](extensions/rym/README.es.md) |
| Régressions des listes dans le navigateur | [English](cloud/web/test/browser/README.md) · [简体中文](cloud/web/test/browser/README.zh.md) · [繁體中文](cloud/web/test/browser/README.zh-Hant.md) · [日本語](cloud/web/test/browser/README.ja.md) · [한국어](cloud/web/test/browser/README.ko.md) · [Français](cloud/web/test/browser/README.fr.md) · [Español](cloud/web/test/browser/README.es.md) |
| Captures et reproduction | [English](docs/images/README.md) · [简体中文](docs/images/README.zh.md) · [繁體中文](docs/images/README.zh-Hant.md) · [日本語](docs/images/README.ja.md) · [한국어](docs/images/README.ko.md) · [Français](docs/images/README.fr.md) · [Español](docs/images/README.es.md) |

## Licence

Mihonban est distribué sous la [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). Si vous modifiez le logiciel et le rendez accessible par l’intermédiaire d’un réseau, l’AGPL vous oblige à proposer le code source correspondant à cette version.

Cette licence couvre uniquement le code et les modèles sûrs de ce dépôt. Elle n’accorde aucun droit de distribution sur la musique ou les métadonnées de tiers.
