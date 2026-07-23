# Backends de stockage et migration de fichiers

[English](storage.md) · [简体中文](storage.zh.md) · [繁體中文](storage.zh-Hant.md) · [日本語](storage.ja.md) · [한국어](storage.ko.md) · [Français](storage.fr.md) · [Español](storage.es.md)

mihonban sépare les métadonnées du catalogue du stockage des fichiers. D1 sait quel backend nommé possède chaque album ; les images audio et source restent dans ce backend.

## Modèle de données

| Champ/tableau | Signification |
|---|---|
| `storages` | Nommé OneDrive, WebDAV, Google Drive ou Node-configuration backend locale |
| `albums.storage_id` | Backend contenant le dossier album ; requis |
| `artists.storage_id` | Backend contenant l’avatar de l’artiste |
| `storages.is_write` | La cible unique nommée pour les nouveaux téléchargements ; sélectionnez-en une avant de télécharger |

Les chemins de piste et de galerie sont des chemins de stockage relatifs. Les pistes héritent du backend de l’album ; les images de galerie utilisent également le backend de l’album. Les avatars d’artiste ont leur propre liaison car un artiste peut couvrir plusieurs disques.

## Backends supportés

| Backend | Cloudflare | Node runtime | Chemin de lecture |
|---|---:|---:|---|
| OneDrive | Oui | Oui | URL temporaire, généralement 302 |
| WebDAV | Oui | Oui | Proxy principal Worker Range |
| Google Drive | Oui | Oui | Proxy Worker Range principal |
| Dossier local | Non | Oui | Node Range flux |

Un liaison à dossier local ne peut pas être lu après avoir déplacé l’API vers Cloudflare. Migrez ces albums vers un backend cloud avant d’exporter D1.

## Cible d’écriture

Changer la cible d’écriture n’affecte que les mises en ligne futures. Il ne déplace pas les albums existants. Les lectures peuvent couvrir un nombre quelconque de backends configurés.

Les téléchargements sont rejetés lorsqu’aucun backend n’a `is_write = 1`. Un seul backend peut être actif à la fois.

## Migration de l’album

Pour un album, le Worker :

1. Énumère les pistes, la couverture, les images de galerie et l’avatar de l’artiste s’il appartient au même backend source.
2. Copie chaque objet sur le même chemin relatif sur la cible.
3. Les mises à jour `albums.storage_id` seulement après que chaque copie requise ait réussi.
4. Relier l’avatar copié et invalider les index miroir d’image.
5. Laisse les objets sources intacts.

La migration en masse répète la même opération reprenable. Les albums déjà reliés sont sautés. Rafraîchir la page arrête la boucle client sans annuler les albums terminés.

## Limitations importantes

- La migration copie les octets ; elle ne réécrit pas les balises audio ni la disposition des répertoires.
- Les fichiers sources ne sont pas supprimés automatiquement.
- Les grands transferts basés sur des proxy consomment Worker requêtes et du temps d’exécution. Déplacez de grandes bibliothèques par lots.
- R2 est un miroir d’image, pas un backend audio.
- Une migration de base de données ne déplace pas les fichiers. Les mêmes chemins relatifs doivent exister dans le backend restauré.

## Stratégies pratiques

| Objectif | Procédure |
|---|---|
| Ajouter de la capacité | Ajouter un backend et le définir comme cible d’écriture ; garder les anciens albums là où ils sont |
| Tout déplacer | Ajouter/tester la cible, migrer en masse, vérifier la lecture, puis archiver la source plus tard |
| Déplacer Node stockage local vers Cloudflare | Tant que Node fonctionne encore, ajoutez un backend cloud et migrez les albums locaux avant D1’exporter |
| Annuler un déplacement de fichier | Migrer vers un backend testé ; des copies sources peuvent déjà exister |

## Comportement des sauvegardes

La sauvegarde de configuration admin inclut `storages` et leurs identifiants. Elle n’inclut ni les albums ni l’audio. Traitez le JSON comme un secret.

L’exportateur de base de données par défaut omet les configurations de stockage mais préserve chaque `storage_id` d’album/avatar. Restaurez le JSON administrateur après avoir importé D1 afin que ces identifiants se résolvent vers les backends au même nom.

Voir [database-migration.md](database-migration.fr.md) pour l’ordre complet de restauration.

## Vérification après la migration

- Tester le backend cible dans Admin.
- Jouer au moins un petit morceau et un grand tique ; chercher vers la fin.
- Vérifiez les images de couverture, d’avatar et de galerie.
- Confirmez que l’album rapporte le backend cible.
- Conserver la source jusqu’à ce qu’un test de sauvegarde et de restauration séparés aient réussi.

## Dépannage

| Symptôme | Cause/vérification |
|---|---|
| Le backend ne peut pas être supprimé | Un ou plusieurs albums y sont encore liés |
| Les métadonnées de l’album fonctionnent mais le flux est 502 | ID backend manquant, identifiants erronés, ou fichier non copié sur le même chemin |
| L’avatar casse après la migration de l’album | Vérifiez `artists.storage_id` et migrez l’album qui possède cet avatar |
| Échecs locaux en backend sur Cloudflare | Attendu ; le stockage local n’existe que dans le Node runtime |
| La migration s’arrête sur un gros fichier | Réessayer à partir de `fileIndex` signalé, ou déplacer le fichier à l’extérieur de Worker et conserver le même chemin |
