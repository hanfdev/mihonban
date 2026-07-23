# Proxy audio Cloudflare optionnel

[English](audio-proxy.md) · [简体中文](audio-proxy.zh.md) · [繁體中文](audio-proxy.zh-Hant.md) · [日本語](audio-proxy.ja.md) · [한국어](audio-proxy.ko.md) · [Français](audio-proxy.fr.md) · [Español](audio-proxy.es.md)

`cloud/proxy-worker`’est un Worker autonome qui relaie des URL audio temporaires pour l’application principale mihonban. Il est utile lorsqu’un second itinéraire Worker ou un domaine personnalisé offre un meilleur chemin vers le CDN de stockage.

Il ne met pas l’audio en cache et ne garantit pas une vitesse plus élevée. Mesurez avant et après.

## Modèle de sécurité

- Le Worker principal signe l’URL source et une expiration de cinq minutes avec `STREAM_PROXY_SECRET`.
- Proxy vérifie la même valeur que `PROXY_SECRET`.
- Seuls GET, HEAD et OPTIONS sont acceptés.
- Seuls les amont HTTPS dans `ALLOWED_HOSTS` sont acceptés.
- Chaque redirection en amont est vérifiée par rapport à la liste des autorisés.
- Les en-têtes Range et conditionnels sont transmis ; les cookies et en-têtes d’autorisation ne le sont pas.
- Les réponses sont privées/sans magasin.

N’activez pas le mode non signé en production et ne définissez pas de joker hôte non restreinte.

## 1. Configurez et déployez le proxy

Édit `cloud/proxy-worker/wrangler.jsonc` :

- `ALLOWED_HOSTS` : hôtes exacts séparés par virgules ou suffixes commençant par un point.
- `ALLOWED_ORIGINS` : votre origine principale mihonban ; `*` fonctionne mais une origine spécifique est préférable.

Les suffixes OneDrive par défaut sont un point de départ. Microsoft peut rediriger vers un locataire ou un domaine de téléchargement régional ; ajouter uniquement le suffixe exact observé dans une requête échouée.

```bash
cd cloud/proxy-worker
npm ci
npm test
npx wrangler login
npx wrangler secret put PROXY_SECRET
npx wrangler deploy
```

Utilisez au moins 32 caractères aléatoires ; une chaîne hexadécimale générée à partir de 32 octets aléatoires est recommandée. Conservez-la temporairement afin que la même valeur puisse être ajoutée à la Worker principale.

## 2. Configurez le Worker principal

```bash
cd ../worker
npx wrangler secret put STREAM_PROXY_SECRET
npx wrangler deploy
```

Collez exactement le même secret que pour `PROXY_SECRET`.

Dans le panneau des modules administratifs mihonban :

1. Activer le proxy audio.
2. Définir l’URL proxy personnalisée à :

```text
https://mihonban-audio-proxy.<account>.workers.dev/?url={url}
```

3. Sauvegarder et jouer un morceau OneDrive accompagné.

Le Worker principal ajoute `expires` et `sig` automatiquement. Ne mettez jamais le secret partagé dans l’URL.

## 3. Vérifier

```bash
curl https://mihonban-audio-proxy.<account>.workers.dev/healthz
```

Ensuite, utilisez des outils réseau de navigateurs pendant que vous jouez :

- Main `/api/stream/<id>` renvoie 302 au proxy.
- Le proxy retourne 200 ou 206.
- Seeking envoie `Range` et reçoit `Content-Range`.
- Une demande de `?url=...` non signée renvoie 401.
- Un hôte non autorisé renvoie 403.

## Portée

Le proxy externe n’est utilisé que lorsque le Worker principal peut obtenir une URL de téléchargement temporaire, actuellement des backends de type OneDrive. WebDAV, Google Drive et Node stockage local nécessitent des identifiants privés et restent derrière le Worker principal.

## Dépannage

| Statut | Signification/action |
|---|---|
| 401 | Les secrets diffèrent, la signature expirée, ou la Worker principale n’a pas été redéployée |
| 403 | L’hôte source initial n’est pas autorisé sur liste |
| 502 avec message hôte | Une redirection a atteint un autre hôte ; vérifiez-le avant d’ajouter le suffixe |
| 416 | En amont a rejeté la plage d’octets demandée |
| La lecture est plus lente | Désactivez une URL externe et utilisez le chemin direct/main-Worker |

Faites pivoter les deux secrets ensemble si la valeur de signature est exposée. Les URL signées existantes expirent dans les cinq minutes.
