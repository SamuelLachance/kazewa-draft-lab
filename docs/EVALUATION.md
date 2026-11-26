# Ce qui est mesuré

Trois questions différentes. Elles ne sont jamais mélangées dans un même chiffre.

1. **Une draft que Kazewa a jugée.** Le site renvoie son verdict. C’est une recherche dans sa mémoire : l’accord est total par construction, et ce n’est pas la mesure d’un modèle.
2. **Une draft qu’il n’a pas jugée, mais qui est celle d’une partie pro déjà jouée.** Le site nomme l’équipe qui a gagné. Ce n’est pas un jugement sur la draft : sur les parties qu’il a commentées, l’équipe qu’il préférait est le plus souvent celle qui a gagné, et le rapport mesure à quelle fréquence.
3. **Une draft qui n’a pas été jouée.** Le site donne un verdict estimé d’après ses arguments sur les mêmes champions, puis d’après ses fiches champion, quand l’un des deux départage les compositions. Sinon il ne donne pas d’estimation. Cette estimation est mesurée sur des drafts tenues à l’écart.

Les valeurs courantes sont dans [`data/evaluation.json`](../data/evaluation.json), recalculées par `npm run evaluate`. Le site les lit dans ce fichier. Les nombres cités ici sont ceux du rapport du 21 novembre 2026.

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

Quand les dix champions sont ceux d’une partie de l’index des matchs professionnels (79 864 parties, de 2018 à 2026, sauf 2020), le site le dit, nomme la partie et le vainqueur, et affiche ce côté comme un fait : l’équipe qui a gagné. Ce fait ne compte pas dans le verdict estimé estimé.

| Mesure | Parties | Il préférait le vainqueur | Intervalle |
| --- | ---: | ---: | --- |
| Parties jugées et appariées à un match | 302 | 79,8 % | 75 à 84 |
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

### Toute draft reçoit une estimation, sinon aucune

Le site donne une estimation quand ses arguments ou ses fiches départagent les deux compositions, et dit laquelle a servi. Sinon il n’en donne pas : ce cas est compté à part, sans demi-point. Le résultat d’une partie déjà jouée n’en fait pas partie : c’est un fait affiché à côté, mesuré à part.

| Lecture | Drafts | Accord | Intervalle | Ce que c’est |
| --- | ---: | ---: | --- | --- |
| Ses arguments venus d’autres vidéos | 233 | 61,8 % | 55 à 68 | Aucun réglage : on compte ses arguments par côté |
| Répondre toujours le même côté, mêmes drafts | 233 | 54,1 % | 48 à 60 | La barre à dépasser |
| Ses fiches champion | 57 | 59,6 % | 46 à 73 | Mesuré sur les vidéos que les fiches n’ont jamais vues |
| **Estimation enchaînée : arguments puis fiches** | 70 | 58,6 % | 48 à 68 | Drafts de vidéos qu’aucune lecture n’a vues ; une draft sur 71 n’a aucune estimation |

**Ses arguments.** Pour chaque draft jugée, on ne garde que les matchups, synergies et réponses qu’il a nommés dans d’autres groupes et qui s’appliquent encore : mêmes champions, même relation allié ou adverse, mêmes rôles. On compte de quel côté ils penchent. Rien n’est ajusté sur ses verdicts.

**Ses fiches champion.** Chaque fiche résume ce qu’il dit d’un champion : avec qui il est bon, par qui il est puni. La fiche est lue proposition par proposition. Sur une draft, une fiche parle quand le champion cité est là dans la relation décrite.

**La grille de décision (second avis).** `src/theory.mjs` applique sa grille (identité, trous structurels, axes, bonus, timing, verdict) et les vérifications de construction de Shanei. Elle ne lit aucune partie professionnelle et n’entre pas dans l’estimation. Sur les 292 drafts où elle penche d’un côté, son côté est celui de Kazewa 147 fois, soit 50,3 % (intervalle 45 à 57 %) : une pièce lancée. Selon le niveau de confiance, l’accord va de 46 % à 59 % sans suivre la confiance (`node research/theory-eval.mjs` donne le détail par niveau) : la confiance ne sert pas à trier. La structure des drafts, telle qu’elle est mesurée ici, ne porte pas le verdict de Kazewa.

**Le total.** Sur les 71 drafts des vidéos tenues à l’écart des fiches, l’estimation coïncide avec son avis 41 fois sur les 70 qui en ont une (58,6 %) ; une draft n’en a aucune. Le résultat d’une partie déjà jouée (80,3 %, 57 sur 71) n’est pas dans ce total : c’est une mesure à part, affichée comme un fait.

**Drafts tirées au hasard.** Sur 500 drafts tirées de tout le catalogue avec un générateur fixe, le site n’a aucune estimation pour 123 (24,6 %) : ses arguments en donnent une pour 14, ses fiches pour 363 (`data/evaluation.json`, `unseen.randomDrafts`).

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
| Même côté que le verdict de Kazewa, 283 drafts où la grille penche | 49,5 % (intervalle 43,1 à 56,0) |
| … dont ses avis donnés pendant la draft, 208 drafts | 45,7 % |
| Même côté que le vainqueur de ces parties, 283 drafts | 51,6 % |
| Même côté que le vainqueur, 52 089 parties pro où sa grille départage les deux compositions (sur 60 365 depuis 2021) | 49,7 % |

Les quatre mesures sont une pièce lancée. La grille n’est donc **pas une lecture du verdict estimé** : elle est affichée à part, comme second avis, et `unseen.shaneiGrid.usedForTheVerdict` vaut `false`. Ce résultat rejoint ce qui est constaté plus bas pour le calculateur et les profils de champions : au niveau professionnel les deux équipes draftent des compositions cohérentes, et la qualité de construction ne départage ni le vainqueur ni l’avis de Kazewa. La grille ne trouve rien à reprocher à 24,4 % des compositions professionnelles ; ses reproches les plus fréquents sont l’absence de vrai tank dans le bloc de quatre, un pick de poke dans un bloc d’engage (ou l’inverse) et un hypercarry sans enchanteur.

Le chiffre sur les parties professionnelles demande l’index des matchs (`.cache/oe-games.json`), qui n’est pas dans le dépôt. Il est recalculé quand l’index est là. Sinon le dernier chiffre est gardé, à condition qu’il ait été mesuré avec la grille livrée : le rapport garde l’empreinte de la grille (`proGames.grid`), et un test échoue si elle ne correspond plus.

### Le coach et la méthode

Le coach ne lit plus les parties professionnelles pour choisir : ses classements viennent des remarques de Kazewa, de la grille de décision et des règles de Shanei. Les statistiques de présence et de moment des équipes pro ne comptent plus dans le classement.

La mesure sur 612 drafts professionnelles de 2026 (`research/coach-eval.mjs`) est restée dans le dépôt, mais elle ne sert plus de cible : elle ne mesure pas une règle des deux coachs, elle mesure l’écart avec ce que font les équipes. Elle a été lancée une dernière fois avec la grille et la méthode : le champion réellement pris figure dans les dix premières suggestions 47,4 % du temps, contre 52,6 % sans la méthode. Cet écart n’a pas été réglé pour le réduire ; il est dit tel quel.

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

## La valeur de composition : modèle de draft sur les parties pro

Le seul modèle qui lit les parties professionnelles ne voit que les dix champions et leurs rôles : ni équipe, ni joueur, ni bans, ni ordre des picks, ni patch. Il est dans `research/draftmodel/` (procédure reprise de `lol-draft-predictor`, `ml/draftmodel.py`), et `data/draft-values.json` en garde une valeur par champion et par rôle, pour le coach.

**Mesure hors échantillon** (2025-01-01 au 2026-11-13, 19 979 parties, réentraînement chaque trimestre, jamais utilisé pour choisir le réglage) :

| Mesure | Valeur |
| --- | ---: |
| Précision du modèle | 54,3 % |
| Précision de « toujours bleu » sur les mêmes parties | 53,4 % |
| Gain | +0,9 point |
| Intervalle à 95 % du gain, regroupé par jour | +0,1 à +1,7 point |
| Log-loss (un pile ou face vaut 0,693) | 0,688 |

**Ce que ces chiffres disent.** Le modèle fait mieux que « toujours bleu », mais peu, et l'avantage est fragile : regroupé par mois, l'intervalle contient zéro ; trois trimestres sur huit (2025 T1, 2025 T2, et 2026 T4 partiel) sont en dessous de « toujours bleu ». Ce n'est pas un signal qui permet de passer le repère de 55 %.

**Choix du réglage.** La fenêtre, la demi-vie et la régularisation ont été choisies sur 2023-2024 seulement, sur une grille de 18 réglages prévue avant le calcul. Le réglage retenu (fenêtre de 2400 jours, demi-vie de 240 jours, C = 0,05) est au bord de la grille. Le réglage par défaut donne 54,2 % sur 2025-2026.

**Une précaution.** La variante « champions seuls » a été retenue après une première exécution dont les chiffres poolés incluaient 2025-2026. Sur 2023-2024 seulement, elle gagne aussi, mais au réglage retenu les duels de lane sont légèrement meilleurs en log-loss (écart de 0,0001). 2025-2026 n'est donc pas un échantillon vierge : l'intervalle ne tient pas compte de la recherche de réglage.

**Contrôle indépendant.** Un second calcul, écrit sans le code de `research/`, reproduit 54,3 % (0,5427 à tolérance convergée, 0,5429 à la tolérance par défaut de sklearn) et un gain de +0,87 à +0,89 point. Aucune fuite d'information : chaque prédiction n'utilise que des parties antérieures à son trimestre.

**Lecture pour le coach.** La valeur de composition ajoute au plus quelques points à un pick, étiquetée « Pro » et précisée comme « composition seule, signal faible ». Elle ne remplace ni la grille de Kazewa ni les règles de Shanei.

## Le système de draft fondé sur les connaissances (`src/draft-system/`)

Refait à partir des connaissances accumulées : les profils de champions (`data/knowledge.json`, 0 à 2 par fonction), les 42 règles de besoins de composition du même fichier, et la logique de choix. Le choix d'un pick regarde l'état : les rôles libres, les besoins que l'équipe ne remplit pas, les menaces de l'équipe adverse, et la meilleure réponse adverse après le pick (anticipation à deux coups). Une règle ne compte que si son déclencheur existe dans cette draft précise. Aucune statistique, aucune équipe, aucun joueur.

**Mesure, faite une seule fois, sans réglage** : 304 drafts jugées par Kazewa, 127 vidéos, 293 avec un côté. Accord de 52,8 % (intervalle à 95 % par vidéo : 46,8 à 58,3 %). C'est indiscernable du hasard, comme la grille précédente (50,3 %).

**Ce que cela dit.** Le moteur n'est pas en cause : il fait ce qu'on lui demande, et les tests vérifient son comportement. La limite vient des connaissances qu'il lit. Les profils donnent trois niveaux par fonction ; les règles sont des seuils que j'ai écrits, pas les siens (le fichier le dit) ; ses verdicts dépendent aussi de l'ordre des picks, des bans, des joueurs et du méta, qui ne sont pas dans la draft. Et la mesure est dans l'échantillon : les mêmes vidéos ont écrit les règles et jugé les drafts. Un accord réel exigerait d'écrire les règles sur une partie des vidéos, et de mesurer sur les autres.

## Système de draft, version 2 : familles, contres, combos et flex

La version 1 (besoins seuls) s'accorde avec ses verdicts à 52,8 %. La version 2 ajoute ce que les connaissances disent des **familles** de la méthode de Shanei, des **duos** (bons et mauvais) et des **contres** nommés sur les fiches, et de la **flexibilité** des rôles encore ouverts. Chaque terme est nul quand l'état ne le déclenche pas : pas de contre sans champion adverse verrouillé, pas de flex sans deux rôles libres.

**Mesures, une fois par version, sans réglage :**

| Mesure | Drafts | Accord | Intervalle |
| --- | ---: | ---: | --- |
| Version 1 (besoins seuls), sur toutes les vidéos | 304 | 52,8 % | 46,8 à 58,3 |
| Version 2 (avec familles, duos, contres), sur toutes les vidéos | 304 | 62,0 % | 56,6 à 66,8 |
| Version 2, sur les vidéos que les fiches n'ont jamais vues, sans liens | 71 | 43,0 % | — |
| Idem, avec tous les liens | 71 | 45,8 % | — |
| Idem, avec les seuls liens des fiches | 71 | 47,2 % | — |

**Lecture.** Le gain de la version 2 sur l'ensemble (+9 points) ne tient pas hors échantillon : sur les vidéos que les liens n'ont jamais vues, le système reste sous le hasard. Les duos et les contres viennent des mêmes vidéos que ses verdicts, donc le 62 % mesure la connaissance elle-même, pas une logique qui généralise. La mesure propre demande de reconstruire les liens et les règles sans les vidéos tenues à l'écart, puis de mesurer dessus.

## Reconstruction sans les vidéos tenues à l'écart (2026-11-26)

Le découpage du corpus (`kb_split.json` : 28 vidéos tenues à l'écart, les autres d'entraînement) a servi à auditer ce que le système lit :

- **Profils des champions.** 93 ne citent que des vidéos d'entraînement, 66 sont déduits du kit sans vidéo, 14 citaient une vidéo de test. Ces 14 ont été **reconstruits** : un agent par champion, qui ne lit que les passages des vidéos d'entraînement et les définitions de Kazewa (`taxo/def_*.md`). Aucun profil ne cite plus de vidéo de test.
- **Règles.** Les 42 règles de besoins sont du code écrit à la main (`src/draft-system/rules.mjs`) ; le fichier de connaissances n'en garde que les titres. Elles ne sont donc pas apprises sur les vidéos, mais je ne peux pas certifier que je n'ai jamais lu les vidéos tenues à l'écart en les écrivant.
- **Liens.** Les fiches ont été écrites sans les vidéos tenues à l'écart (`card-holdout.json`). Les duos et familles de la méthode ne citent aucune de ces vidéos.

**Mesure propre, une fois, sur les 71 drafts des 28 vidéos tenues à l'écart :**

| Configuration | Accord |
| --- | ---: |
| Avant reconstruction, sans liens | 43,0 % |
| Avant reconstruction, tous les liens | 45,8 % |
| Avant reconstruction, liens des fiches seuls | 47,2 % |
| Après reconstruction, sans liens | 49,3 % |
| Après reconstruction, tous les liens | 44,4 % |
| Après reconstruction, liens des fiches seuls | 44,4 % |

**Lecture.** Une fois la contamination retirée, le système est au niveau du hasard, et les liens ne l'aident pas. Avec 71 drafts, l'intervalle est de plus de dix points : aucune de ces différences n'est établie. Le constat tient : les connaissances ne permettent pas, en l'état, de reproduire ses verdicts hors échantillon.
