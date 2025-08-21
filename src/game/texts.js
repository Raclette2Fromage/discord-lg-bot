export const DM_TEMPLATES = {
role: (roleKey, align, desc) => `🎭 Ton rôle: **${label(roleKey)}** (${labelAlign(align)})\n${desc}`,
coupleLinked: (a,b)=>`💞 Vous êtes amoureux: **${a}** ❤ **${b}**. Si l'un meurt, l'autre meurt de chagrin. Survivez ensemble.`,
seerResult: (target, info)=>`🔮 Vision: **${target}** est ${info}.`,
detectiveResult: (a,b,same)=>`🕵️ Détective: **${a}** et **${b}** sont-ils du même camp ? → **${same?"OUI":"NON"}**`,
bearGrowl: (left,right,yes)=>`🧸 Montreur d'Ours — Voisins: **${left}** / **${right}** → ${yes?"l'Ours **grogne** (au moins un Loup)":"l'Ours **ne grogne pas**"}`,
pfRelay: (txt)=>`[Loup-Garou] : ${txt}`
};
export function label(key){
const map = {
villageois:"Villageois", loup:"Loup-Garou", voyante:"Voyante", voyante_bavarde:"Voyante Bavarde",
sorciere:"Sorcière", chasseur:"Chasseur", cupidon:"Cupidon", petite_fille:"Petite-Fille",
ancien:"Ancien", bouc:"Bouc émissaire", idiot:"Idiot du Village", salvateur:"Salvateur",
capitaine:"Capitaine", loup_blanc:"Loup Blanc", corbeau:"Corbeau", montreur_ours:"Montreur d'Ours",
detective:"Détective", chien_loup:"Chien-Loup", enfant_sauvage:"Enfant Sauvage", infect_pere:"Infect Père des Loups",
deux_soeurs:"Deux Sœurs", trois_freres:"Trois Frères", ange:"Ange", shaman:"Shaman"
}; return map[key]||key;
}
export function labelAlign(a){ return a==="village"?"Village":""+ (a==="loups"?"Loups":"Neutre"); }
