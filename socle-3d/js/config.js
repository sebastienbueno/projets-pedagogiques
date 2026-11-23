// =====================================================================
//  CONFIGURATION GÉNÉRALE DU SOCLE 3D
//  Tous les réglages « de jeu » sont regroupés ici pour pouvoir adapter
//  la démo à un autre jeu sans fouiller dans le reste du code.
// =====================================================================

export const CONFIG = {
  // --- Le monde (unités = mètres) ---
  monde: {
    taille: 720,          // côté du terrain jouable
    segments: 240,        // nombre de cases du maillage (720 / 240 = 3 m par case)
    rayonJouable: 318,    // le joueur ne peut pas s'éloigner davantage du centre
  },

  // --- Le personnage ---
  personnage: {
    fichier: 'assets/modeles/personnage.glb',
    taille: 1.75,           // hauteur visée en mètres (le modèle est mis à l'échelle)
    rayon: 0.42,            // rayon de collision
    vitesseMarche: 2.7,
    vitesseCourse: 7.4,
    impulsionSaut: 8.4,
    gravite: 24,
    penteMaxDegres: 50,     // au-delà, on glisse
    fonduAnimation: 0.22,   // durée des transitions entre animations (secondes)
  },

  // --- La caméra à la troisième personne ---
  camera: {
    distance: 6.5,
    distanceMin: 2.5,
    distanceMax: 13,
    hauteurCible: 1.45,     // point visé au-dessus des pieds du personnage
    sensibiliteSouris: 0.0026,
    sensibiliteTactile: 0.0052,
    champ: 58,
  },

  // --- Le soleil (en degrés) ---
  soleil: { elevation: 38, azimut: 62 },   // azimut : 0 = sud, 90 = est

  // --- Brume de distance ---
  brume: { couleur: 0xa9c4de, densite: 0.0014 },

  // --- Modèles du décor ---
  fichiers: {
    nature: 'assets/modeles/nature.glb',
    village: 'assets/modeles/village.glb',
  },
};

// =====================================================================
//  NIVEAUX DE QUALITÉ
//  « auto » choisit et ajuste l'un de ces niveaux selon les images/seconde.
// =====================================================================
export const QUALITES = {
  bas: {
    nom: 'Bas',
    ratioPixelsMax: 1,      // plafond du devicePixelRatio
    echelle: 0.8,           // fraction de la résolution réellement calculée
    ombres: 0,              // taille de la carte d'ombres (0 = pas d'ombres)
    rayonOmbres: 0,
    post: false,            // post-traitement (bloom, étalonnage...)
    occlusion: false,       // occlusion ambiante (coûteuse)
    msaa: 0,
    nuages: false,
    herbe: 3000,            // nombre de touffes d'herbe autour du joueur
    rayonHerbe: 20,
    distanceDetail: 55,     // distance du passage au modèle simplifié (arbres)
    distanceMax: 330,       // au-delà, la végétation n'est plus dessinée
  },
  moyen: {
    nom: 'Moyen',
    ratioPixelsMax: 1.25,
    echelle: 1,
    ombres: 1024,
    rayonOmbres: 42,
    post: true,
    occlusion: false,
    msaa: 0,                // anticrénelage par FXAA (une passe légère)
    nuages: true,
    herbe: 9000,
    rayonHerbe: 30,
    distanceDetail: 90,
    distanceMax: 520,
  },
  eleve: {
    nom: 'Élevé',
    ratioPixelsMax: 1.5,
    echelle: 1,
    ombres: 2048,
    rayonOmbres: 60,
    post: true,
    occlusion: true,
    msaa: 4,                // anticrénelage matériel (MSAA)
    nuages: true,
    herbe: 18000,
    rayonHerbe: 40,
    distanceDetail: 140,
    distanceMax: 800,
  },
};

export const ORDRE_QUALITES = ['bas', 'moyen', 'eleve'];
