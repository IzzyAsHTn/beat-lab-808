# Beat Lab 808

Beat Lab est un petit studio musical autonome publié avec GitHub Pages : boîte à rythmes, séquenceur de samples, découpeur et effets. Aucun framework ni dépendance externe.

## Outils

- `index.html` — boîte à rythmes 8 voix et 16 pas avec deux kits synthétisés, TR-808 classique et Organique numérique. Les voix sont kick, snare, clap, charley fermé, charley ouvert, tom grave, tom aigu et cowbell. Son motif, le kit, le tempo et le swing sont mémorisés dans le navigateur.
- `sequencer.html` — séquenceur de samples 8 pistes / 32 pas, boucles de 8, 16 ou 32 pas, swing, volume et panoramique indépendants, ainsi que filtre passe-bas, saturation, écho et réverbération par piste.
- `samples.html` — lecteur et découpeur local de samples, forme d’onde, écoute et export WAV.
- `effects.html` — impression hors ligne des effets dans un WAV; fichier limité à 2 minutes pour éviter une surcharge mémoire. Les effets temps réel par piste sont dans le séquenceur.

## Sauvegarde locale

Le séquenceur enregistre automatiquement les motifs, réglages de mixage, effets et samples dans le stockage local du navigateur (IndexedDB et stockage local). Ils sont conservés quand tu navigues vers un autre outil puis reviens, sur le même navigateur et le même appareil. Les fichiers audio ne sont pas envoyés sur GitHub. Effacer les données du site dans le navigateur efface aussi ces samples.

## Mise à jour sur GitHub Pages

Décompresse l’archive du site et téléverse les fichiers à la racine du dépôt `IzzyAsHTn/beat-lab-808`. Pour cette mise à jour, remplace `index.html`, `sequencer.html`, `effects.html` et `README.md`; tu peux aussi re-téléverser `samples.html` pour garder les cinq fichiers identiques à l’archive. Valide avec **Commit changes**, puis attends le déploiement Pages.
