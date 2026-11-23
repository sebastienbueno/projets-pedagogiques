// =====================================================================
//  INTERFACE
//  Écran de chargement, compteur d'images/seconde, menu de réglages,
//  messages à l'écran. Tout est en HTML/CSS par-dessus le canevas 3D.
// =====================================================================

const $ = (id) => document.getElementById(id);

export class Interface {
  constructor() {
    this.el = {
      chargement: $('chargement'), barre: $('barre-progression'), etape: $('etape-chargement'),
      jouer: $('bouton-jouer'), erreur: $('erreur'),
      fps: $('compteur-fps'), menu: $('menu'), boutonMenu: $('bouton-menu'), fermerMenu: $('fermer-menu'),
      qualites: $('choix-qualite'), etatQualite: $('etat-qualite'),
      caseFps: $('case-fps'), caseSon: $('case-son'), volume: $('volume'),
      retour: $('bouton-source'), pleinEcran: $('bouton-plein-ecran'),
      message: $('message'), aide: $('aide'),
    };
    this.menuOuvert = false;
    this.surMenu = null;          // rappel (ouvert: boolean)
    this._minuterieMessage = 0;
    this._tempsFps = 0;

    this.el.boutonMenu.addEventListener('click', () => this.basculerMenu());
    this.el.fermerMenu.addEventListener('click', () => this.basculerMenu(false));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') this.basculerMenu();
      if (e.code === 'KeyF') { this.el.caseFps.checked = !this.el.caseFps.checked; this.el.caseFps.dispatchEvent(new Event('change')); }
    });
    this.el.caseFps.addEventListener('change', () => this.afficherFps(this.el.caseFps.checked));
    this.el.pleinEcran.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    });
  }

  // ---------- Chargement ----------

  /** @param {number} fraction 0 → 1 */
  progression(fraction, etape) {
    this.el.barre.style.width = `${Math.round(Math.min(1, fraction) * 100)}%`;
    this.el.barre.parentElement.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
    if (etape) this.el.etape.textContent = etape;
  }

  /** Affiche le bouton « Jouer » et résout la promesse quand on clique dessus. */
  attendreJouer() {
    this.el.etape.textContent = 'Prêt !';
    this.el.jouer.hidden = false;
    this.el.jouer.focus();
    return new Promise((resoudre) => {
      this.el.jouer.addEventListener('click', () => {
        this.el.chargement.classList.add('termine');
        setTimeout(() => { this.el.chargement.hidden = true; }, 700);
        resoudre();
      }, { once: true });
    });
  }

  erreur(texte) {
    this.el.erreur.textContent = texte;
    this.el.erreur.hidden = false;
    this.el.etape.textContent = 'Chargement interrompu';
  }

  // ---------- Menu ----------

  basculerMenu(ouvert = !this.menuOuvert) {
    if (!this.el.chargement.hidden) return;
    this.menuOuvert = ouvert;
    this.el.menu.hidden = !ouvert;
    if (this.surMenu) this.surMenu(ouvert);
  }

  /**
   * Branche le menu sur le reste du jeu.
   * @param {object} actions { qualite(mode), son(actif), volume(v), retour() }
   */
  brancher(actions, modeQualite) {
    for (const bouton of this.el.qualites.querySelectorAll('button')) {
      bouton.addEventListener('click', () => actions.qualite(bouton.dataset.qualite));
    }
    this.el.caseSon.addEventListener('change', () => actions.son(this.el.caseSon.checked));
    this.el.volume.addEventListener('input', () => actions.volume(Number(this.el.volume.value) / 100));
    this.el.retour.addEventListener('click', () => { actions.retour(); this.basculerMenu(false); });
    this.marquerQualite(modeQualite, '');
  }

  /** Met à jour les boutons de qualité et la ligne d'état. */
  marquerQualite(mode, etat) {
    for (const bouton of this.el.qualites.querySelectorAll('button')) {
      bouton.setAttribute('aria-pressed', String(bouton.dataset.qualite === mode));
    }
    this.el.etatQualite.textContent = etat;
  }

  // ---------- Compteur d'images/seconde ----------

  afficherFps(visible) {
    this.el.caseFps.checked = visible;
    this.el.fps.hidden = !visible;
  }

  /** Rafraîchi quatre fois par seconde seulement (écrire dans la page a un coût). */
  majFps(dt, fps, texteQualite, infos) {
    this._tempsFps += dt;
    if (this._tempsFps < 0.25 || this.el.fps.hidden) return;
    this._tempsFps = 0;
    this.el.fps.textContent = `${Math.round(fps)} i/s · ${texteQualite}\n${infos}`;
  }

  // ---------- Messages ----------

  /** Affiche un message quelques secondes (deux lignes possibles : espagnol puis français). */
  message(titre, sousTitre = '', duree = 5) {
    const m = this.el.message;
    m.innerHTML = '';
    const a = document.createElement('strong');
    a.textContent = titre;
    m.append(a);
    if (sousTitre) {
      const b = document.createElement('span');
      b.textContent = sousTitre;
      m.append(b);
    }
    m.classList.add('visible');
    clearTimeout(this._minuterieMessage);
    this._minuterieMessage = setTimeout(() => m.classList.remove('visible'), duree * 1000);
  }

  /** Affiche l'aide des commandes adaptée (clavier ou tactile), puis l'efface. */
  aide(tactile) {
    this.el.aide.textContent = tactile
      ? 'Pouce gauche : se déplacer (à fond pour courir) · Glisser à droite : regarder · Bouton : sauter'
      : 'Flèches ou ZQSD : se déplacer · Maj : courir · Espace : sauter · Cliquer-glisser : regarder · Molette : zoom';
    this.el.aide.classList.add('visible');
    clearTimeout(this._minuterieAide);
    this._minuterieAide = setTimeout(() => this.el.aide.classList.remove('visible'), 12000);
  }
}
