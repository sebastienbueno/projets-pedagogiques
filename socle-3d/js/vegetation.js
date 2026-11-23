// =====================================================================
//  VÉGÉTATION ET ROCHERS
//  - ChampInstances : outil réutilisable qui dessine des milliers de copies
//    d'un modèle (« instancing »), découpées en blocs, avec deux niveaux de
//    détail selon la distance et un masquage au-delà d'une distance maximale ;
//  - arbres, rochers, pitons rocheux (dont ceux de la source), nuages ;
//  - herbe : un tapis de touffes qui suit le joueur (voir classe Herbe).
// =====================================================================
import * as THREE from 'three';
import { creerAlea, fbm, lisse } from './bruit.js';
import { VILLAGE, ETANG } from './monde.js';
import { CONFIG } from './config.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _e = new THREE.Vector3();
const _haut = new THREE.Vector3(0, 1, 0);
const _info = { d: 0, s: 0, cote: 1, H: 0, terre: 0 };

/**
 * Dessine de nombreuses copies d'une géométrie, regroupées par blocs de terrain.
 * Chaque bloc est un InstancedMesh : un seul appel de dessin pour tout le bloc,
 * et three.js ne dessine pas les blocs hors du champ de la caméra.
 */
export class ChampInstances {
  /**
   * @param {object} o
   * @param {THREE.BufferGeometry} o.geometrie      modèle détaillé (près)
   * @param {THREE.BufferGeometry} [o.geometrieLoin] modèle simplifié (loin) ; facultatif
   * @param {THREE.Material} o.materiau
   * @param {THREE.Matrix4[]} o.matrices             position/rotation/échelle de chaque copie
   * @param {number} [o.tailleBloc]
   * @param {boolean} [o.ombres]                     les copies proches projettent-elles une ombre ?
   * @param {number} [o.portee]                      multiplicateur de la distance maximale d'affichage
   */
  constructor({ geometrie, geometrieLoin = null, materiau, matrices, tailleBloc = 72, ombres = true, portee = 1, nom = 'instances' }) {
    this.groupe = new THREE.Group();
    this.groupe.name = nom;
    this.blocs = [];
    this.portee = portee;
    this.deuxNiveaux = !!geometrieLoin;

    // Répartition des copies par bloc.
    const parBloc = new Map();
    for (const matrice of matrices) {
      _p.setFromMatrixPosition(matrice);
      const cle = `${Math.floor(_p.x / tailleBloc)}|${Math.floor(_p.z / tailleBloc)}`;
      if (!parBloc.has(cle)) parBloc.set(cle, []);
      parBloc.get(cle).push(matrice);
    }
    for (const liste of parBloc.values()) {
      const creer = (geo, projette) => {
        const mesh = new THREE.InstancedMesh(geo, materiau, liste.length);
        liste.forEach((mat, i) => mesh.setMatrixAt(i, mat));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = projette;
        mesh.receiveShadow = true;
        this.groupe.add(mesh);
        return mesh;
      };
      const pres = creer(geometrie, ombres);
      const loin = geometrieLoin ? creer(geometrieLoin, false) : null;
      this.blocs.push({ pres, loin, centre: pres.boundingSphere.center, rayon: pres.boundingSphere.radius });
    }
    this.total = matrices.length;
  }

  /** Choisit, bloc par bloc, le niveau de détail à afficher. */
  mettreAJour(positionCamera, distanceDetail, distanceMax) {
    distanceMax *= this.portee;
    for (const b of this.blocs) {
      const d = Math.max(0, b.centre.distanceTo(positionCamera) - b.rayon);
      const visible = d < distanceMax;
      if (b.loin) {
        const detail = d < distanceDetail;
        b.pres.visible = visible && detail;
        b.loin.visible = visible && !detail;
      } else {
        b.pres.visible = visible;
      }
    }
  }
}

/** Prépare la géométrie d'un modèle du fichier nature.glb. */
function geometrieDe(scene, nom) {
  const objet = scene.getObjectByName(nom);
  if (!objet) throw new Error(`Modèle introuvable : ${nom}`);
  let mesh = objet.isMesh ? objet : null;
  if (!mesh) objet.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
  return mesh.geometry;
}

export class Vegetation {
  /**
   * @param {THREE.Group} modeles scène du fichier nature.glb
   * @param {import('./terrain.js').Terrain} terrain
   * @param {import('./collisions.js').Collisions} collisions
   * @param {import('./eau.js').Eau} eau
   */
  constructor(modeles, terrain, collisions, eau) {
    this.terrain = terrain;
    this.collisions = collisions;
    this.groupe = new THREE.Group();
    this.groupe.name = 'vegetation';
    this.champs = [];
    this.temps = { value: 0 };

    // Tous les modèles KayKit partagent une seule texture : un seul matériau suffit.
    let materiauBase = null;
    modeles.traverse((o) => { if (o.isMesh && !materiauBase) materiauBase = o.material; });
    materiauBase.roughness = 0.85;
    this.materiauRoche = materiauBase;
    this.materiauArbre = this._creerMateriauArbre(materiauBase);

    this._planterArbres(modeles);
    this._poserRochers(modeles);
    this._poserPitons(modeles, eau);
    this._poserNuages(modeles);
  }

  /** Les arbres reprennent le matériau commun, plus un léger balancement dû au vent. */
  _creerMateriauArbre(base) {
    const mat = base.clone();
    const temps = this.temps;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTemps = temps;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTemps;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float phase = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.17;
            float souplesse = max(0.0, transformed.y - 0.25);
            transformed.x += sin(uTemps * 1.3 + phase) * 0.035 * souplesse;
            transformed.z += cos(uTemps * 1.1 + phase * 1.7) * 0.025 * souplesse;
          #endif`);
    };
    return mat;
  }

  /** Vrai si l'on peut poser un objet de décor ici (ni village, ni étang, ni hors limites). */
  _libre(x, z, margeVillage = 8) {
    if (Math.hypot(x, z) > 348) return false;
    if (Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < VILLAGE.rayon + margeVillage) return false;
    if (Math.hypot(x - ETANG.x, z - ETANG.z) < ETANG.rayon + 5) return false;
    // moulin à vent et champ, à l'extérieur du village
    if (Math.hypot(x - VILLAGE.x - VILLAGE.moulinVent.x, z - VILLAGE.z - VILLAGE.moulinVent.z) < 13) return false;
    if (Math.hypot(x - VILLAGE.x - VILLAGE.champ.x, z - VILLAGE.z - VILLAGE.champ.z) < 17) return false;
    return true;
  }

  _planterArbres(modeles) {
    const alea = creerAlea(2024);
    const terrain = this.terrain;
    const normale = new THREE.Vector3();
    const rondes = [], pointues = [];
    const pas = 7;
    for (let gz = -345; gz <= 345; gz += pas) {
      for (let gx = -345; gx <= 345; gx += pas) {
        const x = gx + (alea() - 0.5) * pas * 0.9;
        const z = gz + (alea() - 0.5) * pas * 0.9;
        const tirage = alea(), taille = alea(), angle = alea() * Math.PI * 2, espece = alea();
        if (!this._libre(x, z)) continue;
        terrain.info(x, z, _info);
        if (_info.d < 13 || _info.terre > 0.15) continue;
        // Bosquets : une carte de bruit décide où la forêt est dense.
        const foret = fbm(x * 0.011 + 40, z * 0.011 + 12, 3, 44);
        let proba = lisse(0.44, 0.62, foret) * 0.9 + 0.03;
        proba *= lisse(13, 34, _info.d);                 // la vallée reste dégagée près de l'eau
        const y = terrain.hauteur(x, z);
        proba *= 1 - lisse(78, 104, y);                  // limite des arbres en altitude
        if (tirage > proba) continue;
        if (terrain.normale(x, z, normale).y < 0.8) continue;   // pas d'arbre sur les pentes raides

        const echelle = 7 * (0.7 + taille * 0.85);
        _q.setFromAxisAngle(_haut, angle);
        _m.compose(_p.set(x, y - 0.25, z), _q, _e.set(echelle, echelle * (0.9 + alea() * 0.3), echelle));
        (espece < 0.62 ? rondes : pointues).push(_m.clone());
        this.collisions.ajouterCercle(x, z, 0.07 * echelle, y + echelle, false);
      }
    }
    const geoRonde = geometrieDe(modeles, 'tree_single_B');
    const geoPointue = geometrieDe(modeles, 'tree_single_A');
    // Sapin « rond » : 220 triangles de près, remplacé de loin par le sapin « pointu » (50 triangles).
    this._ajouter(new ChampInstances({ geometrie: geoRonde, geometrieLoin: geoPointue, materiau: this.materiauArbre, matrices: rondes, nom: 'sapins-ronds' }));
    this._ajouter(new ChampInstances({ geometrie: geoPointue, materiau: this.materiauArbre, matrices: pointues, nom: 'sapins-pointus' }));
    this.nombreArbres = rondes.length + pointues.length;
  }

  _poserRochers(modeles) {
    const alea = creerAlea(77);
    const terrain = this.terrain;
    const normale = new THREE.Vector3();
    const noms = ['rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E'];
    const hauteurs = [0.07, 0.13, 0.19, 0.16, 0.19];
    const rayons = [0.15, 0.13, 0.17, 0.13, 0.22];
    const listes = noms.map(() => []);
    const depart = terrain.trace.point(0.022, 6);
    const pas = 8;
    for (let gz = -340; gz <= 340; gz += pas) {
      for (let gx = -340; gx <= 340; gx += pas) {
        const x = gx + (alea() - 0.5) * pas;
        const z = gz + (alea() - 0.5) * pas;
        const tirage = alea(), taille = alea(), angle = alea() * Math.PI * 2;
        const type = Math.floor(alea() * noms.length);
        if (!this._libre(x, z, 2)) continue;
        if (Math.hypot(x - depart.x, z - depart.z) < 11) continue;   // rien sur le point de départ du joueur
        terrain.info(x, z, _info);
        const largeur = terrain.trace.demiLargeur(_info.s);
        // Pas de rocher sur le sentier ni au milieu du courant.
        if (_info.d < largeur * 0.9) continue;
        if (_info.terre > 0.3 && _info.d > largeur * 1.15 + 2.5) continue;
        const y = terrain.hauteur(x, z);
        terrain.normale(x, z, normale);
        // Plus de rochers en altitude, sur les pentes et au bord de l'eau.
        let proba = 0.1 + 0.3 * lisse(45, 110, y) + 0.3 * lisse(0.1, 0.3, 1 - normale.y);
        proba += 0.45 * (1 - lisse(largeur, largeur + 4, _info.d));
        if (tirage > proba) continue;

        const pres = _info.d < largeur + 4;
        const echelle = 7 * (pres ? 0.6 + taille * 1.2 : 0.7 + taille * taille * 3.2);
        _q.setFromAxisAngle(_haut, angle);
        _m.compose(_p.set(x, y - 0.03 * echelle, z), _q, _e.set(echelle, echelle * (0.8 + alea() * 0.6), echelle));
        listes[type].push(_m.clone());
        const haut = hauteurs[type] * echelle;
        if (haut > 0.75) this.collisions.ajouterCercle(x, z, rayons[type] * echelle * 0.8, y + haut, haut > 1.6);
      }
    }
    this.nombreRochers = 0;
    noms.forEach((nom, i) => {
      this.nombreRochers += listes[i].length;
      this._ajouter(new ChampInstances({ geometrie: geometrieDe(modeles, nom), materiau: this.materiauRoche, matrices: listes[i], nom, tailleBloc: 120, portee: 0.8 }));
    });
  }

  /** Grands pitons rocheux : autour de la source, puis dispersés dans la montagne. */
  _poserPitons(modeles, eau) {
    const alea = creerAlea(5);
    const terrain = this.terrain;
    const noms = ['mountain_A', 'mountain_B', 'mountain_C'];
    const listes = noms.map(() => []);
    const poser = (type, x, z, echelle, angle, enfonce = 0.12) => {
      const y = terrain.hauteur(x, z);
      _q.setFromAxisAngle(_haut, angle);
      _m.compose(_p.set(x, y - enfonce * echelle, z), _q, _e.set(echelle, echelle, echelle));
      listes[type].push(_m.clone());
      this.collisions.ajouterCercle(x, z, echelle * 0.82, y + echelle * 1.5, true);
    };

    // --- La source jaillit d'un amphithéâtre de roche ---
    const t = terrain.trace.courbe.getTangentAt(0, new THREE.Vector3());
    const b = eau.bouche;
    const derriere = (avance, cote) => [b.x - t.x * avance - t.z * cote, b.z - t.z * avance + t.x * cote];
    poser(1, ...derriere(4.3, 0), 5.2, 0.4, 0.3);
    poser(0, ...derriere(2.5, 8.2), 4.4, 2.1);
    poser(2, ...derriere(2.9, -8.0), 4.8, 4.0);
    poser(0, ...derriere(11, 5), 7.5, 1.0);
    poser(2, ...derriere(12, -6), 8.5, 5.2);

    // --- Pitons dispersés ---
    let poses = 0, essais = 0;
    while (poses < 34 && essais < 4000) {
      essais++;
      const x = (alea() - 0.5) * 680, z = (alea() - 0.5) * 680;
      if (!this._libre(x, z, 30)) continue;
      terrain.info(x, z, _info);
      if (_info.d < 32) continue;
      const y = terrain.hauteur(x, z);
      if (y < 30 && alea() > 0.25) continue;
      poser(Math.floor(alea() * 3), x, z, 5 + alea() * 9, alea() * 6.28);
      poses++;
    }
    noms.forEach((nom, i) => {
      this._ajouter(new ChampInstances({ geometrie: geometrieDe(modeles, nom), materiau: this.materiauRoche, matrices: listes[i], nom, tailleBloc: 140, portee: 2 }));
    });
  }

  /** Quelques nuages en volume qui dérivent lentement. */
  _poserNuages(modeles) {
    const alea = creerAlea(31);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xbfd0e6, emissiveIntensity: 0.55, fog: false });
    this.nuages = new THREE.Group();
    this.nuages.name = 'nuages';
    const geos = [geometrieDe(modeles, 'cloud_big'), geometrieDe(modeles, 'cloud_small')];
    for (let i = 0; i < 16; i++) {
      const nuage = new THREE.Mesh(geos[i % 2], mat);
      const angle = alea() * Math.PI * 2, rayon = 350 + alea() * 900;
      nuage.position.set(Math.cos(angle) * rayon, 330 + alea() * 220, Math.sin(angle) * rayon);
      nuage.scale.setScalar(45 + alea() * 70);
      nuage.scale.y *= 0.6;
      nuage.rotation.y = alea() * 6.28;
      nuage.userData.vitesse = 1.5 + alea() * 2.5;
      nuage.userData.sansOcclusion = true;
      this.nuages.add(nuage);
    }
    this.groupe.add(this.nuages);
  }

  _ajouter(champ) {
    this.champs.push(champ);
    this.groupe.add(champ.groupe);
  }

  /** @param {object} qualite niveau de qualité en cours (voir config.js) */
  mettreAJour(dt, temps, positionCamera, qualite) {
    this.temps.value = temps;
    for (const champ of this.champs) champ.mettreAJour(positionCamera, qualite.distanceDetail, qualite.distanceMax);
    for (const nuage of this.nuages.children) {
      nuage.position.x += nuage.userData.vitesse * dt;
      if (nuage.position.x > 1300) nuage.position.x = -1300;
    }
  }
}

// =====================================================================
//  HERBE
//  Un nombre fixe de touffes couvre un carré centré sur le joueur. Quand il
//  avance, les touffes qui sortent d'un côté réapparaissent de l'autre : le
//  coût reste constant quelle que soit la taille du monde. L'altitude et la
//  présence d'herbe sont lues dans une texture fournie par le terrain.
//  Tout le calcul est fait par la carte graphique (shader de sommets).
// =====================================================================
export class Herbe {
  /** @param {import('./terrain.js').Terrain} terrain */
  constructor(terrain) {
    this.terrain = terrain;
    this.maxTouffes = 18000;
    this.uniformes = {
      uTemps: { value: 0 },
      uCentre: { value: new THREE.Vector3() },
      uCote: { value: 96 },                    // côté du carré couvert
      uCarte: { value: terrain.carteHerbe },
      uMonde: { value: new THREE.Vector2(terrain.taille, terrain.tailleCarteHerbe) },
      uJoueur: { value: new THREE.Vector3() },
      uCamera: { value: new THREE.Vector3() },
      uBas: { value: new THREE.Color(0x356420) },
      uHaut: { value: new THREE.Color(0x8fb53c) },
    };

    // Une touffe = trois brins plats en éventail.
    const positions = [], indices = [];
    for (let brin = 0; brin < 3; brin++) {
      const angle = (brin / 3) * Math.PI + 0.3;
      const cx = Math.cos(angle), cz = Math.sin(angle);
      const base = positions.length / 3;
      const largeur = 0.06, penche = (brin - 1) * 0.3;
      // 5 sommets : deux à la base, deux à mi-hauteur, la pointe
      const points = [[-largeur, 0], [largeur, 0], [-largeur * 0.7, 0.5], [largeur * 0.7, 0.5], [0, 1]];
      for (const [l, h] of points) {
        positions.push(cx * l + cz * penche * h + cz * 0.06 * (brin - 1), h, cz * l - cx * penche * h - cx * 0.06 * (brin - 1));
      }
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    // Normales verticales : l'herbe est éclairée comme le sol qui la porte.
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setIndex(indices);
    // Par touffe : position dans le carré (x, z), taille, angle.
    const alea = creerAlea(99);
    const donnees = new Float32Array(this.maxTouffes * 4);
    for (let i = 0; i < this.maxTouffes; i++) {
      donnees[i * 4] = alea();
      donnees[i * 4 + 1] = alea();
      donnees[i * 4 + 2] = 0.3 + alea() * 0.4;
      donnees[i * 4 + 3] = alea() * 6.283;
    }
    geo.setAttribute('touffe', new THREE.InstancedBufferAttribute(donnees, 4));
    geo.instanceCount = this.maxTouffes;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    const uniformes = this.uniformes;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniformes);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 touffe;
          uniform float uTemps, uCote;
          uniform vec3 uCentre, uJoueur, uCamera;
          uniform vec2 uMonde;
          uniform sampler2D uCarte;
          varying float vHauteurBrin;
          varying float vTeinte;`)
        .replace('#include <begin_vertex>', `
          // Position de la touffe : case du carré « enroulée » autour du joueur.
          vec2 base = touffe.xy * uCote;
          base += uCote * floor((uCentre.xz - base) / uCote + 0.5);
          // Lecture de l'altitude et de la densité d'herbe.
          vec2 uvCarte = base / uMonde.x + 0.5;
          vec4 carte = texture2D(uCarte, uvCarte);
          float eloignement = distance(base, uCentre.xz);
          float taille = touffe.z * smoothstep(0.25, 0.6, carte.g) * (1.0 - smoothstep(uCote * 0.36, uCote * 0.48, eloignement));
          // Les brins collés à l'objectif deviendraient géants à l'écran : on les efface.
          taille *= smoothstep(0.7, 2.4, distance(vec3(base.x, carte.r, base.y), uCamera));
          float c = cos(touffe.w), s = sin(touffe.w);
          vec3 brin = vec3(position.x * c - position.z * s, position.y, position.x * s + position.z * c);
          brin.xz *= 1.6;
          brin *= taille;
          // Vent : les pointes ondulent.
          float vent = sin(uTemps * 1.7 + base.x * 0.33 + base.y * 0.21) * 0.16 + sin(uTemps * 3.3 + base.x * 1.1) * 0.05;
          brin.xz += vec2(0.8, 0.45) * vent * position.y * taille;
          // Le joueur couche l'herbe autour de lui.
          vec2 ecart = base - uJoueur.xz;
          float pousse = (1.0 - smoothstep(0.2, 1.3, length(ecart))) * position.y * taille;
          brin.xz += normalize(ecart + 0.0001) * pousse * 0.5;
          brin.y -= pousse * 0.35;
          vec3 transformed = vec3(base.x + brin.x, carte.r + brin.y - 0.06, base.y + brin.z);
          vHauteurBrin = position.y;
          vTeinte = fract(touffe.w * 7.31);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uBas, uHaut;
          varying float vHauteurBrin;
          varying float vTeinte;`)
        // Les deux faces d'un brin reçoivent la même lumière (pas de face « à l'envers »).
        .replace('#include <normal_fragment_begin>', `
          vec3 normal = normalize(vNormal);
          vec3 nonPerturbedNormal = normal;`)
        .replace('#include <color_fragment>', `
          diffuseColor.rgb = mix(uBas, uHaut, vHauteurBrin * (0.75 + 0.5 * vTeinte));`);
    };
    this.maillage = new THREE.Mesh(geo, mat);
    this.maillage.name = 'herbe';
    this.maillage.frustumCulled = false;
    this.maillage.receiveShadow = true;
    this.maillage.userData.sansOcclusion = true;
  }

  /** Ajuste le nombre de touffes et la surface couverte au niveau de qualité. */
  regler(nombre, rayon) {
    this.maillage.visible = nombre > 0;
    this.maillage.geometry.instanceCount = Math.min(this.maxTouffes, nombre);
    this.uniformes.uCote.value = rayon * 2;
  }

  mettreAJour(temps, positionJoueur, positionCamera) {
    this.uniformes.uTemps.value = temps;
    this.uniformes.uCamera.value.copy(positionCamera);
    this.uniformes.uCentre.value.copy(positionJoueur);
    this.uniformes.uJoueur.value.copy(positionJoueur);
  }
}
