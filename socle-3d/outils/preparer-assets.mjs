// Outil facultatif (Node.js) : régénère les fichiers GLB du dossier assets/modeles
// à partir des packs KayKit d'origine (CC0). Il n'est PAS nécessaire pour lancer la démo.
//
//   npm i @gltf-transform/core @gltf-transform/functions
//   node preparer-assets.mjs <dossier KayKit Adventurers> <dossier KayKit Medieval Hexagon> <dossier de sortie>
//
// - personnage.glb : un aventurier, sans ses armes, avec seulement les animations utiles ;
// - nature.glb et village.glb : tous les modèles du décor réunis (une seule texture partagée).
import { NodeIO } from '@gltf-transform/core';
import { mergeDocuments, dedup, prune, unpartition, resample } from '@gltf-transform/functions';

const [dossierPerso, dossierHexa, sortie] = process.argv.slice(2);
const io = new NodeIO();

// ---------- Personnage ----------
const ANIMATIONS_GARDEES = [
  'Idle', 'Walking_A', 'Running_A', 'Jump_Start', 'Jump_Idle', 'Jump_Land',
  // quelques animations en réserve pour les futurs jeux (dialogues, récompenses, objets)
  'Cheer', 'Interact', 'PickUp', 'Sit_Floor_Idle',
];
const ARMES = ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable'];
{
  const doc = await io.read(`${dossierPerso}/Characters/gltf/Rogue.glb`);
  const racine = doc.getRoot();
  for (const anim of racine.listAnimations()) {
    if (!ANIMATIONS_GARDEES.includes(anim.getName())) anim.dispose();
  }
  for (const noeud of racine.listNodes()) {
    if (ARMES.includes(noeud.getName())) noeud.setMesh(null);
  }
  await doc.transform(resample(), prune({ keepLeaves: true }), dedup());
  await io.write(`${sortie}/personnage.glb`, doc);
}

// ---------- Décor ----------
const NATURE = ['tree_single_A', 'tree_single_B', 'rock_single_A', 'rock_single_B', 'rock_single_C',
  'rock_single_D', 'rock_single_E', 'mountain_A', 'mountain_B', 'mountain_C', 'cloud_big', 'cloud_small']
  .map((n) => `decoration/nature/${n}`);
const VILLAGE = [
  'buildings/red/building_home_A_red', 'buildings/red/building_home_B_red',
  'buildings/blue/building_home_A_blue', 'buildings/blue/building_home_B_blue',
  'buildings/green/building_home_A_green', 'buildings/green/building_home_B_green',
  'buildings/yellow/building_home_A_yellow', 'buildings/yellow/building_home_B_yellow',
  'buildings/red/building_tavern_red', 'buildings/blue/building_church_blue',
  'buildings/yellow/building_market_yellow', 'buildings/red/building_well_red',
  'buildings/red/building_windmill_red', 'buildings/blue/building_watermill_blue',
  'buildings/green/building_blacksmith_green',
  'buildings/neutral/fence_wood_straight', 'buildings/neutral/fence_stone_straight',
  'buildings/neutral/building_grain',
  'decoration/props/barrel', 'decoration/props/crate_A_big', 'decoration/props/crate_B_small',
  'decoration/props/sack', 'decoration/props/wheelbarrow', 'decoration/props/bucket_water',
  'decoration/props/resource_lumber', 'decoration/props/tent', 'decoration/props/flag_red',
  'decoration/props/flag_yellow',
];

async function reunir(liste, fichier) {
  let cible = null;
  for (const chemin of liste) {
    const doc = await io.read(`${dossierHexa}/Assets/gltf/${chemin}.gltf`);
    if (!cible) cible = doc; else mergeDocuments(cible, doc);
  }
  const racine = cible.getRoot();
  // Une seule scène contenant tous les modèles, retrouvés ensuite par leur nom.
  const scenes = racine.listScenes();
  for (const s of scenes.slice(1)) {
    for (const enfant of s.listChildren()) scenes[0].addChild(enfant);
    s.dispose();
  }
  await cible.transform(unpartition(), dedup(), prune());
  await io.write(`${sortie}/${fichier}`, cible);
}
await reunir(NATURE, 'nature.glb');
await reunir(VILLAGE, 'village.glb');
console.log('Assets générés dans', sortie);
