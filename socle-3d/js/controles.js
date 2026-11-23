// =====================================================================
//  CONTRÔLES
//  Réunit clavier, souris et écran tactile en un seul objet « commandes »
//  que le reste du jeu lit à chaque image :
//    x, y     déplacement voulu (−1 → 1) ;   courir   booléen ;
//    saut     vrai pendant une image quand on vient d'appuyer ;
//    rotX/Y   rotation de caméra demandée (radians) ;   zoom   molette.
//  Clavier : flèches ou ZQSD/WASD (on lit la position physique des touches,
//  donc AZERTY et QWERTY fonctionnent tous deux), Maj = courir, Espace = saut.
//  Souris : cliquer-glisser pour tourner la caméra, molette pour zoomer.
//  Tactile : joystick à gauche, glisser à droite pour la caméra, bouton de saut.
// =====================================================================
import { CONFIG } from './config.js';

export class Controles {
  /**
   * @param {HTMLElement} zone élément qui reçoit la souris et les doigts (le canevas)
   * @param {object} elements { joystick, manette, boutonSaut, boutonCourse }
   */
  constructor(zone, elements) {
    this.zone = zone;
    this.el = elements;
    this.actif = false;                 // faux tant que le jeu n'a pas commencé ou quand un menu est ouvert
    this.touches = new Set();
    this.tactile = false;
    this.commandes = { x: 0, y: 0, courir: false, saut: false, rotX: 0, rotY: 0, zoom: 0 };
    this._sautDemande = false;
    this._rotX = 0; this._rotY = 0; this._zoom = 0;
    this._joystick = { id: null, x0: 0, y0: 0, x: 0, y: 0 };
    this._regard = { id: null, x: 0, y: 0 };
    this._souris = { glisse: false };
    this._courseTactile = false;
    this.surPremierGeste = null;        // rappel au tout premier geste tactile

    this._clavier();
    this._sourisEtDoigts();
  }

  _clavier() {
    const jeu = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight']);
    window.addEventListener('keydown', (e) => {
      if (!this.actif) return;
      if (jeu.has(e.code)) e.preventDefault();      // évite que la page défile
      if (e.code === 'Space' && !e.repeat) this._sautDemande = true;
      this.touches.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.touches.delete(e.code));
    // Si la fenêtre perd le focus, on relâche tout (sinon le personnage continue de courir).
    window.addEventListener('blur', () => this.touches.clear());
  }

  _sourisEtDoigts() {
    const zone = this.zone;
    zone.addEventListener('contextmenu', (e) => e.preventDefault());

    zone.addEventListener('pointerdown', (e) => {
      if (!this.actif) return;
      if (e.pointerType === 'touch') {
        this._activerTactile();
        const gauche = e.clientX < window.innerWidth * 0.45;
        if (gauche && this._joystick.id === null) {
          // Le joystick apparaît sous le doigt.
          Object.assign(this._joystick, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 });
          this._dessinerJoystick(true);
        } else if (this._regard.id === null) {
          Object.assign(this._regard, { id: e.pointerId, x: e.clientX, y: e.clientY });
        }
      } else {
        this._souris.glisse = true;
        Object.assign(this._regard, { x: e.clientX, y: e.clientY });
      }
      try { zone.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché : sans importance */ }
    });

    zone.addEventListener('pointermove', (e) => {
      if (!this.actif) return;
      if (e.pointerType === 'touch') {
        if (e.pointerId === this._joystick.id) {
          const rayon = 56;
          let dx = e.clientX - this._joystick.x0, dy = e.clientY - this._joystick.y0;
          const l = Math.hypot(dx, dy);
          if (l > rayon) { dx *= rayon / l; dy *= rayon / l; }
          this._joystick.x = dx / rayon;
          this._joystick.y = -dy / rayon;
          this._dessinerJoystick(true);
        } else if (e.pointerId === this._regard.id) {
          this._rotX += (e.clientX - this._regard.x) * CONFIG.camera.sensibiliteTactile;
          this._rotY += (e.clientY - this._regard.y) * CONFIG.camera.sensibiliteTactile;
          this._regard.x = e.clientX; this._regard.y = e.clientY;
        }
      } else if (this._souris.glisse) {
        this._rotX += (e.clientX - this._regard.x) * CONFIG.camera.sensibiliteSouris * 1.6;
        this._rotY += (e.clientY - this._regard.y) * CONFIG.camera.sensibiliteSouris * 1.6;
        this._regard.x = e.clientX; this._regard.y = e.clientY;
      }
    });

    const fin = (e) => {
      if (e.pointerType === 'touch') {
        if (e.pointerId === this._joystick.id) {
          Object.assign(this._joystick, { id: null, x: 0, y: 0 });
          this._dessinerJoystick(false);
        }
        if (e.pointerId === this._regard.id) this._regard.id = null;
      } else {
        this._souris.glisse = false;
      }
    };
    zone.addEventListener('pointerup', fin);
    zone.addEventListener('pointercancel', fin);

    zone.addEventListener('wheel', (e) => {
      if (!this.actif) return;
      e.preventDefault();
      this._zoom += Math.sign(e.deltaY) * 0.1;
    }, { passive: false });

    // Boutons tactiles
    const { boutonSaut, boutonCourse } = this.el;
    if (boutonSaut) {
      boutonSaut.addEventListener('pointerdown', (e) => { e.preventDefault(); this._sautDemande = true; });
    }
    if (boutonCourse) {
      boutonCourse.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this._courseTactile = !this._courseTactile;
        boutonCourse.classList.toggle('actif', this._courseTactile);
      });
    }
  }

  /** Affiche les commandes tactiles dès le premier contact du doigt. */
  _activerTactile() {
    if (this.tactile) return;
    this.tactile = true;
    document.body.classList.add('tactile');
    if (this.surPremierGeste) this.surPremierGeste();
  }

  _dessinerJoystick(visible) {
    const { joystick, manette } = this.el;
    if (!joystick) return;
    joystick.classList.toggle('visible', visible);
    if (visible) {
      joystick.style.left = `${this._joystick.x0}px`;
      joystick.style.top = `${this._joystick.y0}px`;
      manette.style.transform = `translate(${this._joystick.x * 56}px, ${-this._joystick.y * 56}px)`;
    }
  }

  /** Simule un appui (utilisé par les tests automatiques et la démonstration). */
  forcer(x, y, courir = false, saut = false) {
    this._force = { x, y, courir };
    if (saut) this._sautDemande = true;
  }

  liberer() {
    this._force = null;
  }

  /** À appeler une fois par image : calcule l'objet `commandes`. */
  lire() {
    const c = this.commandes, t = this.touches;
    let x = 0, y = 0;
    if (t.has('ArrowLeft') || t.has('KeyA')) x -= 1;
    if (t.has('ArrowRight') || t.has('KeyD')) x += 1;
    if (t.has('ArrowUp') || t.has('KeyW')) y += 1;
    if (t.has('ArrowDown') || t.has('KeyS')) y -= 1;
    let courir = t.has('ShiftLeft') || t.has('ShiftRight');

    // Joystick : analogique. Poussé à fond, on court.
    if (this._joystick.id !== null) {
      x = this._joystick.x; y = this._joystick.y;
      const force = Math.hypot(x, y);
      if (force < 0.15) { x = 0; y = 0; }
      courir = this._courseTactile || force > 0.92;
      if (courir && force > 0.15) { x /= force; y /= force; }   // pleine vitesse de course
    }
    if (this._force) { x = this._force.x; y = this._force.y; courir = this._force.courir; }

    c.x = this.actif ? x : 0;
    c.y = this.actif ? y : 0;
    c.courir = courir;
    c.saut = this.actif && this._sautDemande;
    c.rotX = this._rotX; c.rotY = this._rotY; c.zoom = this._zoom;
    this._sautDemande = false;
    this._rotX = this._rotY = this._zoom = 0;
    return c;
  }
}
