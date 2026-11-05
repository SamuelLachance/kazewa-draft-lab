# Kazewa — Draft Lab

Un moteur explicable qui compare deux compositions de League of Legends à partir du corpus Kazewa, une interface française et un serveur de connexion aux données professionnelles.

**Statut : site public.** Le seuil retenu est 70 % d’accord sur la cohorte élargie. Les résultats réels sont dans [`data/evaluation.json`](data/evaluation.json), affichés sur le site et détaillés dans [`docs/EVALUATION.md`](docs/EVALUATION.md). La publication n’est pas bloquée.

Dépôt public : [SamuelLachance/kazewa-draft-lab](https://github.com/SamuelLachance/kazewa-draft-lab). Site : [samuellachance.github.io/kazewa-draft-lab](https://samuellachance.github.io/kazewa-draft-lab/). **86 tests automatisés réussis**, build statique réussi et neuf parcours vérifiés dans Chrome. Voir [la vérification détaillée](docs/VERIFICATION.md).

## Démarrer

Prérequis : Node.js 24 (aucune dépendance applicative à installer).

```powershell
cd C:\Users\Admin\Documents\kazewa\draft-lab
npm ci --ignore-scripts
npm run dev
```

Ouvrir <http://127.0.0.1:4173>. L’atelier fonctionne sans compte ni fournisseur live : choisir les dix champions, charger des cas du corpus, inverser les équipes et partager une draft par URL. Les portraits utilisent les assets officiels Data Dragon ; leur chargement nécessite Internet. Le calcul reste local au navigateur.

`npm run dev` essaie aussi le connecteur public LoL Esports sans clé quand aucun fournisseur n’est défini. Il importe les compositions lorsque leur flux de partie est disponible. Il ne garantit pas le suivi des picks pendant la sélection. Une absence de match actif produit une liste vide, pas une simulation. `LIVE_PROVIDER=none` permet de garder uniquement l’atelier.

```powershell
npm test                 # Vérifications du moteur, des données, du live et du serveur
npm run evaluate         # Recalcul du benchmark figé, sans le corpus source
npm run distill          # Expérience séparée d’apprentissage et validation hors groupe
npm run build            # Site statique dans dist/, compatible GitHub Pages
npm run verify:fidelity  # Affiche l’accord élargi. Ne bloque pas la publication.
```

`npm run knowledge` reconstruit les profils et les règles depuis le dossier parent contenant le corpus. `node scripts/evaluate.mjs --rebuild-benchmark` reconstruit les cas depuis les fichiers parent. Ces deux opérations nécessitent les sources locales ; les tests, l’évaluation et le build utilisent les données générées commitées et fonctionnent dans un dépôt autonome.

## Ce que le moteur juge

Le moteur lit exclusivement `blue` et `red`, chacune avec les rôles `top`, `jng`, `mid`, `bot`, `sup`. Il évalue frontline, dégâts soutenus, accès aux carries, protection, cohérence des familles, combos, tempo, terrain, objectifs et présence globale. Les signaux liés à un même argument sont plafonnés pour limiter leur double comptage. Chaque signal renvoie aux identifiants des vidéos du corpus.

Les poids sont des traductions heuristiques, pas des nombres dictés par Kazewa. Les profils distinguent les propriétés explicitement attribuées à Kazewa de celles déduites de ses critères. Les contradictions identifiées dans le corpus sont préservées et signalées. Un champion absent, un doublon ou une composition incomplète suspend le verdict.

Le score ne reçoit jamais les noms des équipes, les joueurs, les résultats, les golds, les kills, les objets, les bans ni l’ordre des picks. Les axes et le score ne sont pas des probabilités de victoire. Une meilleure draft peut perdre la partie.

## Brancher le direct

GitHub Pages sert des fichiers statiques ; le fournisseur et ses secrets nécessitent **un serveur séparé**. Le serveur Node fourni sert l’interface et `GET /api/live`. Voir [`docs/LIVE_SOURCES.md`](docs/LIVE_SOURCES.md) pour les contrats, les sources vérifiées et les limites de couverture.

Trois chemins sont prévus :

- `LIVE_PROVIDER=lolesports` : connecteur public sans clé, expérimental, découvert sur le site officiel et vérifié sur son format courant. Il ne dispose pas d’un contrat d’API stable et ne garantit pas la phase de draft.

- `LIVE_FEED_URL` + éventuellement `LIVE_FEED_TOKEN` : snapshots normalisés HTTPS, notamment depuis une source autorisée qui garantit la phase de draft.
- `PANDASCORE_TOKEN` : connecteur optionnel vers un abonnement live PandaScore. Les données sont synchronisées avec la diffusion. Le connecteur public implémenté annonce les compositions de partie, sans garantir le suivi pick par pick.

Exemple PowerShell pour un flux déjà disponible :

```powershell
$env:LIVE_FEED_URL = 'https://votre-source.example/snapshot'
$env:FRONTEND_ORIGIN = 'http://127.0.0.1:4173'
npm start
```

Injecter les tokens par le gestionnaire de secrets de l’hébergeur. Le serveur ne lit pas automatiquement `.env` ; ce fichier d’exemple documente les variables. Sur un hébergeur Node, définir `HOST=0.0.0.0`, le `PORT` fourni par le service et `FRONTEND_ORIGIN=https://<compte>.github.io`. Le chemin du dépôt n’appartient pas à l’origine CORS.

Dans l’onglet **Direct pro → Configurer le flux**, saisir uniquement l’URL publique `https://<proxy>/api/live`. Elle est mémorisée localement. Aucun token ne doit être placé dans l’URL ou le frontend. Une URL fournie par `LIVE_API_URL` au build peut définir cette adresse pour tous les visiteurs.

Le navigateur rafraîchit le flux toutes les 15 secondes et suspend le verdict si les dix picks manquent, les rôles ne sont pas confirmés, la source ne garantit pas la phase annoncée, la partie est terminée ou l’observation date de plus de 90 secondes. Les pannes ne sont jamais remplacées par des exemples de matchs.

Le connecteur public a été appelé réellement avec succès le 29 octobre 2026 : aucun match actif n’était alors annoncé. Le schéma des dix champions a aussi été vérifié sur un flux historique réel, conservé comme fixture et jamais présenté comme live. Une rencontre active reste nécessaire pour vérifier le parcours complet avec une partie en cours. La connexion à un flux commercial n’a pas été vérifiée sans accès fournisseur. Aucune clé interne LoL Esports ancienne n’est intégrée.

## Publier sur GitHub Pages

Les workflows sont prêts dans `.github/workflows/` :

- `check.yml` teste, réévalue et construit un artefact de revue sur les push/PR.
- `pages.yml`, déclenché à chaque push sur `main` ou manuellement, teste, réévalue, construit et publie `dist/` avec le dernier moteur.

Le seuil affiché est 70 % d’accord sur la cohorte élargie, avec au moins 80 % de couverture. Il ne bloque pas la publication.

Le dépôt est public. **Settings → Pages → Source : GitHub Actions**. Définir éventuellement la variable de dépôt `LIVE_API_URL` avec l’adresse publique du proxy. Le serveur live doit être hébergé séparément pour que le site statique puisse importer les données.

Chaque push sur `main` republie le site avec le dernier moteur.

L’[expérience de distillation](docs/DISTILLATION.md) compare aussi un modèle appris au moteur à règles. Elle obtient 82,3 % d’accord sur son entraînement mais 51,6 % hors groupes de vidéos/compositions et ne justifie pas un remplacement du moteur. Ces métriques restent séparées de la validation principale.

## Organisation

| Chemin | Fonction |
| --- | --- |
| `src/engine.mjs` | Règles exécutables, score et abstention |
| `data/knowledge.json` | Profils, règles et provenance |
| `data/lol-champions-gameplay.md` | Guide gameplay des champions, patch Data Dragon |
| `data/benchmark.json` | Cas nettoyés, reconstruction, déduplication et exclusions |
| `data/evaluation.json` | Accord, couverture, incertitude et seuil de publication |
| `public/` | Interface sans framework |
| `server/` | Proxy live et service HTTP |
| `scripts/` | Génération, évaluation et build |
| `tests/` | Vérifications automatisées |

Ce projet est une reconstruction expérimentale de principes issus du corpus fourni. Il ne constitue pas une validation ou une approbation par Kazewa. Les assets du jeu appartiennent à Riot Games.
