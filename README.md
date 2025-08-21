# Discord Loup-Garou Bot

Bot Discord pour jouer au **Loup-Garou de Thiercelieux** directement sur un serveur Discord.  
Il gère automatiquement la création du lobby, la distribution des rôles en MP, les phases de jour/nuit, les votes et un récapitulatif de fin de partie.

---

## ✨ Fonctionnalités

- Gestion du lobby : création, rejoindre/quitter, expulser avant le début.
- Distribution des rôles en messages privés avec description simple.
- Gestion automatique des phases **jour/nuit**.
- Système de votes pour les Loups et le Village.
- Nombreux rôles supportés (Villageois, Loups, Sorcière, Voyante, Cupidon, etc.).
- Options configurables :
  - Révélation des rôles à la mort (on/off).
  - Composition visible ou cachée au lancement.
  - Choix entre Voyante classique, Voyante bavarde ou aucune Voyante.

---

## 🚀 Commandes disponibles

### 🎮 Gestion du lobby
- `/lg create` → Crée un lobby de jeu.  
- `/lg join` → Rejoindre le lobby.  
- `/lg leave` → Quitter le lobby.  
- `/lg kick @joueur` → Expulser un joueur (avant le démarrage).  
- `/lg start` → Démarrer la partie (le lobby est verrouillé).  

### ⚙️ Configuration de partie
- `/lg config` → Définir les paramètres de la partie :
  - `loups` → nombre de Loups-Garous.  
  - `voyante` → `classic`, `bavarde`, ou `none`.  
  - `reveal_on_death` → `true` ou `false`.  
  - `composition_visible` → `true` ou `false`.  
  - Choix du nombre de rôles spéciaux (Cupidon, Sorcière, Ancien, etc.).  

---

## 📦 Installation

### Prérequis
- [Node.js](https://nodejs.org/) v18 ou plus récent.
- Un bot Discord créé via le [Discord Developer Portal](https://discord.com/developers/applications).

### Étapes
1. Clonez ce dépôt :
   ```bash
   git clone https://github.com/<votre-user>/discord-lg-bot.git
   cd discord-lg-bot
