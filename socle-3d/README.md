# Socle 3D — « Del manantial al pueblo »

Démo technique 3D jouable dans le navigateur : un personnage descend d'une source de montagne
jusqu'au village en suivant le ruisseau. Elle sert de **socle réutilisable** pour de futurs jeux
pédagogiques d'espagnol (collège). Rien à installer côté élève : une page web, hors ligne possible.

- Three.js r187 (WebGL2), fourni dans `vendor/` : aucun appel à un serveur extérieur.
- Site statique, **sans étape de build** : compatible GitHub Pages tel quel.
- Assets 100 % CC0 (voir [`assets/CREDITS.md`](assets/CREDITS.md)), le reste est procédural.

## Lancer en local

Les modules JavaScript ne se chargent pas en ouvrant le fichier directement (`file://`) :
il faut un petit serveur web. Depuis ce dossier :

```
python3 -m http.server 8000
```

puis ouvrir <http://localhost:8000/>. (Ou, dans VS Code, l'extension « Live Server ».)

Paramètres d'adresse utiles : `?fps=1` (compteur affiché), `?qualite=bas|moyen|eleve|auto`,
`?pos=x,z` (point de départ, par exemple `?pos=28,190` pour arriver près du village).

## Commandes

| | Clavier + souris | Tablette |
|---|---|---|
| Se déplacer | flèches ou ZQSD / WASD | joystick sous le pouce gauche |
| Courir | Maj | pousser le joystick à fond, ou bouton ▶▶ |
| Sauter | Espace | bouton ↑ |
| Regarder | cliquer-glisser, molette pour le zoom | glisser sur la moitié droite |
| Réglages / compteur d'images | Échap (ou P) / F | bouton ☰ |

## Publier sur GitHub Pages

Le dépôt est déjà publié par GitHub Pages (fichier `.nojekyll` à la racine) : une fois ce dossier
fusionné dans la branche publiée, la démo est en ligne à
`https://<utilisateur>.github.io/projets-pedagogiques/socle-3d/`.

Pour un nouveau dépôt : *Settings → Pages → Build and deployment → Deploy from a branch*,
choisir la branche et le dossier `/ (root)`, enregistrer. Tous les chemins sont relatifs :
le dossier `socle-3d/` peut être renommé ou copié ailleurs sans rien modifier.

## Organisation du code

Tout est commenté en français. Chaque module ne s'occupe que d'un sujet.

| Fichier | Rôle |
|---|---|
| `js/config.js` | Réglages du jeu et niveaux de qualité (bas / moyen / élevé) |
| `js/monde.js` | Plan du monde : tracé du ruisseau, village, étang |
| `js/terrain.js` | Relief, matériau du sol, altitude en tout point (physique) |
| `js/eau.js` | Ruisseau, étang, source : géométrie et shader d'eau |
| `js/vegetation.js` | Instancing avec niveaux de détail (`ChampInstances`), arbres, rochers, herbe |
| `js/village.js` | Bâtiments, moulins animés, accessoires, collisions |
| `js/personnage.js` | Modèle animé + contrôleur physique |
| `js/camera.js` | Caméra à la troisième personne avec anti-traversée |
| `js/controles.js` | Clavier, souris, joystick tactile |
| `js/collisions.js` | Obstacles (cercles et rectangles) rangés dans une grille |
| `js/rendu.js` | Moteur, ciel physique, soleil et ombres, post-traitement |
| `js/qualite.js` | Qualité adaptative selon les images/seconde |
| `js/audio.js` | Sons d'eau et de vent spatialisés (synthétisés) |
| `js/interface.js` | Chargement, menu, compteur, messages |
| `js/main.js` | Assemblage et boucle de jeu |

**Faire un autre jeu sur ce socle** : copier le dossier, puis modifier `monde.js` (le plan),
`config.js` (les réglages) et `main.js` (le scénario : messages, zones, objectifs).
Dans la console du navigateur, l'objet `__socle` donne accès à tous les modules.
`outils/preparer-assets.mjs` montre comment convertir d'autres modèles KayKit en GLB.

## Performance

- Mode **auto** par défaut : départ en « moyen » ; si les images/seconde passent sous 50, la
  résolution baisse, puis le niveau (ombres, post-traitement, herbe, distance d'affichage) ;
  si elles restent à 57 ou plus pendant 9 s, la qualité remonte. Un niveau qui échoue deux fois
  n'est plus retenté.
- Réglage manuel et compteur dans le menu ☰ (le choix manuel est mémorisé sur l'appareil).
- Végétation et rochers en instancing par blocs, modèle simplifié au loin, masquage au-delà
  d'une distance ; herbe à coût constant (un tapis qui suit le joueur, calculé par la carte graphique).

## Vérifications faites

Dans Chromium (rendu logiciel, sans carte graphique) :

- aucune erreur ni avertissement en console, aux trois niveaux de qualité ;
- trajet automatique source → place du village avec la vraie physique : 82 s en courant par le
  sentier, 105 s par le lit du ruisseau ;
- le mode auto réduit bien la qualité quand l'affichage est lent ;
- joystick tactile en émulation de tablette.

**Non vérifié** : les 60 images/seconde sur un vrai ordinateur de collège et sur une vraie tablette
(je n'ai pas de carte graphique ici), ainsi que le son à l'oreille. C'est le premier test à faire.

## Ce qu'il reste à améliorer

- Mesurer sur le matériel réel et ajuster `QUALITES` dans `config.js` (c'est fait pour ça).
- La physique est volontairement simple : on ne peut pas monter sur les rochers, les toits ou un
  pont ; pas de nage (l'étang se traverse à pied).
- Le son est synthétisé : de vrais enregistrements CC0 seraient plus naturels.
- Sol sans textures photographiques (Poly Haven n'était pas accessible depuis l'environnement de
  travail) : couleurs et bruit procéduraux, cohérents avec le style « low-poly » des modèles.
- Le personnage pèse 2,3 Mo : une compression Meshopt/Draco le réduirait nettement.
- Pas de manette de jeu, pas de sauvegarde, pas encore de contenu pédagogique (dialogues,
  panneaux, quêtes de vocabulaire) : c'est l'étape suivante.
