# Vérifications de la version 2.5.0

Vérifications effectuées le 21 novembre 2026.

Résultat local : **159 tests automatisés réussis**, aucune erreur ; mesure recalculée ; construction statique réussie.

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

- L’ancien coach classait les champions avec le calculateur structurel et la présence des équipes pro. Il plaçait le pick réel dans ses dix premières suggestions 16 % du temps sur les drafts de 2025, et ses raisons étaient parfois « 0 tank » sur un plateau vide.
- Le coach actuel ne lit plus les statistiques des parties pro pour classer ni pour donner une raison. Ses raisons viennent des remarques de Kazewa, de sa grille de décision (`src/theory.mjs`) et des règles de Shanei (`src/method.mjs`), chacune avec sa vidéo quand il en existe une.
- Une mesure sur 612 drafts professionnelles de 2026 (`research/coach-eval.mjs`) avait donné 47,4 % de pick réel dans les dix premières suggestions avec la méthode des deux coachs. Elle mesurait l’écart avec ce que font les équipes, donc elle ne sert plus de cible, et elle n’a pas été relancée pour la logique actuelle.
- Les tests (`tests/draft-coach.test.mjs`, `tests/method.test.mjs`, `tests/theory.test.mjs`) vérifient : le classement de ses arguments, le ban de son propre pick, le rôle réel des champions flex, que la présence pro ne donne aucune raison, que la grille tient sa symétrie, que la confiance suit son étape F, et que la procédure ne lit aucune donnée de parties pro.

## Grille de décision de Kazewa et lecture de Shanei

- `src/theory.mjs` applique sa grille de décision (section 8 de son document de méthode) : identité, trous structurels, axes, bonus, timing et verdict. Les vérifications de construction de Shanei s’y ajoutent.
- Mesure sur ses 304 drafts jugées, `research/theory-eval.mjs`, sans réglage : 50,3 % d’accord avec son verdict sur 292 drafts où la grille penche (intervalle 45 à 57 %), une pièce lancée. Les composantes de la grille ne sont pas publiées : aucune mesure du dépôt ne les isole.
- Le verdict estimé d’une draft jamais jouée suit : ses arguments, puis ses fiches champion. Sans l’un ni l’autre, pas d’estimation. Sur les drafts des vidéos tenues à l’écart, l’estimation coïncide avec son avis 58,6 % du temps (41 sur 70, intervalle 48 à 68 %) ; une draft sur 71 n’a aucune estimation.
- Un test (`tests/browser-imports.test.mjs`) vérifie que chaque import nommé des fichiers du navigateur existe dans le module qu’il nomme : un import mort casse toute la page au chargement, et aucun autre test ne le voit.
- Le résultat d’une partie déjà jouée n’est plus un verdict : il est affiché comme un fait. Il coïncidait avec son avis 80 % du temps, mais il ne vient pas de sa méthode.
- La lecture de Shanei reste un second avis : sur les drafts jugées où elle penche, elle coïncide avec son verdict 49,5 % du temps.
- Une relecture contradictoire de la procédure et du coach vérifie qu’aucune donnée de parties pro ne décide, et que chaque règle est appliquée comme son texte la donne. Ses défauts confirmés sont corrigés ; le détail est dans le compte rendu de la session.

## Méthode de Shanei et de Kazewa

- Relevé : 358 règles (258 de Shanei, 100 de Kazewa) tirées des fiches de leurs vidéos par quatre lecteurs, chaque règle relue par un second lecteur contre la fiche citée (vidéo, moment, sens, champions nommés, passages incertains). Les champions ont été classés dans les familles de Shanei puis relus de la même façon : 154 sont classés par lui-même, les autres d’après ses définitions.
- Les règles que la fiche de leur vidéo marque comme incertaines sont affichées avec cette mention et ne donnent aucun point. Les renvois à d’autres vidéos (« vid. 29 ») sont retirés du texte affiché.
- Les tests (`tests/method.test.mjs`) vérifient : que chaque règle citée dans le code existe, sous le bon coach ; qu’une règle incertaine ne donne jamais de point ; la famille lue sur des compositions types ; les reproches de la lecture (tank, full AP, hypercarry sans enchanteur, anti-synergie, ultime offert à Sylas) et leur symétrie ; l’ordre des rôles, les first picks et les picks à ne pas blind ; que le plan n’est jamais vu de l’adversaire ; et, sur des drafts entières jouées sur la première suggestion depuis les deux côtés et avec chaque plan, qu’aucune ligne n’est dite sans règle ni phrase de sa fiche.

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

## Modèle de composition et retrait des équipes et des joueurs

- Une revue indépendante (trois relecteurs en lecture seule) a été faite sur le modèle de composition. Pas de fuite d'information ; les chiffres 54,3 % et +0,9 point sont reproduits ; la précaution sur le choix de la variante et sur 2025-2026 est écrite dans [`docs/EVALUATION.md`](EVALUATION.md).
- **Retiré** : les champs d'équipe des données structurées (`src/results.mjs`, `src/memory.mjs`, `scripts/build-memory.mjs`, `data/memory-site.json`) ; les noms d'équipes des 256 fichiers `data/pro-results/` (79 751 noms effacés, testé) ; l'affichage des noms d'équipes dans le fait « partie déjà jouée » et dans les phrases de verdict.
- **Retiré des textes publiés** (`scripts/redact-names.mjs`, lancé par `npm run build`) : les noms d’équipes et de joueurs de la mémoire publiée, des notes du coach et des fiches de champions sont remplacés par « une équipe » et « un joueur ». 3 121 remplacements à la dernière exécution complète, sur 6 621 joueurs et 3 817 équipes connus. Un test rescanne les fichiers publiés contre la liste des données pro.
- **Flux du direct** : le serveur ne transmet plus de nom d’équipe (le côté est nommé par sa couleur).
- **Serveur de développement** : il ne sert plus les trois fichiers sources de la mémoire (`kazewa-memory.json`, `kazewa-enrichment.json`, `memory-overrides.json`).
- **Limites, à connaître** : la liste des joueurs vient des saisons présentes dans `.cache/oe-new` (2018, 2019, 2021, 2026). Les joueurs des autres saisons ne sont pas couverts, et le test ne peut pas les voir. Des mots courants qui sont aussi des noms ont été gardés en clair (par exemple « Ghost », sort d’invocateur) pour ne pas abîmer le texte. Les fichiers sources de Kazewa (`data/kazewa-memory.json`) gardent les noms : la construction de la mémoire rapproche ses drafts des matchs par ces noms. Ils figurent aussi dans l’historique Git publié avant ce changement, qu’il faudrait réécrire pour les effacer.
- **Hors modèle** : aucun nom d'équipe ni de joueur n'entre dans le calcul du modèle de composition ni dans les décisions du coach (vérifié par la revue et par un test sur le module de valeur).
- Un doublon d'enregistrement source (une partie NLC publiée sous deux noms d'équipes) est conservé tel quel et noté dans le test.
