# Outil navigateur RYM de Mihonban

[English](README.md) · [简体中文](README.zh.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Français](README.fr.md) · [Español](README.es.md)

Cette extension facultative Chrome/Edge Manifest V3 envoie les métadonnées de publications RYM vers une bibliothèque Mihonban existante. La version 1.1.0 ajoute une file lancée par l’utilisateur pour actualiser notes et nombres de votes des albums ayant déjà un lien source.

## Compilation et installation

Depuis la racine du dépôt, installez les dépendances Web et compilez :

```sh
npm --prefix cloud/web ci
npm --prefix cloud/web run build
```

La compilation copie l’extension et le parseur partagé dans `cloud/web/dist/rym-browser-tool/`, et crée `cloud/web/dist/rym-browser-tool.zip`. Dans la page Extensions de Chrome/Edge, utilisez Charger l’extension non empaquetée (**Load unpacked**) sur le dossier généré contenant `manifest.json`. Le dossier source seul est incomplet : la compilation fournit `rym-capture.js` et `batch-reader.js`. Après remplacement d’une copie installée, cliquez sur Recharger (**Reload**) dans Extensions.

Sur un serveur déployé, **Admin → RYM updates → Batch update ratings** propose le même ZIP. Le [manuel](../../docs/manual.fr.md#rym-métadonnées) décrit installation, association aux sources et examen des classifications.

## Modes de fonctionnement

- **Envoyer la page actuelle :** actualisez une page de publication RYM, ouvrez l’extension, définissez l’adresse Mihonban et envoyez. Confirmez les albums correspondants dans Mihonban. Les classifications arrivent comme suggestions à adopter explicitement.
- **Actualiser les notes en lot :** ouvrez Mihonban en administrateur, lancez l’extension depuis cet onglet, sélectionnez les albums liés et démarrez la file. Seuls note et nombre de votes changent ; les éditions partageant une source réutilisent une observation. Classifications entretenues et rangs restent intacts.

Gardez ouverts les onglets de bibliothèque et de file. Les navigations sont espacées d’au moins 30 secondes. Vérification ou limitation suspend la file : terminez la vérification dans l’onglet source puis reprenez explicitement. Une limitation impose au moins cinq minutes de repos. Pause/reprise et réessais sont pris en charge, mais aucun service planifié ne tourne en arrière-plan et les vérifications du site ne sont pas contournées.

Au démarrage du lot, l’extension demande l’accès facultatif à RYM. Elle utilise la session administrateur existante via l’onglet de bibliothèque ouvert, sans conserver mots de passe, cookies ni HTML complet. Adresse de bibliothèque, progression et scores capturés sont stockés sur l’appareil ; un nouveau lot remplace le travail précédent.

## Vérifications

```sh
node --test cloud/web/test/rym-capture.test.js cloud/web/test/rym-batch.test.js
```

Les tests Worker de `cloud/worker/test/rym-updates.test.js` couvrent association des sources, modifications concurrentes, fraîcheur des observations, classifications entretenues et endpoint réservé aux scores.
