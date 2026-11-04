// Authoritative room logic for ChompChomp.io. build.js concatenates powerups.js + sim.js + this file
// into dist/server.js, which is deployed to the "arena" room. Clients only send inputs (steering,
// boost, fire) and two events (hello, spawn); movement, dots, power-ups, bullets, damage, scores and
// saves are all decided here, so a modified client can't teleport or award itself anything.

const SIM = window.ChompSim;
const { WEAPON_IDS, SKINS, clamp } = SIM;
const MSG_CHARS = 1800; // stay under the 2048-char event payload cap
const BODY_POINTS = 150; // max points in a synced body outline (keeps the field under 2048 chars)
const HURT_MAX = 250; // max damaged circles listed per snake
const INPUT_QUEUE = 4;
const SNAPSHOT_COOLDOWN = 2; // seconds between full food snapshots for one client

const sessions = {}; // sessionId -> { id, q, input, snake, deadAt, save, snapAt }
let world = null;
let out = []; // event tuples produced this tick, flushed to every client
const bodyDirty = new Set();
let bodyCursor = 0;

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const humansOnline = () => Object.keys(sessions).length;
const botTarget = () => Math.max(0, SIM.BOT_COUNT - SIM.BOTS_PER_HUMAN * humansOnline());

function safe(fn) {
  try { return fn(); } catch (err) { state.shared.persistError = String(err && err.message || err).slice(0, 200); }
  return undefined;
}

// ---------- World hooks: what clients need to hear about ----------
const hooks = {
  foodAdd: (f) => out.push(['f', f.id, Math.round(f.x), Math.round(f.y), Math.round(f.value * 10), f.c]),
  foodEat: (f, s) => out.push(['e', f.id, s.id]),
  bullet: (b) => out.push(['b', b.id, Math.round(b.x), Math.round(b.y), Math.round(b.vx), Math.round(b.vy),
    r2(b.life), WEAPON_IDS.indexOf(b.weapon), b.owner.id]),
  bulletHit: (b) => out.push(['d', b.id]),
  fx: (t) => out.push(t),
  pickupAdd: (pk) => {
    state.entities.pk[pk.id] = { x: Math.round(pk.x), y: Math.round(pk.y), t: pk.type, n: pk.natural ? 1 : 0, b: r2(pk.born) };
  },
  pickupGone: (pk) => { delete state.entities.pk[pk.id]; },
  spawn: (s) => bodyDirty.add(s),
  chop: (s) => bodyDirty.add(s),
  death: onDeath,
  toast: (s, msg) => emitTo(s.pid, 'toast', msg),
  pickup: (s, type, msg) => emitTo(s.pid, 'pu', [type, msg]),
};

function ensureWorld() {
  if (world) return;
  state.entities.players = state.entities.players || {};
  state.entities.snakes = state.entities.snakes || {};
  state.entities.pk = state.entities.pk || {};
  world = SIM.createWorld(hooks);
  world.init(botTarget());
  out = []; // nobody is connected yet; joiners get a snapshot
}

// ---------- Persistence ----------
// Saves and leaderboard scores are written only here, from server-computed results.
function recordGame(sess, s) {
  const score = Math.floor(s.stats.score);
  const len = Math.floor(s.peakMass);
  const secs = Math.max(0, Math.floor(world.time - s.born));
  // The cached copy carries this session's earlier writes (which flush asynchronously); the stored
  // copy covers anything written elsewhere. Take the larger of each.
  const stored = safe(() => loadData(sess.id)) || {};
  const v = sess.save;
  for (const k of ['games', 'best', 'bestLen', 'kills', 'dots', 'time']) v[k] = Math.max(v[k] || 0, stored[k] || 0);
  const newBest = score > v.best;
  v.games += 1;
  v.best = Math.max(v.best, score);
  v.bestLen = Math.max(v.bestLen, len);
  v.kills += s.kills;
  v.dots += s.stats.dots;
  v.time += secs;
  safe(() => saveData(sess.id, v));
  safe(() => submitScore(sess.id, 'score', score, 'max'));
  safe(() => submitScore(sess.id, 'length', len, 'max'));
  if (s.kills > 0) safe(() => submitScore(sess.id, 'kills', s.kills, 'inc'));
  return { score, len, secs, newBest, best: v.best };
}

function onDeath(s, killer, cause) {
  delete state.entities.snakes[s.id];
  bodyDirty.delete(s);
  if (!s.human) return;
  const p = state.entities.players[s.pid];
  if (p) p.sn = 0;
  const sess = sessions[s.pid];
  if (!sess) return;
  sess.snake = null;
  sess.deadAt = world.time;
  const res = recordGame(sess, s);
  if (cause === 'left') return;
  emitTo(s.pid, 'dead', {
    by: killer ? killer.name : '',
    cause,
    score: res.score,
    len: Math.floor(s.mass),
    kills: s.kills,
    dots: s.stats.dots,
    hits: s.stats.hits,
    secs: res.secs,
    best: res.best,
    newBest: res.newBest,
  });
}

// ---------- Sync ----------
function bodyStr(s) {
  const segs = s.segs, n = segs.length, k = Math.max(1, Math.ceil(n / BODY_POINTS));
  const parts = [];
  for (let i = 0; i < n; i += k) parts.push(Math.round(segs[i].x) + ',' + Math.round(segs[i].y));
  if ((n - 1) % k) parts.push(Math.round(segs[n - 1].x) + ',' + Math.round(segs[n - 1].y));
  return parts.join(';');
}

// Damaged circles as "index:severity" with severity 0-9.
function hurtStr(s) {
  if (!s.bodyHurt) return '';
  const max = world.segHp(s), life = s.segLife, parts = [];
  for (let i = 0; i < life.length && parts.length < HURT_MAX; i++) {
    if (life[i] >= 0) parts.push(i + ':' + clamp(Math.floor((1 - life[i] / max) * 10), 0, 9));
  }
  return parts.join(',');
}

const upgradesStr = (s) => Object.keys(s.stacks).map((id) => id + ':' + s.stacks[id]).join(',');

function syncSnakes() {
  const ents = state.entities.snakes, list = world.snakes, t = world.time;
  // Refresh one body outline per tick so late joiners see whole snakes, not just heads.
  if (list.length) {
    bodyCursor = (bodyCursor + 1) % list.length;
    bodyDirty.add(list[bodyCursor]);
  }
  for (const s of list) {
    s.angle = wrapAngle(s.angle);
    let e = ents[s.id];
    if (!e) e = ents[s.id] = { n: s.name, s: s.skin, p: s.pid || '' };
    e.x = r1(s.x);
    e.y = r1(s.y);
    e.a = r3(s.angle);
    e.m = r1(s.mass);
    e.bo = s.boosting ? 1 : 0;
    e.hp = Math.ceil(s.health);
    e.mh = s.mods.maxHealth;
    e.sh = Math.ceil(s.mods.shield);
    e.ge = s.effects.ghost > 0 ? r1(t + s.effects.ghost) : 0; // server time the effect ends
    e.fe = s.effects.frenzy > 0 ? r1(t + s.effects.frenzy) : 0;
    e.w = WEAPON_IDS.indexOf(s.weapon);
    e.sc = Math.floor(s.stats.score);
    e.k = s.kills;
    e.d = s.stats.dots;
    e.hi = s.stats.hits;
    e.sp = r2(s.mods.speed);
    e.tu = r2(s.mods.turn);
    e.up = upgradesStr(s);
    e.hu = hurtStr(s);
    if (s.human) e.ack = s.ack | 0;
    if (bodyDirty.has(s)) e.bd = bodyStr(s);
  }
  bodyDirty.clear();
}

// Send this tick's tuples to everyone, split into messages under the payload cap.
function flush() {
  if (!out.length) return;
  let batch = [], len = 2;
  for (const t of out) {
    const n = JSON.stringify(t).length + 1;
    if (len + n > MSG_CHARS && batch.length) {
      emit('t', batch);
      batch = [];
      len = 2;
    }
    batch.push(t);
    len += n;
  }
  emit('t', batch);
  out = [];
}

// Every live orb, flattened as [id, x, y, value*10, color, ...] in chunks.
function sendSnapshot(id) {
  const chunks = [];
  let cur = [], len = 0;
  for (const f of world.foods) {
    if (f.eaten) continue;
    const item = [f.id, Math.round(f.x), Math.round(f.y), Math.round(f.value * 10), f.c];
    const n = item.join(',').length + 1;
    if (len + n > MSG_CHARS - 40 && cur.length) {
      chunks.push(cur);
      cur = [];
      len = 0;
    }
    for (const v of item) cur.push(v);
    len += n;
  }
  chunks.push(cur);
  chunks.forEach((f, i) => emitTo(id, 'fs', { i, n: chunks.length, f }));
  for (const s of world.snakes) bodyDirty.add(s);
}

function cleanName(n) {
  const name = String(n == null ? '' : n).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
  return name || 'Guest';
}

// ---------- Room handlers ----------
function onJoin(id) {
  ensureWorld();
  const save = safe(() => loadData(id)) || {};
  sessions[id] = { id, q: [], input: null, snake: null, deadAt: -Infinity, save, snapAt: -Infinity };
  state.entities.players[id] = { sn: 0 };
}

function onLeave(id) {
  const sess = sessions[id];
  if (sess && sess.snake && sess.snake.alive) world.killSnake(sess.snake, null, 'left');
  delete sessions[id];
  delete state.entities.players[id];
}

function onInput(id, input) {
  const sess = sessions[id];
  if (!sess || !input || typeof input !== 'object') return;
  const a = Number(input.a);
  if (!Number.isFinite(a)) return;
  sess.q.push({ q: input.q | 0, a, b: !!input.b, f: !!input.f });
  if (sess.q.length > INPUT_QUEUE) sess.q.shift();
}

function onEvent(id, type, data) {
  ensureWorld();
  const sess = sessions[id];
  if (!sess) return;
  if (type === 'hello') {
    if (world.time - sess.snapAt < SNAPSHOT_COOLDOWN) return;
    sess.snapAt = world.time;
    sendSnapshot(id);
  } else if (type === 'spawn') {
    if (sess.snake || world.time - sess.deadAt < 0.8) return;
    const d = data && typeof data === 'object' ? data : {};
    sess.q.length = 0;
    sess.input = null;
    const s = world.spawnHuman(id, cleanName(d.n), clamp(d.s | 0, 0, SKINS.length - 1));
    s.ack = 0;
    sess.snake = s;
    state.entities.players[id].sn = s.id;
  }
}

function onTick(dt) {
  ensureWorld();
  if (dt > 1) dt /= 1000; // tolerate a millisecond tick
  dt = clamp(dt || 0.05, 0.001, 0.1);
  for (const id in sessions) {
    const sess = sessions[id], s = sess.snake;
    if (!s || !s.alive) continue;
    // One input per tick; if a client got ahead, skip to its newer inputs.
    if (sess.q.length > 2) sess.q.splice(0, sess.q.length - 2);
    const inp = sess.q.shift() || sess.input;
    if (!inp) continue;
    sess.input = inp;
    s.targetAngle = inp.a;
    s.wantBoost = inp.b;
    s.wantFire = inp.f;
    s.ack = inp.q;
  }
  world.step(dt, botTarget());
  syncSnakes();
  flush();
  state.shared.t = r2(world.time);
}
