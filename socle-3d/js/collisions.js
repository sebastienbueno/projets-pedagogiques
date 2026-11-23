// =====================================================================
//  COLLISIONS AVEC LE DÉCOR
//  Les obstacles sont des formes simples vues de dessus : des cercles
//  (arbres, rochers, puits) et des rectangles orientés (bâtiments).
//  Ils sont rangés dans une grille pour ne tester que les voisins.
//  Le sol, lui, est géré par le terrain (terrain.hauteur).
// =====================================================================

const TAILLE_CASE = 16;

export class Collisions {
  constructor() {
    /** @type {Map<number, object[]>} */
    this.cases = new Map();
    this.nombre = 0;
  }

  _cle(cx, cz) {
    return (cx + 512) * 4096 + (cz + 512);
  }

  _ranger(obstacle, rayonEnglobant) {
    const x0 = Math.floor((obstacle.x - rayonEnglobant) / TAILLE_CASE);
    const x1 = Math.floor((obstacle.x + rayonEnglobant) / TAILLE_CASE);
    const z0 = Math.floor((obstacle.z - rayonEnglobant) / TAILLE_CASE);
    const z1 = Math.floor((obstacle.z + rayonEnglobant) / TAILLE_CASE);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const cle = this._cle(cx, cz);
        let liste = this.cases.get(cle);
        if (!liste) { liste = []; this.cases.set(cle, liste); }
        liste.push(obstacle);
      }
    }
    this.nombre++;
  }

  /**
   * Ajoute un obstacle rond.
   * @param {number} sommet altitude du haut de l'obstacle (au-dessus, on passe)
   * @param {boolean} cacheCamera vrai si la caméra ne doit pas pouvoir entrer dedans
   */
  ajouterCercle(x, z, rayon, sommet, cacheCamera = false) {
    this._ranger({ type: 0, x, z, rayon, sommet, cacheCamera }, rayon);
  }

  /** Ajoute un obstacle rectangulaire tourné de `angle` radians autour de la verticale. */
  ajouterBoite(x, z, demiX, demiZ, angle, sommet, cacheCamera = true) {
    this._ranger({
      type: 1, x, z, demiX, demiZ, cos: Math.cos(angle), sin: Math.sin(angle), sommet, cacheCamera,
    }, Math.hypot(demiX, demiZ));
  }

  /**
   * Repousse un cylindre vertical (le personnage) hors des obstacles.
   * Modifie pos.x / pos.z et renvoie vrai s'il y a eu contact.
   */
  resoudre(pos, rayon) {
    let contact = false;
    // Deux passes : la sortie d'un obstacle peut faire entrer dans son voisin.
    for (let passe = 0; passe < 2; passe++) {
      const liste = this.cases.get(this._cle(Math.floor(pos.x / TAILLE_CASE), Math.floor(pos.z / TAILLE_CASE)));
      if (!liste) return contact;
      for (const o of liste) {
        if (pos.y > o.sommet - 0.15) continue;
        if (o.type === 0) {
          const dx = pos.x - o.x, dz = pos.z - o.z;
          const mini = o.rayon + rayon;
          const d2 = dx * dx + dz * dz;
          if (d2 < mini * mini) {
            const d = Math.sqrt(d2) || 0.0001;
            pos.x = o.x + (dx / d) * mini;
            pos.z = o.z + (dz / d) * mini;
            contact = true;
          }
        } else {
          // Passage dans le repère du rectangle.
          const dx = pos.x - o.x, dz = pos.z - o.z;
          let lx = dx * o.cos - dz * o.sin;
          let lz = dx * o.sin + dz * o.cos;
          const px = Math.max(-o.demiX, Math.min(o.demiX, lx));
          const pz = Math.max(-o.demiZ, Math.min(o.demiZ, lz));
          let ex = lx - px, ez = lz - pz;
          const d2 = ex * ex + ez * ez;
          if (d2 >= rayon * rayon) continue;
          if (d2 > 1e-8) {
            // centre à l'extérieur du rectangle : on s'écarte du point le plus proche
            const d = Math.sqrt(d2);
            lx = px + (ex / d) * rayon;
            lz = pz + (ez / d) * rayon;
          } else {
            // centre à l'intérieur : on sort par le côté le plus proche
            const mx = o.demiX - Math.abs(lx), mz = o.demiZ - Math.abs(lz);
            if (mx < mz) lx = Math.sign(lx || 1) * (o.demiX + rayon);
            else lz = Math.sign(lz || 1) * (o.demiZ + rayon);
          }
          pos.x = o.x + lx * o.cos + lz * o.sin;
          pos.z = o.z - lx * o.sin + lz * o.cos;
          contact = true;
        }
      }
    }
    return contact;
  }

  /** Vrai si le point est à l'intérieur d'un obstacle opaque (utilisé par la caméra). */
  contient(x, y, z, marge = 0.3) {
    const liste = this.cases.get(this._cle(Math.floor(x / TAILLE_CASE), Math.floor(z / TAILLE_CASE)));
    if (!liste) return false;
    for (const o of liste) {
      if (!o.cacheCamera || y > o.sommet + marge) continue;
      const dx = x - o.x, dz = z - o.z;
      if (o.type === 0) {
        const r = o.rayon + marge;
        if (dx * dx + dz * dz < r * r) return true;
      } else {
        const lx = dx * o.cos - dz * o.sin;
        const lz = dx * o.sin + dz * o.cos;
        if (Math.abs(lx) < o.demiX + marge && Math.abs(lz) < o.demiZ + marge) return true;
      }
    }
    return false;
  }
}
