# Mihonban pour Android

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

Client natif Kotlin / Jetpack Compose pour un serveur Mihonban existant, sans WebView. Android 8.0 (API 26) ou ultérieur est requis.

## Aperçu

Captures réelles du client Android natif, avec données de test fictives et pochettes originales de démonstration. [Détails des captures](../docs/images/README.fr.md).

| Bibliothèque Android | Lecteur Android |
|:---:|:---:|
| <img src="../docs/images/android-library.webp" height="480" alt="Bibliothèque Android"> | <img src="../docs/images/android-player.webp" height="480" alt="Lecteur Android"> |

## Connexion

Compilez la préversion 0.1.10 localement ou téléchargez l’APK debug d’une [exécution Android réussie](https://github.com/hanfdev/mihonban/actions/workflows/android.yml). L’APK release nécessite votre propre clé de signature. Saisissez l’adresse racine du serveur, par exemple `https://music.example.com` ou `http://192.168.1.20:8788`, puis la phrase secrète auditeur ou administrateur. Ne la laissez vide que si le serveur autorise les invités. Un émulateur Android atteint le serveur de développement de l’hôte via `http://10.0.2.2:8788`.

HTTPS est recommandé à distance. HTTP local est pris en charge dans les modes de développement Node/Wrangler existants ; le serveur doit définir `DEV_INSECURE_COOKIE=1` pour les sessions par cookie en HTTP. L’application ne contourne pas la validation des certificats TLS.

## Fonctions natives

- Grille d’albums, listes de pistes, filtre de genre, tri par année/titre/artiste/note/ajout récent, recherche globale, crédits de plusieurs artistes et discographies.
- Détails d’album, notes, descriptions, albums associés, pagination et zoom des livrets, partage Android, favoris d’albums et de pistes partagés.
- Mini-lecteur et lecteur complet, recherche temporelle, lecture aléatoire, répétition, file modifiable, lecture suivante, minuterie, focus audio et débranchement du casque.
- Service de lecture Media3 au premier plan, avec commandes dans les notifications, au casque et sur l’écran verrouillé. La lecture continue en arrière-plan ; après redémarrage du processus, la file revient en pause.
- Téléchargements WorkManager dans le stockage privé, progression, pause/réessai/suppression, reprise par plages d’octets validées, métadonnées et pochettes persistantes, lecture hors ligne et consultation de la bibliothèque en cache.
- Administration : modification des albums/pistes/artistes, visibilité, suppression confirmée, import Discogs des métadonnées et livrets, ordre des images, envoi audio via le sélecteur de documents Android, analyse et enregistrement de dossiers du serveur.
- Administration du serveur : invités et modules, stockages nommés et tests/cible d’écriture, configuration/test R2, boîte de réception source et analyse, changement des phrases secrètes auditeur/administrateur.
- Palette Web conservée : surfaces brun-noir, texte ivoire chaud, accents vermillon et titres à empattements. Cibles tactiles, navigation inférieure, restauration du défilement, retour système, rotation et marges Android utilisent Compose natif.

Le catalogue s’ouvre directement sur les albums ou pistes. La barre supérieure se replie en défilant vers le haut et revient vers le bas. La densité de grille est réglable ; genre et tri se trouvent dans un panneau inférieur refermable. La recherche propose genres existants, ajouts récents et catégories de résultats. Les détails placent la pochette à côté des métadonnées et regroupent les actions secondaires dans un menu. L’état des onglets est enregistré par serveur et rôle d’accès. Le tri par ajout récent utilise la date de création initiale : modifier une note ou les métadonnées ne place pas un ancien album en tête.

La version 0.1.3 remplace le développement de la description sur place par un lecteur dédié. L’album garde un extrait brut de trois lignes ; le lecteur fixe son en-tête et son bouton Fermer, propose le retour en haut, restaure la position de l’album à la fermeture et mémorise la lecture à la réouverture. CommonMark, tableaux GFM et texte barré sont rendus nativement, avec texte sélectionnable, listes imbriquées, citations, liens, code, séparateurs et images autonomes. Tableaux larges et code défilent horizontalement. Le HTML brut reste du texte inerte. Couleurs et typographie Web sont conservées sans WebView.

La version 0.1.4 rend visibles les erreurs d’images : chargement, texte alternatif lisible et bouton de réessai remplacent les zones vides inexpliquées. Le réessai ne recharge que l’image et garde le lecteur ouvert. Une adresse inutilisable affiche une explication sans réessai voué à l’échec.

La version 0.1.5 corrige le retour en haut des descriptions composées d’un seul long paragraphe ou d’une citation. Le défilement interne aux blocs Markdown est désormais pris en compte, et le bouton disparaît au début. La famille de police des titres est partagée entre recréations d’Activity pour éviter de réallouer les tampons des polices embarquées.

La version 0.1.6 annule les requêtes actives quand leur tâche WorkManager s’arrête, même si le serveur bloque avant les en-têtes ou pendant le corps. Suspendre ou supprimer un téléchargement libère sa requête sans attendre l’expiration réseau. Les pochettes utilisent la même annulation. Un réessai manuel repart de zéro ; les tentatives automatiques peuvent reprendre des données partielles validées.

La version 0.1.7 affiche les images de description partageant un paragraphe avec du texte ou une légende. Texte et images gardent leur ordre, un espacement lisible et le format Markdown environnant, y compris dans les citations imbriquées. Chargement et réessai restent disponibles.

La version 0.1.8 remonte les commandes en portrait et rapproche la pochette du titre. Une rangée inférieure donne accès au téléchargement du morceau, au partage et à la file. Les téléchargements indiquent leur progression et permettent pause/réessai ; les fichiers terminés sont conservés. Le partage ouvre le sélecteur Android avec morceau, artiste et lien d’album Web. En paysage, cette rangée se place sous la pochette pour laisser de la place aux informations. Le lecteur complet n’affiche toujours que titre et artistes comme métadonnées.

La version 0.1.9 trie par défaut les albums par note pondérée, avec le même ajustement de confiance et les mêmes départages que le Web. Toucher un genre principal ou secondaire ouvre les albums correspondants dans cet ordre ; Retour revient à l’album. La barre repliée masque entièrement titre et icônes tout en préservant la zone de la barre d’état système.

La version 0.1.10 corrige les fragments de titre/icônes lorsque la barre est presque repliée. Elle fait sortir une barre de hauteur entière au lieu de centrer les commandes dans une bande rétrécie, mesure la distance réelle et atténue la fin du déplacement. La position fermée reste conservée après un changement d’échelle d’affichage. La marge de barre d’état reste hors de la rangée mobile.

More → Playback settings propose le préchargement du morceau suivant : Wi-Fi uniquement (défaut), toujours ou désactivé. Wi-Fi uniquement annule les requêtes anticipées lorsque le réseau par défaut devient cellulaire et reprend en Wi-Fi. Il suit le vrai morceau suivant en lecture aléatoire, attend la mise en tampon du morceau actuel, ignore les téléchargements et s’arrête en pause. Les premiers 16 MiB au maximum vont dans le cache musical existant, séparé par serveur/rôle et soumis à sa limite ; la lecture les réutilise. Ce réglage local ne demande pas de rôle administrateur.

Les téléphones de 320–599 dp proposent explicitement deux/trois colonnes ; les fenêtres plus étroites et les tablettes ont aussi des nombres distincts. Le bouton de grille est neutre, sans chiffre ni accent visible, mais le lecteur d’écran annonce le nombre courant. Le choix persiste après redémarrage et est partagé par bibliothèque, favoris et genres. La bibliothèque accepte le rafraîchissement par glissement. La file s’ouvre au morceau actuel, Retour revient au lecteur et la vider demande confirmation.

La version 0.1.2 garde les commandes dans la zone sûre et adapte la pochette à l’espace restant. Les métadonnées contiennent seulement titre et artistes ; toucher le titre ouvre l’album. La mise en tampon conserve une commande lecture/pause utilisable. Le mode aléatoire des listes est une sélection : il ne démarre ni ne modifie la lecture avant Play all. Celui des détails d’album lance directement cet album.

More → Cache settings affiche l’usage disque audio/images, fixe le cache musical entre 128 MB et 2 GB et efface les caches automatiques. Réduire la limite évince immédiatement les données musicales anciennes. Les images ont une limite séparée de 64 MB. Téléchargements explicites, catalogue sauvegardé et session sont préservés ; la lecture active peut recréer du cache. Les clés du cache de flux incluent serveur et rôle.

Les favoris sont une sélection éditoriale partagée du serveur. Comme sur le Web, auditeurs et invités les lisent, seuls les administrateurs les modifient. URL, instantanés du catalogue, images et téléchargements sont séparés par serveur et rôle. Les cookies de session utilisent Android Keystore AES-GCM ; les mots de passe ne sont pas enregistrés. Les données de l’application sont exclues de la sauvegarde Android.

## Compilation et tests

Utilisez JDK 17, Android SDK platform 35 et Build Tools 35.0.0. Ouvrez ce dossier dans Android Studio ou lancez depuis la racine du dépôt :

```powershell
android\gradlew.bat -p android testDebugUnitTest lintDebug assembleDebug assembleRelease
android\gradlew.bat -p android connectedDebugAndroidTest
```

Sur macOS/Linux :

```sh
sh android/gradlew -p android testDebugUnitTest lintDebug assembleDebug assembleRelease
sh android/gradlew -p android connectedDebugAndroidTest
```

Définissez `ANDROID_HOME` ou `sdk.dir` dans le fichier ignoré `android/local.properties`. Le wrapper fixe Gradle 8.9. Les tests n’exigent ni serveur de production, ni identifiants, ni fichiers audio. Les tests JVM couvrent compatibilité JSON, isolation URL/cookies, sécurité des redirections et validation des plages. Les tests instrumentés emploient un serveur HTTP intégré et du PCM synthétique pour vérifier navigation native, lecture, recherche temporelle, files, téléchargements et mode hors ligne.

Sorties :

- APK de développement installable : `app/build/outputs/apk/debug/app-debug.apk`.
- APK release non signé : `app/build/outputs/apk/release/app-release-unsigned.apk`. Signez-le avec votre clé de publication avant distribution et conservez cette clé pour les mises à jour.
- Rapports JVM et lint : `app/build/reports/`.

Le workflow Android GitHub Actions compile les deux variantes et lance JVM/lint, avec une tâche séparée sur émulateur API 35. Il ne publie pas de version et n’utilise pas de clé de production.

Voir les [résultats de validation](VERIFICATION.fr.md) pour les commandes, résultats enregistrés et limites de couverture. Les captures représentatives sont dans `docs/images/`. APK, séries complètes de captures et rapports de compilation restent des fichiers générés absents des sources. Les artefacts CI nécessitent l’accès au workflow et expirent selon la rétention GitHub.

## Limites actuelles

Les formats suivent Media3 et les décodeurs du dispositif, notamment MP3, FLAC, AAC, WAV, Vorbis et Opus courants. DSD/APE et autres codecs spécialisés ne sont pas embarqués. Les envois du téléphone résistent à la rotation mais restent une opération d’édition au premier plan : gardez l’application ouverte jusqu’à l’enregistrement. Ce n’est pas une file persistante d’envoi en arrière-plan. Un envoi interrompu avant l’enregistrement peut laisser des fichiers partiels à supprimer chez le fournisseur de stockage.

L’interface d’écoute propose chinois et anglais selon la langue du dispositif ; l’administration est actuellement en chinois simplifié. Mise à jour RYM assistée par navigateur, import HTML sauvegardé, sauvegarde/restauration complète des paramètres, migration massive du stockage et configuration OAuth restent dans le Web. Ce client se connecte à un serveur existant ; il n’en héberge pas.

Licence AGPL-3.0-only du dépôt. Les dépendances tierces gardent leurs licences. Les polices Shippori Mincho et GenRyu Mincho correspondent à celles du Web ; leurs SIL Open Font Licenses sont dans `app/src/main/assets/licenses/`.
