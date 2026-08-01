# Architecture et modèle runtime

[English](cloud.md) · [简体中文](cloud.zh.md) · [繁體中文](cloud.zh-Hant.md) · [日本語](cloud.ja.md) · [한국어](cloud.ko.md) · [Français](cloud.fr.md) · [Español](cloud.es.md)

Mihonban utilise la même interface React et la même API compatible Worker dans les déploiements locaux et cloud. Seuls les adaptateurs de persistance et d’accès aux fichiers changent selon le runtime.

## Composants

| Composant | Node | Wrangler local | Cloudflare | Nature des données |
|---|---:|---:|---:|---|
| Ressources React | Oui | Oui | Oui | Reconstructibles |
| API Hono | Oui | Oui | Oui | Couche application sans état |
| Base de données du catalogue | SQLite | D1 locale | D1 distante | Métadonnées faisant autorité |
| Limite de débit/cache KV | Adaptateur SQLite | KV local | Cloudflare KV | Reconstructible |
| Miroir d’images R2 | Optionnel | Liaison optionnelle | Optionnel | Cache d’images reconstructible |
| Backend à dossier local | Oui | Non | Non | Fichiers faisant autorité une fois configurés |
| OneDrive/WebDAV/Google Drive | Oui | Oui | Oui | Fichiers faisant autorité |
| Compagnon Python | Processus externe | Processus externe | Processus externe | Flux de travail local facultatif |

Les fichiers audio n’ont jamais leur place dans D1, KV, R2 cache d’images ou Git.

## Chemin de demande

```text
Browser --HTTP/HTTPS--> API runtime
                         |-- catalog metadata: SQLite or D1
                         |-- short cache/rate limit: KV adapter
                         |-- image mirror: optional R2
                         +-- named storage backend

OneDrive temporary URL ---------> usually 302 direct playback
WebDAV / Google Drive ----------> main API Range proxy
Node local folder --------------> Node Range stream
Optional external proxy --------> signed five-minute relay for temporary URLs
```

Le proxy externe ne reçoit que les sources pour lesquelles l’API principale peut obtenir une URL temporaire. Il ne reçoit jamais les identifiants WebDAV, Google Drive ou des dossiers locaux.

## Authentification et rôles

- Mot de passe de l’auditeur (`APP_PASSWORD` bootstrap) : parcourir et jouer.
- Mot de passe administrateur (`ADMIN_PASSWORD` bootstrap) : toutes les écritures et paramètres d’infrastructure.
- Mode invité sans mot de passe : un bouton d’Admin explicite qui accorde à l’auditeur un rôle sans mot de passe.
- Clé compagnon (`COMPANION_KEY`) : optionnelle `X-Api-Key` utilisée par le compagnon Python local.

Les mots de passe modifiés dans Admin sont stockés sous forme de hachages PBKDF2 et ont la priorité sur les valeurs de l’environnement bootstrap. Changer un mot de passe augmente l’époque de la session et révoque les cookies de connexion existants. Les échecs de connexion sont comptés par IP source ; six échecs verrouillent cette source pendant 15 minutes.

Les cookies de production nécessitent HTTPS. `DEV_INSECURE_COOKIE=1` n’existe que pour les tests HTTP locaux de confiance.

## Modèle de données

- `albums` : métadonnées d’album, `storage_id` nommées, états cachés et champs d’ordre.
- `tracks` : métadonnées des pistes et chemin relatif au stockage ; les pistes héritent du backend de l’album.
- `artists` : métadonnées de l’artiste, état caché, chemin d’avatar et `storage_id` avatar indépendant.
- `album_images` : chemins de galerie sur le backend de l’album et identité de source stable facultative pour rendre les imports externes idempotents.
- `favorites` : favoris de l’album/morceau et l’ordre.
- `notes` : notes d’album, notes d’artistes et biographies.
- `storages` : configurations nommées OneDrive, WebDAV, Google Drive ou Node-locales.
- `settings` : hachages de mot de passe, drapeaux de module, configuration R2, paramètres de source et autres états runtime.
- `source_posts`, `track_imports` et tables de cache-image : métadonnées opérationnelles.

L’autorité du titre d’une piste est explicite. Renommer une piste dans l’administration active son indicateur `tracks.title_override` ; les scans ultérieurs du compagnon, les réenregistrements d’album complet et la synchronisation d’une piste conservent alors ce titre, tandis que les pistes ordinaires continuent de suivre les tags du fichier. Les bases D1 existantes ajoutent automatiquement cette colonne. Une ligne antérieure à la migration est classée lors de son prochain enregistrement : une valeur identique devient un titre synchronisé ordinaire ; en cas de différence, le titre D1 actuel est conservé prudemment comme modification manuelle afin d’éviter toute perte. Les sauvegardes logiques SQLite/D1 conservent cet indicateur.

Le JSON des paramètres d’administrateur exporte un sous-ensemble autorisé de paramètres ainsi que des configurations de stockage nommées, y compris les identifiants. Il exclut les lignes de catalogue, les hachages de mots de passe et les anciennes sessions. Stockez-le chiffré.

## Téléversement et lecture

- Un backend nommé unique est sélectionné comme cible d’écriture pour les nouveaux téléchargements.
- Les albums existants conservent leur propre `storage_id` ; changer la cible d’écriture ne les déplace pas.
- OneDrive utilise une session de téléversement et des URL de téléchargement temporaires.
- WebDAV et Google Drive uploads/flux passent par l’API principale.
- Node fichiers à dossier local sont diffusés uniquement par le Node runtime.
- Range et `Content-Range` comportements sont nécessaires pour une recherche fiable, en particulier sur iOS.

## Images

Sans R2, l’API lit les images depuis le stockage qui les possède et applique des en-têtes de cache pour l’edge et le navigateur. Lorsque R2 est activé, la première requête ou le préchauffage copie l’image dans le miroir, puis les requêtes suivantes peuvent être redirigées vers son URL publique. Le remplacement d’une image invalide son index afin qu’elle puisse être mise en miroir à nouveau. Si l’index D1 a disparu mais que le même objet R2 public existe encore, le préchauffage le réenregistre au moyen d’un nombre limité de requêtes HEAD, sans télécharger ni téléverser de nouveau les données de l’image.

Les redirections d’images R2 publiques sont mises en cache cinq minutes par le navigateur et l’edge Cloudflare, avec `stale-while-revalidate`. La destination est une URL R2 versionnée et immuable : actualiser la bibliothèque ne relance donc pas le Worker pour chaque pochette, tandis qu’un remplacement est pris en compte après cette fenêtre. Les redirections d’images masquées et d’audio restent privées et sans cache.

Les listes d’albums et les surfaces compactes utilisent des dérivés WebP de 256 px ou 640 px produits depuis le fichier enregistré par Cloudflare Image Transformations. `fit: scale-down` conserve exactement le cadrage manuel ou Discogs sans dépendre d’un cache de miniatures du fournisseur susceptible d’être obsolète, tout en évitant de décoder des sources de plusieurs Mo pendant le défilement. Les vues de détail et de recadrage utilisent toujours l’original. R2 conserve `art:<album-id>:original` comme source de transformation, avec `art:<album-id>:256` et `art:<album-id>:640`. Si la transformation est indisponible, l’API sert l’original en secours sans jamais l’enregistrer sous une clé de dérivé.

Si une redirection vers le miroir public aboutit à un objet absent ou obsolète, l’application web réessaie depuis le stockage propriétaire. Le Worker valide les octets de l’image, revient de la miniature du fournisseur au fichier original si nécessaire, puis répare l’objet R2 et son index D1 versionné après une récupération réussie. Un ancien 404 mis en cache devient ainsi auto-réparable sans exposer les identifiants du stockage privé au navigateur.

R2 n’est pas un backend audio et n’est pas la base de données du catalogue.

## Tâches planifiées

Cloudflare utilise le déclencheur Wrangler Cron à la 17e minute toutes les six heures. Node utilise `SOURCE_SCAN_HOURS` (`6` par défaut, `0` le désactive). Le scan de source lit les titres et liens RSS/Atom/Blogger pris en charge ; il ne télécharge pas de musique.

`mihonban watch` est différent : il surveille une vraie boîte de réception locale et invoque 7-Zip/beets. Il doit fonctionner sur un ordinateur ou un NAS pouvant accéder à ce répertoire et ne peut pas s’exécuter à l’intérieur de Cloudflare Workers.

## Couches de sauvegarde et de récupération

1. Catalogue : sauvegarde compatible SQLite ou export SQL logique de D1.
2. Configuration : paramètres administrateur JSON, chiffré au repos.
3. Secrets d’exécution : gestionnaire de mots de passe ou coffre de secrets du déploiement.
4. Audio et images originales : sauvegarde indépendante au niveau du stockage.
5. KV : à reconstruire. L’index d’images R2 ne doit être migré que si le même compartiment est conservé ; sinon, réenregistrez les objets publics existants ou reconstruisez l’index par préchauffage.

Consultez [Sauvegarde, migration et récupération de la base de données](database-migration.fr.md) pour connaître l’ordre complet.

## Limites de l’hébergement

Le forfait gratuit de Cloudflare peut convenir à une bibliothèque personnelle ou à quelques auditeurs, mais les quotas et les conditions changent. Les requêtes API, les lignes de D1, les opérations de KV, le R2 et l’audio proxy consomment tous les ressources de la plateforme. OneDrive URL temporaires contournent souvent le Worker ; WebDAV, Google Drive, les flux de Node locaux et les routes proxy activées ne le font pas.

Workers ne peut pas accéder aux dossiers d’un ordinateur personnel, rester résident pour les événements du système de fichiers, transcoder l’audio, exécuter Beets ou extraire des archives. Gardez ces tâches dans le compagnon optionnel.

## Diagnostics

Cloudflare :

```bash
cd cloud/worker
npx wrangler tail
npx wrangler d1 execute mihonban --remote --config wrangler.local.jsonc \
  --command "SELECT COUNT(*) AS albums FROM albums"
```

Wrangler local utilise la même commande avec `--local`. Sous Node, vérifiez `DATA_DIR`, le journal de démarrage et l’état du système dans l’administration. N’inscrivez jamais dans les journaux des jetons d’actualisation, des URL audio signées, des exports de réglages ou les en-têtes d’autorisation des requêtes.
