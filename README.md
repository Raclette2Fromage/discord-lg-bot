# 🐺 Discord Loup-Garou Bot

Bot Discord pour jouer au **Loup-Garou de Thiercelieux** directement sur un serveur Discord.  
Il gère automatiquement la création du lobby, la distribution des rôles en MP, les phases de jour/nuit, les votes et un récapitulatif de fin de partie.  
Les rôles sont envoyés en MP. Les Loups ont un salon privé.

---

## ✨ Fonctionnalités

- Gestion du lobby : création, rejoindre/quitter, expulser avant le début.
- Distribution des rôles en messages privés avec description simple.
- Gestion automatique des phases jour/nuit.
- Système de vote pour les Loups et pour le Village.
- Nombreux rôles supportés :
  - Villageois, Loups
  - Voyante, Voyante bavarde (mutuellement exclusives)
  - Sorcière, Cupidon, Chasseur, Salvateur
  - Idiot, Corbeau, Montreur d’Ours
  - Deux Sœurs, Trois Frères (salons privés)
  - Shaman (peut parler avec les morts)
  - Petite-Fille (espionne le salon des Loups avec 20% de risque d’être démasquée)
  - Et d’autres…
- Options configurables :
  - Révélation des rôles à la mort, en fin de partie, ou jamais.
  - Composition visible ou cachée au lancement.
  - Cupidon configurable (peut être dans le couple ou non, couple aléatoire possible).
  - Chance de démasquage de la Petite-Fille ajustable.

---

## 🎮 Commandes disponibles

### 🏠 Gestion du lobby
- `/lg create` → Créer un lobby de jeu.
- `/lg join` → Rejoindre le lobby.
- `/lg leave` → Quitter le lobby.
- `/lg kick @user` → Expulser un joueur (avant le démarrage).
- `/lg start` → Démarrer la partie (le lobby est verrouillé).
- `/lg stop` → Arrêter/nettoyer la partie.
- `/lg table` → Voir l’ordre de table (cercle des joueurs).
- `/lg help` → Afficher l’aide et les commandes.
- `/lg roles` → Liste de tous les rôles et leurs pouvoirs.

### ⚙️ Configuration de partie
- `/lg config` → Définir les paramètres de la partie :
  - `joueurs` → nombre total de joueurs.
  - `roles` → définir la composition (ex: `loup=2 sorciere=1 voyante=1 petite_fille=1`).
    - Limites : pas de doublons sauf Villageois, Loups, Deux Sœurs et Trois Frères.
  - `reveal` → `on_death`, `end`, ou `never`.
  - `composition_visible` → `true` ou `false`.
  - Options spéciales : Cupidon (self/random).

---

## ⚡ Installation

### Prérequis
- [Node.js v18](https://nodejs.org/) ou plus récent.  
- Un bot Discord créé via le [Discord Developer Portal](https://discord.com/developer).

### Étapes
1. Clone le repo :
   ```bash
   git clone <url_du_repo>
   cd <repo>
