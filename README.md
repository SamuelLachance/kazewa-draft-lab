# Kazewa — Draft Lab

Le verdict de Kazewa sur les drafts de League of Legends qu’il a commentées, avec ses raisons et sa vidéo. Pour toute autre draft, le site donne un verdict estimé d’après ses propres arguments sur les mêmes champions, puis d’après ses fiches champion. Si ni l’un ni l’autre ne départage les deux compositions, il ne donne pas d’estimation. La grille de décision de Kazewa et la vérification de construction de Shanei, un second coach, sont des seconds avis, affichés à part. Aucun résultat de partie professionnelle ne décide du verdict. Chaque verdict dit quelle lecture a servi et ce qu’elle vaut.

Le coach de draft suit le processus que les deux coachs enseignent : l’ordre des picks, les premiers picks, la famille de la composition, les pièces qui manquent, les bans qui protègent le plan. Il ne lit pas la méta professionnelle pour choisir.

Site : [samuellachance.github.io/kazewa-draft-lab](https://samuellachance.github.io/kazewa-draft-lab/). Dépôt : [SamuelLachance/kazewa-draft-lab](https://github.com/SamuelLachance/kazewa-draft-lab).

## Ce que le site répond

| Situation | Réponse | Fiabilité |
| --- | --- | --- |
| Draft que Kazewa a jugée | Son verdict, sa confiance, ses raisons en français, le lien vers le passage de la vidéo | Restitution : c’est son avis, pas une prédiction |
| Draft jamais jouée, ses arguments s’y appliquent | Le côté que désignent les matchups, synergies et réponses qu’il a nommés dans d’autres vidéos | Environ 62 %, mesuré en ne gardant que ses arguments venus d’autres vidéos |
| Ses arguments ne départagent pas, ses fiches oui | Le côté que désignent ses fiches champion (qui va bien avec qui, qui prend le dessus sur qui) | Environ 60 %, mesuré sur des vidéos que les fiches n’ont jamais vues |
| Ni ses arguments ni ses fiches ne départagent | Pas d’estimation. La grille de décision de Kazewa est affichée à part, comme second avis | Aucune : le site le dit |
| Partie pro déjà jouée | Le fait : l’équipe qui a gagné. Ce n’est pas le verdict de la draft | Le résultat est un fait ; il ne sert pas à prédire |

Quand ses arguments ou ses fiches départagent les deux compositions, le site donne une estimation. Sur les drafts de vidéos tenues à l’écart, elle coïncide avec son avis 58,6 % du temps pour une draft jamais jouée (41 sur 70, intervalle 48 à 68 %) ; une seule de ces 71 drafts n’a reçu aucune estimation. Sur 500 drafts tirées au hasard parmi tous les champions, 123 n’ont aucune estimation (24,6 %). Une autre lecture, celle du résultat d’une partie déjà jouée, coïncide avec son avis 80 % du temps ; elle est affichée comme un fait et non comme un verdict, parce qu’elle ne vient pas de sa méthode.

Un constat borne ce que dix champions peuvent dire : sur les vidéos dont ses fiches champion sont tirées, les fiches retrouvent son verdict 78,6 % du temps ; sur les vidéos qu’elles n’ont jamais vues, 59,6 %. Ce qu’il dit d’une draft permet de retrouver son verdict ; des règles générales sur les champions ne le permettent pas.

Les chiffres exacts sont dans [`data/evaluation.json`](data/evaluation.json) et expliqués dans [`docs/EVALUATION.md`](docs/EVALUATION.md). Le site les lit dans ce fichier : il n’écrit aucun pourcentage en dur.

Pour toute draft, le site montre aussi :

- **les drafts proches qu’il a jugées**, avec son verdict replacé sur les côtés de la draft affichée ;
- **ses arguments** donnés ailleurs et encore valables ici (mêmes champions, même relation allié ou adverse, mêmes rôles), comptés par côté ;
- **la fiche de chaque champion** : ce qu’il en dit, résumé de ses vidéos, pour les 173 champions du catalogue ;
- **la grille de décision**, comme second avis hors de l’estimation : identité, trous structurels, axes gagnés, bonus et timing de chaque côté, avec la phrase qui les motive ;
- **la lecture de Shanei** : la famille de chaque composition et ce qu’il reprocherait ou validerait, chaque ligne avec sa vidéo ([détail plus bas](#le-second-avis--la-méthode-de-shanei)) ;
- **la lecture structurelle du calculateur**, une description des deux compositions dont le score n’est pas un verdict.

## La grille de décision de Kazewa

`src/theory.mjs` applique sa grille de décision telle qu’il la décrit (son document de méthode, section 8) :

- **A. Identité** : une phrase par camp ; sans identité lisible, ou avec des identités incompatibles, −2 ;
- **B. Trous structurels**, chacun retranché : pas de vrai tank ni de frontline (−3), moins de deux sources de dégâts soutenus (−3), trois immobiles face à un catch (−3), engage contre un bloc de désengagement (−2), poke avec un support qui engage et sans peel (−2), un pick qui a besoin d’un partenaire qu’il n’a pas (−1), une compo qui doit gagner tôt sans outil pour conclure (−2) ;
- **C. Axes** : la phase de lane, le combat d’équipe, le scaling, les objectifs, le catch, le split et les globaux, la portée. Le camp qui gagne un axe prend un point, deux s’il le gagne nettement ;
- **D. Bonus** : +2 si chaque pick s’enchaîne avec un autre, +1 par condition de victoire indépendante au-delà de la première (jusqu’à +3), +1 pour un plan simple et cohérent ;
- **E. Timing** : un camp qui compte sur l’avance tôt sans gagner ses lanes cède un point au camp qui scale ;
- **F. Verdict** : l’écart et les trous donnent la confiance de 0 à 3, comme dans sa grille.

Les vérifications de Shanei s’y ajoutent : pas de tank dans le bloc de quatre (−2), jamais full AD ni full AP (−2), un hypercarry sans enchanteur (−1). Ses points ne sont pas les siens : sa grille ne les chiffre pas. Quand il nomme un axe que les profils de champions ne mesurent pas, la grandeur la plus proche est utilisée, et la phrase le dit.

Cette grille **ne lit aucune partie professionnelle** et n’entre pas dans l’estimation : c’est un second avis. Elle est mesurée sur les drafts qu’il a jugées sans être réglée sur elles : sur 292 drafts où elle penche, son côté est celui de Kazewa 147 fois, soit 50,3 % (intervalle 45 à 57 %), une pièce lancée. La confiance ne fait pas monter l’accord. Mesure : `node research/theory-eval.mjs`. Ses verdicts reposent sur les joueurs, la forme des équipes et des décisions de draft que les profils ne décrivent pas : c’est ce qu’il dit lui-même dans les limites de sa méthode.

Non appliqué, et dit comme tel dans le code : la pénalité d’un pick bloqué par un contre (blind, contre faux, premier pick qui cède son contre), le pick décisif laissé à l’adversaire (étape D), et la dégradation d’un cran quand le plan dépend du confort d’un joueur ou de l’exécution (étape F). Ces points demandent l’ordre des picks, les bans et ses contres nommés ; le coach applique lui-même les règles de premier pick et de blind de Shanei. Le catch ne compte que sa valeur : un carry atteignable par un dash ou un engage n’est pas compté. Le second flex, que Shanei proscrit, n’est pas encore pénalisé.

## Le second avis : la méthode de Shanei

Le site lit aussi chaque draft complète avec la grille de Shanei, tirée de ses vidéos (`data/method.json`, 258 règles) :

- **une seule identité** : la famille est lue sur le bloc jungle, mid, ADC et support (le top est à part). Trois familles : all-in (catch, wombo combo, full early), poke / disengage, hypercarry (un carry et son enchanteur). Un pick du bloc hors de la famille est relevé, deux cassent la cohérence ;
- **un vrai tank dans le bloc de quatre**, jamais full AD ni full AP ;
- **les pièces de chaque famille** : l’enchanteur de l’hypercarry, le tank au mid d’un hypercarry jungle, le mid de poke, trois à cinq sources de désengage pour une compo qui n’engage pas ;
- **les duos** : les combos et anti-synergies qu’il nomme (170 tirés de la table des combos de son cours, 70 de ses vidéos) ;
- **face à l’autre composition** : ce qui tient un all-in, les réponses à une compo poke, un ultime offert à Sylas, une botlane sacrifiée.

Chaque ligne cite la règle qui la porte et renvoie à la vidéo, sauf les duos de la table du cours. Il classe lui-même 154 des 173 champions dans ses familles ; les autres sont classés d’après ses définitions et n’entrent pas dans la lecture de la famille. Les faits de kit (tank, enchanteur, type de dégâts, engage…) viennent d’une grille d’analyste, pas de ses mots. Une règle que la fiche de la vidéo marque comme mal transcrite ou non tranchée est affichée avec la mention « avis moins net » et ne compte pas.

Ce second avis **n’entre pas dans le verdict estimé**, et le site dit pourquoi : sur les drafts jugées par Kazewa où elle penche d’un côté, la composition qu’elle trouve la plus saine est celle qu’il préférait 49,5 % du temps. La grille dit comment une draft est bâtie, pas qui gagne ni ce qu’en pense Kazewa. `node research/shanei-eval.mjs` refait ces mesures.

## Le coach de draft

Le coach suit les vingt tours d’une draft (bans et picks) et dit à chaque tour quoi bannir ou prendre, avec la phrase qui justifie chaque point du classement :

- **ce que Kazewa a dit** de ce champion avec ceux déjà pris : matchups, réponses et synergies nommés dans les drafts qu’il a jugées, dans les mêmes rôles, avec le lien vers la vidéo ; à défaut, ce qu’en disent ses fiches champion ;
- **ce qu’il disait de la force du champion ces six derniers mois** : fort ou faible dans la méta du moment, dans le rôle dont il parlait ;
- **sa grille de décision** : ce que le champion comble ou crée dans son camp, et les axes qu’il fait gagner ou perdre ;
- **les règles des deux coachs** pour le moment de la draft : l’ordre des rôles (ADC tôt, pas de support en première rotation, support avant le top, top en dernier pick, comme Shanei le veut), les premiers picks, les picks à ne pas blind, la famille de la composition et les pièces qui manquent, les combos et les réponses à ce que montre l’adversaire ;
- **les bans** qui protègent le plan : un ban protège la composition selon sa famille, et ne retire jamais une de ses pièces.

Tu peux dire au coach quelle famille tu vises (all-in, poke, hypercarry) : ce plan guide alors les picks et les bans dès le premier tour, et il n’est jamais montré à l’adversaire. À chaque tour le coach affiche les règles des deux coachs pour ce moment de la draft, et sous chaque côté l’état de la composition : sa famille, son tank, ce qui lui manque. Chaque ligne d’une suggestion dit de qui elle vient : Shanei, Kazewa ou la grille de décision.

Un champion est proposé dans le rôle où il est réellement joué : la table des lanes est complétée par les rôles joués en pro. Les statistiques des parties professionnelles ne classent rien : elles ne servent qu’à lire les rôles. Pour les bans, le camp qui prend juste après ne bannit pas son propre meilleur pick. Sous les cinq suggestions, le coach montre jusqu’à trois champions moins joués en ce moment mais que Kazewa a nommés contre ou avec ceux déjà pris.

Le coach ne prédit pas le vainqueur. Il applique les règles de deux coachs, et ce qu’elles donnent n’a pas été réglé sur des parties professionnelles : un coach qui suivrait ce que font les équipes pro ne suivrait pas ces règles. La mesure sur des drafts professionnelles de 2026 reste dans [`docs/EVALUATION.md`](docs/EVALUATION.md) : elle ne sert plus de cible.

## Démarrer

Prérequis : Node.js 22 ou plus. Aucune dépendance à installer.

```powershell
npm run dev
```

Ouvrir <http://127.0.0.1:4173>. Tout le calcul se fait dans le navigateur.

```powershell
npm test          # mémoire, verdict, grille de décision, méthode, mesure, coach, flux live, serveur
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
npm run coach:data                                                 # data/coach.json : remarques datées de Kazewa par champion
npm run method                                                     # data/method.json : règles, familles, duos et bans de la méthode des deux coachs
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
| `src/theory.mjs` | Grille de décision de Kazewa (identité, trous, axes, bonus, timing, verdict) et son usage par le coach |
| `src/method.mjs` | Méthode de draft de Shanei et de Kazewa : lecture d’une draft, raisons d’un pick ou d’un ban, règles du tour |
| `src/relations.mjs` | Lecture d’après ses fiches champion |
| `src/results.mjs` | Parties pro déjà jouées avec les dix champions d’une draft (fait affiché, pas verdict) |
| `src/engine.mjs` | Calculateur structurel (description des compositions) |
| `src/draft-coach.mjs` | Coach de draft : les vingt tours, la session |
| `src/coach.mjs` | Classement des bans et des picks, avec la phrase derrière chaque point |
| `data/kazewa-memory.json` | Mémoire complète, avec la trace de chaque source |
| `data/memory-site.json` | Version chargée par le site |
| `data/champion-cards.json` | Fiche Kazewa des 173 champions |
| `data/model.json` | Fiabilité mesurée de chaque lecture |
| `data/card-holdout.json` | Vidéos tenues à l’écart quand les fiches ont été écrites |
| `data/evaluation.json` | Rapport de mesure |
| `data/method.json` | Règles des deux coachs avec leur vidéo, familles de Shanei par champion, duos, listes de bans |
| `research/method-extraction.json` | Relevé des règles dans les fiches des vidéos, relu règle par règle, et grille de kits |
| `research/theory-eval.mjs` | Mesure de la grille de décision sur les verdicts de Kazewa, sans réglage |
| `data/coach.json` | Remarques datées de Kazewa par champion |
| `data/pro-results/` | Résultat des parties pro, par empreinte des dix champions (données Oracle’s Elixir) |
| `scripts/` | Construction de la mémoire, mesure, build |
| `research/` | Banc d’essai hors groupe et modèles essayés |
| `server/` | Proxy du flux professionnel et service HTTP local |

## Direct pro

GitHub Pages sert des fichiers statiques ; le flux professionnel passe par un serveur séparé. Voir [`docs/LIVE_SOURCES.md`](docs/LIVE_SOURCES.md). Sur un match en direct, le site affiche le verdict de Kazewa s’il a jugé cette draft ; sinon, le verdict estimé et la lecture dont il vient.

## Publier

`.github/workflows/pages.yml` teste, mesure, construit et publie `dist/` à chaque push sur `main`. **Settings → Pages → Source : GitHub Actions.**

Projet indépendant. Il n’est ni affilié à Riot Games ni approuvé par Kazewa. Les assets du jeu appartiennent à Riot Games. Les compositions et les résultats des parties professionnelles viennent des données de match d’[Oracle’s Elixir](https://oracleselixir.com/).
