# Vérifications de la version

Vérifications effectuées le 29 octobre 2026.

Résultat local final : **86 tests automatisés réussis**, aucune erreur ; construction statique réussie.

## Calcul et données

Les tests automatisés couvrent la symétrie du score, l’absence des résultats et noms d’équipes dans les entrées prédictives, l’abstention sur picks inconnus/incertains et drafts incomplets, les rôles des synergies, la déduplication des cas, l’orientation des labels, l’exclusion des correspondances ambiguës et la séparation du corpus exploratoire.

Les rapports d’accord sont recalculables. Les empreintes des sources empêchent de réutiliser un rapport périmé après modification du moteur. La publication n’est pas bloquée : le seuil affiché est 70 % sur la cohorte élargie.

L’expérience d’apprentissage utilise une validation par groupes de vidéos et de compositions. Ses 82,3 % en apprentissage ne sont pas un résultat de généralisation ; les 51,6 % hors groupe et le recul sur le transfert séparé ne justifient pas son adoption.

## Navigateur

Chrome a rendu le site avec un profil de test isolé, sans accès à la session utilisateur. Vérification visuelle du bureau et d’un viewport mobile réel de 390 px, sans débordement horizontal.

Un harnais temporaire de même origine a vérifié neuf parcours :

1. Chargement du moteur et des dix sélecteurs.
2. Suppression des picks et suspension du verdict.
3. Analyse d’une composition complète.
4. Inversion des équipes et conservation de la marge.
5. Lien partagé contenant un pick incertain : abstention visible.
6. Affichage des mesures et du corpus exploratoire dans la méthode.
7. Absence de flux : aucun verdict final.
8. Réception et analyse d’un flux local explicitement simulé.
9. Changement de source : ancien verdict effacé immédiatement.

Le serveur de simulation et les pages temporaires ne font pas partie du site distribué. Les captures et le résultat de cette séance sont dans le dossier local ignoré `.preview/`.

## Sources live et HTTP

Le connecteur public LoL Esports a réussi un appel réseau réel et trouvé zéro partie active. Des fenêtres historiques réelles ont confirmé le schéma des rôles et les dix identifiants de champions. Cela ne valide pas encore une partie active de bout en bout ni une garantie de suivi pendant la sélection.

Les tests HTTP couvrent les erreurs réseau, observations périmées, doublons, limites de taille, authentification, CORS, fichiers privés, traversées de chemins et liens symboliques. Le connecteur PandaScore reste à vérifier avec un accès commercial réel.

La connexion GitHub est confirmée. Le dépôt de revue et la validation du code restent distincts de la publication d’un site et de la fidélité aux jugements de Kazewa.
