# Kazewa — Draft Lab

Le verdict de Kazewa sur les drafts de League of Legends qu’il a commentées, avec ses raisons et sa vidéo. Toute autre draft reçoit un verdict estimé : d’après le résultat du match quand la partie a déjà été jouée, sinon d’après ses arguments sur les mêmes champions, puis ses fiches champion, puis ses principes de composition. Chaque verdict dit quelle lecture a servi et ce qu’elle vaut.

Chaque draft est aussi lue avec la méthode d’un second coach, Shanei : c’est un second avis sur la construction des deux compositions, affiché à part. Le coach de draft suit le processus que les deux coachs enseignent.

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
- **la lecture de Shanei** : la famille de chaque composition (all-in, poke, hypercarry) et ce que sa méthode lui reprocherait ou validerait, chaque ligne avec la vidéo où il donne la règle ([détail plus bas](#le-second-avis--la-méthode-de-shanei)) ;
- **la lecture structurelle du calculateur** (frontline, dégâts, catch, scaling…). C’est une description des deux compositions. Sur les drafts qu’il n’a jamais vues, son côté coïncide avec celui de Kazewa une fois sur deux : son score n’est pas présenté comme un verdict.

## Le second avis : la méthode de Shanei

Le site lit chaque draft complète avec la grille de Shanei, tirée de ses vidéos (`data/method.json`, 258 règles) :

- **une seule identité** : la famille est lue sur le bloc jungle, mid, ADC et support (le top est à part). Trois familles : all-in (catch, wombo combo, full early), poke / disengage, hypercarry (un carry et son enchanteur). Un pick du bloc hors de la famille est relevé, deux cassent la cohérence ;
- **un vrai tank dans le bloc de quatre**, jamais full AD ni full AP ;
- **les pièces de chaque famille** : l’enchanteur de l’hypercarry, le tank au mid d’un hypercarry jungle, le mid de poke, trois à cinq sources de désengage pour une compo qui n’engage pas ;
- **les duos** : les combos et anti-synergies qu’il nomme (70 duos tirés de ses vidéos, 170 de la table des combos de son cours) ;
- **face à l’autre composition** : ce qui tient un all-in, les réponses à une compo poke, un ultime offert à Sylas, une botlane sacrifiée.

Chaque ligne cite la règle qui la porte et renvoie à la vidéo. Il classe lui-même 154 des 173 champions dans ses familles ; les autres sont classés d’après ses définitions et ne sont jamais retenus contre une draft. Les faits de kit (tank, enchanteur, type de dégâts, engage…) viennent d’une grille d’analyste, pas de ses mots. Une règle que la fiche de la vidéo marque comme mal transcrite ou non tranchée est affichée avec la mention « avis moins net » et ne compte pas.

Ce second avis **n’entre pas dans le verdict estimé**, et le site dit pourquoi : sur 278 drafts jugées par Kazewa, la composition que la grille trouve la plus saine est celle qu’il préférait 49,3 % du temps ; sur 52 124 parties professionnelles, c’est celle qui a gagné 49,8 % du temps. À ce niveau les deux équipes draftent des compositions cohérentes : la grille dit comment une draft est bâtie, pas qui gagne ni ce qu’en pense Kazewa. Elle ne trouve rien à reprocher à 24,6 % des compositions professionnelles. `node research/shanei-eval.mjs` refait ces mesures.

## Le coach de draft

Le coach suit les vingt tours d’une draft (bans et picks) et dit à chaque tour quoi bannir ou prendre, avec la phrase qui justifie chaque point du classement :

- **ce que Kazewa a dit** de ce champion avec ceux déjà pris : les matchups, réponses et synergies qu’il a nommés dans les drafts qu’il a jugées, dans les mêmes rôles, avec le lien vers la vidéo ; à défaut, ce qu’en disent ses fiches champion. L’adversaire direct de la lane compte davantage, et une lane qu’il juge perdue plus qu’une lane qu’il juge gagnée. Une anti-synergie qu’il a nommée compte contre le duo. Un matchup ou un duo qu’il a jugé dans les deux sens ne donne aucun point ;
- **ce qu’il disait du champion ces six derniers mois** : fort ou faible dans la méta du moment, dans le rôle dont il parlait ;
- **la méta pro** : la part des parties professionnelles récentes où le champion est pris ou banni, dans ce rôle (744 parties du 2026-09-15 au 2026-11-13, toutes ligues sauf les académies) ;
- **le moment de la draft** : le rôle que les équipes pro prennent à ce pick, et le stade où elles prennent ce champion ;
- **la frontline** : quand trois picks sont posés sans frontline, un champion qui en apporte une passe devant ;
- **le processus de draft des deux coachs** (`src/method.mjs`, 258 règles de Shanei et 100 de Kazewa, chacune avec sa vidéo) :
  - l’ordre des rôles de Shanei : l’ADC tôt, pas de support en première rotation, le support avant le top, le top en dernier pick ; Kazewa garde lui aussi le dernier pick rouge pour le top ;
  - le premier pick : les ADC sûrs et les vrais flex de Shanei, les picks qu’il ne blind pas, et ce que Kazewa dit d’un premier pick ;
  - la famille de la composition : une pièce de la famille passe devant, un pick hors thème derrière. Sans plan annoncé, la famille ne compte qu’à partir de trois picks posés, comme Shanei le demande ;
  - les pièces qui manquent : l’enchanteur d’un hypercarry, le vrai tank du bloc de quatre, le mid de poke, et sur le dernier pick qui peut encore les apporter elles comptent double ;
  - les combos et anti-synergies que Shanei nomme, ses réponses à ce que montre l’adversaire, jamais full AD ni full AP ;
  - les règles de construction de Kazewa : pas d’immobiles empilés, deux picks de scaling au maximum, un tank dans les deux premiers picks ;
  - les bans de Shanei : un ban protège la composition selon sa famille et ne retire jamais une de ses pièces.

Tu peux dire au coach quelle famille tu vises (all-in, poke, hypercarry) : ce plan guide alors les picks et les bans dès le premier tour, et il n’est jamais montré à l’adversaire. À chaque tour le coach affiche les règles des deux coachs pour ce moment de la draft, et sous chaque côté l’état de la composition : sa famille, son tank, ce qui lui manque. Chaque ligne d’une suggestion dit de qui elle vient : Shanei, Kazewa ou la méta pro.

Un champion est proposé dans le rôle où il est réellement joué : la table des lanes est complétée par les rôles joués en pro. Pour les bans, le camp qui prend juste après ne bannit pas son propre meilleur pick. Sous les cinq suggestions, le coach montre jusqu’à trois champions moins joués en ce moment mais que Kazewa a nommés contre ou avec ceux déjà pris. Il affiche aussi, sans que cela change le classement, les champions qui peuvent encore répondre à un pick d’après lui, et ce qu’il disait de ce pick dans une vidéo datée (365 remarques, chacune rangée sous le champion dont elle parle).

Le coach ne prédit pas le vainqueur et n’utilise pas le calculateur structurel. Sa mesure est un contrôle de bon sens : sur 612 drafts professionnelles de 2026 rejouées tour par tour, avec les seuls chiffres des 60 jours précédents, le champion réellement pris figure dans ses cinq premières suggestions 29,6 % du temps et dans ses dix premières 47,4 % du temps (rang médian 11) ; 46,0 % quand les picks précédents sont rangés dans le rôle que le coach leur donne lui-même, comme sur le site. Le champion réellement banni figure dans ses dix premières suggestions 49,9 % du temps en première phase et 45,4 % en seconde. Suivre la méthode des deux coachs éloigne le coach de ce que font les équipes professionnelles : sans elle, le même classement place le pick réel dans ses dix premières suggestions 52,6 % du temps. Sur les drafts de 2025, chaque partie de la méthode fait baisser cet accord, et d’autant plus qu’elle pèse : les équipes pro ne draftent pas selon ces règles. La méthode est gardée parce que le coach doit dire ce que feraient Shanei et Kazewa ; une règle pèse à peu près autant qu’un argument de Kazewa sur deux champions. Aucun plan n’est donné dans cette mesure. L’ancienne version, classée par le calculateur, plaçait le pick réel dans ses dix premières suggestions 16 % du temps (rang médian 39). `node research/coach-eval.mjs` refait la mesure.

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
npm run coach:data                                                 # data/coach.json : méta pro récente et remarques de Kazewa par champion
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
| `src/relations.mjs` | Lecture d’après ses fiches champion |
| `src/results.mjs` | Parties pro déjà jouées avec les dix champions d’une draft |
| `src/engine.mjs` | Calculateur structurel (description des compositions) |
| `src/draft-coach.mjs` | Coach de draft : les vingt tours, la session |
| `src/coach.mjs` | Classement des bans et des picks, avec la phrase derrière chaque point |
| `src/method.mjs` | Méthode de draft de Shanei et de Kazewa : lecture d’une draft, raisons d’un pick ou d’un ban, règles du tour |
| `data/kazewa-memory.json` | Mémoire complète, avec la trace de chaque source |
| `data/memory-site.json` | Version chargée par le site |
| `data/champion-cards.json` | Fiche Kazewa des 173 champions |
| `data/model.json` | Fiabilité mesurée de chaque lecture |
| `data/card-holdout.json` | Vidéos tenues à l’écart quand les fiches ont été écrites |
| `data/evaluation.json` | Rapport de mesure |
| `data/method.json` | Règles des deux coachs avec leur vidéo, familles de Shanei par champion, duos, listes de bans |
| `research/method-extraction.json` | Relevé des règles dans les fiches des vidéos, relu règle par règle, et grille de kits |
| `data/coach.json` | Méta pro récente et remarques datées de Kazewa par champion (données Oracle’s Elixir pour la méta) |
| `data/pro-results/` | Résultat des parties pro, par empreinte des dix champions (données Oracle’s Elixir) |
| `scripts/` | Construction de la mémoire, mesure, build |
| `research/` | Banc d’essai hors groupe et modèles essayés |
| `server/` | Proxy du flux professionnel et service HTTP local |

## Direct pro

GitHub Pages sert des fichiers statiques ; le flux professionnel passe par un serveur séparé. Voir [`docs/LIVE_SOURCES.md`](docs/LIVE_SOURCES.md). Sur un match en direct, le site affiche le verdict de Kazewa s’il a jugé cette draft ; sinon, le verdict estimé et la lecture dont il vient.

## Publier

`.github/workflows/pages.yml` teste, mesure, construit et publie `dist/` à chaque push sur `main`. **Settings → Pages → Source : GitHub Actions.**

Projet indépendant. Il n’est ni affilié à Riot Games ni approuvé par Kazewa. Les assets du jeu appartiennent à Riot Games. Les compositions et les résultats des parties professionnelles viennent des données de match d’[Oracle’s Elixir](https://oracleselixir.com/).
