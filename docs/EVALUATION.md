# Ce qui est mesuré

Deux questions différentes. Elles ne sont jamais mélangées dans un même chiffre.

1. **Une draft que Kazewa a jugée.** Le site renvoie son verdict. C’est une recherche dans sa mémoire : l’accord est total par construction, et ce n’est pas la mesure d’un modèle.
2. **Une draft qu’il n’a pas jugée.** Le site donne un verdict estimé. Cette estimation est mesurée sur des drafts tenues à l’écart.

Les valeurs courantes sont dans [`data/evaluation.json`](../data/evaluation.json), recalculées par `npm run evaluate`. Le site les lit dans ce fichier. Les nombres cités ici sont ceux du rapport du 14 novembre 2026.

## La mémoire

`data/kazewa-memory.json` contient 286 parties professionnelles dont il a commenté la draft, issues de 109 vidéos. 274 portent un côté préféré ; 12 sont commentées sans préférence.

- 280 compositions sont vérifiées contre les données du match réel (compositions par rôle, côtés de carte, vainqueur) : parties de 2018, 2019, 2021 et 2023 à 2026. Les 6 autres viennent de ses vidéos seules.
- Le verdict garde le moment le plus fiable : 192 avis donnés pendant la draft, 64 dans la revue du match, 18 explicitement tardifs. Le moment est affiché.
- Quand un autre passage penche pour l’autre côté, le site le dit.
- 131 extractions partielles n’ont pas pu être reliées à une partie (trop peu de picks reconnus). Elles restent hors mémoire plutôt que d’être complétées au jugé.
- La même draft saisie avec un flex rangé dans un autre rôle est reconnue : ce sont les dix champions qui comptent.
- Une partie réelle est stockée une seule fois. Une extraction complète à deux picks d’une partie vérifiée de la même vidéo est rattachée à cette partie ; le rapport de construction liste tout ce qui ressemblerait encore à un doublon (aucun).

Le rapport vérifie que chaque draft jugée, dans les deux orientations, renvoie bien son verdict (`memory.selfRecall`).

### Audit

Chaque cas a été relu à partir de son dossier (extractions, partie reliée, autres parties de la série), puis chaque anomalie a reçu une seconde relecture indépendante. Une relecture du code a ensuite trouvé quatre parties stockées deux fois et une vidéo récapitulative enregistrée en connaissant les résultats. Les corrections retenues sont dans [`data/memory-overrides.json`](../data/memory-overrides.json), chacune avec sa justification.

Trois corrections ont été retirées. L’audit avait remplacé un jungler dans deux parties de 2026 et rattaché une clé de réponse à une extraction mal entendue, d’après ce que disaient ses raisons. Les données de match, une fois disponibles, ont montré que les compositions d’origine étaient justes. Depuis, une composition n’est plus corrigée d’après le commentaire : seules les données de match font foi.

## Les drafts inédites

### Protocole

Validation « un groupe dehors ». Un groupe réunit toutes les drafts qui partagent une vidéo ou une série professionnelle. Chaque draft jugée est estimée avec ce qui vient des autres groupes uniquement, puis comparée à son verdict. Les intervalles retirent et remettent des groupes entiers, parce que les drafts d’une même vidéo ne sont pas indépendantes.

### Toute draft reçoit un verdict

Le site ne s’abstient pas. Il enchaîne trois lectures, de la plus fiable à la plus grossière, et dit laquelle a servi.

| Lecture | Drafts | Accord | Intervalle | Ce que c’est |
| --- | ---: | ---: | --- | --- |
| Ses arguments venus d’autres vidéos | 200 | 60,5 % | 53 à 67 | Aucun réglage : on compte ses arguments par côté |
| Répondre toujours le même côté, mêmes drafts | 200 | 52,5 % | 46 à 59 | La barre à dépasser |
| Ses fiches champion | 56 | 60,7 % | 47 à 74 | Mesuré sur les vidéos que les fiches n’ont jamais vues |
| Ses principes de composition | 207 | 50,7 % | 44 à 58 | Calculateur, sur les drafts qu’il n’a jamais vues : une pièce lancée |
| **Les trois enchaînées** | 70 | 57,9 % | 47 à 67 | Drafts de vidéos qu’aucune lecture n’a vues |

**Ses arguments.** Pour chaque draft jugée, on ne garde que les matchups, synergies et réponses qu’il a nommés dans d’autres groupes et qui s’appliquent encore : mêmes champions, même relation allié ou adverse, mêmes rôles. On compte de quel côté ils penchent. Rien n’est ajusté sur ses verdicts. Cette lecture répond pour 73 % des drafts jugées ; pour les autres il n’y a pas d’argument applicable, ou autant de chaque côté. Face à la règle « toujours le même côté » sur les mêmes drafts, ses arguments ont raison seuls 49 fois et tort seuls 33 fois : l’avantage va dans le bon sens mais n’est pas établi statistiquement (p ≈ 0,10).

**Ses fiches champion.** Chaque fiche résume ce qu’il dit d’un champion : avec qui il est bon, par qui il est puni. La fiche est lue proposition par proposition : « avec X » désigne un partenaire, « contre X » une victime, « puni par X » un champion qui prend le dessus, « anti-synergie » un mauvais partenaire. Sur une draft, une fiche parle quand le champion cité est là dans la relation dite. Les fiches ont été écrites à partir de la plupart de ses vidéos ; 28 vidéos avaient été tenues à l’écart (`data/card-holdout.json`). Sur les drafts de ces 28 vidéos, les fiches désignent son verdict 34 fois sur 56 ; l’intervalle contient 50 %. Sur les drafts des vidéos dont elles sont tirées : 152 fois sur 187 (81,3 %). Seul le premier chiffre est affiché.

**Ses principes.** Les règles de composition du calculateur (frontline, dégâts soutenus, catch, scaling…) décrivent les deux compositions. Sur les 207 drafts jugées que le calculateur n’a jamais vues, son côté est celui de Kazewa une fois sur deux. C’est le dernier recours, et le site le présente comme tel.

**Le total.** Sur les 70 drafts des vidéos tenues à l’écart des fiches, avec ses arguments venus d’autres groupes et sans le calculateur sur les drafts qui ont servi à le régler, le verdict estimé coïncide avec le sien 40 fois, une draft restant à l’équilibre. Sur l’ensemble des 274 drafts jugées le total monte à 63,7 %, mais ce chiffre est gonflé par les fiches et n’est pas affiché.

### Ce que l’écart des fiches veut dire

Quatre fois sur cinq quand les fiches résument la vidéo, six fois sur dix quand elles ne l’ont jamais vue. Ce que Kazewa a dit d’une draft permet de retrouver son verdict ; des règles générales sur les champions ne le permettent presque pas. Son avis tient à la draft elle-même : les bans, les joueurs, la méta du moment. C’est la limite de tout ce que le site peut estimer.

### Lecture écartée : l’ordre des picks

L’ordre des picks (pour chaque lane, quel côté a posé son champion après l’autre) avait paru utile : 61,5 % sur 195 drafts, et 75 % quand il allait dans le sens de ses arguments. Avec les saisons ajoutées, sur 269 drafts :

| Lecture | Drafts | Accord |
| --- | ---: | ---: |
| Ordre des picks, un poids par lane | 269 | 54,6 % |
| Répondre toujours « côté rouge » | 269 | 52,8 % |
| Arguments et ordre des picks du même côté | 111 | 62,2 % |
| Arguments seuls, pour comparaison | 200 | 60,5 % |

L’écart avec la règle sans modèle n’est pas établi (p ≈ 0,68), et l’ordre des picks n’ajoute rien de mesurable à ses arguments. Il a été retiré du verdict et de l’interface. Il reste mesuré dans le rapport (`unseen.pickOrder`) pour que cette décision reste vérifiable.

### Ce qui ne marche pas non plus

Les profils de champions (18 traits par équipe, environ 41 %), l’identité des champions (43 à 47 %) et les statistiques de 44 000 matchs pros (52 à 55 %) restent au niveau du hasard. Ces essais sont dans `research/`.

### L’ancien « 100 % »

La première version du site affichait 62 accords sur 62. Les poids et les exceptions du calculateur avaient été réglés sur ces 62 drafts. Le rapport garde les deux nombres côte à côte (`unseen.structuralCalculator`) : 93,5 % sur les drafts de réglage, 50,7 % sur les autres.

## Repère : le résultat réel

Dans 80 % des drafts jugées, l’équipe qu’il préférait a gagné (`reference.realWinnerMatchesVerdict`). Ce n’est pas une mesure du site. Une partie de ses revues est enregistrée en connaissant le résultat.

## Limites

- Une lecture peut sembler réelle sur deux cents drafts et disparaître sur trois cents : l’ordre des picks l’a fait. Le chiffre de ses arguments repose lui aussi sur deux cents drafts, son avantage sur la règle sans modèle n’est pas encore établi, et il n’a pas été confirmé sur de nouvelles vidéos.
- Ses arguments viennent de ses vidéos passées. Des équipes qui reprennent les mêmes duos, et qu’il continue de préférer, peuvent gonfler le chiffre.
- Les avis de revue et les avis tardifs peuvent connaître le résultat. Ils sont gardés, avec leur moment.
- Les paraphrases de ses raisons viennent d’une transcription automatique, puis d’une traduction relue. Le lien vidéo permet de vérifier.

## Reproduire

```powershell
npm run evaluate
node --test tests/evaluation.test.mjs tests/memory.test.mjs tests/verdict.test.mjs
```

Les tests refusent un rapport ou un fichier de fiabilité qui ne correspond plus exactement à la mémoire livrée, une fiabilité affichée différente du rapport, et une page qui écrirait un pourcentage d’accord en dur.
