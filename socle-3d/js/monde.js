// =====================================================================
//  PLAN DU MONDE
//  Ce fichier ne contient que des données et de la géométrie « sur plan » :
//  le tracé du ruisseau, l'emplacement du village, de l'étang, des routes.
//  Le terrain, l'eau, la végétation et le village s'appuient tous dessus,
//  ce qui garantit qu'ils restent cohérents entre eux.
//  Repère : x vers l'est, z vers le sud, y vers le haut. Unités : mètres.
// =====================================================================
import * as THREE from 'three';
import { lisse } from './bruit.js';

/** Points de passage du ruisseau, de la source (au nord, en altitude) à l'étang (au sud). */
export const POINTS_RUISSEAU = [
  [-30, -236], [-46, -196], [-16, -152], [-50, -102], [-12, -56],
  [26, -10], [-4, 40], [-40, 84], [-6, 124], [50, 148], [88, 182], [98, 214], [100, 236],
];

export const ALTITUDE_SOURCE = 78;   // altitude du lit à la source
export const ALTITUDE_VALLEE = 4;    // altitude du lit à l'arrivée dans l'étang

export const ETANG = { x: 100, z: 240, rayon: 22 };

/** Le village : centre de la place et disposition des bâtiments (positions relatives au centre). */
export const VILLAGE = {
  x: 28, z: 200,
  rayon: 50,            // rayon de la zone aplanie
  rayonPlace: 13,
  echelle: 7,           // les modèles KayKit sont des miniatures : on les agrandit
  // modele = nom du modèle dans village.glb ; « vers » = le bâtiment regarde la place (true) ou un angle donné
  batiments: [
    { modele: 'building_church_blue', x: 0, z: -31 },
    { modele: 'building_tavern_red', x: -27, z: -7 },
    { modele: 'building_market_yellow', x: 5, z: 27 },
    { modele: 'building_blacksmith_green', x: 28, z: 9 },
    { modele: 'building_home_A_red', x: -22, z: -27 },
    { modele: 'building_home_B_yellow', x: 22, z: -25 },
    { modele: 'building_home_A_blue', x: -28, z: 15 },
    { modele: 'building_home_B_green', x: -15, z: 33 },
    { modele: 'building_home_A_yellow', x: 25, z: 30 },
    { modele: 'building_home_B_red', x: 37, z: -9 },
    { modele: 'building_home_B_blue', x: -43, z: -22 },
    { modele: 'building_home_A_green', x: -45, z: 4 },
    { modele: 'building_home_A_red', x: -36, z: 37 },
    { modele: 'building_home_B_yellow', x: -14, z: -47 },
    { modele: 'building_home_A_blue', x: 13, z: -48 },
  ],
  moulinVent: { x: -62, z: -34 },
  champ: { x: -60, z: 22 },
  // Rues en terre battue (segments [x1, z1, x2, z2] relatifs au centre)
  rues: [
    [0, 0, 0, -24], [0, 0, -40, 0], [0, 0, 0, 22], [0, 0, 24, 4],
    [-40, 0, -56, -26], [0, -24, -14, -40], [0, -24, 14, -40],
  ],
};

const _v = new THREE.Vector3();

/**
 * Le tracé du ruisseau : une courbe lisse échantillonnée régulièrement.
 * Fournit le profil d'altitude (toujours descendant) et la distance d'un point au ruisseau.
 */
export class Trace {
  constructor() {
    this.courbe = new THREE.CatmullRomCurve3(
      POINTS_RUISSEAU.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    this.longueur = this.courbe.getLength();

    // Échantillons espacés d'environ 3 m : assez fin pour mesurer les distances.
    this.n = Math.ceil(this.longueur / 3);
    const points = this.courbe.getSpacedPoints(this.n - 1);
    this.px = new Float32Array(this.n);
    this.pz = new Float32Array(this.n);
    this.pH = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.px[i] = points[i].x;
      this.pz[i] = points[i].z;
      this.pH[i] = this.profil(i / (this.n - 1));
    }
  }

  /**
   * Altitude du lit en fonction de l'avancement s (0 = source, 1 = étang).
   * La pente est forte en haut puis s'adoucit ; trois ressauts forment de petites cascades.
   * La fonction est strictement décroissante : l'eau ne remonte jamais.
   */
  profil(s) {
    const marches = lisse(0.17, 0.2, s) + lisse(0.40, 0.43, s) + lisse(0.60, 0.63, s);
    const f = 0.7 * (1 - Math.pow(1 - s, 1.6)) + 0.1 * marches;
    return ALTITUDE_VALLEE + (ALTITUDE_SOURCE - ALTITUDE_VALLEE) * (1 - f);
  }

  /** Demi-largeur du ruisseau : il s'élargit en descendant. */
  demiLargeur(s) {
    return 1.25 + 1.5 * s;
  }

  /** Point du ruisseau à l'avancement s, éventuellement décalé latéralement (cote > 0 = rive droite). */
  point(s, decalage = 0, cible = new THREE.Vector3()) {
    s = Math.min(1, Math.max(0, s));
    this.courbe.getPointAt(s, cible);
    if (decalage !== 0) {
      this.courbe.getTangentAt(s, _v);
      cible.x += -_v.z * decalage;
      cible.z += _v.x * decalage;
    }
    return cible;
  }

  /**
   * Analyse un point (x, z) par rapport au ruisseau. Remplit `r` avec :
   *  d    : distance au ruisseau ;
   *  s    : avancement du point du ruisseau le plus proche (0 → 1) ;
   *  cote : +1 sur la rive droite (en regardant vers l'aval), −1 sur la rive gauche ;
   *  H    : altitude « de référence » du relief, moyenne des altitudes du lit pondérée
   *         par la proximité (elle vaut l'altitude du lit quand on est dans le ruisseau).
   */
  evaluer(x, z, r) {
    const { px, pz, pH, n } = this;
    let meilleur = 0, d2min = Infinity, sommeP = 0, sommeH = 0;
    for (let i = 0; i < n; i++) {
      const dx = x - px[i], dz = z - pz[i];
      const d2 = dx * dx + dz * dz;
      if (d2 < d2min) { d2min = d2; meilleur = i; }
      const p = 1 / ((d2 + 16) * (d2 + 16));
      sommeP += p;
      sommeH += p * pH[i];
    }
    r.H = sommeH / sommeP;

    // Distance précise : on projette le point sur les deux segments voisins.
    let dMin = Infinity, sMin = 0, coteMin = 1;
    for (let i = Math.max(0, meilleur - 1); i < Math.min(n - 1, meilleur + 1); i++) {
      const ax = px[i], az = pz[i];
      const bx = px[i + 1] - ax, bz = pz[i + 1] - az;
      const l2 = bx * bx + bz * bz;
      let t = ((x - ax) * bx + (z - az) * bz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = x - (ax + bx * t), qz = z - (az + bz * t);
      const d = Math.sqrt(qx * qx + qz * qz);
      if (d < dMin) {
        dMin = d;
        sMin = (i + t) / (n - 1);
        coteMin = bx * qz - bz * qx >= 0 ? 1 : -1;
      }
    }
    r.d = dMin;
    r.s = sMin;
    r.cote = coteMin;
    return r;
  }
}

/** Distance d'un point à un segment (dans le plan). */
export function distanceSegment(x, z, x1, z1, x2, z2) {
  const bx = x2 - x1, bz = z2 - z1;
  let t = ((x - x1) * bx + (z - z1) * bz) / (bx * bx + bz * bz);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (x1 + bx * t), z - (z1 + bz * t));
}
