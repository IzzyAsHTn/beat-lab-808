# Beat Lab 808

Beat Lab est un petit studio musical autonome publié avec GitHub Pages : boîte à rythmes, séquenceur de samples, découpeur et effets. Aucun framework ni dépendance externe.

## Outils

- `ateliers.html` — page d’accueil des ateliers musicaux, avec un accès à tous les outils.
- `groove-mystere.html` — jeu musical inspiré du Simon : écoute la séquence de notes ou de percussions et reproduis-la; la difficulté augmente au fil des tours.
- `index.html` — boîte à rythmes 8 voix et 16 pas avec deux kits. Le kit TR-808 emploie un clap synthétisé en rafales de bruit filtré et une courte réverbération; le kit Industriel joue le sample `industrial-clap.wav`, avec tuning par demi-tons. Chaque voix a ses boutons Mute, Solo et effacement du motif. Son motif, le kit, le tempo et le swing sont mémorisés dans le navigateur.
- `sequencer.html` — séquenceur de samples 8 pistes, boucles de 8 ou 16 pas, swing, volume, panoramique, Mute et Solo indépendants par piste, ainsi que filtre passe-bas, saturation, écho et réverbération par piste. Les pas masqués par la longueur choisie restent mémorisés.
- `samples.html` — lecteur et découpeur local de samples, forme d’onde, écoute et export WAV.
- `effects.html` — impression hors ligne des effets dans un WAV; fichier limité à 2 minutes pour éviter une surcharge mémoire. Les effets temps réel par piste sont dans le séquenceur.

## Sauvegarde locale

Le séquenceur enregistre automatiquement les motifs, réglages de mixage (volume, panoramique, Mute, Solo), effets et samples que tu importes dans le stockage local du navigateur (IndexedDB et stockage local). Ils sont conservés quand tu navigues vers un autre outil puis reviens, sur le même navigateur et le même appareil. Les fichiers que tu importes ne sont pas envoyés sur GitHub. Effacer les données du site dans le navigateur efface aussi ces samples.

## Ancien échantillon archivé

`clap-real.wav` est conservé dans le dépôt comme ancienne ressource, mais n'est plus chargé ni utilisé par les kits. Le clap Industriel utilise désormais le fichier audio fourni pour ce projet, `industrial-clap.wav`.

## Mise à jour sur GitHub Pages

Les six pages partagent la marque, les noms d’ateliers, la navigation et les styles de focus de `lab-shared.css`. Le bandeau, le contenu principal et le pied de page sont des repères distincts ; le lien d’évitement donne le focus à `main#contenu`. La page d’accueil utilise aussi `ateliers.css`. Aucun outil de compilation n’est nécessaire.

Pour une installation manuelle, copie tous les fichiers HTML, CSS et JS du site ainsi que les deux WAV, `favicon.svg`, `favicon.png`, `partage.svg` et `partage.png` à la racine du dépôt `IzzyAsHTn/beat-lab-808`, puis attends le déploiement Pages. Les WAV fournis sont les originaux, inchangés.

Les six pages déclarent la même favicon (SVG avec PNG de secours), un titre et une description Open Graph propres à chaque atelier, leur URL publique et une image de partage commune `partage.png` de 1200 × 630 px. `partage.svg` conserve sa source vectorielle. Si le site change de domaine ou de chemin, mets à jour les URL absolues `og:url` et `og:image` dans les six pages. Les images PNG sont fournies : aucune conversion n’est nécessaire pour publier le site.

Pour vérifier localement : `python3 -m http.server 8080`, puis ouvre `http://localhost:8080/ateliers.html`. Un serveur HTTP permet de tester les fichiers audio et le stockage dans les conditions du site.


## Corrections du comportement et des grilles

Le tempo de la boîte à rythmes respecte la valeur affichée avec ou sans swing. Les indicateurs planifiés sont annulés à l’arrêt et les erreurs de sauvegarde sont affichées. Le test de sortie du découpeur respecte son réglage de volume.

Les grilles proposent une seule case dans l’ordre de tabulation : flèches pour changer de pas ou de piste, Début/Fin pour les extrémités de la ligne, Espace ou Entrée pour activer une case. Elles conservent la présentation horizontale d’origine : commandes à gauche, pas alignés à droite. Sur petit écran, la grille entière défile horizontalement ; les en-têtes de pas restent affichés. Les commandes Mute/Solo et d’import sont agrandies sur petit écran. Les bordures contrastées et les focus visibles sont conservés.

Les styles et scripts des cinq ateliers sont dans des fichiers séparés. `lab-tools.css` contient les adaptations des deux grilles ; `lab-grid.js` contient leur navigation au clavier. Les URL CSS et JS portent une version dérivée de leur contenu : actualiser cette version après toute modification du fichier concerné.

### Vérification de comportement

Avec Node.js installé :

```sh
node tests/regression.mjs
```

Ces tests exécutent les fonctions du site avec une horloge, un stockage et un lecteur audio simulés. Ils couvrent le tempo (60, 96, 100 et 160 BPM, swing activé/désactivé), l’annulation des indicateurs, les erreurs de sauvegarde, le volume du bip et la navigation clavier. Compléter par les essais d’import, de sauvegarde/restauration, d’export audio et d’affichage dans un navigateur.
