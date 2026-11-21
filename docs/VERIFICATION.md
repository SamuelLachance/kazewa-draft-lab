# Vérifications de la version 2.4.0

Vérifications effectuées le 20 novembre 2026.

Résultat local : **152 tests automatisés réussis**, aucune erreur ; mesure recalculée ; construction statique réussie.

## Mémoire des verdicts

- Chaque draft jugée renvoie son verdict dans les deux orientations (304 sur 304), contrôlé par `npm run evaluate` et par `tests/memory.test.mjs`.
- Les tests vérifient pour chaque cas : dix champions distincts et connus, verdict et moment valides, au moins une vidéo source, ordre des picks cohérent, arguments limités aux champions de la draft, aucune draft en double.
- Les 259 cas de la première construction ont été relus un par un à partir de leur dossier, puis chaque anomalie a reçu une seconde relecture indépendante. Une relecture du code en cinq angles, dont chaque défaut signalé a été vérifié par un second relecteur, a ensuite trouvé quatre parties stockées deux fois et une vidéo récapitulative à reclasser. Les corrections retenues sont dans `data/memory-overrides.json`. Détail dans [`EVALUATION.md`](EVALUATION.md).
- Les traductions françaises et les arguments structurés ont été produits par lots, puis relus par un second passage qui contrôlait le côté avantagé par chaque argument. L’import refuse un lot qui ne correspond plus au texte qu’il traduit.
- Les 173 fiches champion couvrent tout le catalogue ; un test échoue si un champion n’a pas de fiche. Un autre vérifie, sur de vraies tournures de fiche, que « contre X » n’est pas lu comme « avec X » et que les noms abrégés sont reconnus.
- Une partie réelle n’est stockée qu’une fois : un test échoue si deux cas partagent une partie, ou si la construction signale un quasi-doublon dans une même vidéo.
- Les 131 extractions trop partielles pour un rattachement automatique ont été reprises par trois relecteurs indépendants par vidéo : un qui nomme la partie, un qui cherche à la réfuter, un qui lit le côté sans voir la première réponse. 114 liens ont été gardés, 8 refusés par les contrôles et 9 écartés à la relecture. Après reconstruction, chaque cas dont le verdict avait changé a été comparé à l’état précédent : aucun ne change de côté. Un test vérifie que chaque lien pointe vers la partie nommée, que ses compositions viennent des données de match, et que tout refus est consigné avec sa raison.
- Les traductions et les arguments des 90 parties nouvelles ou modifiées ont été produits puis relus de la même façon que les précédents.
- L’ensemble du changement a été relu sous cinq angles (fichiers de résultats, interface, honnêteté de la mesure, rattachements, tests et textes), et chaque défaut signalé a été contrôlé par un second relecteur chargé de le réfuter. Les 34 défauts confirmés, tous mineurs, sont corrigés : noms d’équipe absents des données, parties en double à la source, résultat appliqué à tort à une partie en cours, quatre vidéos à reclasser comme enregistrées en connaissant le résultat, un avis rattaché à ramener à « sans préférence », deux parties encore stockées deux fois.

## Mesure

- La validation retire un groupe entier (vidéo ou série) à chaque tour. Un test met les deux tiers des drafts dans un groupe qui suit la règle inverse : jugé honnêtement il obtient zéro, et il obtiendrait tout s’il fuyait dans son propre entraînement.
- Ses arguments sont comptés depuis les autres groupes seulement ; un test vérifie qu’un argument ne compte ni pour sa propre draft ni pour une autre partie de sa vidéo.
- Avec des verdicts tirés au sort, l’accord mesuré reste autour de 50 % et le test de permutation (200 tirages) ne les déclare pas significatifs ; avec une règle réelle il est au plancher.
- L’ordre des picks est comparé à la règle « toujours le même côté », mesurée sur les mêmes drafts. L’écart n’est pas établi : il a été retiré du verdict et de l’interface. Un test vérifie que le verdict est le même avec ou sans ordre des picks, et que le fichier de fiabilité livré ne contient plus rien à son sujet. La même règle sans modèle est mesurée face à ses arguments.
- Le rapport et le modèle livrés doivent être exactement ceux que donne la mémoire livrée.
- La page ne contient aucun pourcentage d’accord écrit en dur.
- La lecture par fiches champion est mesurée sur les seules vidéos tenues à l’écart quand les fiches ont été écrites ; le rapport garde à côté le chiffre gonflé des autres vidéos, et un test vérifie que c’est le premier qui est affiché.
- La lecture par le résultat est mesurée sans réglage, avec à part les avis donnés pendant la draft. Des tests vérifient que le vainqueur suit la composition quel que soit le côté où elle est saisie, que deux parties aux résultats opposés ne donnent aucun côté, qu’une draft jugée ne consulte jamais les résultats, que chaque partie vérifiée de la mémoire se retrouve dans les fichiers livrés avec le bon vainqueur, et que le total « draft jamais jouée » n’utilise pas le résultat.
- Toute draft complète reçoit un verdict : un test tire 500 drafts au hasard dans tout le catalogue, champions rares compris, et vérifie que chacune obtient un côté (ou, par exception, un équilibre) et que la fiabilité de la lecture utilisée existe dans le modèle livré.

## Recherche d’un meilleur modèle

Cinq tentatives indépendantes ont cherché un signal sous le même protocole (arguments de Kazewa, statistiques des matchs pros, ordre des picks, structure des compositions, drafts proches), chacune limitée à douze variantes. Les notes disponibles sont dans `research/notes/`. Deux pistes en étaient sorties : l’ordre des picks, et la reprise de ses propres arguments. La première n’a pas tenu quand la mémoire est passée de 253 à 287 parties. Le site utilise la seconde sous sa forme la plus simple, sans aucun réglage.

Deux pistes ont ensuite été mesurées hors de la draft elle-même. La force des équipes (classement Elo sur l’index des matchs, avant chaque partie) ne désigne son verdict qu’environ une fois sur deux. Le résultat de la partie le désigne 79,8 % du temps : le site s’en sert pour les parties déjà jouées, en le disant.

## Coach de draft

- L’ancien coach classait les champions avec le calculateur structurel : bans presque alphabétiques, raisons comme « 0 tank » sur un plateau vide. Rejoué sur de vraies drafts professionnelles de 2025, il plaçait le pick réel dans ses dix premières suggestions 16 % du temps.
- Le nouveau classement (`src/coach.mjs`) a été réglé sur les drafts de 2025 puis mesuré sur celles de 2026 : sur 612 drafts, pick réel dans les cinq premières suggestions 33,1 % du temps, dans les dix premières 52,6 % (50,9 % quand les picks précédents sont rangés dans le rôle que le coach leur donne) ; ban réel dans les dix premières 49,0 % en première phase et 46,6 % en seconde. Chaque draft est rejouée avec les seuls chiffres pro des 60 jours précédents et les seules remarques de Kazewa antérieures ; les parties qu’il a commentées sont exclues.
- Deux idées ont été écartées par cette mesure. Pénaliser un champion parce qu’un counter reste disponible faisait baisser l’accord avec les drafts réelles : c’est devenu un avertissement sans effet sur le classement. Donner plus de poids à ses arguments qu’à la présence pro aussi : ils comptent un point chacun, un et demi contre l’adversaire de la lane, plafonnés à trois dans un même sens. Même ainsi, ses arguments et ses avis récents font baisser l’accord avec les drafts réelles (54,0 % sans eux, 52,6 % avec) : ils sont gardés parce que le coach doit dire ce que lui en pense.
- Une relecture en quatre angles (moteur, intégration, bon sens d’un joueur, données et tests), dont chaque défaut a été contrôlé par un second relecteur, a confirmé 36 défauts de la première réécriture, puis une seconde relecture 22 défauts restants ou créés par les corrections. Tous sont corrigés : champions flex rangés dans un rôle où ils ne sont pas joués, rôles joués en pro absents de la table des lanes, suggestion accompagnée d’une citation de Kazewa disant le pick faible, remarque rangée sous un autre champion que celui dont elle parle, ban conseillé de son propre meilleur pick, matchup jugé dans les deux sens compté pour celui qui choisit, avertissement citant des counters que l’adversaire ne peut plus jouer, liste alphabétique sans raison quand les données manquent ; puis, à la seconde passe, anti-synergies ignorées, avis sur un rôle appliqué à un autre rôle, série d’académies encore dans la fenêtre, parties d’académie rejouées dans la mesure.
- Les tests vérifient : le classement de ses arguments par relation et par rôle, le sens d’un argument pour le champion qu’il donne perdant, un matchup contesté, le plafond, son avis récent sur un champion, le rôle réel des champions flex sur les données livrées, le ban de son propre pick, les formulations selon le côté qui joue, qu’une draft entière jouée sur la première suggestion donne deux équipes complètes avec une raison lisible à chaque tour, et que sans données le coach ne suggère rien.

## Méthode de Shanei et de Kazewa

- Relevé : 358 règles (258 de Shanei, 100 de Kazewa) tirées des fiches de leurs vidéos par quatre lecteurs, chaque règle relue par un second lecteur contre la fiche citée (vidéo, moment, sens, champions nommés, passages incertains) ; 2 règles rejetées, 128 corrigées. Les 173 champions ont été classés dans les familles de Shanei puis relus de la même façon : 154 sont classés par lui-même, les autres d’après ses définitions.
- Mesure de la grille de Shanei avant de la brancher : 49,3 % d’accord avec le verdict de Kazewa sur 278 drafts, 49,8 % avec le vainqueur sur 52 124 parties pro. Elle est donc affichée comme second avis et laissée hors du verdict estimé.
- Mesure du coach avec la méthode, sur 612 drafts de 2026 : pick réel dans les cinq premières suggestions 29,6 % du temps, dans les dix premières 47,4 % (46,0 % avec les rôles placés par le coach), contre 52,6 % sans la méthode ; bans 49,9 % et 45,4 %. Les poids de la méthode ont été fixés sur 2025 par un principe (une règle vaut un argument de Kazewa), pas pour suivre les équipes pro.
- Une relecture en cinq angles (moteur, fidélité aux deux coachs, interface, bon sens d’un joueur, données et mesures), dont chaque défaut a été contrôlé par un second relecteur, a confirmé 73 défauts, dont beaucoup se recoupent. Les principaux : phrases attribuées à Shanei qui citaient une règle disant autre chose, ou une phrase sans rapport tirée de sa fiche ; Ezreal + Xerath donné comme anti-synergie alors qu’il les joue ensemble ; « duo surcoté » compté comme une faute ; règles incertaines présentées comme sûres ; « full AD » reproché à une compo dont le mid fait des dégâts magiques ; plan annoncé qui cachait à l’adversaire la famille pourtant visible sur le plateau ; plan qui guidait trop peu les suggestions ; champion crédité dans un rôle où Shanei ne le joue pas ; renvois internes aux fiches (« vid. 29 ») affichés tels quels. Tous sont corrigés. Une seconde relecture a ensuite vérifié chaque correction et confirmé 51 défauts restants ou créés par les corrections, corrigés à leur tour.
- Les tests (`tests/method.test.mjs`) vérifient : que chaque règle citée dans le code existe, sous le bon coach, et qu’une règle incertaine ne donne jamais de point ; la famille lue sur des compositions types ; les reproches de la grille (tank, full AP, hypercarry sans enchanteur, anti-synergie, ultime offert à Sylas) et sa symétrie ; l’ordre des rôles, les first picks et les picks à ne pas blind ; la famille, les pièces manquantes et les duos ; que le dernier pick capable d’apporter une pièce manquante l’apporte ; que le plan n’est jamais vu de l’adversaire ; que la lecture de Shanei ne change jamais le verdict ; et, sur des drafts entières jouées sur la première suggestion depuis les deux côtés et avec chaque plan, qu’aucune ligne n’est dite sans règle ni phrase de sa fiche.

## Navigateur

Vérifié sur le serveur local, en largeur bureau (1280 px) et mobile (375 px), sans débordement horizontal ni erreur de console :

1. Chargement : une draft jugée s’affiche avec son verdict, ses raisons en français, ses lectures de champions et le lien vidéo.
2. Changement d’un champion : la draft devient inédite, le verdict estimé vient de ses arguments, avec leur fiabilité mesurée.
3. Draft sans aucun argument applicable (Gwen, Nocturne, Twisted Fate, Yunara, Neeko contre Akali, Pantheon, Aurora, Xayah, Lulu) : verdict estimé d’après ses fiches champion, avec la liste des remarques qui s’appliquent.
4. Inversion des équipes : le verdict, estimé ou non, suit les compositions. Un clic dans la page ne relance plus le rendu de la vue.
5. Fiche champion : ouverture, contenu, fermeture.
6. Drafts proches et arguments applicables, avec le bouton qui charge un précédent.
7. Saisie rapide : même verdict que par rôle.
8. Draft d’une partie pro qu’il n’a pas commentée (Gen.G contre T1, LCK, 7 août 2025, partie 1) : le site nomme la partie et le vainqueur, donne ce côté avec la fiabilité mesurée, et suit la composition quand les équipes sont inversées.
9. Coach de draft : les cinq suggestions de chaque tour avec leurs raisons, les citations, les liens vidéo ; une draft entière jouée en cliquant la première suggestion ; first pick et second pick ; un champion flex placé dans un autre rôle par le filtre de rôle ; la recherche (« kar » donne Karma, Karthus, Skarner) ; largeur mobile sans débordement.
10. Lecture de Shanei sous le verdict : famille et score de chaque côté, reproches, validations et remarques avec leur lien vidéo, mention « avis moins net » sur les règles incertaines, phrase de second avis dans la carte du verdict. Coach : choix d’un plan, règles des deux coachs à chaque tour, état des deux compositions, étiquette Shanei, Kazewa ou Pro sur chaque ligne ; une draft entière avec le plan hypercarry.
11. Direct pro et méthode : rendu sans erreur ; le tableau de mesure lit `data/evaluation.json`.

## Sources live et HTTP

Inchangé depuis la version précédente : les tests HTTP couvrent les erreurs réseau, observations périmées, doublons, limites de taille, CORS, fichiers privés, traversées de chemins et liens symboliques. Le connecteur PandaScore reste à vérifier avec un accès commercial réel.
