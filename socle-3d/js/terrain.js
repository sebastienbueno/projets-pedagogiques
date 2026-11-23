// =====================================================================
//  TERRAIN
//  Le relief est une fonction mathématique h(x, z) construite autour du
//  ruisseau : on part de l'altitude du lit, puis on ajoute les versants,
//  les crêtes et un cirque de montagnes. Avantages : l'eau descend toujours,
//  et il existe toujours un chemin praticable de la source au village.
//
//  Trois maillages partagent le même matériau :
//   1. le terrain principal (grille de 3 m) ;
//   2. une bande fine le long du ruisseau (lit, berges, sentier), car une
//      grille de 3 m est trop grossière pour dessiner un lit de 3 m de large ;
//   3. un anneau de montagnes lointaines, très peu détaillé (décor de fond).
// =====================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { fbm, cretes, lisse, melange, creerTextureBruit } from './bruit.js';
import { VILLAGE, ETANG, distanceSegment } from './monde.js';

const DEMI_BANDE = 12;        // demi-largeur de la bande fine le long du ruisseau
const DISTANCE_SENTIER = 9;   // le sentier longe la rive droite à cette distance
const FIN_SENTIER = 0.8;      // avancement où le sentier quitte le ruisseau pour le village

const _i = { d: 0, s: 0, cote: 1, H: 0 };

export class Terrain {
  /** @param {import('./monde.js').Trace} trace */
  constructor(trace) {
    this.trace = trace;
    this.taille = CONFIG.monde.taille;
    this.segments = CONFIG.monde.segments;
    this.pas = this.taille / this.segments;

    // Altitude de la place du village : un peu au-dessus du ruisseau voisin.
    trace.evaluer(VILLAGE.x, VILLAGE.z, _i);
    this.altitudeVillage = trace.profil(_i.s) + 1.6;
    // Niveau de l'eau de l'étang (fin du ruisseau).
    this.niveauEtang = trace.profil(1) - 0.4;

    // Route qui relie la fin du sentier à la place du village.
    const p = trace.point(FIN_SENTIER, DISTANCE_SENTIER);
    this.routes = VILLAGE.rues.map(([a, b, c, d]) => [VILLAGE.x + a, VILLAGE.z + b, VILLAGE.x + c, VILLAGE.z + d]);
    this.routes.push([p.x, p.z, VILLAGE.x + 14, VILLAGE.z - 40]);

    this.groupe = new THREE.Group();
    this.groupe.name = 'terrain';
    this.materiau = this._creerMateriau();
  }

  // -------------------------------------------------------------------
  //  Fonction de relief
  // -------------------------------------------------------------------

  /** Altitude exacte (fonction mathématique). `info` doit déjà contenir trace.evaluer(x, z). */
  _relief(x, z, info, avecLit) {
    const d = info.d;
    const n1 = fbm(x * 0.006 + 3.1, z * 0.006 + 7.7, 3, 5);

    // Versants de la vallée : plus on s'éloigne du ruisseau, plus on monte.
    let h = info.H + Math.pow(lisse(3, 190, d), 1.2) * (26 + 44 * n1);
    // Crêtes rocheuses, de plus en plus marquées avec l'altitude.
    const altitude = Math.min(1, Math.max(0, (h - 10) / 120));
    h += (cretes(x * 0.009, z * 0.009, 4, 9) - 0.38) * lisse(8, 100, d) * (5 + 17 * altitude);
    // Petites bosses.
    h += (fbm(x * 0.045, z * 0.045, 3, 21) - 0.5) * 1.8 * lisse(2, 14, d);
    // Sommet derrière la source (au nord).
    h += lisse(-175, -335, z) * 55 * lisse(10, 85, d);
    // Cirque de montagnes qui ferme le monde.
    h += lisse(280, 360, Math.hypot(x, z)) * (40 + 40 * n1);

    // Replat du village (il s'incline doucement vers le ruisseau).
    const dv = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
    const pv = 1 - lisse(VILLAGE.rayon, VILLAGE.rayon + 55, dv);
    if (pv > 0) {
      const cible = melange(info.H + 0.35, this.altitudeVillage, lisse(5, 26, d));
      h = melange(h, cible + (h - cible) * 0.05, pv);
    }

    // Cuvette de l'étang.
    const de = Math.hypot(x - ETANG.x, z - ETANG.z);
    const pe = 1 - lisse(ETANG.rayon, ETANG.rayon + 22, de);
    if (pe > 0) {
      h = melange(h, this.niveauEtang + 0.5, pe);
      h -= 1.75 * (1 - lisse(ETANG.rayon * 0.4, ETANG.rayon, de));
    }

    // Lit du ruisseau creusé dans le sol.
    if (avecLit) {
      const l = this.trace.demiLargeur(info.s);
      h -= 0.75 * (1 - lisse(0.55 * l, 1.35 * l, d));
    }
    return h;
  }

  /** Proportion de terre battue (berges, sentier, place, rues) en un point : 0 → 1. */
  _terre(x, z, info) {
    const l = this.trace.demiLargeur(info.s);
    let t = 1 - lisse(l * 1.15, l * 1.15 + 2.2, info.d);
    if (info.cote > 0) {
      const bouts = lisse(0.0, 0.03, info.s) * (1 - lisse(FIN_SENTIER - 0.01, FIN_SENTIER + 0.01, info.s));
      t = Math.max(t, (1 - lisse(1.0, 2.3, Math.abs(info.d - DISTANCE_SENTIER))) * bouts);
    }
    const dv = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
    if (dv < 140) {
      t = Math.max(t, 1 - lisse(VILLAGE.rayonPlace - 2, VILLAGE.rayonPlace + 2, dv));
      for (const r of this.routes) {
        t = Math.max(t, 1 - lisse(1.5, 3.2, distanceSegment(x, z, r[0], r[1], r[2], r[3])));
      }
    }
    return t;
  }

  // -------------------------------------------------------------------
  //  Construction
  // -------------------------------------------------------------------

  /** Calcule la grille d'altitudes et crée les trois maillages. */
  construire() {
    const n = this.segments + 1;
    const moitie = this.taille / 2;
    this.grille = new Float32Array(n * n);
    const terre = new Float32Array(n * n);

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -moitie + i * this.pas;
        const z = -moitie + j * this.pas;
        this.trace.evaluer(x, z, _i);
        // Sous la bande fine, la grille est abaissée pour ne jamais dépasser.
        this.grille[j * n + i] = this._relief(x, z, _i, false) - 1.3 * (1 - lisse(8, DEMI_BANDE - 0.5, _i.d));
        terre[j * n + i] = this._terre(x, z, _i);
      }
    }

    // --- Maillage principal ---
    const positions = new Float32Array(n * n * 3);
    const normales = new Float32Array(n * n * 3);
    const masques = new Float32Array(n * n * 2);   // x : terre battue, y : densité d'herbe
    const g = this.grille;
    const lire = (i, j) => g[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const x = -moitie + i * this.pas;
        const z = -moitie + j * this.pas;
        positions[k * 3] = x;
        positions[k * 3 + 1] = g[k];
        positions[k * 3 + 2] = z;
        const nx = lire(i - 1, j) - lire(i + 1, j);
        const nz = lire(i, j - 1) - lire(i, j + 1);
        const ny = 2 * this.pas;
        const l = Math.hypot(nx, ny, nz);
        normales[k * 3] = nx / l;
        normales[k * 3 + 1] = ny / l;
        normales[k * 3 + 2] = nz / l;
        masques[k * 2] = terre[k];
        // L'herbe pousse sur les pentes douces, sous la limite des neiges, hors des chemins.
        const pente = 1 - ny / l;
        const bord = 1 - lisse(300, 330, Math.hypot(x, z));
        masques[k * 2 + 1] = (1 - lisse(0.16, 0.3, pente)) * (1 - lisse(96, 116, g[k])) * bord;
      }
    }
    const indices = new Uint32Array(this.segments * this.segments * 6);
    let q = 0;
    for (let j = 0; j < this.segments; j++) {
      for (let i = 0; i < this.segments; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        indices[q++] = a; indices[q++] = c; indices[q++] = b;
        indices[q++] = b; indices[q++] = c; indices[q++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normales, 3));
    geo.setAttribute('masque', new THREE.BufferAttribute(masques, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    this.maillage = new THREE.Mesh(geo, this.materiau);
    this.maillage.receiveShadow = true;
    this.maillage.name = 'terrain-principal';
    this.groupe.add(this.maillage);

    this._construireCarteHerbe(masques);

    this._construireBande();
    this._construireLointain();
    return this;
  }

  /**
   * Texture lue par le shader de l'herbe : R = altitude du sol, V = densité d'herbe.
   * Elle est deux fois plus fine que la grille pour que l'herbe respecte le sentier et les rues.
   */
  _construireCarteHerbe(masques) {
    const n = this.segments + 1;
    const N = this.segments * 2;                 // nombre de points par côté de la texture
    const pas = this.taille / N;
    const carte = new Uint16Array(N * N * 2);
    const enHalf = THREE.DataUtils.toHalfFloat;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = -this.taille / 2 + (i + 0.5) * pas;
        const z = -this.taille / 2 + (j + 0.5) * pas;
        this.trace.evaluer(x, z, _i);
        // Près du ruisseau, la grille est abaissée : on reprend la fonction de relief exacte.
        const h = _i.d < DEMI_BANDE + 1 ? this._relief(x, z, _i, true) : this._hauteurGrille(x, z);
        // Densité : pente et altitude lues dans la grille, chemins recalculés finement.
        const gi = Math.min(n - 1, Math.round((x + this.taille / 2) / this.pas));
        const gj = Math.min(n - 1, Math.round((z + this.taille / 2) / this.pas));
        const l = this.trace.demiLargeur(_i.s);
        const densite = masques[(gj * n + gi) * 2 + 1]
          * (1 - lisse(0.1, 0.45, this._terre(x, z, _i))) * lisse(l * 1.2, l * 1.2 + 1.5, _i.d);
        const k = (j * N + i) * 2;
        carte[k] = enHalf(h);
        carte[k + 1] = enHalf(densite);
      }
    }
    this.tailleCarteHerbe = N;
    this.carteHerbe = new THREE.DataTexture(carte, N, N, THREE.RGFormat, THREE.HalfFloatType);
    this.carteHerbe.magFilter = this.carteHerbe.minFilter = THREE.LinearFilter;
    this.carteHerbe.needsUpdate = true;
  }

  /** Bande fine qui suit le ruisseau : lit, berges et sentier, avec un point tous les 0,8 m. */
  _construireBande() {
    const trace = this.trace;
    const pasLong = 0.8;
    const rallonge = 14;   // la bande dépasse des deux bouts pour recouvrir les extrémités arrondies
    const nRangs = Math.ceil((trace.longueur + 2 * rallonge) / pasLong) + 1;
    const decalages = [-13.5, -12, -10.5, -9.2, -7.8, -6.4, -5, -3.8, -2.8, -1.9, -1.1, -0.4,
      0.4, 1.1, 1.9, 2.8, 3.8, 5, 6.4, 7.8, 9.2, 10.5, 12, 13.5];
    const nl = decalages.length;
    const positions = new Float32Array(nRangs * nl * 3);
    const normales = new Float32Array(nRangs * nl * 3);
    const masques = new Float32Array(nRangs * nl * 2);
    const centre = new THREE.Vector3();
    const tangente = new THREE.Vector3();
    const e = 0.35;

    for (let r = 0; r < nRangs; r++) {
      const abscisse = -rallonge + r * pasLong;                 // distance le long du ruisseau
      const s = Math.min(1, Math.max(0, abscisse / trace.longueur));
      trace.courbe.getPointAt(s, centre);
      trace.courbe.getTangentAt(s, tangente);
      const hors = abscisse < 0 ? abscisse : Math.max(0, abscisse - trace.longueur);
      centre.addScaledVector(tangente, hors);
      for (let c = 0; c < nl; c++) {
        const k = (r * nl + c) * 3;
        const bordure = c === 0 || c === nl - 1;
        const x = centre.x - tangente.z * decalages[c];
        const z = centre.z + tangente.x * decalages[c];
        this.trace.evaluer(x, z, _i);
        const h = this._relief(x, z, _i, true);
        positions[k] = x;
        positions[k + 1] = bordure ? h - 1.6 : h;   // la bordure plonge sous le terrain : aucun trou visible
        positions[k + 2] = z;
        masques[(r * nl + c) * 2] = this._terre(x, z, _i);
        // Normale par différences finies sur la fonction de relief.
        this.trace.evaluer(x + e, z, _i);
        const hx = this._relief(x + e, z, _i, true);
        this.trace.evaluer(x, z + e, _i);
        const hz = this._relief(x, z + e, _i, true);
        const nx = h - hx, nz = h - hz;
        const l = Math.hypot(nx, e, nz);
        normales[k] = nx / l; normales[k + 1] = e / l; normales[k + 2] = nz / l;
      }
    }
    const indices = new Uint32Array((nRangs - 1) * (nl - 1) * 6);
    let q = 0;
    for (let r = 0; r < nRangs - 1; r++) {
      for (let c = 0; c < nl - 1; c++) {
        const a = r * nl + c, b = a + 1, c2 = a + nl, d = c2 + 1;
        indices[q++] = a; indices[q++] = b; indices[q++] = c2;
        indices[q++] = b; indices[q++] = d; indices[q++] = c2;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normales, 3));
    geo.setAttribute('masque', new THREE.BufferAttribute(masques, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingSphere();
    this.bande = new THREE.Mesh(geo, this.materiau);
    this.bande.receiveShadow = true;
    this.bande.name = 'terrain-ruisseau';
    this.groupe.add(this.bande);
  }

  /** Montagnes lointaines : une grande grille grossière, trouée au centre. */
  _construireLointain() {
    const cote = 3600, seg = 72, n = seg + 1, pas = cote / seg;
    const positions = new Float32Array(n * n * 3);
    const h = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -cote / 2 + i * pas, z = -cote / 2 + j * pas;
        const r = Math.hypot(x, z);
        let y = 20 + lisse(360, 1000, r) * (120 + 330 * cretes(x * 0.0016, z * 0.0016, 4, 77));
        y = melange(-60, y, lisse(300, 420, Math.max(Math.abs(x), Math.abs(z))));
        h[j * n + i] = y;
        positions.set([x, y, z], (j * n + i) * 3);
      }
    }
    const indices = [];
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('masque', new THREE.BufferAttribute(new Float32Array(n * n * 2), 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    this.lointain = new THREE.Mesh(geo, this.materiau);
    this.lointain.name = 'montagnes-lointaines';
    this.groupe.add(this.lointain);
  }

  // -------------------------------------------------------------------
  //  Interrogation du relief (physique, caméra, placement des objets)
  // -------------------------------------------------------------------

  /** Altitude lue dans la grille : identique, au millimètre, au maillage affiché. */
  _hauteurGrille(x, z) {
    const n = this.segments + 1;
    let fx = (x + this.taille / 2) / this.pas;
    let fz = (z + this.taille / 2) / this.pas;
    fx = Math.min(this.segments - 0.0001, Math.max(0, fx));
    fz = Math.min(this.segments - 0.0001, Math.max(0, fz));
    const i = Math.floor(fx), j = Math.floor(fz);
    fx -= i; fz -= j;
    const g = this.grille;
    const a = g[j * n + i], b = g[j * n + i + 1], c = g[(j + 1) * n + i], d = g[(j + 1) * n + i + 1];
    return fx + fz <= 1
      ? a + (b - a) * fx + (c - a) * fz
      : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  /** Altitude du sol en (x, z). */
  hauteur(x, z) {
    this.trace.evaluer(x, z, _i);
    if (_i.d >= DEMI_BANDE) return this._hauteurGrille(x, z);
    const fin = this._relief(x, z, _i, true);
    if (_i.d <= DEMI_BANDE - 1) return fin;
    return melange(fin, Math.max(fin, this._hauteurGrille(x, z)), _i.d - (DEMI_BANDE - 1));
  }

  /** Normale du sol en (x, z), rangée dans `cible`. */
  normale(x, z, cible) {
    const e = 0.6;
    const h = this.hauteur(x, z);
    cible.set(h - this.hauteur(x + e, z), e, h - this.hauteur(x, z + e)).normalize();
    return cible;
  }

  /**
   * Renseignements sur l'eau en (x, z) : renvoie la profondeur d'eau (0 si on est au sec).
   * `surface` est fournie par le module de l'eau une fois le ruisseau construit.
   */
  profondeurEau(x, z, ySol) {
    const de = Math.hypot(x - ETANG.x, z - ETANG.z);
    if (de < ETANG.rayon + 4 && ySol < this.niveauEtang) return this.niveauEtang - ySol;
    this.trace.evaluer(x, z, _i);
    const l = this.trace.demiLargeur(_i.s);
    if (_i.d < l * 1.2) return Math.max(0, 0.32 * (1 - lisse(0.6 * l, 1.2 * l, _i.d)));
    return 0;
  }

  /** Densité d'herbe (0 → 1) en (x, z), lue dans la grille. Sert au placement de la végétation. */
  info(x, z, cible) {
    this.trace.evaluer(x, z, cible);
    cible.terre = this._terre(x, z, cible);
    return cible;
  }

  // -------------------------------------------------------------------
  //  Matériau
  // -------------------------------------------------------------------

  /**
   * Matériau PBR standard dont la couleur est calculée dans le shader à partir
   * de la pente, de l'altitude et d'une texture de bruit : herbe, roche, terre, neige.
   */
  _creerMateriau() {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0 });
    const uniformes = {
      uBruit: { value: creerTextureBruit(256) },
      uHerbeA: { value: new THREE.Color(0x3d6b22) },
      uHerbeB: { value: new THREE.Color(0x86a83a) },
      uHerbeSeche: { value: new THREE.Color(0x9c9a52) },
      uRocheA: { value: new THREE.Color(0x676a6c) },
      uRocheB: { value: new THREE.Color(0xa3a5a4) },
      uTerreA: { value: new THREE.Color(0x7a5c3c) },
      uTerreB: { value: new THREE.Color(0xa98a62) },
      uNeige: { value: new THREE.Color(0xf2f6ff) },
    };
    this.uniformes = uniformes;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniformes);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec2 masque;
          varying vec3 vPosMonde;
          varying vec3 vNormMonde;
          varying vec2 vMasque;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vPosMonde = position;
          vNormMonde = normal;
          vMasque = masque;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uBruit;
          uniform vec3 uHerbeA, uHerbeB, uHerbeSeche, uRocheA, uRocheB, uTerreA, uTerreB, uNeige;
          varying vec3 vPosMonde;
          varying vec3 vNormMonde;
          varying vec2 vMasque;`)
        .replace('#include <color_fragment>', `
          vec3 nMonde = normalize(vNormMonde);
          vec3 grand = texture2D(uBruit, vPosMonde.xz * 0.004).rgb;
          vec3 moyen = texture2D(uBruit, vPosMonde.xz * 0.035).rgb;
          vec3 fin = texture2D(uBruit, vPosMonde.xz * 0.22).rgb;
          float grain = texture2D(uBruit, vPosMonde.xz * 1.3).g;   // détail visible de près
          float pente = 1.0 - nMonde.y;
          float y = vPosMonde.y;

          vec3 herbe = mix(uHerbeA, uHerbeB, smoothstep(0.25, 0.75, grand.r * 0.6 + moyen.g * 0.4));
          herbe = mix(herbe, uHerbeSeche, smoothstep(55.0, 110.0, y + grand.g * 30.0) * 0.8);
          herbe *= 0.8 + 0.22 * fin.b + 0.2 * grain;

          vec3 roche = mix(uRocheA, uRocheB, moyen.r * 0.6 + fin.g * 0.4);
          roche *= 0.92 + 0.16 * smoothstep(0.35, 0.65, texture2D(uBruit, vec2(y * 0.03, grand.b * 0.5)).g);

          vec3 terre = mix(uTerreA, uTerreB, fin.r * 0.4 + moyen.b * 0.3 + grain * 0.3) * (0.85 + 0.3 * grain);

          float pRoche = smoothstep(0.24, 0.4, pente + (moyen.g - 0.5) * 0.16 + (grand.b - 0.5) * 0.2);
          roche *= 0.85 + 0.3 * grain;
          vec3 sol = mix(herbe, roche, pRoche);
          float pTerre = smoothstep(0.38, 0.62, vMasque.x + (fin.g - 0.5) * 0.45);
          sol = mix(sol, terre, pTerre);
          float pNeige = smoothstep(108.0, 132.0, y + (grand.r - 0.5) * 40.0 + (moyen.r - 0.5) * 8.0)
            * (1.0 - smoothstep(0.42, 0.7, pente));
          sol = mix(sol, uNeige, pNeige);
          diffuseColor.rgb = sol;`)
        .replace('#include <roughnessmap_fragment>', `
          float roughnessFactor = mix(roughness, 0.55, pNeige);`);
    };
    return mat;
  }
}

export { DEMI_BANDE, DISTANCE_SENTIER, FIN_SENTIER };
