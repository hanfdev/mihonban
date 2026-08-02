# Sauvegarde, migration et récupération de la base de données

[English](database-migration.md) · [简体中文](database-migration.zh.md) · [繁體中文](database-migration.zh-Hant.md) · [日本語](database-migration.ja.md) · [한국어](database-migration.ko.md) · [Français](database-migration.fr.md) · [Español](database-migration.es.md)

Ce document déplace un catalogue entre les Node SQLite locaux, les Wrangler D1 locaux et les Cloudflare D1 distants.

Si vous restez local, sauvegardez `<DATA_DIR>/mihonban.sqlite`, les paramètres d’administration JSON, runtime les secrets et l’audio séparément. Les sections à distance ne s’appliquent que lorsqu’un déploiement Cloudflare existe réellement.

## Ce qui doit être déplacé

| Données | Chemin de migration |
|---|---|
| Albums, morceaux, artistes, galeries, favoris, notes, publications sources | D1 Export/import SQL |
| OneDrive/R2/paramètres de modules et configurations de stockage nommé | Paramètres administrateur JSON |
| Mot de passe application/admin, secret de session, clé compagnon, secret de signature proxy | Configurer comme cible Worker secrets |
| KV limites de débit et caches de courte durée | Ne pas migrer |
| R2 index de cache | Même compartiment : exporter avec `--include-cache` ; nouveau seau : omettre et préchauffer |
| Audio et images originales | Copier/migrer dans la couche de stockage ; ne fait pas partie de D1 |

Le JSON administrateur seul n’est pas une sauvegarde de catalogue. Un fichier SQL D1 seul ne contient pas d’audio ni, par défaut, d’identifiants.

Les crédits ordonnés d’un album sont stockés dans `album_artists`. Les crédits propres à un morceau ne sont stockés dans `track_artists` que si nécessaire ; sans ligne, le morceau hérite des artistes de l’album. Les deux tables figurent dans les exports SQL logiques. Après une mise à niveau, Mihonban les crée et reprend l’ancien texte d’artiste comme un seul crédit exact. Il ne le découpe pas aux virgules, valides dans les noms et les clés de tri. Utilisez l’éditeur d’album pour une collaboration complète, ou le bouton artiste de la gestion des morceaux pour un invité présent sur quelques titres.

`artist_sort` est facultatif : les valeurs vides sont conservées lors des exports et imports, tandis que la recherche et le tri se replient sur le nom d’origine à l’exécution.

## Avant de déplacer le stockage local Node vers Cloudflare

Cloudflare ne peut pas lire un backend Node `local`. Tant que l’ancienne application Node est toujours disponible :

1. Ajouter et tester OneDrive, WebDAV ou Google Drive.
2. Migrer chaque album lié au stockage local.
3. Vérifier les flux et images depuis le backend cloud.
4. Ensuite, exportez la base de données.

## 1. Sauvegarder la source

Dans l’ancienne application, connectez-vous en tant qu’administrateur et téléchargez **Admin → Paramètres de sauvegarde**. Stockez ce JSON chiffré.

Pour Node, la base de données est `<DATA_DIR>/mihonban.sqlite`. Les fichiers locaux Wrangler D1 sont sous `cloud/worker/.wrangler/state/v3/d1/`.

Arrêtez les écritures lors du dernier coupage. L’exportateur utilise une transaction de lecture SQLite, mais éviter les modifications simultanées facilite la vérification.

## 2. Préparer la cible

Créer D1/KV, copier le modèle public dans la configuration locale ignorée, placer le
Real ID dans ce fichier local, et appliquer le schéma :

```bash
cd cloud/worker
npm ci
cp wrangler.jsonc wrangler.local.jsonc
# Remplacez dans wrangler.local.jsonc les identifiants D1／KV remplis de zéros.
npx wrangler d1 execute mihonban --remote --file schema.sql \
  --config wrangler.local.jsonc
```

Sur PowerShell, utilisez `Copy-Item wrangler.jsonc wrangler.local.jsonc`. Le D1
La ressource s’appelle `mihonban`, correspondant à la configuration et à la Worker. Ne jamais mettre de compte
identifiants de ressources ou secrets de déploiement dans le modèle public.

Si la cible possède déjà des données importantes, exportez-les d’abord :

```bash
mkdir -p ../../backups
npx wrangler d1 export mihonban --remote \
  --output ../../backups/remote-before-import.sql \
  --config wrangler.local.jsonc
```

## 3. Exportation et importation des données de bibliothèque

### Assistant Windows

À partir de la racine du dépôt :

```powershell
powershell -File tools\migrate-d1.ps1 -ImportRemote
```

L’assistant détecte automatiquement le Node SQLite ou Wrangler D1 local le plus récent et écrit un fichier SQL horodaté sous `backups/` ignorée. Il écrit D1 à distance uniquement lorsqu’`-ImportRemote` est présent ; omettez ce changement pour l’exportation uniquement. Avant chaque importation distante, il exporte également la cible actuelle vers `backups/` et annule si cette sauvegarde échoue. `-SkipRemoteBackup` est une dérogation d’urgence explicite.

L’assistant préfère ignorer `cloud/worker/wrangler.local.jsonc` lorsqu’il est présent et utilise sinon le modèle public. Passez `-WranglerConfig <path>` pour sélectionner une autre configuration privée.

Lorsque la cible conserve exactement le même R2 bucket et URL publique, ajoutez
`-IncludeCache` pour que Prewarm puisse passer des objets déjà en miroir à cet endroit :

```powershell
powershell -File tools\migrate-d1.ps1 `
  -Source "D:\mihonban-data\mihonban.sqlite" `
  -IncludeCache -ImportRemote
```

N’incluez pas cet index lorsque vous passez à un seau vide/différent : ses lignes
pointerait vers des objets qui ne sont pas présents. Si un index était omis tandis que le
Les mêmes objets publics existent toujours, les vérifications actuelles de préchauffe ces déterministes
URL d’objet avec HEAD et récupère l’index sans re-téléverser les octets d’image.

Lorsque plusieurs bases de données locales existent, il faut toujours `-Source` passer au lieu de compter sur le temps de modification.

Source explicite :

```powershell
powershell -File tools\migrate-d1.ps1 `
  -Source "D:\mihonban-data\mihonban.sqlite" `
  -Database "mihonban" `
  -WranglerConfig "cloud\worker\wrangler.local.jsonc" `
  -ImportRemote
```

### Manuel/multiplateforme

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

Le mode par défaut utilise UPSERT à clé primaire et conserve les lignes cibles absentes de la source. Un chemin unique conflictuel avec un ID différent échoue au lieu de supprimer silencieusement les données. Pour une nouvelle cible, cela produit un catalogue source exact. `--replace` efface d’abord les tables de catalogue incluses ; ne l’utilisez qu’après une sauvegarde distante.

Le SQL généré n’a intentionnellement aucune `BEGIN TRANSACTION` explicite ou
`COMMIT` : les importations actuelles de D1 à distance rejettent ces déclarations et Wrangler s’applique
un fichier téléchargé atomiquement. L’exportateur lit toujours la source en une SQLite
transaction, donc son instantané est cohérent.

`--include-config` exporte aussi les stockages nommés et les mêmes réglages autorisés
comme la sauvegarde admin, donc le SQL contient le stockage et les identifiants de service. Il
Exclut délibérément les hashages des mots de passe auditeurs/admins, Session Epoch, Companion
Heartbeat, analyse des horodatages et erreurs. Configure les mots de passe Worker cibles et
runtime les secrets de manière indépendante. Le JSON administrateur séparé reste le recommandé
Chemin de configuration. Même avec `--replace`, seules les clés de configuration autorisées
sont remplacés ; les lignes d’authentification cible et de runtime états restent intactes.
Pour le même R2 seau, ajoutez `--include-cache` ; omettez pour un nouveau seau.

## 4. Restauration de la configuration et des secrets

1. Déployer la Worker principale avec de nouveaux secrets `APP_PASSWORD`, `ADMIN_PASSWORD`, `SESSION_SECRET` et `COMPANION_KEY`.
2. Connectez-vous avec le nouveau mot de passe administrateur.
3. Paramètres d’administration → de sauvegarde → importer l’ancien JSON.
4. Tester chaque configuration de stockage et R2.
5. Si vous utilisez le proxy audio externe, réglez `STREAM_PROXY_SECRET` sur le Worker principal et la même valeur que `PROXY_SECRET` sur le Worker proxy.

Le JSON des paramètres ne rétablit intentionnellement pas les hachages de mot de passe ni l’état de la session.

## 5. Vérifier les totaux et le fonctionnement

```bash
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS albums FROM albums"
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS tracks FROM tracks"
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc --command \
  "SELECT COUNT(*) AS artists FROM artists"
```

Puis vérifiez :

- Albums, morceaux, artistes, favoris, notes, état caché et ordre.
- Une piste par backend de stockage, y compris la recherche.
- Images de couverture, d’avatar et de galerie.
- L’auditeur ne peut pas accéder aux objets cachés.
- L’exportation des paramètres d’administration fonctionne sur le nouveau déploiement.
- Si l’index R2 a été omis, exécuter prewarm : les objets publics existants sont récupérés avec HEAD et seuls les objets manquants sont téléchargés.

## 6. Bascule et retour arrière

Mettez à jour le `[cloud].url` compagnon seulement après vérification. Gardez l’ancienne base de données, l’ancien déploiement, la sauvegarde SQL, les réglages JSON et l’audio source jusqu’à ce que le nouveau déploiement ait passé un test de restauration.

Le retour en arrière consiste soit à revenir à l’ancien déploiement, soit à importer la sauvegarde SQL distante pré-importée dans une base de données D1 propre. Ne supprimez jamais la seule copie audio lors d’un coupe de base de données.

## Migration entre déploiements distants

Pour deux déploiements Cloudflare, exportez l’ancien D1 distant et importez-le dans le nouveau télécommandé après avoir appliqué le schéma. Gardez la même séparation : D1 SQL pour le catalogue, JSON administrateur pour la configuration, Worker les secrets définis indépendamment.
