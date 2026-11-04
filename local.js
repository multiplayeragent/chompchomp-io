'use strict';

// Offline practice. With no game key of its own (a fresh clone of this repo), the game runs the same authoritative
// room logic (server/logic.js) right here in the browser at 20 ticks a second, bots included, behind the same
// interface as an online room, so game.js barely knows the difference. Saves and leaderboards stay in this browser.
// Playing online with friends needs your own game key: see the README.
window.ChompLocal = (() => {
  const ID = 'local';
  const TICK_MS = 50;
  const store = {
    get(k) {
      try { return JSON.parse(localStorage.getItem('chomp.offline.' + k)); } catch { return null; }
    },
    set(k, v) {
      try { localStorage.setItem('chomp.offline.' + k, JSON.stringify(v)); } catch { /* storage off */ }
    },
  };
  // Like the wire: what the logic sends is a copy, never a live object.
  const copy = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  // What the room runtime gives room logic, backed by this browser.
  let deliver = () => {};
  window.state = { entities: {}, shared: {} };
  window.emit = (type, data) => deliver(type, data);
  window.emitTo = (id, type, data) => { if (id === ID) deliver(type, data); };
  window.loadData = () => store.get('save');
  window.saveData = (id, v) => store.set('save', v);
  window.submitScore = (id, board, score, mode) => {
    const b = store.get('boards') || {};
    b[board] = mode === 'inc' ? (b[board] || 0) + score : Math.max(b[board] || 0, score);
    store.set('boards', b);
  };

  let loading = null;
  function loadLogic() {
    return loading || (loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'server/logic.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('could not load server/logic.js'));
      document.head.appendChild(s);
    }));
  }

  async function join() {
    await loadLogic();
    const handlers = {};
    let onState = null;
    let queue = [];
    deliver = (type, data) => queue.push([type, copy(data)]);
    const drain = () => {
      const q = queue;
      queue = [];
      for (const [type, data] of q) for (const fn of handlers[type] || []) fn(data);
    };
    const publish = () => { if (onState) onState(copy(window.state)); };

    window.onJoin(ID);
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      window.onTick((now - last) / 1000);
      last = now;
      drain();
      publish();
    }, TICK_MS);

    return {
      sessionId: ID,
      onState(fn) { onState = fn; publish(); },
      on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
      send(type, data) { window.onEvent(ID, type, copy(data)); drain(); },
      sendInput(input) { window.onInput(ID, copy(input)); },
      track() {},
      onDisconnect() {},
      onReconnect() {},
      async leave() {
        clearInterval(timer);
        window.onLeave(ID);
        deliver = () => {};
      },
    };
  }

  // Stands in for MP.auth: one local guest, stats and bests kept in this browser.
  function auth() {
    const online = () => Promise.reject(new Error('Accounts need your own game key. See the README.'));
    const best = (board) => (store.get('boards') || {})[board] || 0;
    return {
      getPlayer: async () => ({ id: ID, username: '', claimed: false }),
      data: {
        get: async (key) => ({ data: store.get(key === '@save' ? 'save' : 'prefs') }),
        set: async (v) => store.set('prefs', v),
      },
      leaderboard: (board) => ({
        top: async () => ({
          entries: best(board) ? [{ rank: 1, playerId: ID, username: (store.get('prefs') || {}).name || 'You', score: best(board) }] : [],
        }),
        myRank: async () => (best(board) ? { rank: 1, total: 1 } : null),
      }),
      claim: online,
      login: online,
      logout() {},
    };
  }

  return { join, auth };
})();
