# Expérience de distillation supervisée

Cette expérience apprend les priorités structurelles relatives des jugements annotés de Kazewa. Elle est **séparée du moteur principal**, de son rapport et de son seuil de fidélité. Elle ne modifie aucun de leurs résultats et ne justifie pas leur remplacement.

## Résultats

Le corpus d’apprentissage contient 62 drafts nettoyées issues de 42 vidéos. La validation utilise cinq plis, regroupés par vidéo et par composition exacte, avec 49 ou 50 cas d’apprentissage par pli. Chaque draft est jugée une seule fois par un modèle qui n’a reçu aucun label de son groupe.

| Mesure | Modèle distillé | Heuristique existante |
| --- | --- | --- |
| Accord hors groupe sur le corpus nettoyé | **32/62 — 51,6 %** | 23/57 — 40,4 % |
| Couverture correspondante | 100 % | 91,9 % |
| Accord en apprentissage sur les 62 mêmes cas | 51/62 — 82,3 % | Sans apprentissage |
| Accord hors groupe sur les 5 cas primaires | 2/5 — 40 % | 2/5 — 40 % |
| Transfert sur les 46 cas exploratoires sans groupe d’apprentissage commun | **19/46 — 41,3 %** | 25/42 — 59,5 % |
| Couverture de ce transfert | 100 % | 91,3 % |

Les taux à des couvertures différentes ne sont pas directement équivalents. Sur les 57 cas nettoyés où les deux modèles décident, le modèle distillé a 30 accords et l’heuristique 23 ; il corrige 22 erreurs de l’heuristique mais introduit 15 erreurs sur ses bonnes décisions. Cela n’établit pas une amélioration statistiquement fiable.

L’intervalle de Wilson à 95 % de l’accord hors groupe est **39,4–63,6 %**. Il porte sur les cas et ne corrige pas leur corrélation entre groupes. Les accords des cinq plis varient de **41,7 % à 75 %**. L’écart entre 82,3 % en apprentissage et 51,6 % hors groupe révèle un surapprentissage important. Le recul sur le transfert exploratoire empêche de considérer le gain du corpus nettoyé comme une amélioration générale.

**La fidélité reste non validée.** Le seuil de 85 % n’est atteint ni sur le corpus nettoyé ni sur les cinq cas primaires, qui sont également trop peu nombreux. Les résultats exploratoires ne contribuent jamais à ce seuil.

## Variables et interprétation

Le prédicteur utilise 24 variables numériques fixes, toutes signées équipe bleue moins équipe rouge :

- 11 scores par famille du moteur existant : frontline, dégâts, accès aux cibles, identité, protection, tempo, macro, terrain, synergie, lane et grille comparative ;
- 7 différences d’axes : frontline, DPS, catch, protection, scaling, objectifs et side lane ;
- 6 différences de sommes de traits de la taxonomie : engage, force early, anti-dash, burst, zone et bridge.

Les interactions nommées déjà présentes dans les règles sont agrégées dans leurs familles. Aucun identifiant de champion ou de paire n’est ajouté comme variable d’apprentissage. Le modèle n’a ni encodage individuel des champions, ni variable de joueur, équipe, date, patch, vidéo, match, résultat réel ou texte d’explication.

Les coefficients et leurs contributions sont consultables dans `data/distillation.json`. Une contribution indique comment une variable déplace le score de préférence. Les variables sont corrélées : un coefficient négatif sur la protection ne signifie pas que Kazewa n’aime pas protéger ses carries. Il peut refléter une mauvaise représentation d’interactions, le contexte absent des labels ou un effet d’échantillonnage. La stabilité des signes et la dispersion des coefficients entre les plis sont rapportées.

Le score est un **signal de préférence de draft**. La fonction logistique sert à calculer la perte d’apprentissage ; aucun pourcentage de victoire n’est fourni et le score n’est pas calibré en probabilité.

## Apprentissage figé pour cette expérience

La régression logistique utilise une pénalité quadratique fixe **λ = 1**, choisie avant le calcul. Aucune recherche d’hyperparamètres, de variable, de graine ou de seuil n’a été faite à partir des résultats. L’objectif est la moyenne des pertes logistiques plus `λ × somme(poids²) / 2`. Un solveur de Newton avec recherche de pas résout cet objectif convexe.

Chaque exemple d’apprentissage est accompagné de son miroir : les compositions sont échangées et la préférence inversée. Cela équilibre exactement les classes et impose une moyenne nulle. **Ces miroirs ne constituent pas de nouveaux exemples indépendants** : 62 drafts restent 62 observations historiques. Le modèle n’a pas de constante. Les coefficients divisent les variables par leur échelle RMS, calculée uniquement sur les exemples du pli d’apprentissage. Un échange de côtés inverse donc le score et le verdict.

Le seuil de décision est fixé à zéro. Seules les égalités numériques à `1e-10` près et les entrées invalides provoquent une abstention. Ce choix donne une forte couverture, y compris quand le signal est faible ; la couverture ne mesure pas la fiabilité.

## Prévention des fuites entre plis

Les groupes sont les composantes connexes de deux relations : même vidéo source, ou même empreinte des dix champions avec leurs rôles, indépendante du côté. Les vidéos supplémentaires conservées lors de la déduplication du benchmark sont également reliées. Les métadonnées du corpus exploratoire participent à cette construction : une draft exploratoire reliant deux vidéos empêche qu’elles soient séparées entre apprentissage et validation.

Les labels exploratoires ne participent **jamais** à l’apprentissage, aux normalisations ou au choix des plis. Les groupes nettoyés sont répartis de façon déterministe et équilibrée en nombre de cas, sans regarder leurs préférences. Dans ce corpus, ils forment 42 groupes. Les 62 prédictions hors groupe sont distinctes des prédictions du modèle final entraîné sur toutes les annotations.

Pour le transfert exploratoire, 55 cas sont exclus parce que leur groupe contient une draft nettoyée d’apprentissage. Les 46 cas restants proviennent de 31 vidéos sans lien de vidéo ou de composition exacte avec l’apprentissage. Cela n’en fait pas un test prospectif : les revues complètes peuvent contenir du recul sur le résultat, et les règles et la taxonomie ont été distillées de vidéos pouvant également figurer dans les corpus évalués.

## Courbe d’apprentissage

Les mêmes cas de validation sont conservés pour chaque fraction. Les groupes d’apprentissage sont ajoutés dans un ordre déterministe sans consulter leurs labels ; aucun seuil ne change.

| Fraction des groupes d’apprentissage disponibles | Nombre moyen de drafts apprises par pli | Accord hors groupe |
| --- | --- | --- |
| 25 % | 13,2 | 29/62 — 46,8 % |
| 50 % | 25,6 | 30/62 — 48,4 % |
| 75 % | 38,4 | 28/62 — 45,2 % |
| 100 % | 49,6 | 32/62 — 51,6 % |

La courbe est irrégulière. Elle ne permet pas de promettre qu’ajouter quelques annotations suffira à atteindre 85 %. La priorité est de vérifier davantage de compositions et de recueillir des jugements avant partie explicitement limités aux dix picks, puis de réserver de nouvelles vidéos à une validation prospective.

## Reproduction et utilisation

Depuis `draft-lab` :

```powershell
node scripts/distill.mjs
node --test tests/distillation.test.mjs
```

Le script lit les connaissances et le benchmark existants et écrit **uniquement** `data/distillation.json`. Le rapport enregistre les empreintes SHA-256 des entrées et du code. Il contient le modèle ajusté sur tous les cas nettoyés, les résultats hors groupe, les résultats par pli, les courbes d’apprentissage et le transfert séparé. Le modèle final ne doit pas être évalué sur ses cas d’apprentissage comme s’ils étaient nouveaux.

Le module `src/distillation.mjs` ne dépend que du moteur JavaScript existant et peut être importé dans un navigateur :

```javascript
import { predictPreference } from './src/distillation.mjs';
const output = predictPreference({ blue, red }, knowledge, report.model);
// output : status, winner, signal, contributions
```

Cette API sert à examiner l’expérience. Son ajout à l’interface ou son remplacement du moteur principal demande une décision distincte, fondée sur une validation suffisante.
