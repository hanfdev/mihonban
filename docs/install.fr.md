# Installer et déployer

[English](install.md) · [简体中文](install.zh.md) · [繁體中文](install.zh-Hant.md) · [日本語](install.ja.md) · [한국어](install.ko.md) · [Français](install.fr.md) · [Español](install.es.md)

Ce guide couvre les trois runtimes supportés et le compagnon local Python optionnel. Choisissez une application runtime ; le compagnon est un outil de workflow supplémentaire, et non une exigence serveur.

## 1. Prérequis

- Node.js 22 ans ou plus
- Vas-y
- Cloudflare compte uniquement lors du déploiement sur Cloudflare
- OneDrive, WebDAV ou Google Drive pour un déploiement Cloudflare
- Python 3.11 ou plus récente et 7-Zip (`7z`, `7zz` ou `7za`) uniquement pour le compagnon local
- `rclone` optionnelle pour la synchronisation des fichiers local-cloud pilotée par des compagnons

Ne placez pas de bases de données SQLite en direct, `music_root`, `data_dir`, annuaires temporaires ou `node_modules` dans OneDrive, Dropbox, iCloud ou un autre dossier synchronisé. Le dépôt lui-même peut être synchronisé si les données de compilation et de modification sont mises en place ailleurs.

Clonez le dépôt canonique :

```bash
git clone https://github.com/hanfdev/mihonban.git
cd mihonban
```

## 2. Choisir un runtime

| Runtime | URL par défaut | Base de données | Stockage dans les dossiers locaux |
|---|---|---|---:|
| Wrangler local | `http://127.0.0.1:8787` | Émulateur local D1/KV | Non |
| Node | `http://127.0.0.1:8788` | `<DATA_DIR>/mihonban.sqlite` | Oui |
| Cloudflare | Worker URL/domaine personnalisé | D1 distant + KV | Non |

Wrangler local correspond le plus à Cloudflare de production. Node est mieux pour un service local/NAS permanent et c’est le seul runtime capable de lire un backend de dossier local serveur.

## 3. Développement Wrangler local

### Assistant Windows

Lorsque le dépôt est sous OneDrive, utilisez :

```powershell
tools\cloud-dev.cmd
```

L’assistant copie `cloud/` dans `%TEMP%\mihonban-cloud-build` par défaut, installe les dépendances à cet endroit, construit React, applique le schéma local et commence Wrangler sur `0.0.0.0:8787`. Configurez `MIHONBAN_STAGE` vers un autre répertoire non synchronisé pour conserver sa D1 locale lors du nettoyage temporaire du répertoir.

Lors de la première exécution, il génère `.dev.vars` avec :

```text
APP_PASSWORD=mihonban-guest
ADMIN_PASSWORD=mihonban-admin
```

Les secrets restants sont aléatoires. Ces deux mots de passe sont uniquement des paramètres par défaut pour le développement local. Changez-les dans Admin avant de permettre à une autre personne de se connecter.

### Configuration manuelle Wrangler

```bash
cd cloud/web
npm ci
npm run build

cd ../worker
npm ci
# Créez .dev.vars à partir de .env.example et remplacez toutes les valeurs fictives.
# Définissez DEV_INSECURE_COOKIE=1 pour le HTTP local.
npx wrangler d1 execute DB --local --file schema.sql
npx wrangler dev --ip 0.0.0.0 --port 8787
```

Sans l’aide à la mise en scène, l’État local est sous `cloud/worker/.wrangler/`. Les `.wrangler/` et `.dev.vars` sont ignorés par Git.

Pour les tests téléphoniques, connectez le téléphone au même réseau local, laissez Node.js passer par le pare-feu hôte, puis ouvrez `http://<computer-lan-ip>:8787`. N’exposez pas ce serveur de développement en format HTTP simple à Internet.

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

Avant de commencer, édit `.env` :

```dotenv
APP_PASSWORD=choose-a-listener-password
ADMIN_PASSWORD=choose-a-separate-admin-password
SESSION_SECRET=at-least-32-random-characters
DEV_INSECURE_COOKIE=1
DATA_DIR=D:/mihonban-data
PORT=8788
```

Il n’y a pas de mots de passe Node intégrés. `APP_PASSWORD` est le mot de passe de l’écouteur ; l’accès invité sans mot de passe est un basculement administrateur distinct. Le serveur lie `0.0.0.0`, donc `http://<computer-lan-ip>:8788` fonctionne sur le LAN après que le pare-feu autorise le port.

La base de données est `<DATA_DIR>/mihonban.sqlite` ; quand `DATA_DIR` est désactivée, elle revient par défaut à `cloud/worker/data/`. Sauvegardez-la pendant que l’application est arrêtée ou avec des outils SQLite-conscientes. Les déploiements de Node public nécessitent HTTPS derrière une plateforme de confiance ou un proxy inverse. Réglez `TRUST_PROXY=1` seulement lorsque les requêtes passent toujours par un proxy que vous contrôlez.

## 5. Compagnon Python optionnel

Passez cette section lorsque le téléchargement/importation web est suffisant. Installez le compagnon pour la surveillance de la boîte de réception, des dossiers ou archives uniques/imbriquées, la réparation des tags, l’organisation locale et la réconciliation local/cloud.

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

`mihonban setup` écrit un TOML privé en dehors du dépôt. `MIHONBAN_CONFIG` est la variable de dérogation actuelle, pas un alias hérité. L’ordre de recherche est explicite `--config`, `MIHONBAN_CONFIG`, `./mihonban.toml`, puis le répertoire de configuration utilisateur de la plateforme.

Commandes courantes :

```text
mihonban ingest --apply
mihonban watch
mihonban cloud sync
mihonban cloud pull
```

Le compagnon ne peut pas s’exécuter à l’intérieur de Cloudflare Workers car il nécessite un système de fichiers local persistant et des outils externes comme 7-Zip et beets.

## 6. Déploiement sur Cloudflare

Le chemin manuel est canonique et ne nécessite pas le compagnon.

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

Ajouter `--location apac` (ou un autre indice de localisation supporté) à `d1 create` lorsque
Il vous faut une région primaire explicite. Copiez la configuration publique dans la zone ignorée
configuration de déploiement local, puis remplacer ses zéros placeholders par les fichiers retournés
D1 et KV IDs :

Si Wrangler propose de mettre à jour la configuration actuelle lors de la création de l’une ou l’autre des ressources,
réponse **Non** ; les vrais identifiants doivent être dans la copie privée créée ci-dessous.

```bash
cp wrangler.jsonc wrangler.local.jsonc
```

PowerShell utilise `Copy-Item wrangler.jsonc wrangler.local.jsonc`. Soyez réaliste
identifiants de compte et tous les secrets hors de la `wrangler.jsonc` publique. Puis exécutez :

```bash
npx wrangler d1 execute mihonban --remote --file schema.sql --config wrangler.local.jsonc
npx wrangler secret put APP_PASSWORD --config wrangler.local.jsonc
npx wrangler secret put ADMIN_PASSWORD --config wrangler.local.jsonc
npx wrangler secret put SESSION_SECRET --config wrangler.local.jsonc
npx wrangler deploy --config wrangler.local.jsonc
```

Cloudflare déploiement n’a pas de mot de passe par défaut pour l’écouteur ou l’administrateur. Entrez des valeurs uniques et utilisez au moins 32 caractères aléatoires pour `SESSION_SECRET`. Ajoutez `COMPANION_KEY` uniquement lorsqu’un compagnon local appellera le déploiement :

```bash
npx wrangler secret put COMPANION_KEY --config wrangler.local.jsonc
npx wrangler deploy --config wrangler.local.jsonc
```

Le même Worker sert `/api/*` et les React assets construits. Un hôte frontend séparé n’est pas nécessaire.

### Assistant combiné Windows optionnel

`tools\deploy-cloud.cmd` fournit Cloudflare ressources, invite les deux mots de passe, télécharge des secrets aléatoires de session/compagnons, écrit la section `[cloud]` compagnon, effectue la première synchronisation et installe le watcher. Utilisez-le uniquement pour le flux de travail combiné de Windows ; les utilisateurs uniquement dans le cloud doivent utiliser les commandes manuelles ci-dessus.

## 7. Configurer le stockage

Connectez-vous en tant qu’administrateur et ajoutez un backend nommé. Un backend doit être sélectionné comme cible d’écriture avant les téléchargements.

### OneDrive

Créez une application Azure avec lecture/écriture de fichiers délégués et accès hors ligne. Entrez l’ID client, le secret client, le jeton de rafraîchissement et l’ID du disque dans Admin, puis testez le backend. OneDrive lecture utilise normalement une URL temporaire et peut contourner le Worker.

### WebDAV

Saisissez l’URL racine de la bibliothèque et les identifiants. La lecture et le téléchargement passent par le Worker principal car WebDAV n’a pas d’URL de téléchargement publique temporaire.

### Google Drive

Activez l’API Drive et créez un client Desktop OAuth. Générez l’URL d’autorisation dans Admin, approuvez-la, copiez le `code` depuis le `http://localhost` redirigez si nécessaire, échangez-le, puis testez et ajoutez le backend. Le scope du disque scriptable est nécessaire pour la découverte et les téléchargements des bibliothèques existantes.

### Dossier local

Disponible uniquement dans le Node runtime. La racine configurée doit rester dans le système de fichiers du serveur et n’est pas portable à Cloudflare. Voir [Backends de stockage et migration de fichiers](storage.fr.md).

## 8. Miroir R2 image optionnel

R2 est un miroir d’image reconstituable, pas la base de données du catalogue ni un backend audio. Créez un bucket, une URL de lecture publique et un jeton de lecture/écriture compatible S3 ; entrez-les dans Admin, testez, activez et préwarm. Gardez la clé d’accès et le secret hors de Git. Lors de la migration tout en conservant le même bucket, conservez `r2_cache` avec `-IncludeCache` ; pour un nouveau bucket, omettez-les et préheatez-les.

## 9. Déplacer une base de données existante

Ne créez pas un déploiement vide en supposant que la restauration des réglages fera réapparaître les albums. Le catalogue, les réglages, les secrets d’exécution et l’audio sont des couches distinctes. Suivez [Sauvegarde, migration et récupération de la base de données](database-migration.fr.md) avant de changer de runtime.

## 10. Proxy audio optionnel

Le Worker principal est déjà des proxies qui nécessitent des identifiants privés. Déployez `cloud/proxy-worker` seulement lorsqu’un second itinéraire Cloudflare ou un domaine personnalisé améliore de manière mesurable la lecture temporaire d’URL. Voir [Proxy audio Cloudflare optionnel](audio-proxy.fr.md).

## 11. Mises à jour

Avant une mise à jour importante, sauvegardez la base de données et les paramètres administratifs en JSON.

Cloudflare :

```bash
git pull
cd cloud/web && npm ci && npm run build
cd ../worker && npm ci
npx wrangler d1 execute mihonban --remote --file schema.sql --config wrangler.local.jsonc
npx wrangler deploy --config wrangler.local.jsonc
```

Node : reconstruire `cloud/web`, réinstaller Worker dépendances, arrêter l’ancien processus et redémarrer `npm run node`. `schema.sql` est reproductible et runtime migrations ajoutent des colonnes requises par les anciennes bases de données.

## 12. Vérification

- Se connecter avec les mots de passe de l’auditeur et de l’administrateur ; tester le mode invité sans mot de passe uniquement s’il est activé.
- Ouvrir la bibliothèque, les pistes, les artistes, les favoris, les importations et les routes d’administration.
- Lire une piste, chercher vers la fin, et tester les contrôles multimédias système sur iOS/Android.
- Ouvrir une couverture, un avatar d’artiste et une galerie d’album ; balayage de galerie de test sur mobile.
- Vérifier que les albums, morceaux, artistes, styles, images, résultats de recherche et favoris cachés ne sont pas disponibles pour les auditeurs.
- Téléverser un album jetable vers la cible d’écriture sélectionnée, puis le retirer.
- Exporter à la fois une sauvegarde de base de données et le JSON des paramètres d’administration.

## Dépannage

| Symptôme | Vérifier |
|---|---|
| La connexion revient immédiatement à la page de connexion | HTTP local doit `DEV_INSECURE_COOKIE=1` ; déploiement public nécessite HTTPS |
| Ancien mot de passe de l’environnement rejeté | Un mot de passe enregistré dans Admin est stocké comme hachage et a priorité |
| Retour de flux 502 | Liaison backend nommée, identifiants, chemin relatif et support Range en amont |
| Les albums existants manquent | Restaurez la base de données du catalogue ; paramètres Le JSON n’inclut pas les albums |
| Wrangler apparaît vide | Confirmez si la commande utilise `--local` ou `--remote`, et quel répertoire de stage possède `.wrangler/` |
| Node semble vide | Confirmer `DATA_DIR` pointe vers le `mihonban.sqlite` prévu |
| Le téléphone ne peut pas se connecter | Utilisez l’IP LAN, liez `0.0.0.0` et laissez passer le port sélectionné par le pare-feu |
| La connexion rend 429 | Arrêtez de réessayer et attendez 15 minutes que le verrouillage source-IP expire |
