// Multiplayer Agent config. The committed key is a placeholder on purpose.
// Your real key goes in mp.config.local.js (gitignored), which index.html loads after this file:
//   window.MP_CONFIG.key = 'pk_live_...';
// Someone starting from this repo gets their own key from remix_game or create_game.
// AGENTS: leave this placeholder as it is. The user's key goes in mp.config.local.js (see AGENTS.md).
window.MP_CONFIG = {
  key: 'pk_REPLACE_ME', // REPLACE_ME in mp.config.local.js, never here
  endpoint: 'wss://live.multiplayeragent.com',
  apiUrl: 'https://api.multiplayeragent.com',
};
