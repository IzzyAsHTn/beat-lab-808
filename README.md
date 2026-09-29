# 808 Beat Lab

808 Beat Lab est une boîte à rythmes minimaliste en HTML, CSS et JavaScript, sans dépendance ni fichier audio externe. Les sons sont générés en temps réel avec Web Audio.

Le site inclut aussi `samples.html`, un lecteur/découpeur de samples locaux : il affiche la forme d’onde, permet de choisir une plage, de l’écouter, de tester la sortie audio et d’exporter en WAV. Le fichier importé est traité dans le navigateur et n’est pas envoyé au site.

## Tester sur Mac

Ouvre `index.html` dans Safari ou Chrome, clique sur **Jouer**, puis active/désactive les cases. Si le navigateur bloque l'audio avant le premier geste, reclique sur **Jouer**.

## Publier avec GitHub Pages

1. Crée un dépôt GitHub, par exemple `beat-lab-808`.
2. Ajoute `index.html`, `samples.html` et ce README à la racine du dépôt. Lors d'une mise à jour, remplace aussi l'ancien `index.html` pour afficher le lien vers le découpeur.
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
- **Sample Cutter** : charge un son local, sélectionne le passage à garder sur la forme d’onde ou avec les champs début/fin, écoute-le et exporte-le en WAV PCM 16 bits. Le bouton de test envoie un bip au lecteur audio du navigateur ; le curseur règle le volume de lecture.

## Limite de cette première version

Les sons sont des synthèses simples inspirées des familles de sons de boîtes à rythmes classiques ; ce ne sont pas des échantillons originaux d'une Roland TR-808.


## Outils du site

- `index.html` — boîte à rythmes avec deux kits synthétisés : TR-808 classique et Organique numérique
- `samples.html` — découpeur local de samples
- `sequencer.html` — séquenceur de samples 4 pistes / 32 pas, boucles de 8, 16 ou 32 pas
- `effects.html` — filtre, saturation, écho et réverbération avec export WAV

Les fichiers audio restent dans le navigateur. Pour mettre le site à jour, téléverse à la racine du dépôt les cinq fichiers : `index.html`, `samples.html`, `sequencer.html`, `effects.html` et `README.md`.
