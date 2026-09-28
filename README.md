# 808 Beat Lab

Une boîte à rythmes minimaliste en HTML, CSS et JavaScript, sans dépendance ni fichier audio externe. Les sons sont générés en temps réel avec Web Audio.

## Tester sur Mac

Ouvre `index.html` dans Safari ou Chrome, clique sur **Jouer**, puis active/désactive les cases. Si le navigateur bloque l'audio avant le premier geste, reclique sur **Jouer**.

## Publier avec GitHub Pages

1. Crée un dépôt GitHub, par exemple `beat-lab-808`.
2. Ajoute `index.html` à la racine du dépôt (tu peux aussi garder ce README).
3. Dans le dépôt, ouvre **Settings → Pages**.
4. Sous **Build and deployment**, choisis **Deploy from a branch**, puis `main` et `/ (root)`, et enregistre.
5. Attends la fin du déploiement : GitHub affichera l'adresse publique dans cette page.

Le dépôt doit être public avec GitHub Free pour utiliser GitHub Pages. N'ajoute aucune clé secrète ou donnée privée à ce projet.

## Commandes

- **Jouer / Arrêter** : démarre ou arrête la boucle.
- **Tempo** : règle la vitesse de 60 à 160 BPM.
- **Swing léger** : décale légèrement un pas sur deux.
- **Cases** : active ou coupe kick, snare, clap et charley.
- **Effacer la grille** : retire toutes les frappes.

## Limite de cette première version

Les sons sont des synthèses simples inspirées des familles de sons de boîtes à rythmes classiques ; ce ne sont pas des échantillons originaux d'une Roland TR-808.
