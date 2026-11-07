# Contrat de compatibilité du client natif

[English](API_COMPATIBILITY.md) · [简体中文](API_COMPATIBILITY.zh.md) · [繁體中文](API_COMPATIBILITY.zh-Hant.md) · [日本語](API_COMPATIBILITY.ja.md) · [한국어](API_COMPATIBILITY.ko.md) · [Français](API_COMPATIBILITY.fr.md) · [Español](API_COMPATIBILITY.es.md)

Le client natif est distinct de `cloud/web`. Le serveur Mihonban peut modifier son interface Web et être déployé indépendamment tant que les comportements API suivants restent compatibles.

## Session et catalogue

Le client conserve les cookies de session entre les requêtes. Une session invitée configurée permet de parcourir sans mot de passe ; un déploiement protégé exige une connexion. Les albums masqués et les modifications des favoris partagés restent soumis aux permissions du serveur.

- `GET /api/health` renvoie une réponse réussie.
- `GET /api/me` renvoie l’objet de session courant. Un `401` signifie que le client doit afficher le parcours de saisie du mot de passe.
- `POST /api/login` accepte `{ "password": "..." }` et renvoie `{ "ok": true, "role": "user|admin" }`.
- `GET /api/library` renvoie le tableau des albums visibles.
- `GET /api/tracks` renvoie le tableau des pistes visibles.
- `GET /api/album/:id` renvoie un objet album contenant un tableau `tracks`.
- `GET /api/artists` renvoie les métadonnées des artistes.
- `GET /api/favorites` renvoie un objet contenant les tableaux `albums` et `tracks`, avec un `id` pour chaque entrée.
- `PUT /api/favorites/:kind/:id` ajoute un favori partagé ; `DELETE` sur le même chemin le retire. `kind` vaut `album` ou `track`. Ces écritures exigent les droits d’administration.

Les listes d’albums et de pistes acceptent `?hidden=1` pour un administrateur autorisé. Le détail d’album peut aussi contenir `note`, `images` et `similar`. Les noms d’artistes et identifiants sont encodés pour les URL dans les chemins de requête.

## Images et audio

- `GET /api/art/:albumId?s=480` renvoie le contenu d’une image.
- `GET /api/image/:id?s=:size` renvoie une image de galerie d’album.
- `GET /api/artist-bio/:name` renvoie un objet contenant la chaîne `bio`.
- `GET /api/artist-art/:name` renvoie une image d’artiste ; le client ajoute `?v=c` pour un portrait personnalisé.
- `GET /api/stream/:trackId` renvoie les octets audio d’origine ou une redirection qui permet de les obtenir.

Le client de bureau télécharge un fichier audio complet pour le décoder et se déplacer localement ; il ne dépend pas de la disposition de streaming du lecteur Web. Les images sont limitées à 32 MiB par réponse. Voir [`src/api.rs`](src/api.rs) pour les chemins exacts et les valeurs par défaut de désérialisation.

## Compatibilité et mises à jour du client

Le client ignore les champs JSON inconnus et fournit des valeurs par défaut pour les champs facultatifs définis dans ses modèles. Les champs obligatoires, notamment les identifiants d’album, noms d’artiste et titres, doivent conserver des types compatibles. Accepter de nouveaux champs inconnus ne rend pas facultatifs les champs déjà obligatoires. Le client n’accède pas à la base Mihonban, aux identifiants de stockage ni aux fichiers de déploiement. Migrations du serveur, stockage et versions du client peuvent donc évoluer indépendamment dans les limites de ce contrat.

Les versions du client peuvent utiliser un manifeste JSON hébergé séparément avec `latest`, `download_url`, `sha256` et `notes`. Publiez une somme SHA-256 : le client actuel ne la vérifie que si le champ est non vide. Les téléchargements préparent un remplacement manuel de l’exécutable, sans installation automatique ni mise à jour du serveur. Le [guide de bureau](README.fr.md) détaille configuration, compilation et lecture.
