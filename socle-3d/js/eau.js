// =====================================================================
//  EAU
//  - le ruisseau : un ruban qui suit le tracé, de la source à l'étang ;
//  - l'étang : un disque au bout du ruisseau ;
//  - la source : un jet qui sort de la roche, avec des gouttelettes.
//  Le shader part du matériau PBR standard de three.js (reflets du ciel et
//  du soleil, ombres, brume) auquel on ajoute : des vaguelettes animées qui
//  descendent le courant, la transparence selon l'angle de vue (Fresnel),
//  l'écume dans les cascades et le fondu sur les rives.
// =====================================================================
import * as THREE from 'three';
import { creerTextureVagues, lisse } from './bruit.js';
import { ETANG } from './monde.js';

const _i = { d: 0, s: 0, cote: 1, H: 0 };

export class Eau {
  /**
   * @param {import('./monde.js').Trace} trace
   * @param {import('./terrain.js').Terrain} terrain
   */
  constructor(trace, terrain) {
    this.trace = trace;
    this.terrain = terrain;
    this.groupe = new THREE.Group();
    this.groupe.name = 'eau';
    this.temps = { value: 0 };
    this.vagues = creerTextureVagues(256);
    this.materiaux = [];

    this._construireRuisseau();
    this._construireEtang();
    this._construireSource();
  }

  /** Matériau d'eau. `vitesse` : défilement du courant ; `force` : relief des vaguelettes. */
  _creerMateriau({ vitesse = 1, force = 0.35, opacite = 0.6, couleur = 0x2b7f9c } = {}) {
    const mat = new THREE.MeshStandardMaterial({
      color: couleur,
      roughness: 0.07,
      metalness: 0,
      transparent: true,
      depthWrite: false,
      envMapIntensity: 0.3,
    });
    const temps = this.temps;
    const vagues = this.vagues;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTemps = temps;
      shader.uniforms.uVagues = { value: vagues };
      shader.uniforms.uVitesse = { value: vitesse };
      shader.uniforms.uForce = { value: force };
      shader.uniforms.uOpacite = { value: opacite };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float pente;
          varying vec2 vUvEau;
          varying float vPenteEau;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vUvEau = uv;
          vPenteEau = pente;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTemps, uVitesse, uForce, uOpacite;
          uniform sampler2D uVagues;
          varying vec2 vUvEau;
          varying float vPenteEau;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          float tEau = uTemps * uVitesse;
          float courant = 1.0 + 1.6 * vPenteEau;
          // Deux couches de vaguelettes qui défilent à des vitesses différentes.
          vec3 v1 = texture2D(uVagues, vec2(vUvEau.x * 1.3, vUvEau.y * 0.22 - tEau * 0.42 * courant)).rgb;
          vec3 v2 = texture2D(uVagues, vec2(vUvEau.x * 2.3 + 0.37, vUvEau.y * 0.47 - tEau * 0.8 * courant)).rgb;
          vec2 dn = v1.rg + v2.rg - 1.0;
          normal = normalize(normal + mat3(viewMatrix) * vec3(dn.x, 0.0, dn.y) * uForce * (1.0 + 1.5 * vPenteEau));
          // Fresnel : l'eau est transparente vue de dessus, réfléchissante en vue rasante.
          float fresnel = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 4.0);
          float rive = smoothstep(0.0, 0.2, vUvEau.x) * smoothstep(1.0, 0.8, vUvEau.x);
          float ecume = smoothstep(0.64, 0.86, v1.b * 0.5 + v2.b * 0.5 + vPenteEau * 0.7 + (1.0 - rive) * 0.14);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.93, 0.96), ecume);
          diffuseColor.a = mix(uOpacite, 0.94, max(fresnel, ecume))
            * smoothstep(0.0, 0.07, vUvEau.x) * smoothstep(1.0, 0.93, vUvEau.x);
          roughnessFactor = mix(roughnessFactor, 0.85, ecume);`);
    };
    this.materiaux.push(mat);
    return mat;
  }

  /** Ruban du ruisseau : la surface suit le lit, 32 cm au-dessus, sans jamais remonter. */
  _construireRuisseau() {
    const { trace, terrain } = this;
    const pas = 0.8;
    const nRangs = Math.ceil(trace.longueur / pas) + 1;
    const travers = [0, 0.2, 0.5, 0.8, 1];
    const nt = travers.length;
    const positions = new Float32Array(nRangs * nt * 3);
    const uvs = new Float32Array(nRangs * nt * 2);
    const pentes = new Float32Array(nRangs * nt);
    const centre = new THREE.Vector3();
    const tangente = new THREE.Vector3();

    // 1) niveau de l'eau à chaque rang
    this.niveaux = new Float32Array(nRangs);
    let precedent = Infinity;
    for (let r = 0; r < nRangs; r++) {
      const s = r / (nRangs - 1);
      trace.courbe.getPointAt(s, centre);
      trace.evaluer(centre.x, centre.z, _i);
      let y = terrain._relief(centre.x, centre.z, _i, true) + 0.32;
      y = Math.max(Math.min(y, precedent), terrain.niveauEtang + 0.015);
      this.niveaux[r] = y;
      precedent = y;
    }

    // 2) sommets
    for (let r = 0; r < nRangs; r++) {
      const s = r / (nRangs - 1);
      trace.courbe.getPointAt(s, centre);
      trace.courbe.getTangentAt(s, tangente);
      const demi = trace.demiLargeur(s) * 1.3;
      const avant = this.niveaux[Math.max(0, r - 2)];
      const apres = this.niveaux[Math.min(nRangs - 1, r + 2)];
      const pente = lisse(0.3, 0.8, (avant - apres) / (4 * pas));
      for (let c = 0; c < nt; c++) {
        const k = r * nt + c;
        const o = (travers[c] * 2 - 1) * demi;
        positions[k * 3] = centre.x - tangente.z * o;
        positions[k * 3 + 1] = this.niveaux[r];
        positions[k * 3 + 2] = centre.z + tangente.x * o;
        uvs[k * 2] = travers[c];
        uvs[k * 2 + 1] = (r * pas);
        pentes[k] = pente;
      }
    }
    const indices = [];
    for (let r = 0; r < nRangs - 1; r++) {
      for (let c = 0; c < nt - 1; c++) {
        const a = r * nt + c, b = a + 1, c2 = a + nt, d = c2 + 1;
        indices.push(a, b, c2, b, d, c2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('pente', new THREE.BufferAttribute(pentes, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    this.ruisseau = new THREE.Mesh(geo, this._creerMateriau({ vitesse: 1, force: 0.4 }));
    this.ruisseau.name = 'ruisseau';
    this.ruisseau.receiveShadow = true;
    this.ruisseau.renderOrder = 2;
    this.ruisseau.userData.sansOcclusion = true;
    this.groupe.add(this.ruisseau);
  }

  /** Étang : un disque dont le bord passe sous la berge. */
  _construireEtang() {
    const rayon = ETANG.rayon + 5;
    const segments = 40, anneaux = 6;
    const positions = [], uvs = [], pentes = [], indices = [];
    for (let a = 0; a <= anneaux; a++) {
      const r = (a / anneaux) * rayon;
      for (let sgm = 0; sgm < segments; sgm++) {
        const angle = (sgm / segments) * Math.PI * 2;
        const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
        positions.push(ETANG.x + x, this.terrain.niveauEtang, ETANG.z + z);
        // u = 0,5 au centre et 1 au bord (pour le fondu de rive) ; v défile lentement
        uvs.push(0.5 + 0.5 * (a / anneaux), (z + x * 0.3) * 0.5);
        pentes.push(0);
      }
    }
    for (let a = 0; a < anneaux; a++) {
      for (let sgm = 0; sgm < segments; sgm++) {
        const i0 = a * segments + sgm, i1 = a * segments + ((sgm + 1) % segments);
        indices.push(i0, i1, i0 + segments, i1, i1 + segments, i0 + segments);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('pente', new THREE.Float32BufferAttribute(pentes, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    this.etang = new THREE.Mesh(geo, this._creerMateriau({ vitesse: 0.12, force: 0.16, opacite: 0.72, couleur: 0x256f8c }));
    this.etang.name = 'etang';
    this.etang.receiveShadow = true;
    this.etang.renderOrder = 1;
    this.etang.userData.sansOcclusion = true;
    this.groupe.add(this.etang);
  }

  /** La source : un jet en cloche qui tombe dans le début du ruisseau, et ses gouttelettes. */
  _construireSource() {
    const { trace } = this;
    const depart = trace.point(0);
    const tangente = trace.courbe.getTangentAt(0, new THREE.Vector3());
    const yBas = this.niveaux[0];
    // Bouche de la source : 3 m en arrière du début du ruisseau, 2,4 m plus haut.
    this.bouche = new THREE.Vector3(depart.x - tangente.x * 3.2, yBas + 2.4, depart.z - tangente.z * 3.2);
    this.pointSource = new THREE.Vector3(depart.x, yBas, depart.z);

    // --- Le jet : un ruban qui suit une trajectoire de chute ---
    const n = 14, portee = 3.6, demi = 0.55;
    const positions = [], uvs = [], pentes = [], indices = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const avance = portee * t;
      const y = this.bouche.y - 2.4 * t * t + 0.25 * Math.sin(t * Math.PI) - (k === n ? 0.25 : 0);
      const cx = this.bouche.x + tangente.x * avance;
      const cz = this.bouche.z + tangente.z * avance;
      const l = demi * (0.75 + 0.6 * t);
      for (const u of [0, 0.5, 1]) {
        const o = (u * 2 - 1) * l;
        positions.push(cx - tangente.z * o, y + (u === 0.5 ? 0.12 : 0), cz + tangente.x * o);
        uvs.push(u, t * 5);
        pentes.push(0.75);
      }
      if (k < n) {
        const a = k * 3;
        indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('pente', new THREE.Float32BufferAttribute(pentes, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = this._creerMateriau({ vitesse: 3.2, force: 0.5, opacite: 0.7, couleur: 0x8fd0d8 });
    mat.side = THREE.DoubleSide;
    this.jet = new THREE.Mesh(geo, mat);
    this.jet.name = 'jet-source';
    this.jet.renderOrder = 3;
    this.jet.userData.sansOcclusion = true;
    this.groupe.add(this.jet);

    // --- Les gouttelettes : leur trajectoire est calculée dans le shader (aucun coût côté processeur) ---
    const nb = 220;
    const graines = new Float32Array(nb * 4);
    const pos = new Float32Array(nb * 3);
    for (let k = 0; k < nb; k++) {
      graines[k * 4] = Math.random();
      graines[k * 4 + 1] = Math.random();
      graines[k * 4 + 2] = Math.random();
      graines[k * 4 + 3] = Math.random();
    }
    const geoP = new THREE.BufferGeometry();
    geoP.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geoP.setAttribute('graine', new THREE.BufferAttribute(graines, 4));
    geoP.boundingSphere = new THREE.Sphere(this.pointSource.clone(), 8);
    const matP = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTemps: this.temps,
        uBouche: { value: this.bouche },
        uImpact: { value: this.pointSource },
        uDirection: { value: tangente },
        uEchelle: { value: 300 },
      },
      vertexShader: /* glsl */`
        attribute vec4 graine;
        uniform float uTemps, uEchelle;
        uniform vec3 uBouche, uImpact, uDirection;
        varying float vAlpha;
        void main() {
          float duree = 0.7 + graine.y * 0.5;
          float t = fract(uTemps / duree + graine.x);
          vec3 cote = vec3(-uDirection.z, 0.0, uDirection.x);
          vec3 p;
          if (graine.w < 0.45) {
            // gouttes qui accompagnent le jet
            p = uBouche + uDirection * (3.6 * t + graine.z * 0.3) + cote * (graine.z - 0.5) * 1.1 * (0.6 + t);
            p.y += -2.4 * t * t + 0.3 * sin(t * 3.14159) + graine.y * 0.25;
          } else {
            // éclaboussures au point de chute
            float angle = graine.z * 6.2832;
            float v = 0.8 + graine.y * 1.6;
            p = uImpact + uDirection * 0.5 + vec3(cos(angle), 0.0, sin(angle)) * v * t * 0.9;
            p.y += (2.6 + graine.x * 1.8) * t - 5.5 * t * t + 0.05;
          }
          vAlpha = sin(t * 3.14159) * 0.8;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.05 + graine.x * 0.07) * uEchelle / max(0.5, -mv.z);
        }`,
      fragmentShader: /* glsl */`
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.15, d) * vAlpha;
          gl_FragColor = vec4(vec3(1.6), a);
        }`,
    });
    this.gouttes = new THREE.Points(geoP, matP);
    this.gouttes.name = 'gouttes-source';
    this.gouttes.renderOrder = 4;
    this.groupe.add(this.gouttes);
  }

  /** Niveau de l'eau du ruisseau à l'avancement s (0 → 1). */
  niveau(s) {
    const r = Math.min(this.niveaux.length - 1, Math.max(0, Math.round(s * (this.niveaux.length - 1))));
    return this.niveaux[r];
  }

  /** À appeler quand la hauteur de l'image change (taille des gouttelettes à l'écran). */
  redimensionner(hauteurPixels) {
    this.gouttes.material.uniforms.uEchelle.value = hauteurPixels;
  }

  /** @param {number} temps temps écoulé en secondes */
  mettreAJour(temps) {
    this.temps.value = temps;
  }
}
