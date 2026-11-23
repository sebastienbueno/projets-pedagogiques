// =====================================================================
//  RENDU
//  - moteur WebGL2 de three.js, tone mapping filmique (ACES) ;
//  - ciel physique (diffusion atmosphérique) qui sert aussi d'éclairage
//    d'ambiance pour les matériaux PBR ;
//  - soleil avec ombres douces qui suivent le joueur ;
//  - post-traitement : occlusion ambiante, bloom, étalonnage des couleurs,
//    anticrénelage — chaque étage peut être coupé selon le niveau de qualité.
// =====================================================================
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CONFIG } from './config.js';

const _v = new THREE.Vector3();
const _taille = new THREE.Vector2();

/**
 * Dernière passe : tone mapping filmique, conversion sRGB, puis étalonnage
 * (saturation, contraste, teinte des ombres et des lumières, vignette).
 */
class PasseEtalonnage extends Pass {
  constructor() {
    super();
    this.uniforms = {
      tDiffuse: { value: null },
      toneMappingExposure: { value: 1 },
      uSaturation: { value: 1.12 },
      uContraste: { value: 1.06 },
      uOmbres: { value: new THREE.Vector3(0.97, 0.99, 1.05) },     // ombres légèrement bleutées
      uLumieres: { value: new THREE.Vector3(1.04, 1.01, 0.95) },   // lumières légèrement dorées
      uVignette: { value: 0.22 },
    };
    this.material = new THREE.RawShaderMaterial({
      name: 'Etalonnage',
      uniforms: this.uniforms,
      defines: { ACES_FILMIC_TONE_MAPPING: '', SRGB_TRANSFER: '' },
      vertexShader: /* glsl */`
        precision highp float;
        uniform mat4 modelViewMatrix;
        uniform mat4 projectionMatrix;
        attribute vec3 position;
        attribute vec2 uv;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D tDiffuse;
        uniform float uSaturation, uContraste, uVignette;
        uniform vec3 uOmbres, uLumieres;
        #include <tonemapping_pars_fragment>
        #include <colorspace_pars_fragment>
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(tDiffuse, vUv);
          gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
          gl_FragColor = sRGBTransferOETF(gl_FragColor);
          vec3 c = gl_FragColor.rgb;
          float luminance = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(luminance), c, uSaturation);
          c = (c - 0.5) * uContraste + 0.5;
          c *= mix(uOmbres, uLumieres, smoothstep(0.1, 0.9, luminance));
          vec2 centre = vUv - 0.5;
          c *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(centre, centre) * 2.0);
          gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }`,
    });
    this._quad = new FullScreenQuad(this.material);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this._quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this._quad.dispose();
  }
}

export class Rendu {
  /** @param {HTMLCanvasElement} canevas */
  constructor(canevas) {
    this.canevas = canevas;
    this.renderer = new THREE.WebGLRenderer({
      canvas: canevas,
      antialias: false,                      // l'anticrénelage est fait en post-traitement
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.4;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;   // ombres filtrées, à bord doux
    this.renderer.info.autoReset = false;                // compteurs remis à zéro une fois par image (voir rendre)

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(CONFIG.brume.couleur, CONFIG.brume.densite);
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.champ, 1, 0.25, 4500);
    this.scene.add(this.camera);

    this.qualite = null;
    this.echelleDynamique = 1;
    this.composer = null;
    this._passes = {};

    this._creerCielEtLumieres();
  }

  _creerCielEtLumieres() {
    // Direction du soleil.
    const phi = THREE.MathUtils.degToRad(90 - CONFIG.soleil.elevation);
    const theta = THREE.MathUtils.degToRad(CONFIG.soleil.azimut);
    this.directionSoleil = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

    // --- Ciel physique ---
    const regler = (ciel) => {
      const u = ciel.material.uniforms;
      u.turbidity.value = 2.2;
      u.rayleigh.value = 1.9;
      u.mieCoefficient.value = 0.003;
      u.mieDirectionalG.value = 0.82;
      u.cloudCoverage.value = 0;         // les nuages sont des modèles 3D (voir vegetation.js)
      u.sunPosition.value.copy(this.directionSoleil);
      ciel.scale.setScalar(10000);
    };
    this.ciel = new Sky();
    this.ciel.name = 'ciel';
    this.ciel.userData.sansOcclusion = true;
    regler(this.ciel);
    this.scene.add(this.ciel);

    // --- Éclairage d'ambiance tiré du ciel (une seule fois, au chargement) ---
    const sceneCiel = new THREE.Scene();
    const cielAmbiance = new Sky();
    regler(cielAmbiance);
    cielAmbiance.material.uniforms.showSunDisc.value = 0;   // évite un point brûlé dans les reflets
    sceneCiel.add(cielAmbiance);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environnement = pmrem.fromScene(sceneCiel, 0, 1, 20000).texture;
    pmrem.dispose();
    cielAmbiance.material.dispose();
    cielAmbiance.geometry.dispose();
    this.scene.environment = this.environnement;
    this.scene.environmentIntensity = 0.7;

    // --- Soleil ---
    this.soleil = new THREE.DirectionalLight(0xfff0dc, 4.2);
    this.soleil.shadow.bias = -0.0006;
    this.soleil.shadow.normalBias = 0.08;
    this.soleil.shadow.radius = 2.2;
    this.scene.add(this.soleil, this.soleil.target);

    // --- Lumière du ciel et rebond du sol (matériaux simples comme l'herbe) ---
    this.ciel2 = new THREE.HemisphereLight(0xc4dcff, 0x6b7a4a, 0.7);
    this.scene.add(this.ciel2);
  }

  /** Applique un niveau de qualité (voir QUALITES dans config.js). */
  appliquerQualite(qualite) {
    this.qualite = qualite;

    // Ombres
    const s = this.soleil;
    s.castShadow = qualite.ombres > 0;
    if (s.castShadow) {
      if (s.shadow.mapSize.x !== qualite.ombres) {
        s.shadow.mapSize.set(qualite.ombres, qualite.ombres);
        if (s.shadow.map) { s.shadow.map.dispose(); s.shadow.map = null; }
      }
      const r = qualite.rayonOmbres;
      Object.assign(s.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 420 });
      s.shadow.camera.updateProjectionMatrix();
    }
    this._construirePostTraitement();
    this.redimensionner();
  }

  /** (Re)construit la chaîne de post-traitement pour la qualité en cours. */
  _construirePostTraitement() {
    if (this.composer) {
      for (const passe of this.composer.passes) if (passe.dispose) passe.dispose();
      this.composer.dispose();
      this.composer = null;
    }
    this._passes = {};
    const q = this.qualite;
    if (!q.post) return;

    // Image intermédiaire en demi-flottants : les hautes lumières (soleil, reflets) y sont conservées.
    const cible = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: q.msaa });
    const composer = new EffectComposer(this.renderer, cible);
    composer.addPass(new RenderPass(this.scene, this.camera));

    if (q.occlusion) {
      const ao = new GTAOPass(this.scene, this.camera, 4, 4);
      ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.2, thickness: 1.2, samples: 8 });
      // Certains objets ne doivent pas compter dans l'occlusion (ciel, eau, herbe animée par shader).
      const exclus = [];
      this.scene.traverse((o) => { if (o.userData.sansOcclusion) exclus.push(o); });
      const cacher = ao._overrideVisibility.bind(ao);
      const montrer = ao._restoreVisibility.bind(ao);
      const masques = [];
      ao._overrideVisibility = () => {
        cacher();
        for (const o of exclus) if (o.visible) { o.visible = false; masques.push(o); }
      };
      ao._restoreVisibility = () => {
        montrer();
        for (const o of masques) o.visible = true;
        masques.length = 0;
      };
      composer.addPass(ao);
      this._passes.occlusion = ao;
    }

    const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.14, 0.4, 2.2);
    composer.addPass(bloom);
    this._passes.bloom = bloom;

    composer.addPass(new PasseEtalonnage());
    if (!q.msaa) composer.addPass(new FXAAPass());
    this.composer = composer;
  }

  /** Ajuste la taille de l'image à la fenêtre et à l'échelle de résolution. */
  redimensionner() {
    const largeur = this.canevas.clientWidth || window.innerWidth;
    const hauteur = this.canevas.clientHeight || window.innerHeight;
    const q = this.qualite;
    const ratio = Math.min(window.devicePixelRatio || 1, q ? q.ratioPixelsMax : 1)
      * (q ? q.echelle : 1) * this.echelleDynamique;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(largeur, hauteur, false);
    this.camera.aspect = largeur / hauteur;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(ratio);
      this.composer.setSize(largeur, hauteur);
    }
    this.renderer.getDrawingBufferSize(_taille);
    this.hauteurImage = _taille.y;
  }

  /** Échelle de résolution dynamique (1 = pleine résolution du niveau de qualité). */
  reglerEchelle(echelle) {
    if (Math.abs(echelle - this.echelleDynamique) < 0.001) return;
    this.echelleDynamique = echelle;
    this.redimensionner();
  }

  /**
   * Centre la zone d'ombres sur le joueur. Le centre est arrondi au pixel de la carte
   * d'ombres : sans cela, les bords des ombres « fourmillent » quand on se déplace.
   */
  suivreOmbres(cible) {
    const s = this.soleil;
    const d = this.directionSoleil;
    if (!this._droite) {
      this._droite = new THREE.Vector3().crossVectors(THREE.Object3D.DEFAULT_UP, d).normalize();
      this._haut = new THREE.Vector3().crossVectors(d, this._droite).normalize();
    }
    let a = cible.dot(this._droite), b = cible.dot(this._haut);
    const c = cible.dot(d);
    if (s.castShadow) {
      const texel = (2 * this.qualite.rayonOmbres) / this.qualite.ombres;
      a = Math.round(a / texel) * texel;
      b = Math.round(b / texel) * texel;
    }
    _v.set(0, 0, 0).addScaledVector(this._droite, a).addScaledVector(this._haut, b).addScaledVector(d, c);
    s.target.position.copy(_v);
    s.position.copy(_v).addScaledVector(d, 200);
  }

  /** Compile tous les shaders à l'avance pour éviter les à-coups en jeu. */
  async precompiler() {
    // La compilation en parallèle n'existe pas sur toutes les cartes graphiques.
    if (this.renderer.extensions.has('KHR_parallel_shader_compile')) {
      await this.renderer.compileAsync(this.scene, this.camera);
    } else {
      this.renderer.compile(this.scene, this.camera);
    }
  }

  rendre(dt) {
    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
