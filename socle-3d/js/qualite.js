// =====================================================================
//  QUALITÉ ADAPTATIVE
//  Objectif : 60 images/seconde, même sur une carte graphique intégrée.
//  En mode « auto », on mesure les images/seconde en continu :
//   - si elles chutent, on réduit d'abord la résolution, puis on descend
//     d'un niveau de qualité (ombres, post-traitement, végétation) ;
//   - si elles restent longtemps au maximum, on remonte prudemment.
//  Un niveau qui a échoué deux fois n'est plus retenté (pas d'oscillation).
//  Le joueur peut aussi imposer bas / moyen / élevé depuis le menu.
// =====================================================================
import { QUALITES, ORDRE_QUALITES } from './config.js';

const FPS_BAS = 50;        // en dessous : on allège
const FPS_BON = 57;        // au-dessus, durablement : on peut remonter
const FENETRE = 1.5;       // durée d'une mesure (secondes)
const ECHELLE_MIN = 0.55;

export class GestionQualite {
  /**
   * @param {(qualite: object, cle: string) => void} appliquerNiveau appelé quand le niveau change
   * @param {(echelle: number) => void} appliquerEchelle appelé quand la résolution dynamique change
   */
  constructor(appliquerNiveau, appliquerEchelle) {
    this.appliquerNiveau = appliquerNiveau;
    this.appliquerEchelle = appliquerEchelle;
    this.mode = 'auto';
    this.niveau = 'moyen';
    this.echelle = 1;
    this.fps = 60;                    // moyenne glissante, pour l'affichage
    this.echecs = { bas: 0, moyen: 0, eleve: 0 };
    this._temps = 0;
    this._images = 0;
    this._repos = 3;                  // secondes à ignorer après un changement (compilation des shaders)
    this._bonnesFenetres = 0;
    this.surChangement = null;        // rappel pour l'interface

    try {
      const memoire = localStorage.getItem('socle3d-qualite');
      if (memoire === 'auto' || QUALITES[memoire]) this.mode = memoire;
    } catch { /* stockage indisponible : sans importance */ }
    if (this.mode !== 'auto') this.niveau = this.mode;
  }

  /** Applique le niveau de départ. */
  demarrer() {
    this.appliquerNiveau(QUALITES[this.niveau], this.niveau);
    this.appliquerEchelle(this.echelle);
    this._signaler();
  }

  /** Choix du joueur : 'auto', 'bas', 'moyen' ou 'eleve'. */
  choisir(mode, memoriser = true) {
    this.mode = mode;
    if (memoriser) {
      try { localStorage.setItem('socle3d-qualite', mode); } catch { /* sans importance */ }
    }
    if (mode !== 'auto') this._changer(mode, 1);
    else { this.echecs = { bas: 0, moyen: 0, eleve: 0 }; this._repos = 2; this._signaler(); }
  }

  _changer(niveau, echelle) {
    const niveauChange = niveau !== this.niveau;
    this.niveau = niveau;
    this.echelle = echelle;
    if (niveauChange) this.appliquerNiveau(QUALITES[niveau], niveau);
    this.appliquerEchelle(echelle);
    this._repos = niveauChange ? 3 : 1;
    this._temps = 0; this._images = 0; this._bonnesFenetres = 0;
    this._signaler();
  }

  _signaler() {
    if (this.surChangement) this.surChangement(this);
  }

  /** À appeler quand l'onglet redevient visible : l'image suivante, anormalement longue, ne compte pas. */
  ignorerProchaineImage() {
    this._ignorer = true;
  }

  /** À appeler à chaque image avec la durée réelle de l'image (secondes). */
  mesurer(dt) {
    if (this._ignorer) { this._ignorer = false; return; }
    dt = Math.min(dt, 1);
    this.fps += (1 / Math.max(dt, 0.001) - this.fps) * Math.min(1, dt * 4);
    if (this._repos > 0) { this._repos -= dt; return; }
    this._temps += dt;
    this._images++;
    if (this._temps < FENETRE) return;
    const fps = this._images / this._temps;
    this._temps = 0; this._images = 0;
    if (this.mode !== 'auto') return;

    const rang = ORDRE_QUALITES.indexOf(this.niveau);
    if (fps < FPS_BAS) {
      this._bonnesFenetres = 0;
      if (this.echelle > 0.72) {
        // 1) on réduit la résolution (davantage si la chute est forte)
        this._changer(this.niveau, Math.max(0.7, this.echelle - (fps < 35 ? 0.3 : 0.15)));
      } else if (rang > 0) {
        // 2) on descend d'un niveau de qualité
        this.echecs[this.niveau]++;
        this._changer(ORDRE_QUALITES[rang - 1], 1);
      } else if (this.echelle > ECHELLE_MIN) {
        // 3) déjà au niveau le plus bas : on réduit encore la résolution
        this._changer(this.niveau, Math.max(ECHELLE_MIN, this.echelle - 0.15));
      }
    } else if (fps >= FPS_BON) {
      this._bonnesFenetres++;
      if (this._bonnesFenetres >= 6) {
        if (this.echelle < 1) {
          this._changer(this.niveau, Math.min(1, this.echelle + 0.15));
        } else if (rang < ORDRE_QUALITES.length - 1 && this.echecs[ORDRE_QUALITES[rang + 1]] < 2) {
          this._changer(ORDRE_QUALITES[rang + 1], 1);
        } else {
          this._bonnesFenetres = 0;
        }
      }
    } else {
      this._bonnesFenetres = 0;
    }
  }
}
