# Publiez le code en toute sécurité

[English](github-publish.md) · [简体中文](github-publish.zh.md) · [繁體中文](github-publish.zh-Hant.md) · [日本語](github-publish.ja.md) · [한국어](github-publish.ko.md) · [Français](github-publish.fr.md) · [Español](github-publish.es.md)

Le dépôt public canonique est [hanfdev/mihonban](https://github.com/hanfdev/mihonban). Il doit contenir uniquement les sources, les tests, la documentation publique et les modèles sécurisés.

## Éléments à ne jamais suivre

- `.dev.vars`, `.env`, `mihonban.toml`, `rclone.conf`, `wrangler.local.jsonc` ou configuration fournisseur
- `backups/`, `*.sqlite`, `*.db`, exportations SQL ou paramètres d’administration JSON
- Audio, couvertures/galeries personnelles, pages RYM sauvegardées ou archives de la boîte mail
- Cloudflare, Azure, Google, WebDAV, Discogs, R2, proxy, ou identifiants compagnons
- `GOAL.local.md` et autres notes privées d’urbanisme/agents
- Généré `node_modules`, `.wrangler`, sortie de compilation, journaux ou fichiers temporaires

La racine `.gitignore` couvre les emplacements standards, mais les règles d’ignorance ne suppriment pas un fichier déjà validé.

## Avant chaque push

```bash
git status --short
git diff --check
git diff --stat
git grep -n -I -i -E "refresh[_-]?token|client[_-]?secret|access[_-]?key|proxy[_-]?secret" -- .
```

Examinez chaque correspondance manuellement. Les noms des variables et les exemples caviardés sont attendus ; les valeurs réelles ne le sont pas. Vérifiez également l’identité de l’auteur du commit :

```bash
git log -5 --format='%h %an <%ae> %s'
```

Avant la première sortie publique ou après une réécriture historique, utilisez un scanner dédié comme Gitleaks pour toutes les références.

## Valider le dépôt

À partir de la racine du dépôt :

```bash
python -m pytest -q
```

Puis dans chaque paquet :

```bash
cd cloud/web
npm ci
npm test
npm run build

cd ../worker
npm ci
npm test
npx wrangler deploy --dry-run

cd ../proxy-worker
npm ci
npm test
npx wrangler deploy --dry-run
```

N’ajoutez pas de sorties de compilation ignorées, d’état D1 local, de bases de données ou de sauvegardes simplement pour faire passer le CI.

## Remotes et forks

Confirmez la destination avant d’appuyer :

```bash
git remote -v
git branch --show-current
```

L’origine canonique est la suivante :

```text
https://github.com/hanfdev/mihonban.git
```

Pour un fork personnel, pointez `origin` au fork et conservez le dépôt canonique comme `upstream` :

```bash
git remote add upstream https://github.com/hanfdev/mihonban.git
git fetch upstream
```

Ne push pas les branches locales de récupération ni les sauvegardes ignorées.

## Secrets de CI et de déploiement

- Les tests de construction et unitaires ne nécessitent aucun secret de production.
- Les pull requests non fiables ne doivent pas recevoir de secrets de déploiement.
- Utiliser GitHub environnements et des jetons API Cloudflare à privilège minimum pour le déploiement.
- Ne jamais placer de stockage ou de identifiants R2 dans les variables de construction frontend.
- Faire tourner tout secret de production apparu dans le chat, les journaux, les captures d’écran, la sortie CI ou l’historique Git.

## Liste de contrôle pour la sortie

- Chaque guide public propose des versions en anglais, chinois simplifié, chinois traditionnel, japonais, coréen, français et espagnol, avec des liens interlinguistiques valides.
- Un clone frais s’installe avec `npm ci` et `pip install -e ./pipeline`.
- Les vérifications de Python, frontend, Worker principale, Worker proxy et répétition générale passent.
- La documentation ne contient aucun chemin spécifique à la machine, URL de service personnel ou identifiant.
- Les notes de migration de base de données/schéma correspondent au code publié.
- Aucune musique privée ni actif protégé par des droits d’auteur tiers n’est regroupé.
- `LICENSE` reste présent et les métadonnées du paquet continuent de déclarer `AGPL-3.0-only`.

## Si un secret a été commité

1. Révoquez ou faites une rotation immédiate auprès du prestataire.
2. Supprimez-le des fichiers et déploiements actuels.
3. Réécrire l’historique affecté avec `git filter-repo` ou BFG quand c’est nécessaire.
4. Force-push seulement après coordination avec chaque collaborateur.
5. Traiter tous les anciens clones, journaux et artefacts comme des copies compromises.

Supprimer la valeur dans un commit ultérieur ne la supprime pas de l’historique.

## Périmètre de la licence

Le AGPL couvre le logiciel de ce dépôt. Il n’accorde pas la permission de publier de la musique, des images de bibliothèque personnelle ou des métadonnées tierces. Chaque publication doit préserver cette distinction.
