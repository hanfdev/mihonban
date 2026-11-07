# Mihonban pour iPhone et iPad

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

Client SwiftUI natif pour un serveur Mihonban existant, utilisant SFBAudioEngine pour la lecture. La préversion actuelle est la 0.2.0 et nécessite iOS/iPadOS 17 ou ultérieur. Il n’héberge pas le serveur et n’utilise pas de WebView pour son interface d’écoute.

## Aperçu de l’interface

Écrans réels de l’application iOS native, capturés dans les simulateurs iPhone et iPad avec des données fictives et les pochettes de remplacement intégrées. [Détails des captures](../docs/images/README.fr.md).

| Bibliothèque iPhone | Détails d’album sur iPhone | Lecteur iPhone |
|:---:|:---:|:---:|
| <img src="../docs/images/ios-library.webp" height="420" alt="Bibliothèque iPhone"> | <img src="../docs/images/ios-album.webp" height="420" alt="Détails d’album sur iPhone"> | <img src="../docs/images/ios-player.webp" height="420" alt="Lecteur iPhone"> |

**Détails d’album sur iPad en paysage**

![Détails d’album sur iPad en paysage](../docs/images/ios-ipad-album.webp)

## Connexion et écoute

Saisissez l’URL racine du serveur, par exemple `https://music.example.com`, et le mot de passe d’écoute ou d’administration. Un mot de passe vide fonctionne uniquement si le serveur autorise les invités. L’option facultative d’enregistrement du mot de passe le conserve dans le trousseau pour la reconnexion. Pour un serveur local, utilisez l’adresse réseau du PC : le `localhost` du téléphone désigne le téléphone lui-même. Les sessions HTTP locales exigent `DEV_INSECURE_COOKIE=1` sur le serveur ; utilisez HTTPS à distance.

- Parcourez albums, chansons, artistes et favoris partagés, avec recherche, filtres de genre, tri, crédits de plusieurs artistes et albums associés.
- Lisez les descriptions d’albums et d’artistes dans un lecteur Markdown natif, parcourez et agrandissez les images, puis partagez les liens d’albums et de chansons avec la feuille de partage du système.
- Utilisez le mini-lecteur, le lecteur complet, la file modifiable, la recherche temporelle, la lecture aléatoire et la répétition. L’audio en arrière-plan, les commandes de l’écran verrouillé et le choix de la sortie audio utilisent les fonctions natives d’iOS.
- Enregistrez des albums pour l’écoute hors ligne. Les téléchargements affichent leur progression, les transferts échoués peuvent être relancés et les téléchargements terminés restent séparés du cache automatique. Les transferts peuvent continuer lorsque l’application est suspendue ; une fermeture forcée les interrompt.
- Rouvrez la bibliothèque précédemment autorisée et la musique téléchargée lorsque le serveur est inaccessible. Un rejet explicite de la session impose une nouvelle connexion.
- Choisissez l’apparence système, claire ou sombre ; réglez le cache automatique entre 256 MB et 4 GB (1 GB par défaut), ou désactivez-le. Vider ce cache préserve les téléchargements explicites.
- Réglez le préchargement du titre suivant sur Désactivé, Automatique (Wi-Fi) ou Toujours. Le mode automatique, choisi par défaut, évite les réseaux cellulaires, les connexions facturées à l’usage et le mode Faibles données. Il prépare uniquement le prochain titre de la file et peut fonctionner sans cache persistant.
- Les administrateurs peuvent modifier les favoris partagés, les métadonnées et pochettes, afficher/masquer les albums et confirmer leur suppression avec ou sans les fichiers stockés. La configuration complète du serveur, l’importation/migration en masse et les mises à jour RYM assistées par navigateur utilisent l’application Web.

L’interface prend en charge l’anglais, le japonais, le coréen, le français, l’espagnol, le chinois simplifié et le chinois traditionnel. Portrait, paysage, Dynamic Type et dispositions iPad disposent de tests de régression distincts. Les formats disponibles dépendent de SFBAudioEngine et des codecs inclus ; la suite vérifie le décodage et la recherche temporelle sur des fichiers MP3, FLAC et Vorbis synthétiques.

## Compilation

Utilisez macOS, Xcode prenant en charge les fonctionnalités Swift 6.2 employées par le code, XcodeGen, Python 3 et FFmpeg. Le [workflow iOS](../.github/workflows/mobile.yml) indique précisément l’environnement et la version de Xcode employés en CI (actuellement `macos-26` et Xcode 26.6). Exécutez les commandes de préparation et de compilation depuis la racine du dépôt :

```sh
brew install xcodegen ffmpeg
python3 -I ios/tools/check-l10n.py
python3 -I ios/tools/check-fonts.py
mkdir -p ios/TestFixtures ios/Resources/ThirdParty
ffmpeg -v error -f lavfi -i 'sine=frequency=440:duration=8:sample_rate=44100' -ac 2 -c:a libmp3lame -q:a 3 ios/TestFixtures/tone.mp3
ffmpeg -v error -f lavfi -i 'sine=frequency=440:duration=8:sample_rate=44100' -ac 2 -c:a flac ios/TestFixtures/tone.flac
ffmpeg -v error -f lavfi -i 'sine=frequency=440:duration=8:sample_rate=44100' -ac 2 -c:a vorbis -strict experimental -q:a 4 ios/TestFixtures/tone.ogg
xcodegen generate --spec ios/project.yml
xcodebuild -resolvePackageDependencies -project ios/Mihonban.xcodeproj -scheme Mihonban -clonedSourcePackagesDirPath .spm
python3 -I ios/tools/acknowledgements.py .spm/checkouts ios/Resources/ThirdParty/Acknowledgements.txt
xcodegen generate --spec ios/project.yml
open ios/Mihonban.xcodeproj
```

SFBAudioEngine est fixé à une révision dans `project.yml`. Si un fichier `ios/Package.resolved` vérifié est fourni, copiez-le dans `ios/Mihonban.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/` avant de résoudre les paquets, comme en CI. La CI inclut le verrou des dépendances résolues dans ses artefacts. Le projet Xcode généré, les copies des dépendances, l’audio synthétique et les produits de compilation sont exclus de Git ; les icônes, la police, le catalogue de traduction et les tables de recherche fournis sont des ressources source.

Sélectionnez un simulateur iPhone ou iPad et exécutez le scheme Mihonban. Pour un appareil physique, configurez votre équipe de développement et votre signature. La CI crée une IPA **non signée** ; son téléchargement ne permet pas de l’installer sans une procédure de signature ou de chargement latéral adaptée. Le workflow fournit aussi les sommes de contrôle, les notices tierces et les objets de compilation permettant une nouvelle édition de liens. Les artefacts sont disponibles dans les [exécutions iOS réussies](https://github.com/hanfdev/mihonban/actions/workflows/mobile.yml) et expirent selon leur durée de conservation ; aucune publication automatique sur l’App Store n’est effectuée.

## Tests

Démarrez le serveur de données de test dans un autre terminal avant d’exécuter le scheme de test Xcode :

```sh
python3 -I ios/tools/fixture-server.py ios/TestFixtures
```

Le serveur écoute sur le port de bouclage 8766 et fournit des médias synthétiques et des données de test API. Les tests couvrent les contrats API, le démarrage hors ligne, l’actualisation du catalogue, les favoris, les transitions de file, le cache et les téléchargements, le décodage et la recherche temporelle, la typographie, la disposition et la navigation native. La CI exécute la suite iPhone et un sous-ensemble iPad distinct, puis publie rapports et captures. Les captures documentaires sélectionnées sont suivies dans `docs/images/` ; les séries complètes et les rapports restent des produits générés hors du contrôle de version. Aucun compte de production ni collection musicale n’est nécessaire. Compiler iOS ou exécuter un simulateur nécessite macOS ; la réussite des seules vérifications Python portables ne valide ni la compilation Swift ni le comportement sur appareil.

## Entretien des ressources générées

Après modification des traductions Web partagées ou des alias de recherche, régénérez les catalogues suivis et examinez les différences :

```sh
node ios/tools/export-locales.mjs
node ios/tools/export-search.mjs
python3 -I ios/tools/check-l10n.py
python3 -I ios/tools/check-fonts.py
```

Uniquement lors d’un changement d’images ou de couverture des polices, installez Pillow, fontTools et Brotli dans un environnement Python de développement, puis lancez `python3 ios/tools/prepare-assets.py .`. Cette commande régénère l’icône/logo et la police de repli à partir de la source fixée et des ressources Web partagées ; elle n’est pas requise pour une compilation ordinaire.

Le projet utilise AGPL-3.0-only. Les polices incluses conservent leur SIL Open Font License. SFBAudioEngine et ses dépendances de codecs gardent leurs propres licences ; conservez les notices générées et les informations sur les dépendances lors de la distribution.

[Retour à la documentation du projet](../README.fr.md)
