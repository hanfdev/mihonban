# Captures pour la documentation

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

Ces images montrent les véritables interfaces Mihonban avec des albums, artistes, notes et descriptions fictifs. Web et Android utilisent des pochettes géométriques originales ; iOS affiche les disques de remplacement intégrés. Aucune collection privée ni pochette commerciale n’y figure. Les captures Web, Android natif et iOS natif représentent des clients distincts, pas des maquettes.

## Inventaire des images

| Image | Interface | Date de capture | Version source |
|---|---|---|---|
| [web-library.webp](web-library.webp) | Bibliothèque Web, anglais | 2026-11-08 | Source Web `351ba8e` |
| [web-library-zh.webp](web-library-zh.webp) | Bibliothèque Web, chinois simplifié | 2026-11-08 | Source Web `351ba8e` |
| [web-album.webp](web-album.webp) | Détails d’album Web, anglais | 2026-11-08 | Source Web `351ba8e` |
| [android-library.webp](android-library.webp) | Bibliothèque Android native | 2026-11-05 | Android 0.1.10 |
| [android-player.webp](android-player.webp) | Lecteur Android natif | 2026-11-05 | Android 0.1.8 |
| [ios-library.webp](ios-library.webp) | Bibliothèque iPhone native | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-album.webp](ios-album.webp) | Détails d’album iPhone natifs | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-player.webp](ios-player.webp) | Lecteur iPhone natif | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |
| [ios-ipad-album.webp](ios-ipad-album.webp) | Détails d’album iPad natifs, paysage | 2026-11-07 | iOS 0.2.0, `5e667fb`, CI #72 |

Les images Web conservent leur résolution de capture de 1280 × 720. Les captures Android et iPhone ont été réduites proportionnellement pour tenir dans 800 × 1440 ; celle de l’iPad a été réduite à 1600 × 1200 après application de son orientation EXIF. Toutes utilisent la compression WebP (qualité 88), sans recadrage ni réorganisation des éléments de l’interface. Les originaux en pleine résolution et les autres artefacts de test restent hors du contrôle de version.

## Reproduire la démonstration Web

Depuis la racine du dépôt, avec Node.js 20 ou ultérieur :

```bash
npm --prefix cloud/web ci
npm --prefix cloud/web run build
node tools/docs-demo.mjs --check
node tools/docs-demo.mjs
```

Ouvrez <http://127.0.0.1:8767> pour la bibliothèque ou <http://127.0.0.1:8767/#/album/midnight-sessions> pour l’album présenté. Choisissez English ou 简体中文 dans le menu de langue. Les captures utilisent le thème sombre et le tri par note par défaut. Arrêtez le serveur avec `Ctrl+C`. Définissez `MIHONBAN_DEMO_PORT` si le port par défaut est occupé.

[`tools/docs-demo.mjs`](../../tools/docs-demo.mjs) sert l’application React actuellement compilée avec 18 albums fictifs, 144 pistes et six artistes. Il écoute uniquement sur l’interface de bouclage, n’accepte que les requêtes de lecture et n’accède à aucune base, information d’authentification, plateforme de stockage ou service de production. La lecture utilise un WAV silencieux généré prenant en charge Range. La démonstration sert localement les polices Inter et Shippori Mincho du dépôt au lieu de contacter Google Fonts ; les composants et styles de disposition de l’application restent inchangés.

Pour actualiser les images, capturez les pages correspondantes de la compilation actuelle, inspectez-les, convertissez-les en WebP et mettez à jour les dates et versions source ci-dessus. Lors de leur réutilisation, indiquez clairement que les noms d’albums et les notes sont fictifs.

## Sources Android

Les exemples Android proviennent des données de test de l’interface native dans [`NativeUiTest.kt`](../../android/app/src/androidTest/java/org/mihonban/android/NativeUiTest.kt), qui fournissent un catalogue fictif et dessinent leurs pochettes avec Android Canvas. Les originaux locaux choisis sont `android/build/screenshots/0110-08-library-overview.png` et `android/build/screenshots/018-player-tall.png`. Ils représentent les versions indiquées ci-dessus et ne signifient pas que tous les clients ou tous les écrans actuels ont été capturés à nouveau au même moment.

Consultez le [guide de développement Android](../../android/README.fr.md) pour la compilation et les tests instrumentés. Seules les images documentaires compressées retenues dans ce dossier sont suivies ; les résultats complets restent dans le répertoire de compilation Android ignoré.

## Sources iOS

Les images iOS natives proviennent de l’[exécution iOS preview #72 réussie](https://github.com/hanfdev/mihonban/actions/runs/42380336181), au commit [`5e667fb`](https://github.com/hanfdev/mihonban/commit/5e667fbacfb99ab3020ae8869f4534ed7f917dc4). Les tests UI Xcode les ont capturées le 2026-11-07 dans les simulateurs **iPhone 17** et **iPad Pro 13-inch (M5)**, avec l’interface anglaise et l’apparence sombre. Ce sont des captures de simulateur, pas des photographies d’appareils physiques. Elles montrent le catalogue fictif de [`DemoLibrary.swift`](../../ios/Sources/DemoLibrary.swift) et le disque de remplacement intégré de [`Theme.swift`](../../ios/Sources/UI/Theme.swift).

| Image documentaire | Nom de la pièce jointe | Test dans `MihonbanUITests` |
|---|---|---|
| `ios-library.webp` | `01-library` | `testBrowsePlayPauseAndQueue` |
| `ios-album.webp` | `02-album` | `testBrowsePlayPauseAndQueue` |
| `ios-player.webp` | `03-now-playing` | `testBrowsePlayPauseAndQueue` |
| `ios-ipad-album.webp` | `48-album-balanced-landscape` | `testTabletAlbumHeaderBalancesArtworkAndInformation` |

L’archive téléchargée `iOS-screenshots-72` a été vérifiée avec le condensat SHA-256 publié sur la page GitHub : `34f1bb830c6453fe2074c77744ff23a34461b0fb32fb57688636e2542fae8457`. Les manifestes indiquent chaque test, appareil, horodatage et nom de fichier original ; les pièces jointes iPad sont sous `ipad/`. Aucune pièce jointe retenue n’est associée à un échec de test.

Pour renouveler les images, suivez le [guide de développement iOS](../../ios/README.fr.md) sur macOS, lancez les tests correspondants de [`MihonbanUITests.swift`](../../ios/UITests/MihonbanUITests.swift), puis exportez les pièces jointes du paquet de résultats avec `xcrun xcresulttool export attachments`. Le [workflow iOS](../../.github/workflows/mobile.yml) effectue déjà cet export et publie l’artefact `iOS-screenshots-<run_number>`. Choisissez les pièces jointes nommées ci-dessus, appliquez l’orientation enregistrée, redimensionnez proportionnellement et actualisez le tableau des dates/versions. Les artefacts CI expirent après leur période de conservation ; les WebP sélectionnés restent dans le dépôt.

[Retour à la documentation du projet](../../README.fr.md)
