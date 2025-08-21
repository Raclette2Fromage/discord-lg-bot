# 🐺 Discord Loup-Garou Bot

Bot Discord pour jouer au **Loup-Garou de Thiercelieux** directement sur un serveur Discord.  
Il gère automatiquement la création du lobby, la distribution des rôles en MP, les phases de jour/nuit, les votes et un récapitulatif de fin de partie.

---

## ✨ Fonctionnalités

- Gestion du lobby : création, rejoindre/quitter, expulser avant le début.
- Distribution des rôles en messages privés avec description simple.
- Gestion automatique des phases jour/nuit.
- Système de vote pour les Loups et le Village.
- Nombreux rôles supportés (Villageois, Loups, Sorcière, Voyante, Voyante bavarde, Cupidon, etc.).
- Options configurables :
  - Révélation des rôles à la mort, en fin de partie, ou jamais.
  - Composition visible ou cachée au lancement.
  - Cupidon configurable (peut être dans le couple ou non, couple aléatoire possible).

---

## 🎮 Commandes disponibles

### 🏠 Gestion du lobby
- `/lg create` → Créer un lobby de jeu.
- `/lg join` → Rejoindre le lobby.
- `/lg leave` → Quitter le lobby.
- `/lg kick @user` → Expulser un joueur (avant le démarrage).
- `/lg start` → Démarrer la partie (le lobby est verrouillé).
- `/lg stop` → Arrêter/nettoyer.
- `/lg table` → Voir l’ordre de table.
- `/lg help` → Afficher l’aide et les commandes.
- `/lg roles` → Liste de tous les rôles et leurs pouvoirs.

### ⚙️ Configuration de partie
- `/lg config` → Définir les paramètres de la partie :
  - `joueurs` → nombre total de joueurs.
  - `roles` → définir la composition (ex: `loup=2 sorciere=1 voyante=1 petite_fille=1`).
  - `reveal` → `on_death`, `end`, ou `never`.
  - `composition_visible` → `true` ou `false`.
  - Options spéciales : Cupidon (self/random), etc.

👉 **Remarque** : la Voyante et la Voyante bavarde sont des rôles distincts.  
Dans la config, tu choisis juste combien de `voyante` **ou** de `voyante_bavarde` tu veux mettre (ou aucun).

---

## ⚡ Installation

### Prérequis
- [Node.js v18](https://nodejs.org/) ou plus récent.  
- Un bot Discord créé via le [Discord Developer Portal](https://discord.com/developer)
