# Beat Lab 808

Beat Lab est un petit studio musical autonome publié avec GitHub Pages : boîte à rythmes, séquenceur de samples, découpeur et effets. Aucun framework ni dépendance externe.

## Outils

- `index.html` — boîte à rythmes 8 voix et 16 pas avec deux kits. Le kit TR-808 emploie un clap synthétisé en rafales de bruit filtré et une courte réverbération; le kit Industriel joue le sample `industrial-clap.wav`, avec tuning par demi-tons. Chaque voix a ses boutons Mute, Solo et effacement du motif. Son motif, le kit, le tempo et le swing sont mémorisés dans le navigateur.
- `sequencer.html` — séquenceur de samples 8 pistes / 32 pas, boucles de 8, 16 ou 32 pas, swing, volume, panoramique, Mute et Solo indépendants par piste, ainsi que filtre passe-bas, saturation, écho et réverbération par piste.
- `samples.html` — lecteur et découpeur local de samples, forme d’onde, écoute et export WAV.
- `effects.html` — impression hors ligne des effets dans un WAV; fichier limité à 2 minutes pour éviter une surcharge mémoire. Les effets temps réel par piste sont dans le séquenceur.

## Sauvegarde locale

Le séquenceur enregistre automatiquement les motifs, réglages de mixage (volume, panoramique, Mute, Solo), effets et samples que tu importes dans le stockage local du navigateur (IndexedDB et stockage local). Ils sont conservés quand tu navigues vers un autre outil puis reviens, sur le même navigateur et le même appareil. Les fichiers que tu importes ne sont pas envoyés sur GitHub. Effacer les données du site dans le navigateur efface aussi ces samples.

## Ancien échantillon archivé

`clap-real.wav` est conservé dans le dépôt comme ancienne ressource, mais n'est plus chargé ni utilisé par les kits. Le clap Industriel utilise désormais le fichier audio fourni pour ce projet, `industrial-clap.wav`.

## Mise à jour sur GitHub Pages

Décompresse l’archive du site et téléverse les fichiers à la racine du dépôt `IzzyAsHTn/beat-lab-808`. Pour cette mise à jour, remplace `index.html` et `README.md` et ajoute `industrial-clap.wav`. Valide avec **Commit changes**, puis attends le déploiement Pages.
