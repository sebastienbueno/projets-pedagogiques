// =====================================================================
//  CHARGEMENT DES MODÈLES (GLB)
//  Charge plusieurs fichiers en parallèle et rapporte l'avancement global
//  pour la barre de progression.
// =====================================================================
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * @param {Record<string, string>} fichiers  nom → adresse du fichier .glb
 * @param {(fraction: number) => void} surProgression  appelé avec une valeur de 0 à 1
 * @returns {Promise<Record<string, object>>} nom → résultat glTF (scene, animations...)
 */
export async function chargerModeles(fichiers, surProgression) {
  const chargeur = new GLTFLoader();
  const noms = Object.keys(fichiers);
  const avancement = Object.fromEntries(noms.map((n) => [n, 0]));
  const signaler = () => {
    const somme = noms.reduce((s, n) => s + avancement[n], 0);
    surProgression(somme / noms.length);
  };
  const resultats = await Promise.all(noms.map((nom) => new Promise((resoudre, rejeter) => {
    chargeur.load(
      fichiers[nom],
      (gltf) => { avancement[nom] = 1; signaler(); resoudre(gltf); },
      (e) => {
        // La taille totale n'est pas toujours connue (fichiers compressés par le serveur).
        if (e.lengthComputable && e.total > 0) { avancement[nom] = Math.min(0.99, e.loaded / e.total); signaler(); }
      },
      () => rejeter(new Error(`Impossible de charger « ${fichiers[nom]} ».`)),
    );
  })));
  return Object.fromEntries(noms.map((nom, i) => [nom, resultats[i]]));
}
