# Sources des drafts professionnels en direct

État de la recherche : 29 octobre 2026. Le site distingue un calendrier, une composition disponible pendant la partie, et une draft suivie pick par pick. Ces trois services ne garantissent pas les mêmes données.

## Chemins implémentés

Le serveur Node fournit `GET /api/live`. Sans fournisseur configuré, il renvoie `status: "not_configured"` et aucune rencontre. Une panne ne déclenche jamais un remplacement par des exemples.

### 1. Fournisseur de snapshots normalisés

Définir `LIVE_FEED_URL` et, si nécessaire, `LIVE_FEED_TOKEN` dans l'environnement **du serveur**. Le token est transmis uniquement dans `Authorization: Bearer …`. La source doit utiliser HTTPS ; HTTP est autorisé exclusivement pour localhost. Les redirections sont refusées. Limites : 8 secondes, 1 Mo par réponse, 100 rencontres. Le serveur partage un cache de 10 secondes entre les visiteurs.

Le contrat est :

```json
{
  "version": 1,
  "status": "ok",
  "provider": "nom-du-fournisseur",
  "observedAt": "2026-10-29T12:00:00Z",
  "capabilities": { "draftPhase": true, "rolesConfirmed": true },
  "delaySeconds": null,
  "matches": [{
    "id": "serie-123:game-2",
    "league": "LCK",
    "gameNumber": 2,
    "status": "draft",
    "patch": null,
    "sourceUrl": "https://exemple.org/match/123",
    "observedAt": "2026-10-29T12:00:00Z",
    "rolesConfirmed": true,
    "blue": { "name": "Équipe A", "picks": { "top": "Ornn", "jng": "Vi", "mid": "Orianna", "bot": "Jinx", "sup": "Lulu" } },
    "red": { "name": "Équipe B", "picks": { "top": "Renekton", "jng": "Lee Sin", "mid": "Ahri", "bot": "Kai'Sa", "sup": "Nautilus" } }
  }]
}
```

Exemple de schéma uniquement : ces équipes ne constituent pas une rencontre en cours. Les noms de champions doivent être officiels. Un slot absent vaut `null`. Le statut d'une rencontre est `draft`, `in_game` ou `finished`. `rolesConfirmed` doit être présent **sur chaque rencontre** ; l'indicateur global ne le remplace pas. Les flex picks restent incertains tant que leurs rôles ne sont pas confirmés. Aucune attribution de rôle depuis l'ordre de sélection n'est effectuée.

`observedAt` est l'heure de la donnée, `fetchedAt` celle de la récupération par le proxy. Une observation manquante ou vieille de plus de trois minutes est signalée `stale: true`. `delaySeconds: null` signifie délai inconnu. Le fournisseur reste responsable de ses droits de diffusion et de la véracité des horodatages/capacités déclarées.

### 2. Connecteur PandaScore

Définir `PANDASCORE_TOKEN` côté serveur avec un abonnement incluant les données live de League of Legends. Si `LIVE_FEED_URL` existe, cette source est prioritaire.

Si `LIVE_PROVIDER=lolesports` est défini, le connecteur public décrit ci-dessous est utilisé après `LIVE_FEED_URL`, avant PandaScore. Sans sélection explicite et sans clé fournisseur, aucun connecteur public n'est activé automatiquement.

Le connecteur découvre les flux via `GET https://api.pandascore.co/lives`, puis ouvre uniquement les URL `wss://live.pandascore.co/…` annoncées pour les frames. Il extrait les champions depuis les rôles documentés `top`, `jun`, `mid`, `adc`, `sup`, convertis en `top`, `jng`, `mid`, `bot`, `sup`. Les statistiques de partie (gold, kills, objets, vainqueur) sont jetées. Le jugement utilise seulement la composition. Les connexions sont partagées par le serveur ; les rencontres sont redécouvertes toutes les 45 secondes.

La découverte parcourt les pages de 100 entrées (cinq pages maximum) et conserve jusqu'à 30 flux LoL simultanés. Le titre est identifié par le slug `league-of-legends`, sans déduction depuis un identifiant numérique de jeu. Une fermeture WebSocket `4001`/`4003` signale un accès refusé, `4029` une limite de connexions. Une connexion rompue retire ses données actives ; une nouvelle tentative est faite à la découverte suivante.

Les frames officielles sont synchronisées avec la diffusion publique et arrivent environ toutes les deux secondes. Le frontend peut consulter le proxy toutes les 15 secondes. Le délai total est celui du fournisseur, de la diffusion et du rafraîchissement ; aucune garantie de latence n'est ajoutée.

La documentation publique des frames confirme les champions par rôle pendant la partie ; elle ne décrit pas un protocole stable de draft pick par pick. Ce connecteur expose donc `draftPhase: false`, même si certains plans commerciaux peuvent offrir davantage. `observationClock: "receipt"` précise que son horodatage est celui de réception de la frame et non celui du serveur de jeu. Un flux normalisé avec garantie explicite est nécessaire pour annoncer le suivi pendant la phase de draft.

La référence publique confirme le corps `blue/red.players.<rôle>.champion.name` et la découverte des URL. Son exemple JSON téléchargeable complet n'a pas pu être récupéré ici : l'enveloppe exacte des frames n'a donc pas été confirmée sur une connexion réelle. Le décodeur accepte un corps direct ou une enveloppe `type: "frame"` avec `payload`/`data`, puis impose les objets de rôles et un identifiant de partie explicite. Les autres formes sont ignorées sans fabriquer de composition. Le sandbox officiel PandaScore (`POST https://live.pandascore.co/api/lol/replay`) permet de vérifier cette intégration avec un abonnement compatible avant mise en service.

### 3. LoL Esports public, expérimental et sans clé

Définir `LIVE_PROVIDER=lolesports` côté serveur. Le fichier `data/champion-assets.json` contient les correspondances officielles Data Dragon `{id, key, name}` ; `npm run sync:champions` le renouvelle sans modifier les profils Kazewa. La synchronisation vérifiée sur le patch `16.21.1` comprend 173 identifiants officiels.

Le connecteur lit la page publique [LoL Esports](https://lolesports.com/en-US) et son transport Apollo SSR. Il analyse uniquement des données avec `JSON.parse`, après conversion lexicale des valeurs `undefined` hors des chaînes ; aucun JavaScript du site n'est exécuté. Seuls les événements **et les games** explicitement `inProgress` sont considérés. Le calendrier est relu toutes les 60 secondes, avec une limite de 5 Mo et de 30 games simultanées.

Pour chaque game, il demande `https://feed.lolesports.com/livestats/v1/window/{gameId}?startingTime=…` avec un bloc de dix secondes situé une minute avant l'heure courante. Le paramètre temporel a été vérifié sur un enregistrement historique réel. La route sans paramètre renvoie des frames d'ouverture : elle sert uniquement de repli si le bloc demandé n'existe pas encore. **L'horodatage original reste conservé**, donc une ancienne frame de repli ne devient jamais fraîche à cause d'une nouvelle récupération HTTP.

Les côtés bleu/rouge sont identifiés par `esportsTeamId`, pas par l'ordre des équipes dans la page. Les rôles viennent de `participantMetadata.role` (`top`, `jungle`, `mid`, `bottom`, `support`). Les IDs comme `KSante` et `MonkeyKing` deviennent les noms officiels `K'Sante` et `Wukong` grâce à Data Dragon. Un champion inconnu laisse son slot vide et suspend le verdict. Les statistiques de partie et les résultats sont ignorés.

Ce connecteur indique toujours `draftPhase: false` et `delaySeconds: null`. Il importe des compositions disponibles dans le flux d'une partie démarrée ; il ne promet ni couverture pick par pick ni délai par rapport au stream. Les observations gardent `rfc460Timestamp` comme heure source et passent les mêmes contrôles de fraîcheur que les autres connecteurs.

Vérifications réseau du 29 octobre 2026 : page officielle HTTP 200 ; window historique de la game `117133830110912106` HTTP 200 ; bloc historique `2026-10-13T06:20:00.000Z` HTTP 200 avec des frames de `06:20:00.197Z` à `06:20:09.797Z`. Les extraits factuels minimaux conservés dans les tests sont explicitement historiques. La page capturée contenait 59 événements distincts, **aucun événement en cours** : elle doit produire une liste live vide. Le chemin complet pendant une game effectivement en cours doit encore être observé ; cette vérification historique ne prouve pas une couverture live de toutes les compétitions.

Un appel réseau réel du connecteur complet `createLolesportsFeed().getSnapshot()` a également réussi à `2026-10-29T18:12:07Z`, avec `status: "ok"`, `provider: "lolesports-public"`, zéro match et `draftPhase: false`. Il confirme le fonctionnement de la découverte publique actuelle sans inventer de rencontre en l'absence de partie en cours.

Ces routes publiques ne constituent pas une API développeur documentée avec garantie de service. Un changement de HTML, d'identifiants ou de disponibilité provoque un état indisponible ; il ne déclenche pas un contournement d'authentification ou un remplacement par une démonstration.

## Sources primaires vérifiées

- [Riot : Official Esports Data, présentation du produit](https://riotesportsdata.com/en-us/product-overview/) : partenariat Riot/GRID pour les données professionnelles à la source.
- [GRID : Open Access Quick Start](https://grid.helpjuice.com/client-help/open-access-quickstart) : l'accès ouvert exclut explicitement les données League of Legends. Une clé gratuite GRID ne suffit donc pas à activer ce site.
- [GRID : authentification](https://docs.grid.gg/public/documentation/api-reference/getting-started/authentication) : en-tête `x-api-key` et documentation détaillée accessible selon les droits. Un adaptateur normalisé doit suivre le schéma auquel le compte a effectivement accès.
- [PandaScore : présentation](https://developers.pandascore.co/docs/introduction) : calendrier gratuit, historique et live séparés par niveau d'accès.
- [PandaScore : WebSockets](https://developers.pandascore.co/docs/websockets-overview) : découverte `/lives`, URL annoncées, frames et synchronisation avec le stream.
- [PandaScore : format League of Legends](https://developers.pandascore.co/docs/data-sample-league-of-legends) : rôles et objets `champion` utilisés par le connecteur.
- [PandaScore : découverte des flux](https://developers.pandascore.co/reference/get_lives) : endpoint et pagination ; [fermetures WebSocket](https://developers.pandascore.co/docs/disconnections) : codes d'erreur ; [sandbox officiel](https://developers.pandascore.co/docs/sandbox-environment) : procédure de vérification sur un replay fourni par PandaScore.
- [PandaScore : FAQ](https://developers.pandascore.co/docs/frequently-asked-questions) : les appels navigateur directs ne sont pas supportés ; un backend est requis pour les appels API.
- [Riot : documentation League of Legends](https://developer.riotgames.com/docs/lol) : Data Dragon sert les champions/assets ; l'API Live Client est locale au client de jeu et ne permet pas de suivre les drafts professionnelles depuis GitHub Pages.

## Endpoints internes LoL Esports

L'ancien `esports-api.lolesports.com/persisted/gw/getLive?hl=en-US` a répondu HTTP 403 sans clé. Le site actuel utilise un proxy GraphQL `/api/gql` avec des requêtes persistées ; les essais anonymes ont répondu HTTP 401, même avec les en-têtes normaux du client Apollo. Ces routes authentifiées ne sont pas utilisées. Aucune ancienne clé du client web ni clé privée n'est intégrée au projet. Le connecteur expérimental se limite au HTML et au window publiquement servis et vérifiés ci-dessus.

## Hébergement

GitHub Pages publie des fichiers statiques. Héberger ce serveur Node séparément et renseigner son URL `/api/live` dans les paramètres du site. Définir `FRONTEND_ORIGIN=https://<compte>.github.io` sur le serveur pour autoriser l'origine du site Pages. Les tokens vont dans les secrets du service serveur, jamais dans GitHub Pages, `public/config.json`, un fichier commité ou la barre d'adresse.

Exemple de commande de démarrage pour un hébergeur Node : `node server/server.mjs`. Variables usuelles : `HOST=0.0.0.0`, `PORT` fourni par l'hébergeur, `FRONTEND_ORIGIN`, et l'une des configurations fournisseur ci-dessus. Aucun processus GitHub Actions planifié ne remplace un serveur live permanent.

Les tests locaux couvrent les schémas, rôles, erreurs réseau, limites de taille, horodatages, secrets, CORS et accès aux fichiers. Ils ne constituent pas une validation d'un flux payant réel : celle-ci exige un compte et un match couvert en cours.
