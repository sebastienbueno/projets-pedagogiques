// =====================================================================
//  AMBIANCE SONORE
//  Aucun fichier audio : les sons d'eau et de vent sont synthétisés au
//  chargement (bruit filtré), puis placés dans l'espace avec l'API Web Audio :
//   - la source (cascade) est fixe : on l'entend de plus en plus en approchant ;
//   - le clapotis du ruisseau suit le point du ruisseau le plus proche ;
//   - la roue du moulin à eau ;
//   - un fond de vent, plus présent en altitude.
//  Les navigateurs interdisent le son avant un geste de l'utilisateur :
//  tout démarre donc au clic sur « Jouer ».
// =====================================================================
import * as THREE from 'three';

const _info = { d: 0, s: 0, cote: 1, H: 0 };
const _p = new THREE.Vector3();

/**
 * Fabrique une boucle de bruit filtré.
 * @param {number} grave  fréquence de coupure basse (Hz)
 * @param {number} aigu   fréquence de coupure haute (Hz)
 * @param {number} remous intensité des variations rapides de volume (0 = son continu)
 */
function creerBoucle(contexte, duree, grave, aigu, remous, graine = 1) {
  const frequence = contexte.sampleRate;
  const n = Math.floor(duree * frequence);
  const tampon = contexte.createBuffer(1, n, frequence);
  const d = tampon.getChannelData(0);
  let etat = graine * 9973;
  const hasard = () => { etat = (etat * 1664525 + 1013904223) % 4294967296; return etat / 2147483648 - 1; };
  const kAigu = 1 - Math.exp((-2 * Math.PI * aigu) / frequence);
  const kGrave = 1 - Math.exp((-2 * Math.PI * grave) / frequence);
  let bas1 = 0, bas2 = 0, haut = 0, modulation = 1, cibleModulation = 1;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const blanc = hasard();
    bas1 += kAigu * (blanc - bas1);          // deux passe-bas en série : coupe les aigus
    bas2 += kAigu * (bas1 - bas2);
    haut += kGrave * (bas2 - haut);          // passe-haut : retire les graves
    let v = bas2 - haut;
    if (remous > 0) {
      // « glouglou » : le volume saute d'une valeur à l'autre plusieurs fois par seconde
      if (i % Math.floor(frequence / 14) === 0) cibleModulation = 1 - remous * (0.5 + 0.5 * hasard());
      modulation += (cibleModulation - modulation) * 0.002;
      v *= modulation;
    }
    d[i] = v;
    max = Math.max(max, Math.abs(v));
  }
  // Raccord de la boucle : la fin se fond dans le début (pas de « clic »).
  const fondu = Math.floor(0.4 * frequence);
  for (let i = 0; i < fondu; i++) {
    const t = i / fondu;
    d[n - fondu + i] = d[n - fondu + i] * (1 - t) + d[i] * t;
  }
  for (let i = 0; i < n; i++) d[i] *= 0.9 / max;
  return tampon;
}

export class Ambiance {
  /** @param {THREE.Camera} camera l'« oreille » du joueur */
  constructor(camera) {
    this.camera = camera;
    this.demarree = false;
    this.volume = 0.8;
    this.muet = false;
  }

  /**
   * À appeler dans un geste de l'utilisateur (clic sur « Jouer »).
   * @param {import('./eau.js').Eau} eau
   * @param {THREE.Vector3} positionMoulin
   */
  demarrer(eau, positionMoulin) {
    if (this.demarree) return;
    try {
      this.ecouteur = new THREE.AudioListener();
      this.camera.add(this.ecouteur);
      const ctx = this.ecouteur.context;
      if (ctx.state === 'suspended') ctx.resume();
      this.eau = eau;

      const creerEmetteur = (tampon, volume, distanceRef, attenuation) => {
        const son = new THREE.PositionalAudio(this.ecouteur);
        son.setBuffer(tampon);
        son.setLoop(true);
        son.setVolume(volume);
        son.setRefDistance(distanceRef);
        son.setRolloffFactor(attenuation);
        son.setDistanceModel('exponential');
        son.panner.panningModel = 'equalpower';   // bien moins coûteux que le mode HRTF par défaut
        return son;
      };

      // La source : un son plein et continu.
      this.sonSource = creerEmetteur(creerBoucle(ctx, 4, 250, 5200, 0.25, 3), 1.0, 5, 1.5);
      this.sonSource.position.copy(eau.pointSource);
      // Le ruisseau : un clapotis qui suit le joueur le long de l'eau.
      this.sonRuisseau = creerEmetteur(creerBoucle(ctx, 5, 500, 3400, 0.8, 7), 0.55, 4, 1.4);
      // Le moulin : un battement d'eau plus grave.
      this.sonMoulin = creerEmetteur(creerBoucle(ctx, 3, 150, 1500, 0.9, 11), 0.6, 4, 1.6);
      this.sonMoulin.position.copy(positionMoulin);
      this.emetteurs = new THREE.Group();
      this.emetteurs.add(this.sonSource, this.sonRuisseau, this.sonMoulin);

      // Le vent : non localisé.
      this.sonVent = new THREE.Audio(this.ecouteur);
      this.sonVent.setBuffer(creerBoucle(ctx, 6, 60, 420, 0.5, 5));
      this.sonVent.setLoop(true);
      this.sonVent.setVolume(0.1);

      for (const son of [this.sonSource, this.sonRuisseau, this.sonMoulin, this.sonVent]) son.play();
      this.ecouteur.setMasterVolume(this.muet ? 0 : this.volume);
      this.demarree = true;
    } catch (erreur) {
      console.warn('Son indisponible :', erreur);
    }
    return this.emetteurs;
  }

  reglerVolume(volume) {
    this.volume = volume;
    if (this.demarree) this.ecouteur.setMasterVolume(this.muet ? 0 : volume);
  }

  couper(muet) {
    this.muet = muet;
    if (this.demarree) this.ecouteur.setMasterVolume(muet ? 0 : this.volume);
  }

  /** Met en pause quand l'onglet est caché. */
  suspendre(oui) {
    if (!this.demarree) return;
    const ctx = this.ecouteur.context;
    if (oui && ctx.state === 'running') ctx.suspend();
    if (!oui && ctx.state === 'suspended') ctx.resume();
  }

  mettreAJour(dt, trace) {
    if (!this.demarree) return;
    // Le clapotis se place sur le point du ruisseau le plus proche de la caméra.
    const c = this.camera.position;
    trace.evaluer(c.x, c.z, _info);
    trace.point(_info.s, 0, _p);
    _p.y = this.eau.niveau(_info.s);
    this.sonRuisseau.position.lerp(_p, Math.min(1, dt * 6));
    // Le vent forcit avec l'altitude.
    const vent = 0.06 + 0.2 * THREE.MathUtils.smoothstep(c.y, 30, 130);
    this.sonVent.setVolume(vent);
  }
}
