# Vérifications de la version 2.2.0

Vérifications effectuées le 14 novembre 2026.

Résultat local : **121 tests automatisés réussis**, aucune erreur ; mesure recalculée ; construction statique réussie.

## Mémoire des verdicts

- Chaque draft jugée renvoie son verdict dans les deux orientations (274 sur 274), contrôlé par `npm run evaluate` et par `tests/memory.test.mjs`.
- Les tests vérifient pour chaque cas : dix champions distincts et connus, verdict et moment valides, au moins une vidéo source, ordre des picks cohérent, arguments limités aux champions de la draft, aucune draft en double.
- Les 259 cas de la première construction ont été relus un par un à partir de leur dossier, puis chaque anomalie a reçu une seconde relecture indépendante. Une relecture du code en cinq angles, dont chaque défaut signalé a été vérifié par un second relecteur, a ensuite trouvé quatre parties stockées deux fois et une vidéo récapitulative à reclasser. Les corrections retenues sont dans `data/memory-overrides.json`. Détail dans [`EVALUATION.md`](EVALUATION.md).
- Les traductions françaises et les arguments structurés ont été produits par lots, puis relus par un second passage qui contrôlait le côté avantagé par chaque argument. L’import refuse un lot qui ne correspond plus au texte qu’il traduit.
- Les 173 fiches champion couvrent tout le catalogue ; un test échoue si un champion n’a pas de fiche. Un autre vérifie, sur de vraies tournures de fiche, que « contre X » n’est pas lu comme « avec X » et que les noms abrégés sont reconnus.
- Une partie réelle n’est stockée qu’une fois : un test échoue si deux cas partagent une partie, ou si la construction signale un quasi-doublon dans une même vidéo.

## Mesure

- La validation retire un groupe entier (vidéo ou série) à chaque tour. Un test met les deux tiers des drafts dans un groupe qui suit la règle inverse : jugé honnêtement il obtient zéro, et il obtiendrait tout s’il fuyait dans son propre entraînement.
- Ses arguments sont comptés depuis les autres groupes seulement ; un test vérifie qu’un argument ne compte ni pour sa propre draft ni pour une autre partie de sa vidéo.
- Avec des verdicts tirés au sort, l’accord mesuré reste autour de 50 % et le test de permutation (200 tirages) ne les déclare pas significatifs ; avec une règle réelle il est au plancher.
- L’ordre des picks est comparé à la règle « toujours le même côté », mesurée sur les mêmes drafts. L’écart n’est pas établi : il a été retiré du verdict et de l’interface. Un test vérifie que le verdict est le même avec ou sans ordre des picks, et que le fichier de fiabilité livré ne contient plus rien à son sujet. La même règle sans modèle est mesurée face à ses arguments.
- Le rapport et le modèle livrés doivent être exactement ceux que donne la mémoire livrée.
- La page ne contient aucun pourcentage d’accord écrit en dur.
- La lecture par fiches champion est mesurée sur les seules vidéos tenues à l’écart quand les fiches ont été écrites ; le rapport garde à côté le chiffre gonflé des autres vidéos, et un test vérifie que c’est le premier qui est affiché.
- Toute draft complète reçoit un verdict : un test tire 500 drafts au hasard dans tout le catalogue, champions rares compris, et vérifie que chacune obtient un côté (ou, par exception, un équilibre) et que la fiabilité de la lecture utilisée existe dans le modèle livré.

## Recherche d’un meilleur modèle

Cinq tentatives indépendantes ont cherché un signal sous le même protocole (arguments de Kazewa, statistiques des matchs pros, ordre des picks, structure des compositions, drafts proches), chacune limitée à douze variantes. Les notes disponibles sont dans `research/notes/`. Deux pistes en étaient sorties : l’ordre des picks, et la reprise de ses propres arguments. La première n’a pas tenu quand la mémoire est passée de 253 à 287 parties. Le site utilise la seconde sous sa forme la plus simple, sans aucun réglage.

## Navigateur

Vérifié sur le serveur local, en largeur bureau (1280 px) et mobile (375 px), sans débordement horizontal ni erreur de console :

1. Chargement : une draft jugée s’affiche avec son verdict, ses raisons en français, ses lectures de champions et le lien vidéo.
2. Changement d’un champion : la draft devient inédite, le verdict estimé vient de ses arguments, avec leur fiabilité mesurée.
3. Draft sans aucun argument applicable (Gwen, Nocturne, Twisted Fate, Yunara, Neeko contre Akali, Pantheon, Aurora, Xayah, Lulu) : verdict estimé d’après ses fiches champion, avec la liste des remarques qui s’appliquent.
4. Inversion des équipes : le verdict, estimé ou non, suit les compositions. Un clic dans la page ne relance plus le rendu de la vue.
5. Fiche champion : ouverture, contenu, fermeture.
6. Drafts proches et arguments applicables, avec le bouton qui charge un précédent.
7. Saisie rapide : même verdict que par rôle.
8. Coach de draft, direct pro et méthode : rendu sans erreur ; le tableau de mesure lit `data/evaluation.json`.

## Sources live et HTTP

Inchangé depuis la version précédente : les tests HTTP couvrent les erreurs réseau, observations périmées, doublons, limites de taille, CORS, fichiers privés, traversées de chemins et liens symboliques. Le connecteur PandaScore reste à vérifier avec un accès commercial réel.
