# Ce qui est mesuré

Trois questions différentes. Elles ne sont jamais mélangées dans un même chiffre.

1. **Une draft que Kazewa a jugée.** Le site renvoie son verdict. C’est une recherche dans sa mémoire : l’accord est total par construction, et ce n’est pas la mesure d’un modèle.
2. **Une draft qu’il n’a pas jugée, mais qui est celle d’une partie pro déjà jouée.** Le site nomme l’équipe qui a gagné. Ce n’est pas un jugement sur la draft : sur les parties qu’il a commentées, l’équipe qu’il préférait est le plus souvent celle qui a gagné, et le rapport mesure à quelle fréquence.
3. **Une draft qui n’a pas été jouée.** Le site donne un verdict estimé d’après ce qu’il a dit des mêmes champions. Cette estimation est mesurée sur des drafts tenues à l’écart.

Les valeurs courantes sont dans [`data/evaluation.json`](../data/evaluation.json), recalculées par `npm run evaluate`. Le site les lit dans ce fichier. Les nombres cités ici sont ceux du rapport du 14 novembre 2026.

## La mémoire

`data/kazewa-memory.json` contient 314 parties professionnelles dont il a commenté la draft, issues de 129 vidéos. 304 portent un côté préféré ; 10 sont commentées sans préférence.

- 312 compositions sont vérifiées contre les données du match réel (compositions par rôle, côtés de carte, vainqueur) : parties de 2018, 2019, 2021 et 2023 à 2026. Les 2 autres viennent de ses vidéos seules.
- Le verdict garde le moment le plus fiable : 222 avis donnés pendant la draft, 34 dans la revue du match, 48 explicitement tardifs. Le moment est affiché.
- Quand un autre passage penche pour l’autre côté, le site le dit.
- 16 extractions partielles n’ont pas pu être reliées à une partie. Elles restent hors mémoire plutôt que d’être complétées au jugé.
- La même draft saisie avec un flex rangé dans un autre rôle est reconnue : ce sont les dix champions qui comptent.
- Une partie réelle est stockée une seule fois. Une extraction complète à deux picks d’une partie vérifiée de la même vidéo est rattachée à cette partie ; le rapport de construction liste tout ce qui ressemblerait encore à un doublon (aucun). Deux parties distinctes dont les drafts se ressemblent, une équipe qui rejoue sa draft par exemple, sont listées à part.

Le rapport vérifie que chaque draft jugée, dans les deux orientations, renvoie bien son verdict (`memory.selfRecall`).

### Audit

Chaque cas a été relu à partir de son dossier (extractions, partie reliée, autres parties de la série), puis chaque anomalie a reçu une seconde relecture indépendante. Une relecture du code a ensuite trouvé quatre parties stockées deux fois et une vidéo récapitulative enregistrée en connaissant les résultats. Les corrections retenues sont dans [`data/memory-overrides.json`](../data/memory-overrides.json), chacune avec sa justification.

Trois corrections ont été retirées. L’audit avait remplacé un jungler dans deux parties de 2026 et rattaché une clé de réponse à une extraction mal entendue, d’après ce que disaient ses raisons. Les données de match, une fois disponibles, ont montré que les compositions d’origine étaient justes. Depuis, une composition n’est plus corrigée d’après le commentaire : seules les données de match font foi.

### Rattachements relus

131 extractions n’avaient pas assez de picks reconnus pour être reliées automatiquement à une partie. Elles ont été reprises vidéo par vidéo :

1. un premier relecteur nomme la partie d’après le titre de la vidéo, la position de la partie dans la vidéo et les champions entendus, en cherchant dans l’index des matchs ;
2. un second cherche à réfuter cette partie : autre série entre les mêmes équipes, autre partie de la série ;
3. un troisième, sans voir la réponse du premier, dit quel côté de la carte l’extraction appelle « gauche » et quelle équipe il préfère.

Un lien est gardé quand la partie est confirmée et que les deux lectures du côté concordent. 114 liens ont été gardés. 8 ont été refusés parce que le côté restait incertain. 9 autres avaient passé les trois contrôles et ont été écartés à la relecture : l’équipe que nomme son commentaire n’était pas celle de la composition que le lien aurait créditée. Dans le doute, une extraction reste hors mémoire : un verdict inversé est pire qu’un verdict absent. Un lien gardé a vu son avis ramené à « sans préférence » après relecture : le passage critiquait la façon de drafter d’une équipe sans comparer les deux drafts. 4 extractions déjà reliées ont été fixées à leur partie, parce que l’ajout de nouvelles séries candidates rendait leur rattachement automatique ambigu.

Les compositions de ces parties viennent des données de match, jamais de l’extraction. Quand une extraction rattachée a écrit deux picks ou plus dans la mauvaise équipe, son avis est gardé mais son texte ne l’est pas si une autre extraction de la même partie dit la même chose. La liste complète, avec la raison de chaque refus, est dans `links` de [`data/memory-overrides.json`](../data/memory-overrides.json).

## Une partie déjà jouée

Quand les dix champions sont ceux d’une partie de l’index des matchs professionnels (79 864 parties, de 2018 à 2026, sauf 2020), le site le dit, nomme la partie et le vainqueur, et donne ce côté comme verdict estimé.

| Mesure | Parties | Il préférait le vainqueur | Intervalle |
| --- | ---: | ---: | --- |
| Toutes les parties qu’il a jugées | 302 | 79,8 % | 75 à 84 |
| Avis donnés pendant la draft | 220 | 77,7 % | 72 à 83 |
| Avis de revue ou tardifs | 82 | 85,4 % | 78 à 92 |
| Vidéos tenues à l’écart des fiches | 71 | 80,3 % | 71 à 90 |

Rien n’est réglé : on compare le côté qui a gagné à son verdict. Quand ses arguments désignent le même côté que le résultat, l’accord est de 85,5 % (138 drafts). Quand ils désignent l’autre côté, c’est le résultat qui a raison 67 fois sur 93 : le résultat passe donc avant ses arguments.

Ce que ce chiffre ne dit pas :

- Il n’existe pas pour une draft qui n’a pas été jouée.
- Il est mesuré sur les parties qu’il a choisi de commenter. Sur une partie qu’il n’aurait pas commentée, il peut être plus bas.
- Il ne vient pas de la force des équipes. Un classement Elo calculé sur l’index, avant chaque partie, ne désigne son verdict qu’une fois sur deux.
- Les avis de revue et les avis tardifs peuvent connaître le résultat. La ligne « pendant la draft » ne compte que ce qu’il dit avant le début de la partie, dans des vidéos où il la découvre en principe sans la connaître. 5 vidéos enregistrées en connaissant les résultats (rétrospectives, parties déjà vues) sont marquées à la main et comptées comme avis tardifs.
- Il ne sert pas pour une partie en cours : une autre partie jouée avec les mêmes dix champions ne dit rien de celle-ci.
- Une partie présente deux fois dans les données sous deux identifiants est gardée une fois ; un enregistrement dont l’ordre des picks ne correspond pas à ses propres compositions est écarté.

Les résultats viennent des données de match d’[Oracle’s Elixir](https://oracleselixir.com/). `data/pro-results/` ne contient pas les compositions, seulement une empreinte des dix champions, les équipes, la date et le vainqueur.

## Une draft jamais jouée

### Protocole

Validation « un groupe dehors ». Un groupe réunit toutes les drafts qui partagent une vidéo ou une série professionnelle. Chaque draft jugée est estimée avec ce qui vient des autres groupes uniquement, puis comparée à son verdict. Les intervalles retirent et remettent des groupes entiers, parce que les drafts d’une même vidéo ne sont pas indépendantes.

### Toute draft reçoit un verdict

Le site ne s’abstient pas. Il enchaîne trois lectures, de la plus fiable à la plus grossière, et dit laquelle a servi.

| Lecture | Drafts | Accord | Intervalle | Ce que c’est |
| --- | ---: | ---: | --- | --- |
| Ses arguments venus d’autres vidéos | 233 | 61,8 % | 55 à 68 | Aucun réglage : on compte ses arguments par côté |
| Répondre toujours le même côté, mêmes drafts | 233 | 54,1 % | 48 à 60 | La barre à dépasser |
| Ses fiches champion | 57 | 59,6 % | 46 à 73 | Mesuré sur les vidéos que les fiches n’ont jamais vues |
| Ses principes de composition | 236 | 50,8 % | 44 à 57 | Calculateur, sur les drafts qu’il n’a jamais vues : une pièce lancée |
| **Les trois enchaînées** | 71 | 58,5 % | 48 à 68 | Drafts de vidéos qu’aucune lecture n’a vues |

**Ses arguments.** Pour chaque draft jugée, on ne garde que les matchups, synergies et réponses qu’il a nommés dans d’autres groupes et qui s’appliquent encore : mêmes champions, même relation allié ou adverse, mêmes rôles. On compte de quel côté ils penchent. Rien n’est ajusté sur ses verdicts. Cette lecture répond pour 77 % des drafts jugées ; pour les autres il n’y a pas d’argument applicable, ou autant de chaque côté. Face à la règle « toujours le même côté » sur les mêmes drafts, ses arguments ont raison seuls 58 fois et tort seuls 40 fois : l’avantage va dans le bon sens mais n’est pas établi statistiquement (p ≈ 0,09).

**Ses fiches champion.** Chaque fiche résume ce qu’il dit d’un champion : avec qui il est bon, par qui il est puni. La fiche est lue proposition par proposition : « avec X » désigne un partenaire, « contre X » une victime, « puni par X » un champion qui prend le dessus, « anti-synergie » un mauvais partenaire. Sur une draft, une fiche parle quand le champion cité est là dans la relation dite. Les fiches ont été écrites à partir de la plupart de ses vidéos ; 28 vidéos avaient été tenues à l’écart (`data/card-holdout.json`). Sur les drafts de ces vidéos, les fiches désignent son verdict 34 fois sur 57 ; l’intervalle contient 50 %. Sur les drafts des vidéos dont elles sont tirées : 165 fois sur 210 (78,6 %). Seul le premier chiffre est affiché.

**Ses principes.** Les règles de composition du calculateur (frontline, dégâts soutenus, catch, scaling…) décrivent les deux compositions. Sur les 236 drafts jugées que le calculateur n’a jamais vues, son côté est celui de Kazewa une fois sur deux. C’est le dernier recours, et le site le présente comme tel.

**Le total.** Sur les 71 drafts des vidéos tenues à l’écart des fiches, avec ses arguments venus d’autres groupes et sans le calculateur sur les drafts qui ont servi à le régler, le verdict estimé coïncide avec le sien 41 fois, une draft restant à l’équilibre. Sur les mêmes drafts, quand on sait qui a gagné la partie, le total est de 80,3 % (57 sur 71). Sur l’ensemble des 304 drafts jugées le total sans résultat monte à 64,0 %, mais ce chiffre est gonflé par les fiches et n’est pas affiché.

### Ce que l’écart des fiches veut dire

Sur les vidéos qu’elles résument, les fiches retrouvent son verdict 78,6 % du temps ; sur celles qu’elles n’ont jamais vues, 59,6 %. Ce que Kazewa a dit d’une draft permet de retrouver son verdict ; des règles générales sur les champions ne le permettent presque pas. Son avis tient à la draft elle-même : les bans, les joueurs, la méta du moment. C’est la limite de tout ce que le site peut estimer sur une draft jamais jouée.

### Lecture écartée : l’ordre des picks

L’ordre des picks (pour chaque lane, quel côté a posé son champion après l’autre) avait paru utile : 61,5 % sur 195 drafts, et 75 % quand il allait dans le sens de ses arguments. Sur 302 drafts :

| Lecture | Drafts | Accord |
| --- | ---: | ---: |
| Ordre des picks, un poids par lane | 302 | 56,0 % |
| Répondre toujours « côté rouge » | 302 | 51,7 % |
| Arguments et ordre des picks du même côté | 126 | 65,9 % |
| Arguments seuls, pour comparaison | 233 | 61,8 % |

L’écart avec la règle sans modèle n’est pas établi (p ≈ 0,27). Il reste hors du verdict et de l’interface, et il est mesuré dans le rapport (`unseen.pickOrder`) pour que cette décision reste vérifiable.

### Ce qui ne marche pas non plus

Les profils de champions (18 traits par équipe, environ 41 %), l’identité des champions (43 à 47 %), les statistiques de 44 000 matchs pros (52 à 55 %) et la force des équipes avant la partie (environ 52 %) restent au niveau du hasard. Les premiers essais sont dans `research/`.

### L’ancien « 100 % »

La première version du site affichait 62 accords sur 62. Les poids et les exceptions du calculateur avaient été réglés sur ces 62 drafts. Le rapport garde les deux nombres côte à côte (`unseen.structuralCalculator`) : 93,5 % sur les drafts de réglage, 50,8 % sur les autres.

## Le second avis : la grille de Shanei

Le site lit aussi chaque draft avec la méthode de Shanei (`src/method.mjs`, `shaneiReading`) : la famille de chaque composition, ce qu’il lui reprocherait, ce qu’il validerait, et laquelle des deux il trouverait la plus saine. Rien n’est réglé sur les verdicts de Kazewa, et aucune de ses vidéos n’a servi à l’écrire : toutes les drafts jugées comptent.

| Mesure | Accord |
| --- | --- |
| Même côté que le verdict de Kazewa, 278 drafts où la grille penche | 49,3 % (intervalle 42,7 à 56,0) |
| … dont ses avis donnés pendant la draft, 204 drafts | 45,6 % |
| Même côté que le vainqueur de ces parties, 278 drafts | 50,0 % |
| Même côté que le vainqueur, 52 124 parties pro depuis 2021 | 49,8 % |

Les quatre mesures sont une pièce lancée. La grille n’est donc **pas une lecture du verdict estimé** : elle est affichée à part, comme second avis, et `unseen.shaneiGrid.usedForTheVerdict` vaut `false`. Ce résultat rejoint ce qui est constaté plus bas pour le calculateur et les profils de champions : au niveau professionnel les deux équipes draftent des compositions cohérentes, et la qualité de construction ne départage ni le vainqueur ni l’avis de Kazewa. La grille ne trouve rien à reprocher à 24,6 % des compositions professionnelles ; ses reproches les plus fréquents sont l’absence de vrai tank dans le bloc de quatre, un pick de poke dans un bloc d’engage (ou l’inverse) et un hypercarry sans enchanteur.

Le chiffre sur les parties professionnelles demande l’index des matchs (`.cache/oe-games.json`), qui n’est pas dans le dépôt. Il est recalculé quand l’index est là. Sinon le dernier chiffre est gardé, à condition qu’il ait été mesuré avec la grille livrée : le rapport garde l’empreinte de la grille (`proGames.grid`), et un test échoue si elle ne correspond plus.

### Le coach et la méthode

La méthode des deux coachs entre aussi dans le classement du coach de draft. Sa mesure rejoue de vraies drafts professionnelles et demande où se trouve le champion réellement pris dans la liste du coach. Sur 612 drafts de 2026 : dans les dix premières suggestions 47,4 % du temps avec la méthode, 52,6 % sans elle ; pour les bans, 49,9 % et 45,4 % avec, 49,0 % et 46,8 % sans. Sur les drafts de 2025, qui ont servi à choisir les poids, chaque partie de la méthode retirée faisait remonter l’accord, et diviser tous ses poids par deux aussi : aucune règle n’est fautive à elle seule, c’est l’ensemble qui s’écarte de ce que font les équipes professionnelles. Les poids n’ont donc pas été choisis pour suivre les pros : une règle pèse à peu près autant qu’un argument de Kazewa sur deux champions, et une famille lue sur les picks ne compte qu’à partir de trois picks.

## Limites

- Une lecture peut sembler réelle sur deux cents drafts et disparaître sur trois cents : l’ordre des picks l’a fait. Le chiffre de ses arguments n’a pas été confirmé sur de nouvelles vidéos.
- Ses arguments viennent de ses vidéos passées. Des équipes qui reprennent les mêmes duos, et qu’il continue de préférer, peuvent gonfler le chiffre.
- La lecture par le résultat ne vaut que pour une partie déjà jouée, et elle est mesurée sur les parties qu’il a choisi de commenter.
- Les avis de revue et les avis tardifs peuvent connaître le résultat. Ils sont gardés, avec leur moment.
- Les paraphrases de ses raisons viennent d’une transcription automatique, puis d’une traduction relue. Le lien vidéo permet de vérifier.
- Les règles de Shanei viennent elles aussi de sous-titres automatiques, très dégradés par endroits. Chaque règle a été relue contre la fiche de sa vidéo ; celles que la fiche marque comme incertaines sont gardées avec cette marque et ne comptent pas. Traduire une règle en test sur dix champions est une interprétation : « vrai tank », « full AD » ou « source de désengage » reposent sur une grille de kits qui n’est pas de lui.

## Reproduire

```powershell
npm run evaluate
node --test tests/evaluation.test.mjs tests/memory.test.mjs tests/verdict.test.mjs tests/results.test.mjs
```

Les tests refusent un rapport ou un fichier de fiabilité qui ne correspond plus exactement à la mémoire livrée, une fiabilité affichée différente du rapport, et une page qui écrirait un pourcentage d’accord en dur.
