export const ALIGN = { VILLAGE: "village", WOLF: "loups", NEUTRAL: "neutre" };


// Définition des rôles actifs (Voleur et les autres exclus sont absents)
export const ROLE_CATALOG = {
// Base
villageois: { key: "villageois", align: ALIGN.VILLAGE, dmDesc: "Pas de pouvoir. Vote le jour." },
loup: { key: "loup", align: ALIGN.WOLF, tag: "wolf", dmDesc: "Chaque nuit, votez avec les Loups pour une victime." },
voyante: { key: "voyante", align: ALIGN.VILLAGE, nightly: true, dmDesc: "Chaque nuit, voyez le camp d'un joueur." },
voyante_bavarde: { key: "voyante_bavarde", align: ALIGN.VILLAGE, nightly: true, exclusive: "voyante", dmDesc: "Chaque nuit, voyez le rôle d'un joueur. Le matin, il est révélé publiquement." },
sorciere: { key: "sorciere", align: ALIGN.VILLAGE, nightly: true, charges: { heal: 1, kill: 1 }, dmDesc: "2 potions: sauver la victime de la nuit / tuer un joueur." },
chasseur: { key: "chasseur", align: ALIGN.VILLAGE, onDeath: true, dmDesc: "En mourant, tuez une cible." },
cupidon: { key: "cupidon", align: ALIGN.VILLAGE, night0: true, dmDesc: "Nuit 0: liez deux amoureux." },
petite_fille: { key: "petite_fille", align: ALIGN.VILLAGE, nightly: true, dmDesc: "La nuit, espionnez les Loups (messages relayés sans pseudo). 20% d'être démasquée." },


// Nouvelle Lune
ancien: { key: "ancien", align: ALIGN.VILLAGE, passive: true, dmDesc: "Survivez à la première attaque des Loups." },
bouc: { key: "bouc", align: ALIGN.VILLAGE, dayTie: true, dmDesc: "En cas d'égalité au vote du jour, vous mourrez." },
idiot: { key: "idiot", align: ALIGN.VILLAGE, lynchImmune: true, dmDesc: "Si lynché, survivez mais perdez votre vote." },
salvateur: { key: "salvateur", align: ALIGN.VILLAGE, nightly: true, dmDesc: "Protégez un joueur chaque nuit (pas 2 fois de suite)." },


// Le Village
capitaine: { key: "capitaine", align: ALIGN.VILLAGE, elected: true, dmDesc: "Voix double. Si vous mourez, désignez un successeur." },
loup_blanc: { key: "loup_blanc", align: ALIGN.WOLF, nightly: true, period: 2, dmDesc: "Toutes les 2 nuits, tuez un Loup." },
corbeau: { key: "corbeau", align: ALIGN.VILLAGE, nightly: true, dmDesc: "+2 voix contre une cible au jour suivant." },
montreur_ours: { key: "montreur_ours", align: ALIGN.VILLAGE, morning: true, dmDesc: "Chaque matin, info si au moins un Loup parmi vos 2 voisins vivants." },


// Personnages
detective: { key: "detective", align: ALIGN.VILLAGE, nightly: true, dmDesc: "Comparez 2 joueurs: même camp ? (oui/non)" },
chien_loup: { key: "chien_loup", align: ALIGN.VILLAGE, switchable: true, dmDesc: "Vous pouvez rejoindre la meute une fois (définitif)." },
enfant_sauvage: { key: "enfant_sauvage", align: ALIGN.VILLAGE, night0: true, convertOnModelDeath: true, dmDesc: "Choisissez un modèle. S'il meurt, vous devenez Loup." },
infect_pere: { key: "infect_pere", align: ALIGN.WOLF, infectOnce: true, dmDesc: "Après l'attaque des Loups, infectez la victime pour la convertir (1x)." },
deux_soeurs: { key: "deux_soeurs", align: ALIGN.VILLAGE, nightlyChat: true, group: "sœurs", dmDesc: "Vous vous connaissez et discutez la nuit." },
trois_freres: { key: "trois_freres", align: ALIGN.VILLAGE, nightlyChat: true, group: "frères", dmDesc: "Vous vous connaissez et discutez la nuit." },
ange: { key: "ange", align: ALIGN.NEUTRAL, special: "d1", dmDesc: "Gagnez si vous êtes éliminé Jour 1, sinon devenez Villageois." },
shaman: { key: "shaman", align: ALIGN.VILLAGE, deadChatAccess: true, dmDesc: "Accès permanent au salon des Morts." }
};


export function roleKeysForConfig() {
// Clés proposées dans /lg config (exclut: villageois qui est auto-complétion)
return Object.keys(ROLE_CATALOG).filter(k => k !== "villageois");
}


export function isWolf(roleKey) { return ROLE_CATALOG[roleKey]?.align === ALIGN.WOLF; }
export function isVillage(roleKey) { return ROLE_CATALOG[roleKey]?.align === ALIGN.VILLAGE; }
