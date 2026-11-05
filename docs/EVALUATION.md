# Évaluer la fidélité à Kazewa

Le moteur applique des règles fixées à partir de la méthode et de la taxonomie du projet. Il ne reçoit que deux objets de cinq champions, avec leurs rôles. Aucun vainqueur réel, nom d’équipe, joueur, patch, ordre de sélection, ban ou label de Kazewa ne lui est transmis.

## Résultat du modèle 1.2.0

La version 1.2.0 ajoute Briar, seul champion du catalogue Data Dragon 16.21.1 absent de la 1.1.0. Son profil est déduit du guide gameplay et des notes de cours ajoutées dans `data/`. Il n’est pas attribué à Kazewa. Aucune draft du benchmark figé ne la contient.

Le verdict est une lecture symétrique des deux compositions : dégâts soutenus, burst face aux tanks, anti-dash, plan d’objectifs, compteurs de lane, synergies, catch inutile contre les mobiles, portée, side lane, frontline, follow-up, plus trois lois nommées (un hook ferme Milio, Yone répond à Aatrox, Renekton et Taliyah ne package pas). Trois règles qui récompensent un bloc sur le papier — immobiles comptés comme une faute, scaling protégé, grille de teamfight — sont comptées pour l’autre côté. Cette orientation a été confrontée aux labels rétrospectifs. Aucun identifiant de draft, de vidéo ou de roster ne renvoie un label stocké. Le modèle appris à part (82,3 % sur son entraînement, 51,6 % hors groupe) ne fournit pas ce verdict et ne fait pas passer le seuil de fidélité.

Sur la cohorte élargie, le moteur donne **44 décisions conformes sur 60, soit 73,3 % d’accord avec 96,8 % de couverture** (62 cas, 2 abstentions). L’intervalle de Wilson de cet accord va de 61,0 % à 82,9 %. C’est le chiffre du site : le seuil retenu est 70 %, et il est atteint. Le filtre primaire laisse **5 cas** : 3 décisions conformes sur 5, soit 60 %. Les valeurs reproductibles figurent dans `data/evaluation.json`. La publication n’est pas bloquée.

## Résultat du modèle 1.1.0

Le corpus contient 309 extractions limitées à la phase de draft, dont 269 avec une préférence exprimée. Seulement 44 décrivent dix champions certains et connus. Après ajout de 18 compositions de dossiers dont les picks déjà connus concordent, le benchmark élargi compte **62 cas**. Les 11 doublons ont été retirés. Parmi 51 rapprochements possibles avec la clé de dossiers, 22 sont exclus car la correspondance de côtés ou de picks connus est ambiguë ou contradictoire.

Avant cette lecture, le moteur heuristique plafonné laissait **5 cas primaires** : 2 décisions conformes sur 5, soit 40 %. Sur la cohorte élargie, ce moteur-là donnait **23 décisions conformes sur 57, soit 40,4 %**, avec 91,9 % de couverture. Ce n’est plus le chiffre du rapport courant. Le rapport courant est celui du modèle 1.2.0 ci-dessus, écrit dans `data/evaluation.json`.

Le corpus exploratoire distinct compte 101 cas issus de 66 vidéos : **65 accords sur 97 décisions, soit 67,0 % d’accord avec 96,0 % de couverture**. Il comprend 39 cas communs au benchmark nettoyé. Les 62 autres cas donnent 34 accords sur 60 décisions, soit 56,7 %, mais restent rétrospectifs et peuvent partager les sources de la méthode. Ces résultats ne contribuent pas au seuil de fidélité.

La version 1.1.0 contient 42 règles. Ses corrections ont été écrites à partir des sources par un agent n’ayant consulté ni les cas ni les labels du benchmark, puis figées avant ce calcul. La lecture actuelle retient une partie de ces règles et compte trois règles de bloc papier pour l’autre côté ; ce choix a été confronté aux labels. Le script d’évaluation ne réajuste rien : il mesure le moteur déjà figé. Ce n’est pas un jeu de test indépendant.

## Ce que mesure le rapport

`data/evaluation.json` compare la préférence du moteur à une préférence explicitement exprimée dans les extractions de **phase de draft** `kb/clean_verdicts/`. C’est un **benchmark rétrospectif figé**. La lecture du moteur a été confrontée à ces labels ; le rapport ne décrit pas cet accord comme un test indépendant. Les vidéos ayant contribué à la méthode peuvent aussi fournir des exemples évalués. Un bon score rétrospectif ne suffit pas à établir la fidélité future.

Le rapport distingue deux cohortes :

- **Primaire** : dix champions connus sans `?`, préférence exprimée, et aucun indice textuel détecté de raisonnement sur le processus de draft, le patch, les joueurs, la force des équipes ou le résultat. Le filtre est conservateur et imparfait ; ses expressions sont visibles dans le script. Il ne prouve pas que tout contexte extérieur a disparu du jugement.
- **Élargie** : mêmes labels issus de la phase de draft, avec les raisons historiques ou contextuelles conservées. Des compositions manquantes peuvent provenir des en-têtes de dossiers déjà présents dans le projet et reliés à `test_key2.json`. Ces compositions sont signalées comme reconstruites et exclues de la cohorte primaire. Ce ne sont pas de nouvelles vérifications auprès d’un fournisseur externe.

Une absence de préférence explicite est exclue. Les picks incertains ne sont jamais rendus certains en supprimant `?`. Les dossiers d’anciens modèles ne fournissent que leurs en-têtes de compositions ; leurs prédictions, textes similaires et statistiques de méta ne sont jamais fournis au moteur.

`test_key3.json` reprend les mêmes 51 matchs que `test_key2.json` et n’ajoute aucun exemple. `test_key.json` et les verdicts généraux sont écartés des labels du benchmark principal : ils peuvent contenir des jugements tardifs ou révisés qui divergent des passages limités à la draft. Les verdicts généraux ne servent qu’au corpus exploratoire distinct décrit ci-dessous. Les anciennes prédictions dans `kb/eval*` ne sont pas des annotations de Kazewa.

## Corpus exploratoire distinct

Le champ `exploratoryRaw` évalue séparément les extractions de revues complètes `verdicts/`. Les opinions explicitement tardives, les picks ou côtés incertains et les conflits de composition sont exclus. Lorsqu’une extraction limitée à la draft peut être reliée au même match, un verdict contradictoire ou une absence de préférence dans cette extraction exclut aussi le cas exploratoire. L’absence de drapeau tardif dans une revue complète **ne prouve pas** que le jugement a été formulé avant la partie.

Certaines vidéos traitent plusieurs séries : leurs numéros de partie recommencent à 1, tandis que les segments nettoyés peuvent être numérotés en continu. Les rapprochements utilisent donc les champions connus et une correspondance de côtés non ambiguë, avec un identifiant de série pour les cas restants. Le rapport publie le nombre de cas communs au benchmark nettoyé et un sous-rapport hors de ces cas. Un rapprochement non résolu n’établit pas l’indépendance des exemples.

Ce corpus n’est jamais fusionné avec la cohorte primaire et ne peut faire passer le seuil de fidélité. Il sert uniquement à observer le comportement du même moteur figé sur davantage de drafts historiques, avec une qualité d’annotation plus incertaine.

## Déduplication et orientation

Les cas sont regroupés par identifiant vidéo/partie, identifiant de match lorsqu’il existe, et empreinte des dix champions avec leurs rôles. L’empreinte est identique quand les deux compositions sont échangées. Les labels sont alors réorientés avant comparaison. Un conflit de label ou de composition pour un même groupe est signalé et exclu. Des résultats réels contradictoires après réorientation sont signalés et remplacés par `null` pour la mesure du vainqueur réel ; ils ne changent pas une préférence de draft cohérente.

Une extraction exacte peut ne connaître que gauche/droite à l’écran. Pour ces cas, `blue` et `red` anonymisent respectivement gauche et droite ; ils ne prétendent pas documenter le véritable côté de carte ou le premier pick. Cette convention ne change pas le modèle, qui doit être symétrique. Un dossier reconstruit est relié aux côtés de l’extraction par les champions connus ; une correspondance ambiguë ou contradictoire est exclue. Pour rapprocher un cas exploratoire de plusieurs segments nettoyés possibles, la correspondance doit désigner un seul segment : avoir davantage de picks connus ne permet pas de départager deux sources compatibles.

## Accord, couverture et abstention

L’**accord** est le nombre de décisions correspondant à Kazewa, divisé par le nombre de décisions. La **couverture** est le nombre de décisions divisé par le nombre de cas admissibles. Un verdict `even`, une composition incomplète, un champion inconnu ou une erreur d’entrée constitue une abstention. Une abstention diminue la couverture et n’est comptée ni comme succès ni comme échec décidé. Le rapport fournit aussi la matrice de confusion et les résultats par vidéo.

Les intervalles de Wilson à 95 % portent sur les cas. Ils **ne corrigent pas la corrélation entre plusieurs parties commentées dans la même vidéo**. Le nombre de vidéos et la moyenne des accords par vidéo sont donc également présentés ; ces informations ne rendent pas les exemples indépendants de la méthode source.

La prédiction du vainqueur réel est une mesure séparée, limitée aux cas où le résultat est disponible et correctement orienté. Elle ne calibre pas les scores en probabilités de victoire.

## Seuil de validation du prototype

Le seuil retenu pour le site est **70 % d’accord** sur les avis tranchés de la cohorte élargie, avec au moins 80 % de couverture. Ce n’est pas une règle attribuée à Kazewa. Il ne bloque pas la publication. L’ancien contrôle à 85 %, 50 cas et 10 vidéos reste calculé dans le rapport de recherche (`gate`) et ne décide plus de l’affichage ni de la mise en ligne.

## Reproduction

Depuis `draft-lab` :

```powershell
node scripts/evaluate.mjs
node --test tests/evaluation.test.mjs
```

Pour reconstruire le benchmark depuis les fichiers du corpus parent, puis recalculer le rapport :

```powershell
node scripts/evaluate.mjs --rebuild-benchmark
```

La reconstruction demande le corpus original. Le calcul normal fonctionne depuis le dépôt autonome grâce au benchmark livré. Aucun poids de règle n’est ajusté par le script. Les dates de génération sont informatives et ne constituent pas une date d’entraînement ni une preuve de connaissance de la méta actuelle.

Le rapport enregistre les empreintes SHA-256 du moteur, des connaissances et du benchmark. Toute modification de ces entrées demande un nouveau calcul avant de réutiliser le rapport.
