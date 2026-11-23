// =====================================================================
//  POINT D'ENTRÉE
//  Assemble les modules du socle : rendu, terrain, eau, végétation, village,
//  personnage, caméra, contrôles, son, interface, qualité adaptative.
//  Pour créer un autre jeu sur ce socle, c'est ce fichier (et monde.js)
//  qu'il faut adapter : les autres modules sont indépendants du scénario.
// =====================================================================
import * as THREE from 'three';
import { CONFIG, QUALITES } from './config.js';
import { Trace, VILLAGE } from './monde.js';
import { Terrain, DISTANCE_SENTIER } from './terrain.js';
import { Eau } from './eau.js';
import { Vegetation, Herbe } from './vegetation.js';
import { Village } from './village.js';
import { Collisions } from './collisions.js';
import { Personnage } from './personnage.js';
import { CameraSuiveuse } from './camera.js';
import { Controles } from './controles.js';
import { Rendu } from './rendu.js';
import { GestionQualite } from './qualite.js';
import { Ambiance } from './audio.js';
import { Interface } from './interface.js';
import { chargerModeles } from './chargement.js';

const parametres = new URLSearchParams(location.search);
const ui = new Interface();

/** Laisse le navigateur afficher la barre de progression entre deux étapes lourdes. */
const souffler = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function demarrer() {
  // ------------------------------------------------------------------
  //  1. Moteur de rendu
  // ------------------------------------------------------------------
  ui.progression(0.03, 'Préparation du moteur 3D…');
  await souffler();
  const canevas = document.getElementById('scene');
  let rendu;
  try {
    rendu = new Rendu(canevas);
  } catch (e) {
    throw new Error('Ce navigateur ne peut pas afficher la 3D (WebGL 2 indisponible). Essaie avec une version récente de Chrome, Edge, Firefox ou Safari.');
  }
  const { scene, camera } = rendu;

  // ------------------------------------------------------------------
  //  2. Modèles
  // ------------------------------------------------------------------
  ui.progression(0.06, 'Chargement des modèles…');
  const modeles = await chargerModeles({
    personnage: CONFIG.personnage.fichier,
    nature: CONFIG.fichiers.nature,
    village: CONFIG.fichiers.village,
  }, (f) => ui.progression(0.06 + 0.44 * f));

  // ------------------------------------------------------------------
  //  3. Monde
  // ------------------------------------------------------------------
  ui.progression(0.52, 'Sculpture de la montagne…');
  await souffler();
  const trace = new Trace();
  const terrain = new Terrain(trace).construire();
  scene.add(terrain.groupe);
  const collisions = new Collisions();

  ui.progression(0.66, 'Le ruisseau se met à couler…');
  await souffler();
  const eau = new Eau(trace, terrain);
  scene.add(eau.groupe);

  ui.progression(0.72, 'Plantation de la forêt…');
  await souffler();
  const vegetation = new Vegetation(modeles.nature.scene, terrain, collisions, eau);
  scene.add(vegetation.groupe);
  const herbe = new Herbe(terrain);
  scene.add(herbe.maillage);

  ui.progression(0.84, 'Construction du village…');
  await souffler();
  const village = new Village(modeles.village.scene, terrain, collisions);
  scene.add(village.groupe);

  // ------------------------------------------------------------------
  //  4. Personnage, caméra, contrôles
  // ------------------------------------------------------------------
  const personnage = new Personnage(modeles.personnage, terrain, collisions);
  scene.add(personnage.racine);

  // Ombre ronde de secours, affichée quand les vraies ombres sont coupées (qualité basse).
  const ombreRonde = creerOmbreRonde();
  scene.add(ombreRonde);

  const cameraSuiveuse = new CameraSuiveuse(camera, terrain, collisions);
  const controles = new Controles(canevas, {
    joystick: document.getElementById('joystick'),
    manette: document.getElementById('manette'),
    boutonSaut: document.getElementById('bouton-saut'),
    boutonCourse: document.getElementById('bouton-course'),
  });
  controles.surPremierGeste = () => ui.aide(true);

  /** Place le personnage près de la source, tourné vers la vallée. */
  function allerALaSource() {
    const depart = trace.point(0.022, DISTANCE_SENTIER - 3);
    const t = trace.courbe.getTangentAt(0.03, new THREE.Vector3());
    const orientation = Math.atan2(t.x, t.z);
    personnage.teleporter(depart.x, depart.z, orientation);
    // La caméra regarde en travers du ruisseau : la source d'un côté, la vallée de l'autre.
    cameraSuiveuse.tangage = 0.3;
    cameraSuiveuse.distanceVoulue = CONFIG.camera.distance;
    cameraSuiveuse.recentrer(personnage.position, orientation - Math.PI / 2 + 0.5);
    arrive = false;
  }
  let arrive = false;

  const position = parametres.get('pos');
  allerALaSource();
  if (position) {
    const [x, z] = position.split(',').map(Number);
    personnage.teleporter(x, z);
    cameraSuiveuse.recentrer(personnage.position);
  }

  // ------------------------------------------------------------------
  //  5. Qualité
  // ------------------------------------------------------------------
  let qualite = QUALITES.moyen;
  const gestion = new GestionQualite(
    (q) => {
      qualite = q;
      rendu.appliquerQualite(q);
      herbe.regler(q.herbe, q.rayonHerbe);
      vegetation.nuages.visible = q.nuages;
      ombreRonde.visible = q.ombres === 0;
      eau.redimensionner(rendu.hauteurImage);
    },
    (echelle) => { rendu.reglerEchelle(echelle); eau.redimensionner(rendu.hauteurImage); },
  );
  const texteQualite = () => {
    const pourcent = Math.round(gestion.echelle * 100);
    return `${QUALITES[gestion.niveau].nom}${gestion.mode === 'auto' ? ' (auto)' : ''}${pourcent < 100 ? ` · résolution ${pourcent} %` : ''}`;
  };
  gestion.surChangement = () => ui.marquerQualite(gestion.mode, `Niveau actuel : ${texteQualite()}`);
  const qualiteDemandee = parametres.get('qualite');
  if (qualiteDemandee === 'auto' || QUALITES[qualiteDemandee]) gestion.choisir(qualiteDemandee, false);
  gestion.demarrer();

  // ------------------------------------------------------------------
  //  6. Son et menu
  // ------------------------------------------------------------------
  const ambiance = new Ambiance(camera);
  ui.brancher({
    qualite: (mode) => gestion.choisir(mode),
    son: (actif) => ambiance.couper(!actif),
    volume: (v) => ambiance.reglerVolume(v),
    retour: () => allerALaSource(),
  }, gestion.mode);
  ui.surMenu = (ouvert) => { controles.actif = enJeu && !ouvert; };
  if (parametres.get('fps') === '1') ui.afficherFps(true);

  window.addEventListener('resize', () => { rendu.redimensionner(); eau.redimensionner(rendu.hauteurImage); });
  document.addEventListener('visibilitychange', () => {
    ambiance.suspendre(document.hidden);
    gestion.ignorerProchaineImage();
  });

  // ------------------------------------------------------------------
  //  7. Boucle de jeu
  // ------------------------------------------------------------------
  let enJeu = false;
  let temps = 0;
  let precedent = performance.now();
  let tempsDetail = 1;
  const infos = rendu.renderer.info;

  /** Fait avancer le monde de dt secondes (sans dessiner). */
  function simuler(dt) {
    temps += dt;
    const commandes = controles.lire();
    personnage.mettreAJour(dt, commandes, cameraSuiveuse.lacet);
    cameraSuiveuse.mettreAJour(dt, personnage, commandes);

    eau.mettreAJour(temps);
    herbe.mettreAJour(temps, personnage.position, camera.position);
    village.mettreAJour(dt, camera.position, qualite);
    // Les niveaux de détail de la végétation n'ont pas besoin d'être recalculés à chaque image.
    tempsDetail += dt;
    if (tempsDetail > 0.2) {
      vegetation.mettreAJour(tempsDetail, temps, camera.position, qualite);
      tempsDetail = 0;
    } else {
      vegetation.temps.value = temps;
    }
    rendu.suivreOmbres(personnage.position);
    if (ombreRonde.visible) {
      const sol = terrain.hauteur(personnage.position.x, personnage.position.z);
      ombreRonde.position.set(personnage.position.x, sol + 0.06, personnage.position.z);
      const hauteur = Math.max(0, personnage.position.y - sol);
      ombreRonde.scale.setScalar(Math.max(0.4, 1 - hauteur * 0.25));
    }
    ambiance.mettreAJour(dt, trace);

    // Arrivée au village.
    if (!arrive && Math.hypot(personnage.position.x - VILLAGE.x, personnage.position.z - VILLAGE.z) < VILLAGE.rayonPlace + 12) {
      arrive = true;
      ui.message('¡Has llegado al pueblo!', 'Tu es arrivé au village.', 7);
      personnage.celebrer();
    }
  }

  function image(maintenant) {
    requestAnimationFrame(image);
    const dtReel = (maintenant - precedent) / 1000;
    precedent = maintenant;
    if (enJeu && !document.hidden) gestion.mesurer(dtReel);
    simuler(Math.min(dtReel, 0.1));
    rendu.rendre(Math.min(dtReel, 0.1));
    ui.majFps(dtReel, gestion.fps, texteQualite(),
      `${infos.render.calls} appels · ${(infos.render.triangles / 1000).toFixed(0)} k triangles`);
  }

  // ------------------------------------------------------------------
  //  8. Préparation finale, puis attente du clic sur « Jouer »
  // ------------------------------------------------------------------
  ui.progression(0.92, 'Derniers réglages…');
  await souffler();
  simuler(0.016);
  await rendu.precompiler();
  rendu.rendre(0.016);
  ui.progression(1);
  requestAnimationFrame((t) => { precedent = t; image(t); });

  // Accès pour le débogage et les tests automatiques (console du navigateur : __socle).
  window.__socle = {
    rendu, terrain, trace, eau, vegetation, village, personnage, cameraSuiveuse, controles, gestion, collisions, simuler,
    pret: true,
  };

  await ui.attendreJouer();
  enJeu = true;
  controles.actif = true;
  const emetteurs = ambiance.demarrer(eau, village.positionMoulinEau);
  if (emetteurs) scene.add(emetteurs);
  ui.message('Sigue el arroyo hasta el pueblo', 'Suis le ruisseau jusqu\'au village.', 7);
  ui.aide(controles.tactile || matchMedia('(pointer: coarse)').matches);
}

/** Petit disque sombre et flou posé sous le personnage. */
function creerOmbreRonde() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const degrade = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  degrade.addColorStop(0, 'rgba(0,0,0,0.55)');
  degrade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = degrade;
  g.fillRect(0, 0, 64, 64);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  mesh.name = 'ombre-ronde';
  mesh.renderOrder = 1;
  mesh.userData.sansOcclusion = true;
  return mesh;
}

demarrer().catch((erreur) => {
  console.error(erreur);
  ui.erreur(erreur.message || String(erreur));
});
