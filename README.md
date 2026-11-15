# Kazewa — Draft Lab

Le verdict de Kazewa sur les drafts de League of Legends qu’il a commentées, avec ses raisons et sa vidéo. Toute autre draft reçoit un verdict estimé : d’après le résultat du match quand la partie a déjà été jouée, sinon d’après ses arguments sur les mêmes champions, puis ses fiches champion, puis ses principes de composition. Chaque verdict dit quelle lecture a servi et ce qu’elle vaut.

Site : [samuellachance.github.io/kazewa-draft-lab](https://samuellachance.github.io/kazewa-draft-lab/). Dépôt : [SamuelLachance/kazewa-draft-lab](https://github.com/SamuelLachance/kazewa-draft-lab).

## Ce que le site répond

| Situation | Réponse | Fiabilité |
| --- | --- | --- |
| Draft que Kazewa a jugée | Son verdict, sa confiance, ses raisons en français, le lien vers le passage de la vidéo | Restitution : c’est son avis, pas une prédiction |
| Draft d’une partie pro déjà jouée, qu’il n’a pas commentée | La partie, l’équipe qui a gagné, et ce côté comme verdict estimé | Environ 80 % : sur les parties qu’il a commentées, il préférait le plus souvent l’équipe gagnante |
| Draft jamais jouée, ses arguments s’y appliquent | Le côté que désignent les matchups, synergies et réponses qu’il a nommés dans d’autres vidéos | Environ 62 %, mesuré en ne gardant que ses arguments venus d’autres vidéos |
| Ses arguments ne départagent pas (aucun, ou autant de chaque côté) | Le côté que désignent ses fiches champion (qui va bien avec qui, qui prend le dessus sur qui) | Environ 60 %, mesuré sur des vidéos que les fiches n’ont jamais vues |
| Ses fiches ne départagent pas | Le côté que désignent ses principes de composition | Environ 50 % : une pièce lancée |

Aucune draft complète n’est laissée sans verdict. Sur les drafts de vidéos tenues à l’écart de toutes les lectures, le verdict estimé coïncide avec le sien 58,5 % du temps pour une draft jamais jouée, et 80,3 % quand la partie a été jouée et que son résultat est connu.

La lecture par le résultat n’est pas un jugement sur la draft. Elle dit qui a gagné, parce que c’est le plus souvent l’équipe dont il préférait la draft. Elle n’existe pas pour une draft qui n’a pas été jouée.

Un constat borne ce que dix champions peuvent dire : sur les vidéos dont ses fiches champion sont tirées, les fiches retrouvent son verdict 78,6 % du temps ; sur les vidéos qu’elles n’ont jamais vues, 59,6 %. Ce qu’il dit d’une draft permet de retrouver son verdict ; des règles générales sur les champions ne le permettent pas.

Les chiffres exacts sont dans [`data/evaluation.json`](data/evaluation.json) et expliqués dans [`docs/EVALUATION.md`](docs/EVALUATION.md). Le site les lit dans ce fichier : il n’écrit aucun pourcentage en dur.

Pour toute draft, le site montre aussi :

- **les drafts proches qu’il a jugées**, avec son verdict replacé sur les côtés de la draft affichée ;
- **ses arguments** donnés ailleurs et encore valables ici (mêmes champions, même relation allié ou adverse, mêmes rôles), comptés par côté ;
- **la fiche de chaque champion** : ce qu’il en dit, résumé de ses vidéos, pour les 173 champions du catalogue ;
- **la lecture structurelle du calculateur** (frontline, dégâts, catch, scaling…). C’est une description des deux compositions. Sur les drafts qu’il n’a jamais vues, son côté coïncide avec celui de Kazewa une fois sur deux : son score n’est pas présenté comme un verdict.

## Pourquoi pas « 100 % d’accord » sur les drafts futures

Les verdicts de Kazewa s’appuient sur l’ordre des picks, les bans, les joueurs, la forme des équipes et la méta du moment. Dix champions ne portent pas cette information. Les profils de champions, leur identité, les règles structurelles et les statistiques de 44 000 matchs pros restent au niveau du hasard quand on les mesure sur des vidéos tenues à l’écart. Une lecture fait un peu mieux : ses propres arguments, repris d’une vidéo à l’autre, 61,8 % du temps, contre 54,1 % en répondant toujours le même côté. Cet avantage va dans le bon sens mais n’est pas encore établi statistiquement. La force des équipes avant la partie ne suit pas ses avis non plus. Le résultat de la partie, lui, les suit 79,8 % du temps : c’est pourquoi le site le nomme quand la partie a été jouée. L’ordre des picks avait paru utile sur 195 drafts ; sur 268 il ne fait pas mieux que répondre toujours le même côté, et il a été retiré. Personne ne peut promettre son avis sur une draft qu’il n’a pas encore commentée.

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
npm run oe:index -- --csv-dir <dossier des CSV Oracle's Elixir>[,<autre dossier>]   # index local des matchs pros, dans .cache/
npm run memory -- --corpus <dossier du corpus>                     # data/kazewa-memory.json + data/memory-site.json
npm run pro:results                                                # data/pro-results/ : résultat de chaque partie de l’index
npm run evaluate
```

`scripts/build-memory.mjs` :

1. lit les extractions de phase de draft, les extractions de revue complète et les clés de réponse ;
2. relie chaque extraction à la partie professionnelle réelle quand elle figure dans l’index (compositions, côtés de carte, résultat), en tolérant au plus une erreur de reconnaissance vocale et en exigeant une marge nette sur toute autre partie ;
3. garde un cas par partie réelle, avec le verdict du meilleur moment disponible : pendant la draft, puis dans la revue, puis l’avis explicitement tardif (sans l’index des matchs, il refuse d’écraser la mémoire, sauf avec `--allow-unverified`) ;
4. applique les corrections et les rattachements relus de [`data/memory-overrides.json`](data/memory-overrides.json) : une extraction trop partielle pour un rattachement automatique est reliée à la partie qu’un relecteur a nommée et que deux contrôles indépendants ont confirmée ;
5. joint la traduction française et les arguments structurés de `data/kazewa-enrichment.json`, liés au texte exact qu’ils traduisent.

Les extractions qu’aucune partie ne permet de compléter restent hors mémoire. Elles sont comptées dans `audit` au début de `data/kazewa-memory.json`.

## Organisation

| Chemin | Fonction |
| --- | --- |
| `src/memory.mjs` | Recherche d’une draft jugée, drafts proches, arguments applicables |
| `src/verdict.mjs` | Réponse du site : sa mémoire d’abord, sinon la chaîne de lectures |
| `src/relations.mjs` | Lecture d’après ses fiches champion |
| `src/results.mjs` | Parties pro déjà jouées avec les dix champions d’une draft |
| `src/engine.mjs` | Calculateur structurel (description des compositions) |
| `src/draft-coach.mjs` | Coach de draft pick par pick |
| `data/kazewa-memory.json` | Mémoire complète, avec la trace de chaque source |
| `data/memory-site.json` | Version chargée par le site |
| `data/champion-cards.json` | Fiche Kazewa des 173 champions |
| `data/model.json` | Fiabilité mesurée de chaque lecture |
| `data/card-holdout.json` | Vidéos tenues à l’écart quand les fiches ont été écrites |
| `data/evaluation.json` | Rapport de mesure |
| `data/pro-results/` | Résultat des parties pro, par empreinte des dix champions (données Oracle’s Elixir) |
| `scripts/` | Construction de la mémoire, mesure, build |
| `research/` | Banc d’essai hors groupe et modèles essayés |
| `server/` | Proxy du flux professionnel et service HTTP local |

## Direct pro

GitHub Pages sert des fichiers statiques ; le flux professionnel passe par un serveur séparé. Voir [`docs/LIVE_SOURCES.md`](docs/LIVE_SOURCES.md). Sur un match en direct, le site affiche le verdict de Kazewa s’il a jugé cette draft ; sinon, le verdict estimé et la lecture dont il vient.

## Publier

`.github/workflows/pages.yml` teste, mesure, construit et publie `dist/` à chaque push sur `main`. **Settings → Pages → Source : GitHub Actions.**

Projet indépendant. Il n’est ni affilié à Riot Games ni approuvé par Kazewa. Les assets du jeu appartiennent à Riot Games. Les compositions et les résultats des parties professionnelles viennent des données de match d’[Oracle’s Elixir](https://oracleselixir.com/).
