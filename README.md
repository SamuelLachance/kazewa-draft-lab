# Kazewa — Draft Lab

Le verdict de Kazewa sur les drafts de League of Legends qu’il a commentées, avec ses raisons et sa vidéo. Pour une draft qu’il n’a pas commentée : ses avis les plus proches, ses arguments sur les mêmes champions, et une tendance tirée de ces arguments, dont la fiabilité est mesurée et affichée.

Site : [samuellachance.github.io/kazewa-draft-lab](https://samuellachance.github.io/kazewa-draft-lab/). Dépôt : [SamuelLachance/kazewa-draft-lab](https://github.com/SamuelLachance/kazewa-draft-lab).

## Ce que le site répond

| Situation | Réponse | Fiabilité |
| --- | --- | --- |
| Draft que Kazewa a jugée | Son verdict, sa confiance, ses raisons en français, le lien vers le passage de la vidéo | Restitution : c’est son avis, pas une prédiction |
| Draft inédite, ses arguments s’y appliquent | Le côté que désignent les matchups, synergies et réponses qu’il a nommés dans d’autres vidéos | Environ 63 %, mesuré en ne gardant que ses arguments venus d’autres vidéos |
| … et l’ordre des picks les confirme | La même tendance, renforcée | Environ 75 % |
| … et l’ordre des picks les contredit | Aucune tendance, les deux lectures sont montrées | Aucune des deux ne l’emporte |
| Draft inédite, aucun argument applicable | L’ordre des picks seul s’il est connu (environ 61 %), sinon rien | Les règles de composition seules ne dépassent pas une pièce lancée |

Les chiffres exacts sont dans [`data/evaluation.json`](data/evaluation.json) et expliqués dans [`docs/EVALUATION.md`](docs/EVALUATION.md). Le site les lit dans ce fichier : il n’écrit aucun pourcentage en dur.

Pour toute draft, le site montre aussi :

- **les drafts proches qu’il a jugées**, avec son verdict replacé sur les côtés de la draft affichée ;
- **ses arguments** donnés ailleurs et encore valables ici (mêmes champions, même relation allié ou adverse, mêmes rôles), comptés par côté ;
- **la fiche de chaque champion** : ce qu’il en dit, résumé de ses vidéos, pour les 173 champions du catalogue ;
- **la lecture structurelle du calculateur** (frontline, dégâts, catch, scaling…). C’est une description des deux compositions. Sur les drafts qu’il n’a jamais vues, son côté coïncide avec celui de Kazewa une fois sur deux : son score n’est pas présenté comme un verdict.

## Pourquoi pas « 100 % d’accord » sur les drafts futures

Les verdicts de Kazewa s’appuient sur l’ordre des picks, les bans, les joueurs, la forme des équipes et la méta du moment. Dix champions ne portent pas cette information. Les profils de champions, leur identité, les règles structurelles et les statistiques de 44 000 matchs pros restent au niveau du hasard quand on les mesure sur des vidéos tenues à l’écart. Deux lectures font mieux : ses propres arguments, repris d’une vidéo à l’autre, et l’ordre des picks. Ensemble elles retrouvent son verdict trois fois sur quatre, pas plus. Personne ne peut promettre son avis sur une draft qu’il n’a pas encore commentée.

L’ancienne version affichait 100 % d’accord. Ce chiffre venait de 62 drafts sur lesquelles le calculateur avait été réglé. Sur les autres drafts jugées, le même calculateur tombait à une sur deux. Ce chiffre a été retiré.

Une draft future rejoint la mémoire quand Kazewa la commente : on ajoute l’extraction de sa vidéo au corpus et on relance `npm run memory`.

## Démarrer

Prérequis : Node.js 22 ou plus. Aucune dépendance à installer.

```powershell
npm run dev
```

Ouvrir <http://127.0.0.1:4173>. Tout le calcul se fait dans le navigateur.

```powershell
npm test          # mémoire, verdict, mesure, calculateur, coach, flux live, serveur
npm run evaluate  # recalcule data/evaluation.json et data/model.json depuis la mémoire
npm run build     # site statique dans dist/, compatible GitHub Pages
```

Ces trois commandes fonctionnent dans un dépôt autonome, sans le corpus et sans réseau.

## Reconstruire la mémoire

La mémoire se reconstruit depuis le corpus local (extractions des vidéos), qui n’est pas dans ce dépôt.

```powershell
npm run oe:index -- --csv-dir <dossier des CSV Oracle's Elixir>   # index local des matchs pros, dans .cache/
npm run memory -- --corpus <dossier du corpus>                     # data/kazewa-memory.json + data/memory-site.json
npm run evaluate
```

`scripts/build-memory.mjs` :

1. lit les extractions de phase de draft, les extractions de revue complète et les clés de réponse ;
2. relie chaque extraction à la partie professionnelle réelle quand elle figure dans l’index (compositions, côtés de carte, ordre des picks, résultat), en tolérant au plus une erreur de reconnaissance vocale et en exigeant une marge nette sur toute autre partie ;
3. garde un cas par partie réelle, avec le verdict du meilleur moment disponible : pendant la draft, puis dans la revue, puis l’avis explicitement tardif (sans l’index des matchs, il refuse d’écraser la mémoire, sauf avec `--allow-unverified`) ;
4. applique les corrections relues de [`data/memory-overrides.json`](data/memory-overrides.json) ;
5. joint la traduction française et les arguments structurés de `data/kazewa-enrichment.json`, liés au texte exact qu’ils traduisent.

Les extractions qu’aucune partie ne permet de compléter restent hors mémoire. Elles sont comptées dans `audit` au début de `data/kazewa-memory.json`.

## Organisation

| Chemin | Fonction |
| --- | --- |
| `src/memory.mjs` | Recherche d’une draft jugée, drafts proches, arguments applicables |
| `src/verdict.mjs` | Réponse du site : sa mémoire d’abord, tendance mesurée sinon |
| `src/engine.mjs` | Calculateur structurel (description des compositions) |
| `src/draft-coach.mjs` | Coach de draft pick par pick |
| `data/kazewa-memory.json` | Mémoire complète, avec la trace de chaque source |
| `data/memory-site.json` | Version chargée par le site |
| `data/champion-cards.json` | Fiche Kazewa des 173 champions |
| `data/model.json` | Poids de l’ordre des picks par lane et fiabilités mesurées |
| `data/evaluation.json` | Rapport de mesure |
| `scripts/` | Construction de la mémoire, mesure, build |
| `research/` | Banc d’essai hors groupe et modèles essayés |
| `server/` | Proxy du flux professionnel et service HTTP local |

## Direct pro

GitHub Pages sert des fichiers statiques ; le flux professionnel passe par un serveur séparé. Voir [`docs/LIVE_SOURCES.md`](docs/LIVE_SOURCES.md). Sur un match en direct, le site affiche le verdict de Kazewa s’il a jugé cette draft ; sinon, le côté que désignent ses arguments. Le flux public ne donne pas l’ordre des picks.

## Publier

`.github/workflows/pages.yml` teste, mesure, construit et publie `dist/` à chaque push sur `main`. **Settings → Pages → Source : GitHub Actions.**

Projet indépendant. Il n’est ni affilié à Riot Games ni approuvé par Kazewa. Les assets du jeu appartiennent à Riot Games.
