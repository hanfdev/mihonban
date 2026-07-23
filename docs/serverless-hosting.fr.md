# Hébergement Serverless sur Cloudflare

[English](serverless-hosting.md) · [简体中文](serverless-hosting.zh.md) · [繁體中文](serverless-hosting.zh-Hant.md) · [日本語](serverless-hosting.ja.md) · [한국어](serverless-hosting.ko.md) · [Français](serverless-hosting.fr.md) · [Español](serverless-hosting.es.md)

L’objectif serverless est de continuer à se connecter, naviguer et lire en ligne pendant que l’ordinateur personnel est éteint. La forme prise en charge est une Worker qui sert l’application React et l’API, D1 + KV, une R2 optionnelle pour les images, et l’audio stocké dans OneDrive, WebDAV ou Google Drive.

## Charges de travail adaptées

| Travail | Cloudflare Workers convient |
|---|---|
| React assets et requêtes API courtes | Bien |
| D1 catalogue/paramètres et KV cache court | Bien |
| Rappels de sources RSS/Atom/Blogger | Bon avec Cron Trigger |
| Range diffusion en continu depuis le stockage | Pris en charge, soumis aux limites réseau et forfaits |
| Surveillance de la boîte de réception, extraction d’archives, betteraves, modifications en bloc des tags | Non supporté ; utilisez le compagnon local |
| Transcodage ou balayages locaux persistants | Non pris en charge ; utiliser les outils Node/NAS |

## Architecture recommandée

```text
Browser
  |
Cloudflare Worker (API + React assets)
  |-- D1: catalog and settings
  |-- KV: rate limits and short-lived cache
  |-- optional R2: image mirror
  +-- OneDrive / WebDAV / Google Drive: audio and originals
```

Suivez [Installer et déployer ](install.fr.md). Avant de déplacer un catalogue local, suivez [Migration de base de données](database-migration.fr.md) ; importer seul les paramètres d’administration ne restaure pas les albums.

## L’ordinateur personnel doit-il rester allumé ?

Non, pas pour la connexion web, la navigation, la lecture, les importations web ou le scan source programmé. Activez-le uniquement pour le traitement local de la boîte de réception, la réconciliation local/cloud, les sauvegardes hors ligne ou d’autres tâches complémentaires.

Cloudflare Workers ne peut pas voir un répertoire personnel ni attendre les événements du système de fichiers. Pour exécuter la boîte de réception en continu, placez le compagnon Python sur un NAS ou un hôte à faible consommation en permanence. Cet appareil organise et synchronise les fichiers ; l’application web fonctionne toujours de manière indépendante dans Cloudflare.

## Libre ne veut pas dire illimité

Workers, D1, KV et R2 quotas et tarifs peuvent changer ; utilisez le tableau de bord Cloudflare actuel et la documentation officielle comme autorité. L’hypothèse de type « free tier » du projet est une bibliothèque personnelle ou quelques auditeurs, et non une grande distribution publique ou un relais audio sans perte continue à l’échelle de téraoctets.

OneDrive URL temporaires contournent souvent le Worker. WebDAV, Google Drive, et un octet de transfert proxy audio explicitement activé via un Worker et consomment plus de ressources de la plateforme.

## Proxy audio externe

Testez d’abord le déploiement principal. Ajoutez le proxy séparé uniquement lorsque la mesure montre qu’une autre route Worker ou un domaine personnalisé améliore le chemin. Il s’agit d’un relais signé autorisé, pas d’un CDN public, et il ne garantit pas une vitesse supérieure. Voir [Proxy audio Cloudflare optionnel](audio-proxy.fr.md).

## Checklist de mise en ligne

- Worker URL/domaine personnalisé s’ouvre via HTTPS.
- Les permissions invitée sans mot de passe pour l’auditeur, l’administrateur et optionnelles sont correctes.
- Lecture et recherche de travail sur ordinateur, Safari iOS et Chrome Android.
- Le contenu caché n’est pas disponible pour les auditeurs au niveau de l’API.
- Chaque backend de stockage nommé est testé ; une cible d’écriture est sélectionnée.
- Les images R2 optionnelles et le proxy sont testés indépendamment.
- D1 SQL, paramètres d’administration JSON, runtime secrets et sauvegardes audio sont tous pris en compte.
- Aucun secret n’apparaît dans Git, la documentation, les journaux ou les captures d’écran.
