# Validation Android

[English](VERIFICATION.md) · [简体中文](VERIFICATION.zh.md) · [繁體中文](VERIFICATION.zh-Hant.md) · [日本語](VERIFICATION.ja.md) · [한국어](VERIFICATION.ko.md) · [Français](VERIFICATION.fr.md) · [Español](VERIFICATION.es.md)

Version source actuelle : 0.1.10 / code de version 11. Outils : JDK 17, Gradle 8.9, Android Gradle Plugin 8.7.3, Kotlin 2.0.21, SDK 35 et Build Tools 35.0.0.

## Reproduire

Depuis la racine du dépôt, indiquez le SDK installé avec `ANDROID_HOME` ou le fichier ignoré `android/local.properties` :

```powershell
android\gradlew.bat -p android testDebugUnitTest lintDebug assembleDebug assembleRelease
android\gradlew.bat -p android connectedDebugAndroidTest
```

Sur macOS/Linux, utilisez `sh android/gradlew -p android` avec les mêmes tâches. Le wrapper fixe Gradle 8.9 et vérifie sa somme de contrôle. La seconde commande exige un émulateur ou appareil. Les tests emploient un serveur HTTP intégré et de l’audio synthétique, sans serveur de production, identifiants ni musique personnelle.

Sorties standard sous `android/app/build/` :

- `reports/tests/testDebugUnitTest/` et `test-results/testDebugUnitTest/` : rapports JVM.
- `reports/lint-results-debug.html` et `.xml` : diagnostics lint.
- `reports/androidTests/` et `outputs/androidTest-results/` : rapports sur appareil.
- `outputs/apk/debug/app-debug.apk` : APK de développement.
- `outputs/apk/release/app-release-unsigned.apk` : APK réduit nécessitant une signature de publication.

Le [workflow Android](../.github/workflows/android.yml) compile Debug et Release, exécute JVM/lint et une tâche séparée sur émulateur API 35. Il téléverse APK, rapports et captures comme artefacts CI. Les captures de documentation sélectionnées sont suivies sous `docs/images/` ; les sorties complètes et preuves de tests locales restent hors du contrôle de version.

## Résultats enregistrés

La vérification de publication des sources du 2026-11-07 a réussi `testDebugUnitTest lintDebug assembleDebug assembleRelease` avec Gradle 8.9 et JDK 17. Elle a réutilisé les sorties incrémentales existantes : 2 tâches exécutées et 97 à jour. Le téléchargement de la distribution par le wrapper n’a pas abouti lors du contrôle réseau local ; cette exécution a utilisé Gradle 8.9 déjà installé. Un script d’initialisation local a choisi un dossier de sortie existant ; les sources et tâches étaient celles de ce dépôt.

Les rapports réutilisés contiennent 29 tests JVM sans échec, erreur ni test ignoré. Lint ne signale aucune erreur, 15 avertissements et une information. Les APK de développement et release réduit non signé existent. Ce sont des résultats incrémentaux, pas une nouvelle exécution d’émulateur ni une compilation propre indépendante.

La validation antérieure du 2026-11-05 a enregistré 22 tests sur appareil réussis sur un émulateur Android 15 / API 35 x86_64, à 945 × 1680 pixels et 420 dpi, ainsi que la vérification de signature de l’APK de développement. La suite couvre navigation native, lecture et recherche temporelle, file, téléchargements/hors ligne, isolation des caches, préchargement suivant et barre repliable.

La régression de barre échantillonne des états partiellement repliés, plusieurs densités/tailles de police et les marges de barre d’état, puis vérifie repli complet, restauration et changement de densité. Elle cible les fragments de titre/icônes corrigés en 0.1.10. Les signalements lint existants concernent mises à jour des dépendances, écritures synchrones des préférences, service média exporté, référence de dépôt à portée applicative et état entier encapsulé dans l’interface d’import.

## Limites de couverture

Aucun nouvel essai sur émulateur ou appareil physique n’a été réalisé pour la mise à jour documentaire du 2026-11-07. Android 8 à l’exécution, Android 16 et comportements propres aux fabricants, intégration batterie/casque et comptes de stockage de production restent non vérifiés. Une course liée à un Stop retardé sous Android 15 après vidage puis redémarrage immédiat de la file reste connue.

Voir le [guide Android](README.fr.md#limites-actuelles) pour codecs, envois au premier plan et administration avancée. Les APK CI ou locaux peuvent avoir des signatures et sommes différentes ; vérifiez l’artefact de l’exécution à installer.
