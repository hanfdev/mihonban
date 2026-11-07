# Client Windows natif de Mihonban

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

Ce répertoire contient le client de bureau natif écrit en Rust. Il dessine son interface avec `egui`, communique directement avec l’API HTTP de Mihonban via `reqwest` et décode localement les formats audio pris en charge avec `rodio` / Symphonia. Il n’intègre pas de navigateur et ne charge pas l’application Web de Mihonban.

Le client accepte plusieurs profils de service Mihonban. L’adresse du service se modifie dans les paramètres, les mots de passe sont conservés dans le Gestionnaire d’informations d’identification Windows et le manifeste facultatif de mise à jour du client est indépendant des versions du serveur. Les builds étiquetés sont publiés sur [GitHub Releases](https://github.com/hanfdev/mihonban/releases), sous les tags `desktop-v*`, avec l’exécutable portable et un fichier de sommes SHA-256.

## Interface, paramètres et cache

Le client démarre maximisé sur son écran, en respectant la mise à l’échelle Windows et la zone de travail disponible autour de la barre des tâches. La fenêtre initiale ne reçoit volontairement aucune taille intérieure fixe : eframe 0.29 applique cette taille après avoir créé la fenêtre maximisée, ce qui peut la réduire sans effacer son état maximisé.

La carte de connexion adapte sa taille à son contenu et reste centrée sous la barre de navigation, même si une traduction ou une erreur en modifie la hauteur. Une étiquette compacte indique l’hôte, le port et le chemin de déploiement ; son infobulle conserve l’adresse complète. Une connexion échouée propose directement Réessayer et Paramètres.

L’interface reprend le style sombre d’archives et de vinyles de Mihonban : en-tête fixe, recherche centrée, mur de pochettes, présentation d’album et liste des pistes, avec un lecteur natif permanent. Les pochettes et l’audio utilisent un cache persistant propre à chaque profil. Les paramètres donnent accès au dossier, à une limite de 1–200 GB, à l’espace utilisé, à l’effacement du cache et à un raccourci vers l’Explorateur. Les écritures sont atomiques et l’éviction suit la politique du moins récemment utilisé ; un fichier dépassant la limite configurée est lu une fois sans être conservé.

Choisir une autre piste annule le téléchargement audio qu’elle remplace. L’arrêt de la lecture et l’annulation du préchargement libèrent également leurs connexions et fichiers incomplets, y compris lorsque le cache disque est désactivé. Vider un cache actif annule ses téléchargements pour éviter qu’ils le remplissent ensuite. Les fichiers terminés restent disponibles pour la lecture ; les téléchargements incomplets sont nettoyés à la fin ou à l’annulation de leur tâche. Si un autre processus verrouille temporairement un fichier incomplet, un démarrage ultérieur supprime les fragments abandonnés depuis plus de dix minutes.

Les portraits d’artistes sont recadrés au centre en conservant leurs proportions, dans la grille comme dans la fiche d’artiste. Le comportement correspond au `object-fit: cover` du client Web pour les photos horizontales et verticales.

Sous Windows, réduire la fenêtre masque par défaut le client dans son icône native de zone de notification ; la lecture et la progression de la file continuent en arrière-plan. Double-cliquez sur l’icône originale Mihonban ou choisissez Afficher la fenêtre principale dans son menu contextuel pour restaurer la fenêtre. Ce menu propose aussi Lecture/Pause et Quitter. Paramètres → Comportement de la fenêtre mémorise séparément les options de réduction et de fermeture vers la zone de notification. Par défaut, fermer la fenêtre quitte encore l’application, et Quitter dans la zone de notification la termine toujours. Si l’initialisation de l’icône échoue, le fonctionnement normal de la fenêtre reste disponible.

Le cache par défaut se trouve dans le répertoire local de données d’application Windows. Changer son dossier ou sa limite ne concerne que le client natif et ne modifie jamais le serveur Mihonban ni son stockage.

Les paramètres sont enregistrés par utilisateur Windows dans `%APPDATA%\Mihonban\Mihonban\config\config.json`. Toutes les copies du client exécutées sous le même compte lisent les mêmes profils, préférences de fenêtre et paramètres de cache, quel que soit l’emplacement de l’exécutable. Les mots de passe restent séparés dans le Gestionnaire d’informations d’identification Windows, avec le nom du profil comme clé. Une machine sans profil enregistré démarre avec l’adresse locale indicative intégrée.

Les paramètres utilisent les mêmes surfaces noires chaudes, titres à empattements, bordures fines et actions orange que la bibliothèque. La page centrée alterne entre un formulaire de service accompagné d’une colonne fenêtre/mises à jour et des cartes empilées sur toute la largeur dans les petites fenêtres. Les champs natifs, interrupteurs accessibles au clavier, lignes d’actions qui se replient et jauge de stockage local prennent en charge les sept langues. Enregistrez les paramètres du cache pour appliquer son activation, son dossier ou sa limite ; les options de zone de notification continuent de s’enregistrer automatiquement.

Un profil de serveur se supprime depuis la carte de service. Le dialogue de confirmation identifie le profil enregistré et son adresse, sélectionne Annuler par défaut et exige une seconde confirmation explicite. Au moins un profil est conservé. Supprimer le profil sélectionné active un autre profil enregistré et arrête sa lecture ; cela ne supprime ni musique du serveur, ni favoris, ni médias locaux en cache. Les identifiants enregistrés sont supprimés, sauf si un autre profil utilise encore le même nom d’identifiant.

## Mémoire et performances du catalogue

Le cache disque et la mémoire des images décodées sont distincts. Les pochettes et portraits utilisent un budget de textures LRU adapté au nombre de pochettes visibles (40–72 MiB, couvrant un écran 4K à 200 %), tandis que la galerie dispose de 16 MiB. Les transferts de textures en attente protègent les textures visibles de l’image précédente avant le nouveau calcul de visibilité. L’éviction libère les handles de textures natifs ; revenir à une image la recharge depuis le disque. Seules les cartes de galerie ou de recommandation visibles demandent des images. Deux téléchargements d’images, décodages ou résultats décodés en attente au maximum sont conservés simultanément ; le décodage et le redimensionnement s’effectuent hors du thread d’interface. Pochettes et portraits conservent leurs proportions dans une limite de 512 px ; les images de galerie sont limitées à 2048 px. L’ombrage d’origine des pochettes reste inchangé, tandis que les portraits n’allouent plus de copie assombrie inutilisée. Ces budgets couvrent les données de textures, pas le processus entier, le pilote graphique, les polices ou les allocations temporaires de décodage.

Pour examiner sans réseau le budget de textures d’un cache local existant, lancez `cargo run --locked --manifest-path desktop/Cargo.toml --example texture_memory_probe -- <cache-directory>` depuis la racine du dépôt. Le rapport estime les données RGBA décodées à partir des dimensions réelles et simule la politique LRU de production ; il ne mesure pas l’ensemble de travail du processus.

Le mur d’albums virtualise les lignes : seule la zone visible et une ligne adjacente de chaque côté créent des widgets de cartes, tandis que des espaces de même hauteur conservent toute l’étendue de défilement. Filtrage et tri réutilisent une liste d’indices partagée jusqu’à ce qu’un filtre ou la bibliothèque change ; les choix de décennie, d’artiste et de genre ne sont reconstruits que lorsque les données changent. Les identifiants d’interaction suivent l’identité des albums, stabilisant le survol et le clic lorsque des lignes entrent à l’écran. Le défilement fluide natif, les durées d’animation des cartes et le style de la barre de défilement droite sont conservés.

La page d’artiste réutilise d’une image à l’autre ses totaux d’albums, genres et données de recherche. Le rafraîchissement des métadonnées ou le changement de profil invalide cet instantané, même si le nombre d’albums ou d’artistes reste identique. Des genres ne différant que par la casse ASCII partagent un filtre, avec l’orthographe la plus fréquente à l’affichage. Seul le résultat filtré courant est conservé : saisir de nouvelles recherches n’accumule pas de cache d’historique.

La liste des pistes omet la ligne d’artiste lorsqu’elle répète exactement les crédits ordonnés de l’album. Les pistes ayant d’autres crédits conservent leurs liens individuels vers les artistes. Sans différence de crédits, l’album utilise des lignes compactes ; dès qu’une piste exige une seconde ligne, toutes adoptent la même hauteur supérieure. Les bandes de galerie et d’albums similaires ont des barres de défilement couvrant toute la largeur disponible.

Les accès au cache disque mettent à jour les dates LRU en mémoire et les sauvegardent lors de la prochaine modification du cache, au lieu de réécrire tout l’index pour chaque image. Une image en échec attend 30 secondes avant une nouvelle tentative, évitant des requêtes continues sur une pochette absente. Depuis la racine, lancez `cargo run --release --locked --manifest-path desktop/Cargo.toml --example scroll_layout_probe` pour comparer sans interface une grille complète et une disposition egui virtualisée. Ce benchmark CPU synthétique vérifie l’équivalence des cartes visibles et de la hauteur de défilement ; il ne mesure ni FPS applicatifs, ni rendu GPU, ni décodage d’images, ni latence de molette.

## Lecture

Le lecteur suit la disposition Web : la barre compacte aligne pochette, informations de piste, commandes, position et volume sur une seule ligne. Sélectionner la pochette ouvre En cours de lecture avec un fond de pochette flouté, une composition centrée à deux colonnes et une commande orange pendant la lecture. Le titre ouvre l’album, le nom d’artiste ouvre sa page et Échap replie le lecteur. Espace alterne lecture et pause dans les deux vues.

Les deux vues partagent le mode aléatoire, les modes sans répétition/tout/une piste et la sourdine. Le mode aléatoire parcourt chaque piste de la file une fois avant de s’arrêter ou de recommencer ; Précédent remonte cet ordre. Le déplacement dans la piste prévisualise le temps pendant le glissement et applique la position au relâchement. Une barre de position focalisée accepte les flèches (cinq secondes, trente avec Maj) et Début/Fin ; le volume accepte les flèches et restaure le niveau audible précédent après la sourdine.

Les fichiers audio utilisent le constructeur de décodeur Rodio tenant compte du fichier, qui reçoit sa longueur complète et sa capacité de déplacement. Cela permet la navigation dans un FLAC sans table de recherche. La position vient directement de la sortie audio ; un déplacement échoué affiche une brève notification au lieu d’être masqué par une position temporairement imposée. Le [fichier de régression de navigation](tests/fixtures/README.fr.md) contient un son généré sans table de recherche, et les tests comparent les échantillons après déplacements avant/arrière à un décodage séquentiel. Pour un contrôle supplémentaire avec une vraie sortie audio et des fichiers locaux complets, lancez depuis la racine `cargo run --locked --manifest-path desktop/Cargo.toml --example seek_backend_probe -- <audio-file> [<audio-file> ...]`.

## Compilation et tests

Depuis la racine du dépôt, compilez et lancez le client Windows optimisé :

```powershell
cargo run --release --locked --manifest-path desktop/Cargo.toml
```

Avant de publier des modifications du client, lancez `cargo test --locked --manifest-path desktop/Cargo.toml` depuis la racine. La suite couvre l’interruption de téléchargements HTTP locaux, les changements de piste, l’effacement et l’éviction du cache, l’invalidation du cache d’artistes et les régressions de disposition des lignes. Les deux benchmarks synthétiques sont exclus des tests ordinaires ; utilisez `cargo test --release --locked --manifest-path desktop/Cargo.toml -- --ignored --nocapture` pour comparer les coûts d’agrégation des artistes ou d’éviction. Leurs durées mesurent des algorithmes, pas les FPS de l’application ni la mémoire du processus.

Le profil release privilégie un exécutable réduit. Les polices intégrées sont compressées dans l’exécutable et décompressées au démarrage, préservant la typographie des langues prises en charge et des métadonnées musicales. Les exécutables Debug sont plus volumineux car ils contiennent le code de développement non optimisé. Les exécutables Release utilisent le sous-système GUI de Windows et s’ouvrent sans fenêtre de terminal.

## Mises à jour

L’URL facultative de source de mise à jour est fournie par l’éditeur du client Windows. Laissez-la vide sans canal de diffusion ; elle est distincte de l’adresse du service Mihonban et ne met pas le serveur à jour. Vérifier les mises à jour lit les métadonnées de version ; Télécharger et vérifier prépare un nouvel exécutable à remplacer manuellement, sans installation silencieuse.

La source désigne un petit document JSON hébergé par le canal de diffusion du client, par exemple :

```json
{
  "latest": "0.2.0",
  "download_url": "https://github.com/hanfdev/mihonban/releases/download/desktop-v0.2.0/mihonban_desktop.exe",
  "sha256": "...",
  "notes": "..."
}
```

Consultez le [contrat de compatibilité de l’API native](API_COMPATIBILITY.fr.md) pour les exigences serveur, et le [guide du projet](../README.fr.md) pour installer le serveur et découvrir les autres clients.
