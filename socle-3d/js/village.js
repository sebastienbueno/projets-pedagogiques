// =====================================================================
//  VILLAGE
//  Place les bâtiments KayKit autour de la place (plan dans monde.js),
//  les deux moulins (animés), le champ, les clôtures et les accessoires,
//  et déclare leurs volumes de collision.
// =====================================================================
import * as THREE from 'three';
import { VILLAGE } from './monde.js';
import { ChampInstances } from './vegetation.js';
import { creerAlea } from './bruit.js';

const E = VILLAGE.echelle;
const _boite = new THREE.Box3();
const _v = new THREE.Vector3();

export class Village {
  /**
   * @param {THREE.Group} modeles scène du fichier village.glb
   * @param {import('./terrain.js').Terrain} terrain
   * @param {import('./collisions.js').Collisions} collisions
   */
  constructor(modeles, terrain, collisions) {
    this.modeles = modeles;
    this.terrain = terrain;
    this.collisions = collisions;
    this.groupe = new THREE.Group();
    this.groupe.name = 'village';
    this.animes = [];   // pièces qui tournent : ailes du moulin, roue à aubes
    this.champs = [];

    modeles.traverse((o) => {
      if (o.isMesh) { o.material.roughness = 0.8; this.materiau = o.material; }
    });

    for (const b of VILLAGE.batiments) {
      this.poser(b.modele, VILLAGE.x + b.x, VILLAGE.z + b.z, Math.atan2(-b.x, -b.z));
    }
    // Le puits, au centre de la place.
    this.poser('building_well_red', VILLAGE.x, VILLAGE.z, 0.4, { rond: true });

    this._moulinVent();
    this._moulinEau();
    this._champ();
    this._accessoires();
  }

  /**
   * Pose un modèle au sol et crée sa collision.
   * @param {object} [o] rond : collision circulaire ; sansCollision ; enfonce : mètres sous le sol ; y : altitude imposée
   * @returns {THREE.Object3D}
   */
  poser(nom, x, z, angle, o = {}) {
    const source = this.modeles.getObjectByName(nom);
    if (!source) throw new Error(`Modèle introuvable : ${nom}`);
    const objet = source.clone(true);
    const y = o.y ?? this.terrain.hauteur(x, z) - (o.enfonce ?? 0.12);
    objet.position.set(x, y, z);
    objet.rotation.set(0, angle, 0);
    objet.scale.setScalar(E * (o.echelle ?? 1));
    objet.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    this.groupe.add(objet);

    if (!o.sansCollision) {
      // Boîte englobante du modèle dans son propre repère.
      objet.updateMatrixWorld(true);
      _boite.makeEmpty();
      const inverse = new THREE.Matrix4().copy(objet.matrixWorld).invert();
      objet.traverse((m) => {
        if (!m.isMesh) return;
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld).applyMatrix4(inverse);
        _boite.union(b);
      });
      const ech = objet.scale.x;
      const sommet = y + _boite.max.y * ech;
      if (o.rond) {
        const rayon = Math.max(_boite.max.x - _boite.min.x, _boite.max.z - _boite.min.z) * 0.5 * ech * 0.9;
        this.collisions.ajouterCercle(x, z, rayon, sommet, true);
      } else {
        const demiX = (_boite.max.x - _boite.min.x) * 0.5 * ech * 0.9;
        const demiZ = (_boite.max.z - _boite.min.z) * 0.5 * ech * 0.9;
        // Le centre de la boîte n'est pas forcément l'origine du modèle.
        _v.set((_boite.max.x + _boite.min.x) * 0.5 * ech, 0, (_boite.max.z + _boite.min.z) * 0.5 * ech)
          .applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
        this.collisions.ajouterBoite(x + _v.x, z + _v.z, demiX, demiZ, angle, sommet, true);
      }
    }
    return objet;
  }

  _moulinVent() {
    const x = VILLAGE.x + VILLAGE.moulinVent.x, z = VILLAGE.z + VILLAGE.moulinVent.z;
    const moulin = this.poser('building_windmill_red', x, z, Math.atan2(-VILLAGE.moulinVent.x, -VILLAGE.moulinVent.z), { rond: true, echelle: 1.25 });
    const ailes = moulin.getObjectByName('building_windmill_top_fan_red');
    if (ailes) this.animes.push({ objet: ailes, axe: 'z', vitesse: 0.9 });
  }

  /** Le moulin à eau est posé sur la rive, sa roue trempe dans le ruisseau. */
  _moulinEau() {
    const trace = this.terrain.trace;
    const s = 0.865;
    const centre = trace.point(s);
    // Dans le modèle, la roue est à l'arrière (côté −Z) : le bâtiment tourne donc le dos au
    // ruisseau, et son origine est placée pour que la roue trempe dans le courant.
    const position = trace.point(s, trace.demiLargeur(s) * 0.6 + 0.35);
    const angle = Math.atan2(position.x - centre.x, position.z - centre.z);
    const niveauEau = this.terrain.hauteur(centre.x, centre.z) + 0.32;
    const moulin = this.poser('building_watermill_blue', position.x, position.z, angle, { y: niveauEau + 1.5 });
    const roue = moulin.getObjectByName('building_watermill_wheel_blue');
    if (roue) this.animes.push({ objet: roue, axe: 'z', vitesse: -1.1 });
    this.positionMoulinEau = position.clone().setY(niveauEau + 0.5);
  }

  /** Un champ de blé entouré d'une clôture en bois (avec une ouverture). */
  _champ() {
    const cx = VILLAGE.x + VILLAGE.champ.x, cz = VILLAGE.z + VILLAGE.champ.z;
    this.poser('building_grain', cx, cz, 0, { sansCollision: true, enfonce: 0.05 });
    // Chaque clôture mesure 8,1 m ; dans le modèle, elle est décalée de −1 en x.
    const cote = (fx, fz, angle) => {
      const dx = -Math.cos(angle) * E, dz = Math.sin(angle) * E;     // décalage (−1, 0, 0) × échelle, tourné de `angle`
      const cloture = this.poser('fence_wood_straight', fx - dx, fz - dz, angle, { sansCollision: true, enfonce: 0 });
      cloture.position.y = this.terrain.hauteur(fx, fz) - 0.1;
      this.collisions.ajouterBoite(fx, fz, 0.3, 4.05, angle, cloture.position.y + 2.2, false);
    };
    const L = 8.12;
    for (const k of [-0.5, 0.5]) {
      cote(cx - L, cz + k * L, 0);                    // côté ouest
      cote(cx + L, cz + k * L, 0);                    // côté est
      cote(cx + k * L, cz + L, Math.PI / 2);          // côté sud
    }
    cote(cx - 0.5 * L, cz - L, Math.PI / 2);          // côté nord : une seule clôture, l'autre moitié sert d'entrée
  }

  /** Tonneaux, caisses, sacs... dessinés par groupes (instancing). */
  _accessoires() {
    const alea = creerAlea(12);
    const liste = [
      // près du marché
      ['barrel', -5, 21], ['barrel', -3.4, 22.2], ['crate_A_big', 14, 22], ['crate_B_small', 15.6, 21], ['sack', 12.5, 20.5],
      // près de la taverne
      ['barrel', -20.5, -13], ['barrel', -19, -14.4], ['barrel', -21, 0.5], ['crate_A_big', -22, 2.4],
      // près de la forge
      ['resource_lumber', 22, 17], ['crate_A_big', 23, 2], ['bucket_water', 21.5, 5.5],
      // près des maisons
      ['resource_lumber', -34, 22], ['sack', -22, 21], ['sack', -21.2, 22.4], ['wheelbarrow', -46, 14],
      ['crate_B_small', 16, -30], ['barrel', 30, -16], ['bucket_water', 3.2, 2.2], ['wheelbarrow', -10, 40],
      ['tent', 17, 40], ['crate_A_big', 31, 23], ['sack', -37, -14],
      // drapeaux devant l'église
      ['flag_yellow', -6, -24], ['flag_red', 6, -24],
    ];
    const parModele = new Map();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), e = new THREE.Vector3(E, E, E);
    const haut = new THREE.Vector3(0, 1, 0);
    for (const [nom, rx, rz] of liste) {
      const x = VILLAGE.x + rx, z = VILLAGE.z + rz;
      const y = this.terrain.hauteur(x, z) - 0.03;
      q.setFromAxisAngle(haut, alea() * Math.PI * 2);
      m.compose(p.set(x, y, z), q, e);
      if (!parModele.has(nom)) parModele.set(nom, []);
      parModele.get(nom).push(m.clone());
      if (nom !== 'sack' && nom !== 'bucket_water' && !nom.startsWith('flag')) {
        const rayon = nom === 'resource_lumber' || nom === 'tent' ? 1.7 : nom === 'wheelbarrow' ? 1.2 : 0.75;
        this.collisions.ajouterCercle(x, z, rayon, y + 1.4, false);
      }
    }
    for (const [nom, matrices] of parModele) {
      const source = this.modeles.getObjectByName(nom);
      const champ = new ChampInstances({ geometrie: source.geometry, materiau: this.materiau, matrices, tailleBloc: 400, nom });
      this.champs.push(champ);
      this.groupe.add(champ.groupe);
    }
  }

  mettreAJour(dt, positionCamera, qualite) {
    for (const a of this.animes) a.objet.rotation[a.axe] += a.vitesse * dt;
    for (const c of this.champs) c.mettreAJour(positionCamera, qualite.distanceDetail, qualite.distanceMax * 0.6);
  }
}
