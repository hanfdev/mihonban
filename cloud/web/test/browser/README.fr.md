# Tests de régression des listes dans le navigateur

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

Ce banc de test monte les véritables vues de liste React et compare le code actuel à la révision Git `95eed448dd80ca49de0de2703d1db1f7e78e8e94`, juste avant la modification de mémoïsation des listes. Il vérifie les résultats du tri et des filtres, les rappels de lecture, le réordonnancement des favoris, le travail des requêtes et le nombre de rendus des lignes de pistes. Le tri par ajout récent a volontairement changé depuis cette révision : des cas distincts testent donc les vues actuelles Library, Artists et Import pour les dates d’ajout initial, les modifications de notes ou de titres, l’ordre après actualisation, les nouveaux imports, les dates identiques, les dates inconnues et les albums masqués.

Depuis la racine du dépôt, installez les dépendances Web et construisez le banc de test :

```sh
npm --prefix cloud/web ci
node cloud/web/tools/build-performance-browser.mjs
python -m http.server 8766 --bind 127.0.0.1 --directory backups/web-perf-browser
```

Ouvrez `http://127.0.0.1:8766` dans un navigateur de bureau avec une zone d’affichage visible, puis cliquez sur **Run all tests**. La page affiche chaque cas et le total final des réussites et des échecs. Pour l’automatisation, appelez `await window.runPerformanceTests()` et lisez `window.performanceTestResults`. Les tests de réordonnancement au pointeur utilisent la détection des éléments dans la zone d’affichage ; une zone de taille nulle n’est pas prise en charge.

La construction lit les fichiers de référence directement dans Git ; aucun répertoire privé `backups/web-perf-baseline` n’est nécessaire. Utilisez un clone dont l’historique contient la révision fixée. Un clone complet la contient, mais une simple archive ZIP des sources ne suffit pas. Pour un clone superficiel, récupérez cette révision avant la construction, ou tout l’historique avec `git fetch --unshallow` :

```sh
git fetch origin 95eed448dd80ca49de0de2703d1db1f7e78e8e94
```

Les fichiers générés restent dans le répertoire ignoré `backups/web-perf-browser`. Son `manifest.json` consigne la révision de référence et les empreintes des sources. Les réponses API et les pochettes utilisent des données locales de test, et la page bloque les connexions externes. Elle n’écrit jamais dans une bibliothèque réelle. Ces vérifications sont distinctes de `npm test` ; une construction réussie ne confirme pas à elle seule la réussite des cas dans le navigateur.
