# Crédits des ressources

Toutes les ressources de ce dossier sont sous licence **CC0 1.0** (domaine public) :
elles peuvent être réutilisées, modifiées et publiées sans condition ni mention obligatoire.
Texte de la licence : <https://creativecommons.org/publicdomain/zero/1.0/deed.fr>

| Fichier | Contenu | Source | Auteur | Licence |
|---|---|---|---|---|
| `modeles/personnage.glb` | Personnage « Rogue » riggé, 10 animations conservées (Idle, Walking_A, Running_A, Jump_Start, Jump_Idle, Jump_Land, Cheer, Interact, PickUp, Sit_Floor_Idle), armes retirées | *KayKit – Character Pack : Adventurers 1.0* — <https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0> (page du pack : <https://kaylousberg.itch.io/kaykit-adventurers>) | Kay Lousberg (www.kaylousberg.com) | CC0 |
| `modeles/nature.glb` | Sapins (`tree_single_A`, `tree_single_B`), rochers (`rock_single_A` à `E`), pitons (`mountain_A` à `C`), nuages (`cloud_big`, `cloud_small`) | *KayKit – Medieval Hexagon Pack 1.0* — <https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0> (page du pack : <https://kaylousberg.itch.io/kaykit-medieval-hexagon>) | Kay Lousberg | CC0 |
| `modeles/village.glb` | Maisons A et B (rouge, bleu, vert, jaune), taverne, église, marché, puits, forge, moulin à vent, moulin à eau, clôtures, champ, tonneau, caisses, sac, brouette, seau, bois, tente, drapeaux | *KayKit – Medieval Hexagon Pack 1.0* (même dépôt) | Kay Lousberg | CC0 |

Les fichiers d'origine (glTF + textures) ont été convertis en GLB et regroupés avec
[glTF-Transform](https://gltf-transform.dev) ; le script utilisé est `outils/preparer-assets.mjs`.

## Ce qui n'est pas un fichier

Le reste du décor est **procédural**, calculé par le code au chargement : aucune ressource externe.

- relief, couleurs du sol, herbe : `js/terrain.js`, `js/vegetation.js` ;
- eau (vaguelettes, écume, gouttelettes) : `js/eau.js`, `js/bruit.js` ;
- ciel physique et éclairage d'ambiance : module `Sky` de three.js (`js/rendu.js`) ;
- sons d'eau et de vent : synthétisés avec l'API Web Audio (`js/audio.js`).

## Code tiers

- **three.js r187** (`vendor/three/`) — licence MIT, © three.js authors — <https://threejs.org>.
  `build/three.module.min.js` est la version officielle du paquet npm `three@0.187.0`, minifiée ;
  `addons/` contient les seuls modules utilisés, copiés tels quels.
