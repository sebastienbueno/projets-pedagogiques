// =====================================================================
//  PERSONNAGE
//  - modèle riggé KayKit (GLB) et ses animations : repos, marche, course,
//    saut (élan, en l'air, réception), avec fondus enchaînés ;
//  - contrôleur physique : gravité, saut, appui sur le relief, glissade sur
//    les pentes trop raides, collisions avec le décor, ralentissement dans l'eau.
// =====================================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';

const P = CONFIG.personnage;

// Nom des animations dans le fichier GLB.
const CLIPS = {
  repos: 'Idle',
  marche: 'Walking_A',
  course: 'Running_A',
  sautElan: 'Jump_Start',
  sautAir: 'Jump_Idle',
  sautReception: 'Jump_Land',
  joie: 'Cheer',
};

const _normale = new THREE.Vector3();
const _souhait = new THREE.Vector3();

export class Personnage {
  /**
   * @param {object} gltf résultat du chargement de personnage.glb
   * @param {import('./terrain.js').Terrain} terrain
   * @param {import('./collisions.js').Collisions} collisions
   */
  constructor(gltf, terrain, collisions) {
    this.terrain = terrain;
    this.collisions = collisions;

    // --- Modèle ---
    this.racine = new THREE.Group();      // position = pieds du personnage
    this.racine.name = 'personnage';
    this.modele = gltf.scene;
    const boite = new THREE.Box3().setFromObject(this.modele);
    this.modele.scale.setScalar(P.taille / (boite.max.y - boite.min.y));
    this.modele.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;         // les maillages animés ont une boîte englobante peu fiable
        o.material.roughness = 0.75;
      }
    });
    this.racine.add(this.modele);

    // --- Animations ---
    this.mixeur = new THREE.AnimationMixer(this.modele);
    this.actions = {};
    for (const [cle, nom] of Object.entries(CLIPS)) {
      const clip = THREE.AnimationClip.findByName(gltf.animations, nom);
      if (!clip) { console.warn(`Animation absente : ${nom}`); continue; }
      const action = this.mixeur.clipAction(clip);
      if (cle === 'sautElan' || cle === 'sautReception' || cle === 'joie') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[cle] = action;
    }
    this.animation = null;
    this._jouer('repos', 0);
    this.mixeur.addEventListener('finished', (e) => {
      // Fin de l'élan → animation « en l'air » ; fin de la réception → retour à la locomotion.
      if (e.action === this.actions.sautElan && !this.auSol) this._jouer('sautAir', 0.12);
      if (e.action === this.actions.sautReception || e.action === this.actions.joie) this.reception = false;
    });

    // --- État physique ---
    this.position = this.racine.position;
    this.vitesse = new THREE.Vector3();
    this.orientation = 0;            // angle autour de la verticale (0 = regarde vers +Z)
    this.auSol = true;
    this.tempsEnLAir = 0;
    this.tempsDepuisSaut = 10;       // mémoire d'appui sur « saut » (tolérance d'un dixième de seconde)
    this.reception = false;
    this.profondeurEau = 0;
    this.allure = 0;                 // vitesse horizontale réelle, pour choisir l'animation
    this.cosPenteMax = Math.cos(THREE.MathUtils.degToRad(P.penteMaxDegres));
  }

  /** Lance une animation avec un fondu depuis la précédente. */
  _jouer(cle, fondu = P.fonduAnimation) {
    const suivante = this.actions[cle];
    if (!suivante || this.animation === cle) return;
    const precedente = this.actions[this.animation];
    suivante.reset();
    suivante.enabled = true;
    suivante.setEffectiveWeight(1);
    // Marche ↔ course : on reprend au même moment de la foulée pour que les pieds ne sautent pas.
    const locomotion = (c) => c === 'marche' || c === 'course';
    if (precedente && locomotion(cle) && locomotion(this.animation)) {
      suivante.time = (precedente.time / precedente.getClip().duration) * suivante.getClip().duration;
    }
    suivante.play();
    if (precedente && fondu > 0) {
      precedente.crossFadeTo(suivante, fondu, false);
    } else if (precedente) {
      precedente.stop();
    }
    this.animation = cle;
  }

  /** Place le personnage en (x, z), posé sur le sol. */
  teleporter(x, z, orientation = this.orientation) {
    this.position.set(x, this.terrain.hauteur(x, z), z);
    this.vitesse.set(0, 0, 0);
    this.orientation = orientation;
    this.racine.rotation.y = orientation;
    this.auSol = true;
  }

  /** Joue l'animation de joie (arrivée au village, bonne réponse dans un futur jeu...). */
  celebrer() {
    if (!this.auSol) return;
    this.reception = true;
    this._jouer('joie', 0.15);
  }

  /**
   * Avance la simulation.
   * @param {number} dt pas de temps en secondes
   * @param {object} commandes { x, y : déplacement voulu (−1 → 1), courir, saut }
   * @param {number} lacetCamera angle horizontal de la caméra : « avant » = là où elle regarde
   */
  mettreAJour(dt, commandes, lacetCamera) {
    // On découpe les grands pas de temps pour rester stable quand l'affichage ralentit.
    dt = Math.min(dt, 0.1);
    const etapes = Math.max(1, Math.ceil(dt / (1 / 60)));
    if (commandes.saut) this.tempsDepuisSaut = 0;
    for (let i = 0; i < etapes; i++) this._pas(dt / etapes, commandes, lacetCamera);
    this._animer(dt);
  }

  _pas(dt, commandes, lacet) {
    const pos = this.position, vit = this.vitesse, terrain = this.terrain;

    // --- Direction voulue, exprimée dans le repère de la caméra ---
    let mx = commandes.x, my = commandes.y;
    let force = Math.hypot(mx, my);
    if (force > 1) { mx /= force; my /= force; force = 1; }
    const sin = Math.sin(lacet), cos = Math.cos(lacet);
    const dirX = -sin * my + cos * mx;
    const dirZ = -cos * my - sin * mx;
    let vitesseCible = (commandes.courir ? P.vitesseCourse : P.vitesseMarche);
    vitesseCible *= 1 - 0.4 * Math.min(1, this.profondeurEau / 0.5);   // on avance moins vite dans l'eau
    _souhait.set(dirX * vitesseCible, 0, dirZ * vitesseCible);

    // --- Pentes raides : on ne peut pas les remonter, et on glisse vers le bas ---
    let glisse = false;
    if (this.auSol) {
      terrain.normale(pos.x, pos.z, _normale);
      if (_normale.y < this.cosPenteMax) {
        glisse = true;
        const l = Math.hypot(_normale.x, _normale.z) || 1;
        const bx = _normale.x / l, bz = _normale.z / l;       // direction de la descente
        const montee = _souhait.x * bx + _souhait.z * bz;
        if (montee < 0) { _souhait.x -= bx * montee; _souhait.z -= bz * montee; }
        _souhait.x += bx * 6; _souhait.z += bz * 6;
      }
    }

    // --- Accélération progressive (plus molle en l'air) ---
    const reactivite = this.auSol ? (glisse ? 4 : 11) : 2.5;
    const k = 1 - Math.exp(-reactivite * dt);
    vit.x += (_souhait.x - vit.x) * k;
    vit.z += (_souhait.z - vit.z) * k;

    // --- Saut (toléré un court instant après avoir quitté le sol) ---
    this.tempsDepuisSaut += dt;
    if (this.tempsDepuisSaut < 0.12 && (this.auSol || this.tempsEnLAir < 0.1) && !glisse && vit.y <= 0.01) {
      vit.y = P.impulsionSaut;
      this.auSol = false;
      this.tempsEnLAir = 0.11;
      this.tempsDepuisSaut = 10;
      this.reception = false;
      this._jouer('sautElan', 0.08);
      if (this.actions.sautElan) this.actions.sautElan.timeScale = 1.6;
    }

    // --- Déplacement horizontal + obstacles ---
    pos.x += vit.x * dt;
    pos.z += vit.z * dt;
    this.collisions.resoudre(pos, P.rayon);
    const r = Math.hypot(pos.x, pos.z);
    if (r > CONFIG.monde.rayonJouable) {
      pos.x *= CONFIG.monde.rayonJouable / r;
      pos.z *= CONFIG.monde.rayonJouable / r;
    }

    // --- Vertical : gravité, appui au sol ---
    const sol = terrain.hauteur(pos.x, pos.z);
    if (this.auSol) {
      if (pos.y - sol > 0.45) {
        this.auSol = false;            // le sol se dérobe (rebord) : on tombe
        this.tempsEnLAir = 0;
      } else {
        pos.y = sol;                   // on reste collé au relief, en montée comme en descente
        vit.y = 0;
      }
    }
    if (!this.auSol) {
      this.tempsEnLAir += dt;
      vit.y -= P.gravite * dt;
      pos.y += vit.y * dt;
      if (pos.y <= sol && vit.y <= 0) {
        const chute = -vit.y;
        pos.y = sol;
        vit.y = 0;
        this.auSol = true;
        if (this.tempsEnLAir > 0.25) {
          this.reception = chute > 4;
          if (this.reception) {
            this._jouer('sautReception', 0.08);
            if (this.actions.sautReception) this.actions.sautReception.timeScale = 1.5;
          }
        }
        this.tempsEnLAir = 0;
      }
    }
    this.profondeurEau = terrain.profondeurEau(pos.x, pos.z, sol);

    // --- Orientation : le personnage se tourne vers sa direction de marche ---
    if (force > 0.05) {
      const cible = Math.atan2(dirX, dirZ);
      let ecart = cible - this.orientation;
      ecart = Math.atan2(Math.sin(ecart), Math.cos(ecart));
      this.orientation += ecart * (1 - Math.exp(-12 * dt));
    }
    this.racine.rotation.y = this.orientation;
    this.allure = Math.hypot(vit.x, vit.z);
  }

  /** Choisit l'animation selon l'état, puis fait avancer le mixeur. */
  _animer(dt) {
    if (!this.auSol) {
      if (this.animation !== 'sautElan' && this.tempsEnLAir > 0.18) this._jouer('sautAir', 0.15);
    } else if (!this.reception) {
      if (this.allure < 0.35) {
        this._jouer('repos');
      } else if (this.allure < (P.vitesseMarche + P.vitesseCourse) * 0.5) {
        this._jouer('marche');
        this.actions.marche.timeScale = THREE.MathUtils.clamp(this.allure / P.vitesseMarche, 0.6, 1.5) * 1.15;
      } else {
        this._jouer('course');
        this.actions.course.timeScale = THREE.MathUtils.clamp(this.allure / P.vitesseCourse, 0.7, 1.2) * 1.1;
      }
    } else if (this.allure > 1.5) {
      // On repart tout de suite si le joueur continue d'avancer.
      this.reception = false;
    }
    this.mixeur.update(dt);
  }
}
