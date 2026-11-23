// =====================================================================
//  BRUIT ET HASARD REPRODUCTIBLES
//  Tout le décor est « procédural » : il est recalculé à l'identique à
//  chaque chargement grâce à ces fonctions (mêmes graines = même monde).
// =====================================================================
import * as THREE from 'three';

/** Générateur pseudo-aléatoire à graine (mulberry32). Renvoie une fonction → [0, 1[. */
export function creerAlea(graine) {
  let a = graine >>> 0;
  return function alea() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hachage d'une case de grille → [0, 1[. */
function hachage(ix, iy, graine) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(graine, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Interpolation douce (smoothstep). Fonctionne aussi quand a > b (rampe inversée). */
export function lisse(a, b, x) {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

export function melange(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Bruit de valeur 2D lissé → [0, 1].
 * `periode` (optionnelle) rend le motif répétable, utile pour les textures.
 */
export function bruit2D(x, y, graine = 0, periode = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  let x0 = ix, x1 = ix + 1, y0 = iy, y1 = iy + 1;
  if (periode > 0) {
    x0 = ((x0 % periode) + periode) % periode;
    x1 = ((x1 % periode) + periode) % periode;
    y0 = ((y0 % periode) + periode) % periode;
    y1 = ((y1 % periode) + periode) % periode;
  }
  const a = hachage(x0, y0, graine);
  const b = hachage(x1, y0, graine);
  const c = hachage(x0, y1, graine);
  const d = hachage(x1, y1, graine);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Bruit fractal (somme d'octaves) → environ [0, 1]. */
export function fbm(x, y, octaves = 4, graine = 0, periode = 0) {
  let somme = 0, amplitude = 0.5, total = 0;
  for (let o = 0; o < octaves; o++) {
    somme += amplitude * bruit2D(x, y, graine + o * 17, periode);
    total += amplitude;
    x *= 2; y *= 2; amplitude *= 0.5;
    if (periode > 0) periode *= 2;
  }
  return somme / total;
}

/** Bruit « à crêtes » : dessine des arêtes de montagne → [0, 1]. */
export function cretes(x, y, octaves = 4, graine = 0) {
  let somme = 0, amplitude = 0.5, total = 0, precedent = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(bruit2D(x, y, graine + o * 31) * 2 - 1);
    n *= n;
    somme += n * amplitude * precedent;
    total += amplitude;
    precedent = 0.4 + 0.6 * n;
    x *= 2.03; y *= 2.03; amplitude *= 0.5;
  }
  return somme / total;
}

/**
 * Texture de bruit répétable (RVB = trois bruits indépendants).
 * Sert à casser l'uniformité des couleurs du terrain sans télécharger d'image.
 */
export function creerTextureBruit(taille = 256) {
  const donnees = new Uint8Array(taille * taille * 4);
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      const i = (y * taille + x) * 4;
      donnees[i] = 255 * fbm(x / 32, y / 32, 5, 11, 8);
      donnees[i + 1] = 255 * fbm(x / 16, y / 16, 4, 23, 16);
      donnees[i + 2] = 255 * fbm(x / 8, y / 8, 3, 37, 32);
      donnees[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(donnees, taille, taille, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Carte de normales répétable pour l'eau : on calcule les pentes d'un relief de bruit.
 * RV = pente en x / y (centrée sur 0,5), B = bruit brut (sert à l'écume).
 */
export function creerTextureVagues(taille = 256) {
  const relief = new Float32Array(taille * taille);
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      relief[y * taille + x] = fbm(x / 32, y / 32, 4, 71, 8);
    }
  }
  const donnees = new Uint8Array(taille * taille * 4);
  const lire = (x, y) => relief[((y + taille) % taille) * taille + ((x + taille) % taille)];
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      const i = (y * taille + x) * 4;
      const dx = (lire(x + 1, y) - lire(x - 1, y)) * 6;
      const dy = (lire(x, y + 1) - lire(x, y - 1)) * 6;
      donnees[i] = 255 * Math.min(1, Math.max(0, 0.5 + dx));
      donnees[i + 1] = 255 * Math.min(1, Math.max(0, 0.5 + dy));
      donnees[i + 2] = 255 * fbm(x / 8, y / 8, 3, 97, 32);
      donnees[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(donnees, taille, taille, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
