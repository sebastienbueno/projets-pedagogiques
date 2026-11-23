// =====================================================================
//  CAMÉRA À LA TROISIÈME PERSONNE
//  Elle tourne autour du personnage (souris / doigt), le suit en douceur
//  et se rapproche automatiquement pour ne jamais passer sous le terrain
//  ni à travers un bâtiment ou un gros rocher.
// =====================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';

const C = CONFIG.camera;
const _cible = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class CameraSuiveuse {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('./terrain.js').Terrain} terrain
   * @param {import('./collisions.js').Collisions} collisions
   */
  constructor(camera, terrain, collisions) {
    this.camera = camera;
    this.terrain = terrain;
    this.collisions = collisions;
    this.lacet = 0;                 // angle horizontal (0 = caméra au sud du personnage, regardant vers le nord)
    this.tangage = 0.3;             // angle vertical (positif = caméra au-dessus)
    this.distanceVoulue = C.distance;
    this.distance = C.distance;     // distance réelle, après collision
    this.point = new THREE.Vector3();   // point visé, lissé
    this.tempsSansRotation = 10;
    this.initialisee = false;
  }

  /** Place immédiatement la caméra (au départ, après une téléportation). */
  recentrer(position, lacet = this.lacet) {
    this.lacet = lacet;
    this.point.copy(position).y += C.hauteurCible;
    this.distance = this.distanceVoulue;
    this.initialisee = true;
  }

  /**
   * @param {number} dt
   * @param {import('./personnage.js').Personnage} personnage
   * @param {object} commandes { rotX, rotY : rotation demandée (radians), zoom }
   */
  mettreAJour(dt, personnage, commandes) {
    if (!this.initialisee) this.recentrer(personnage.position);

    // --- Rotation demandée par le joueur ---
    if (commandes.rotX !== 0 || commandes.rotY !== 0) this.tempsSansRotation = 0;
    else this.tempsSansRotation += dt;
    this.lacet -= commandes.rotX;
    this.tangage = THREE.MathUtils.clamp(this.tangage + commandes.rotY, -0.5, 1.25);
    this.distanceVoulue = THREE.MathUtils.clamp(this.distanceVoulue * (1 + commandes.zoom), C.distanceMin, C.distanceMax);

    // --- Aide : la caméra revient doucement derrière le personnage quand il avance ---
    if (this.tempsSansRotation > 1.2 && personnage.allure > 1) {
      const derriere = personnage.orientation + Math.PI;
      let ecart = derriere - this.lacet;
      ecart = Math.atan2(Math.sin(ecart), Math.cos(ecart));
      // pas de correction quand le personnage vient vers la caméra (sinon elle ferait demi-tour)
      if (Math.abs(ecart) < 2.4) this.lacet += ecart * (1 - Math.exp(-0.9 * dt));
    }

    // --- Suivi lissé du point visé ---
    _cible.copy(personnage.position);
    _cible.y += C.hauteurCible;
    const k = 1 - Math.exp(-10 * dt);
    this.point.x += (_cible.x - this.point.x) * k;
    this.point.z += (_cible.z - this.point.z) * k;
    this.point.y += (_cible.y - this.point.y) * (1 - Math.exp(-7 * dt));   // plus doux en vertical (sauts)

    // --- Direction du point visé vers la caméra ---
    const ct = Math.cos(this.tangage);
    _dir.set(Math.sin(this.lacet) * ct, Math.sin(this.tangage), Math.cos(this.lacet) * ct);

    // --- Collision : on avance le long du rayon jusqu'au premier obstacle ---
    let libre = this.distanceVoulue;
    const pas = 0.3;
    for (let d = 0.6; d <= this.distanceVoulue + 0.001; d += pas) {
      const x = this.point.x + _dir.x * d;
      const y = this.point.y + _dir.y * d;
      const z = this.point.z + _dir.z * d;
      if (y < this.terrain.hauteur(x, z) + 0.35 || this.collisions.contient(x, y, z)) {
        libre = Math.max(0.7, d - pas);
        break;
      }
    }
    // On se rapproche vite (pour ne pas voir à travers), on recule lentement.
    const vitesse = libre < this.distance ? 22 : 3.5;
    this.distance += (libre - this.distance) * (1 - Math.exp(-vitesse * dt));
    if (this.distance > libre + 0.6) this.distance = libre + 0.6;

    this.camera.position.set(
      this.point.x + _dir.x * this.distance,
      this.point.y + _dir.y * this.distance,
      this.point.z + _dir.z * this.distance,
    );
    // Dernière sécurité : jamais sous le sol.
    const sol = this.terrain.hauteur(this.camera.position.x, this.camera.position.z) + 0.3;
    if (this.camera.position.y < sol) this.camera.position.y = sol;
    this.camera.lookAt(this.point);
  }
}
