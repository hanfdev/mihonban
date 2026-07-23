# Guide d’utilisation quotidienne

[English](manual.md) · [简体中文](manual.zh.md) · [繁體中文](manual.zh-Hant.md) · [日本語](manual.ja.md) · [한국어](manual.ko.md) · [Français](manual.fr.md) · [Español](manual.es.md)

Ce guide s’adresse aux administrateurs de bibliothèque. Les chemins et les URL dépendent de la runtime sélectionnée et de votre configuration privée.

## Points d’entrée

| Point d’entrée | But |
|---|---|
| Application web | Parcourir, jouer, rechercher, mettre en favori, importer et administrer |
| Boîte de réception locale | Dossiers optionnels ou archives RAR/ZIP/7z traités par le compagnon Python |
| `mihonban` CLI | Diagnostiquer, ingérer, surveiller, synchroniser, extraire et traiter RYM pages enregistrées |

Le compagnon Python et tout lecteur de bureau ne sont pas nécessaires pour la lecture web.

## Identités

- Mot de passe de l’auditeur : parcourir et lire du contenu authentifié.
- Mot de passe administrateur : télécharger, modifier, masquer, supprimer, mettre en favori, commander et configurer l’infrastructure.
- Mode invité sans mot de passe : accès optionnel en lecture seule sans saisie de mot de passe.
- Clé compagnon : identifiant machine pour le pipeline local optionnel.

`mihonban-guest` et `mihonban-admin` sont des paramètres par défaut générés uniquement par `tools\cloud-dev.cmd`. Les déploiements Node et manuels Cloudflare n’ont pas de mots de passe par défaut. Changez les paramètres par défaut des assistants locaux avant de partager l’accès.

Les mots de passe enregistrés dans Admin dépassent les valeurs de démarrage de l’environnement Admin. Changer l’un ou l’autre mot de passe révoque les sessions existantes.

## Lecture et interactions mobiles

- Le volume, la langue et le tri sont enregistrés par origin du navigateur. Un nouveau nom d’hôte ou domaine personnalisé repart avec de nouvelles préférences ; sans valeur enregistrée, le volume commence à 85 %.
- La lecture démarre dans l’événement de toucher/clic d’origine afin qu’Android Chrome puisse établir une lecture audible et une session multimédia système. Sur les navigateurs compatibles, l’écran verrouillé/la notification permet lecture, pause, piste précédente/suivante et recherche.
- Sur mobile, touchez la pochette ou la zone vide du mini-lecteur, ou faites glisser le mini-lecteur vers le haut, pour ouvrir l’écran de lecture. Les liens d’album et d’artiste restent indépendants.
- Un état de chargement apparaît pendant le changement d’image du livret ; balayez horizontalement pour passer à l’image précédente ou suivante.

## Dossiers et archives de la boîte de réception

1. Mettez un dossier d’album ou une archive que vous êtes autorisé à utiliser dans le `inbox` configuré.
2. Exécuter `mihonban watch`, ou traiter une fois avec `mihonban ingest --apply`.
3. Réviser les journaux et les rapports de quarantaine ; les échecs difficiles ne sont jamais ignorés silencieusement.
4. Lorsque la synchronisation cloud est configurée, exécutez `mihonban cloud sync`.

Le pipeline prend en charge les dossiers directs, une archive et des archives imbriquées. Il attend trois sondages inchangés avant de traiter afin que les fichiers partiellement copiés ne soient pas ouverts. Le travail se déroule dans une zone temporaire privée. Les éléments sources réussis sont transférés à `_done` ; les échecs graves et leur rapport passent à `_quarantine`.

Le pipeline extrait, répare l’encodage des noms de fichiers japonais, exécute l’organisation des métadonnées/tags, normalise la disposition de la bibliothèque et peut enregistrer le résultat avec l’API. Les métadonnées ambiguës restent disponibles pour une consultation manuelle.

## Analyse des sources cloud et surveillance locale

Le module source Admin lit les titres et liens RSS/Atom/Blogger pris en charge. Cloudflare Cron ou l’intervalle de Node peuvent l’exécuter lorsque l’ordinateur personnel est éteint. Il ne télécharge ni ne décompacte la musique.

`mihonban watch` nécessite l’accès au `inbox` local, aux fichiers persistants, au 7-Zip et à Beets. Exécutez-le sur Windows, macOS, Linux ou un NAS ; il ne peut pas fonctionner à l’intérieur de Cloudflare Workers.

## Importation web

1. Connectez-vous en tant qu’administrateur et ouvrez l’Importation.
2. Sélectionnez les morceaux appartenant à un album et critiquez l’artiste, le titre, l’année, les noms de fichiers et l’ordre.
3. Choisir/recadrer un recouvrement et sélectionner le stockage destiné à l’écriture.
4. Commencez le téléchargement et attendez que chaque morceau se termine avant de quitter la page.
5. Ouvrez l’album terminé, jouez une piste et cherchez vers la fin.

Utilisez `mihonban cloud pull` lorsque la copie web doit retourner dans la bibliothèque locale. Ajoutez `--retag` uniquement lorsque les métadonnées cloud doivent mettre à jour les balises locales existantes.

## RYM Métadonnées

Mihonban n’automatise pas les requêtes à Rate Your Music. Sauvegardez manuellement une page de sortie dans le navigateur, importez le HTML sauvegardé sur la page de l’album, et évaluez la note, le nombre de votes, les genres primaires/secondaires et les descripteurs avant de sauvegarder. La CLI peut analyser, faire correspondre et écrire manuellement les pages sauvegardées en masse.

## Discogs

Les administrateurs peuvent rechercher les versions ou les artistes et prévisualiser une importation d’images, genres/styles et texte biographique. Configurez un jeton Discogs personnel dans Admin. L’intégration utilise l’API officielle.

## Favoris et contenus masqués

- Les administrateurs peuvent ajouter des albums ou des morceaux aux favoris et les faire glisser pour les réordonner.
- Les auditeurs peuvent consulter la sélection de favoris, mais pas la modifier.
- Les albums, morceaux et artistes masqués, ainsi que les genres, images, résultats de recherche et favoris qui n’existent que dans du contenu masqué, sont exclus des réponses destinées aux auditeurs.
- « Afficher les éléments masqués » est un état d’affichage réservé aux administrateurs et partagé entre les listes d’albums, de morceaux et d’artistes.
- Le compteur d’albums de l’en-tête suit le même état : il inclut les albums masqués uniquement lorsque cette option est activée.
- Dans la galerie d’un album, l’image précédente disparaît dès que vous changez d’image. Un indicateur reste visible jusqu’au chargement de l’image choisie ; en cas d’échec, un état d’erreur explicite est affiché.

Après une modification de visibilité, vérifiez également le résultat dans une session d’auditeur distincte au lieu de vous fier uniquement à l’interface d’administration.

## Stockage nommé

- La cible d’écriture concerne uniquement les nouveaux téléversements.
- Les albums existants continuent d’utiliser le stockage indiqué par leur propre `storage_id`.
- La migration copie les objets requis et ne modifie les liaisons qu’après la réussite de toutes les copies indispensables.
- Les objets sources ne sont pas supprimés automatiquement.
- Après un déplacement en masse, testez la lecture, la recherche, les pochettes, les avatars et les galeries avant d’archiver les anciennes copies.

Voir [Backends de stockage et migration de fichiers](storage.fr.md).

## Écran d’administration

- État système : totaux album/piste/stockage et battement de cœur compagnon.
- Mots de passe et accès invité.
- Paramètres de sauvegarde et de restauration : configuration sensible, pas lignes de catalogue.
- Backends de stockage nommés et cible d’écriture.
- R2 image miroir et préchauffe.
- Discogs jeton.
- Modules optionnels de balayage source et de proxy audio.

Le JSON des paramètres contient des identifiants. Stockez-le dans un coffre-fort chiffré et ne l’attachez jamais à des issues, chats, e-mails ou Git.

## Routine de sauvegarde

| Quand | Action |
|---|---|
| Après une importante importation | Sauvegardez Node SQLite ou exportez D1 SQL ; confirmez l’existence d’une seconde copie audio |
| Après modifications de stockage/R2/module | Exporter un nouveau JSON des paramètres d’administration |
| Avant une mise à jour d’application | Base de données + paramètres JSON + identifiant actuel de commit/déploiement |
| Périodiquement | Effectuer un test de restauration plutôt que de vérifier uniquement l’existence de fichiers |

Voir [Sauvegarde, migration et récupération de base de données](database-migration.fr.md).

## Commandes courantes

```text
mihonban doctor
mihonban ingest --apply
mihonban watch
mihonban cloud sync
mihonban cloud pull
mihonban cloud pull --retag
mihonban rym parse
mihonban rym match
mihonban rym write --apply

cd cloud/worker && npm test
cd cloud/web && npm test && npm run build
```

## Dépannage

| Symptôme | Action |
|---|---|
| La boîte de réception ne fait rien | Confirmez que l’élément est pris en charge et entièrement copié, qu’un seul observateur s’exécute, et inspectez `data_dir/logs` |
| L’élément est mis en quarantaine | Lisez son rapport ; vérifiez la corruption, le mot de passe de l’archive, les fichiers non pris en charge, et la confiance en correspondance |
| L’application web ne contient pas d’anciens albums | Restaurez la base de données du catalogue ; Paramètres d’administration Le JSON ne contient pas d’albums |
| Retour de lecture 502 | Testez le stockage nommé de l’album et confirmez qu’aucun fichier n’a été déplacé à l’extérieur de Mihonban |
| La progression avance mais aucun son n’est audible | Vérifiez le volume du lecteur, de l’onglet et de la sortie système ; forcez l’actualisation après une mise à jour. Un nouvel origin démarre à 85 % |
| Recherche d’échecs ou durée iOS est incorrecte | Vérifiez que les retours en amont/proxy sont corrects 206, `Content-Range` et longueur totale |
| Les images sont lentes ou Graph est limité | Testez et activez R2, puis préchauffez |
| La pochette fonctionne dans la liste mais pas dans la page détaillée | Forcez une actualisation. La version actuelle revient au stockage propriétaire et répare le miroir R2 manquant ; si le problème persiste, testez ce stockage et R2 |
| Google Drive ne trouve pas les fichiers existants | Réautoriser l’étendue actuelle du disque et vérifier l’identifiant racine |
| Le téléchargement web est absent localement | Exécutez `mihonban cloud pull` et vérifiez la télécommande rclone configurée |
| La connexion revient 429 | Arrêtez de réessayer et attendez 15 minutes |
| La connexion HTTP locale ne persiste pas | Définir `DEV_INSECURE_COOKIE=1` ; ne jamais l’utiliser sur HTTPS public |
