# Ce qui est mesuré

Deux questions différentes. Elles ne sont jamais mélangées dans un même chiffre.

1. **Une draft que Kazewa a jugée.** Le site renvoie son verdict. C’est une recherche dans sa mémoire : l’accord est total par construction, et ce n’est pas la mesure d’un modèle.
2. **Une draft qu’il n’a pas jugée.** Le site estime. Cette estimation est mesurée sur des drafts tenues à l’écart.

Les valeurs courantes sont dans [`data/evaluation.json`](../data/evaluation.json), recalculées par `npm run evaluate`. Le site les lit dans ce fichier. Les nombres cités ici sont ceux du rapport du 14 novembre 2026.

## La mémoire

`data/kazewa-memory.json` contient 253 parties professionnelles dont il a commenté la draft, issues de 103 vidéos. 244 portent un côté préféré ; 9 sont commentées sans préférence.

- 199 compositions sont vérifiées contre les données du match réel (compositions par rôle, côtés de carte, ordre des picks, vainqueur). Les autres viennent de ses vidéos seules : parties d’avant 2022 ou d’après mars 2026, absentes de l’index local.
- Le verdict garde le moment le plus fiable : 180 avis donnés pendant la draft, 51 dans la revue du match, 13 explicitement tardifs. Le moment est affiché.
- Quand un autre passage penche pour l’autre côté, le site le dit.
- 182 extractions partielles n’ont pas pu être reliées à une partie. Elles restent hors mémoire plutôt que d’être complétées au jugé.
- La même draft saisie avec un flex rangé dans un autre rôle est reconnue : ce sont les dix champions qui comptent.

Le rapport vérifie que chaque draft jugée, dans les deux orientations, renvoie bien son verdict (`memory.selfRecall`).

### Audit

Les cas de la première construction ont été relus un par un à partir de leur dossier (extractions, partie reliée, autres parties de la série), puis chaque anomalie a reçu une seconde relecture indépendante. Une relecture du code a ensuite trouvé quatre parties stockées deux fois et une vidéo récapitulative enregistrée en connaissant les résultats. Les corrections retenues sont dans [`data/memory-overrides.json`](../data/memory-overrides.json), chacune avec sa justification : verdicts mal orientés, junglers erronés, doublons rattachés, textes qui nomment la mauvaise équipe, avis de la vidéo récapitulative reclassés en avis tardifs. Les désaccords réels entre deux passages sont laissés tels quels et signalés.

## Les drafts inédites

### Protocole

Validation « un groupe dehors ». Un groupe réunit toutes les drafts qui partagent une vidéo ou une série professionnelle. Chaque draft jugée est estimée avec ce qui vient des autres groupes uniquement, puis comparée à son verdict. Les intervalles retirent et remettent des groupes entiers, parce que les drafts d’une même vidéo ne sont pas indépendantes.

### Résultats

| Lecture | Drafts | Accord | Intervalle | Ce que c’est |
| --- | ---: | ---: | --- | --- |
| Ses arguments venus d’autres vidéos | 180 | 63,3 % | 55 à 71 | Aucun réglage : on compte ses arguments par côté |
| Arguments et ordre des picks du même côté | 79 | 74,7 % | 63 à 84 | Les deux lectures s’accordent |
| Ordre des picks seul | 195 | 61,5 % | 53 à 69 | Cinq poids, un par lane |
| Répondre toujours « côté rouge » | 195 | 56,4 % | 50 à 63 | Règle sans modèle, sur les mêmes drafts |
| Calculateur structurel, drafts jamais vues | 178 | 52,2 % | 46 à 59 | Hasard |
| Calculateur structurel, drafts de réglage | 62 | 93,5 % | | Ne prouve rien : il a été réglé dessus |

**Ses arguments.** Pour chaque draft jugée, on ne garde que les matchups, synergies et réponses qu’il a nommés dans d’autres groupes et qui s’appliquent encore : mêmes champions, même relation allié ou adverse, mêmes rôles. On compte de quel côté ils penchent. Rien n’est ajusté sur ses verdicts. Cette lecture répond pour 74 % des drafts jugées ; pour les autres il n’y a pas d’argument applicable, ou autant de chaque côté.

**L’ordre des picks.** Pour chaque lane, le modèle sait seulement quel côté a posé son champion après l’autre. Répondre en top et au mid compte le plus, puis en jungle ; pour l’ADC le signe s’inverse légèrement. Ce signal dépasse le hasard mesuré en rejouant la procédure avec des verdicts tirés au sort (49,4 % ± 5,7 points, p ≈ 0,005). Une partie tient au côté de la carte : le côté qui pick en dernier est aussi celui qu’il préfère le plus souvent, et l’écart avec la règle « toujours côté rouge » (120 contre 110 drafts sur 195) n’est pas établi statistiquement (p ≈ 0,28).

**Les deux ensemble.** Quand ses arguments et l’ordre des picks désignent le même côté, c’est son verdict trois fois sur quatre. Quand ils s’opposent (66 drafts), ses arguments ont raison 36 fois : le site n’affiche alors aucune tendance.

**Ce qui ne marche pas.** Les règles de composition du calculateur, les profils de champions (18 traits par équipe, environ 41 %), l’identité des champions (43 à 47 %) et les statistiques de 44 000 matchs pros (52 à 55 %) restent au niveau du hasard. Ces essais sont dans `research/`.

### Ce que le site affiche

| Situation | Affichage |
| --- | --- |
| Arguments et ordre des picks du même côté | Tendance, fiabilité de la deuxième ligne du tableau |
| Arguments seuls | Tendance, fiabilité de la première ligne |
| Ordre des picks seul | Tendance, fiabilité de la troisième ligne, avec le rappel de la règle « toujours côté rouge » |
| Arguments et ordre des picks opposés | Aucune tendance, les deux lectures sont montrées |
| Rien d’applicable | Aucune tendance |

Seule la direction est mesurée. Le site n’affiche pas de score de confiance propre à une draft.

### L’ancien « 100 % »

La version précédente affichait 62 accords sur 62. Les poids et les exceptions du calculateur avaient été réglés sur ces 62 drafts. Sur les 178 drafts jugées qu’il n’avait jamais vues, le même calculateur donne 93 accords : une sur deux. Le rapport garde les deux nombres côte à côte (`unseen.structuralCalculator`).

## Repère : le résultat réel

Dans 79 % des drafts jugées dont le résultat est connu, l’équipe qu’il préférait a gagné (`reference.realWinnerMatchesVerdict`). Ce n’est pas une mesure du site. Une partie de ses revues est enregistrée en connaissant le résultat.

## Limites

- Les deux lectures ont été mesurées sur le corpus où elles ont été trouvées. Leur vraie valeur se verra sur ses prochaines vidéos.
- Ses arguments viennent de ses vidéos passées. Des équipes qui reprennent les mêmes duos, et qu’il continue de préférer, peuvent gonfler le chiffre ; sur des équipes ou des patchs qu’il n’a pas commentés il peut être plus bas.
- Les groupes relient les parties par vidéo, et par série quand la partie est reliée aux données de match. Deux vidéos sur une même série non reliée tombent dans deux groupes.
- Les avis de revue et les avis tardifs peuvent connaître le résultat. Ils sont gardés, avec leur moment.
- Les paraphrases de ses raisons viennent d’une transcription automatique, puis d’une traduction relue. Le lien vidéo permet de vérifier.

## Reproduire

```powershell
npm run evaluate
node --test tests/evaluation.test.mjs tests/memory.test.mjs tests/verdict.test.mjs
node research/run.mjs research/models/process.mjs --split all --permute 100
```

Les tests refusent un rapport ou un modèle qui ne correspond plus exactement à la mémoire livrée, une fiabilité affichée différente du rapport, et une page qui écrirait un pourcentage d’accord en dur.
