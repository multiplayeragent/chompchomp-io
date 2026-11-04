'use strict';

// Browser client. The world is simulated by the authoritative room logic (server/logic.js); this
// file draws what the server says, predicts our own head so steering feels instant, and sends only
// inputs: steering angle, boost and fire.
(() => {
  const { RARITY, WEAPONS, POWERUPS, iconSprite, iconURL } = window.ChompPowerups;
  const S = window.ChompSim;
  const { WORLD_R, SKINS, PALETTE, WEAPON_IDS, MAX_SHIELD, BULLET_R, PICKUP_R, PICKUP_DROP_LIFE, TAU, clamp, angleDiff } = S;

  // ---------- Config ----------
  // The key comes from mp.config.js (placeholder, committed) and mp.config.local.js (your real key, gitignored).
  const CFG = window.MP_CONFIG || {};
  const NET = {
    key: CFG.key,
    endpoint: CFG.endpoint || 'wss://live.multiplayeragent.com',
    apiUrl: CFG.apiUrl || 'https://api.multiplayeragent.com',
    room: 'arena',
  };
  // No key of its own yet (a fresh clone), no SDK (no internet), or ?offline: play offline against bots (local.js).
  const OFFLINE = !NET.key || NET.key === 'pk_REPLACE_ME' || !window.MP || /[?&]offline\b/.test(location.search);
  const OFFLINE_NOTE = 'Offline practice vs bots. To play online with friends, see the README.';
  const INPUT_DT = 1 / 20; // one input per server tick
  const INTERP_DELAY = 0.12; // seconds other snakes are drawn in the past, between two server updates
  const MAX_PARTICLES = 1500;
  const LB_ROTATE = 5; // seconds per in-game leaderboard category
  const BOARDS = [
    { id: 'score', title: 'Best score' },
    { id: 'kills', title: 'Total kills' },
    { id: 'length', title: 'Longest' },
  ];

  // ---------- Utils ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shade(hex, amt) {
    const f = amt < 0 ? (c) => Math.round(c * (1 + amt)) : (c) => Math.round(c + (255 - c) * amt);
    const [r, g, b] = hexToRgb(hex);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }
  function rgba(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };
  const fmtTime = (secs) => (secs >= 3600 ? `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
    : secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`);

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1, vignette = null;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Sprites ----------
  const sprites = new Map();
  function makeSprite(key, size, draw) {
    let c = sprites.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = size;
      draw(c.getContext('2d'), size / 2);
      sprites.set(key, c);
    }
    return c;
  }
  const bodySprite = (color) => makeSprite('b' + color, 128, (g, m) => {
    const grad = g.createRadialGradient(m * 0.72, m * 0.68, m * 0.08, m, m, m);
    grad.addColorStop(0, shade(color, 0.5));
    grad.addColorStop(0.45, color);
    grad.addColorStop(0.85, shade(color, -0.3));
    grad.addColorStop(1, shade(color, -0.65));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(m, m, m - 1, 0, TAU);
    g.fill();
  });
  const glowSprite = (color) => makeSprite('g' + color, 64, (g, m) => {
    const grad = g.createRadialGradient(m, m, 0, m, m, m);
    grad.addColorStop(0, rgba(color, 0.8));
    grad.addColorStop(0.4, rgba(color, 0.35));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, m * 2, m * 2);
  });
  const foodSprite = (color) => makeSprite('f' + color, 64, (g, m) => {
    const grad = g.createRadialGradient(m, m, 0, m, m, m);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.12, rgba(color, 1));
    grad.addColorStop(0.28, rgba(color, 0.55));
    grad.addColorStop(0.55, rgba(color, 0.15));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, m * 2, m * 2);
  });

  function makeHexPattern() {
    const S2 = 2, w = 56, h = 96, s = h / 3;
    const xs = w / (Math.sqrt(3) * s);
    const c = document.createElement('canvas');
    c.width = w * S2;
    c.height = h * S2;
    const g = c.getContext('2d');
    g.scale(S2, S2);
    g.fillStyle = '#080b0f';
    g.fillRect(0, 0, w, h);
    for (const [cx, cy] of [[0, 0], [w, 0], [w / 2, h / 2], [0, h], [w, h]]) {
      const grad = g.createRadialGradient(cx, cy - s * 0.3, 0, cx, cy, s);
      grad.addColorStop(0, '#1a212b');
      grad.addColorStop(1, '#10151b');
      g.fillStyle = grad;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 3;
        g.lineTo(cx + Math.cos(a) * (s - 2) * xs, cy + Math.sin(a) * (s - 2));
      }
      g.closePath();
      g.fill();
    }
    const p = ctx.createPattern(c, 'repeat');
    if (p.setTransform) p.setTransform(new DOMMatrix().scale(1 / S2));
    return p;
  }
  const hexPattern = makeHexPattern();
  const sparkSprite = glowSprite('#ffffff');
  const fireSprite = glowSprite('#ff922b');
  const frenzyGlow = glowSprite('#ff4d4d');
  const rarityGlow = Object.fromEntries(Object.entries(RARITY).map(([k, r]) => [k, glowSprite(r.color)]));

  // Crack overlays for damaged body circles: dark fissures with a light edge so they read on any skin.
  const crackSprites = [0, 1, 2].map((v) => makeSprite('crack' + v, 64, (g, m) => {
    g.beginPath();
    g.arc(m, m, m - 1, 0, TAU);
    g.clip();
    g.lineCap = g.lineJoin = 'round';
    const paths = [];
    for (let k = 0; k < 4; k++) {
      let a = (k / 4) * TAU + v * 0.9 + rand(-0.4, 0.4), x = m + rand(-4, 4), y = m + rand(-4, 4);
      const pts = [[x, y]];
      for (let s = 0; s < 4; s++) {
        a += rand(-0.7, 0.7);
        x += Math.cos(a) * m * 0.3;
        y += Math.sin(a) * m * 0.3;
        pts.push([x, y]);
      }
      paths.push(pts);
    }
    for (const [color, width, off] of [['rgba(255,255,255,0.8)', 8, 2], ['rgba(0,0,0,0.95)', 6, 0]]) {
      g.strokeStyle = color;
      g.lineWidth = width;
      for (const pts of paths) {
        g.beginPath();
        for (const [x, y] of pts) g.lineTo(x + off, y + off);
        g.stroke();
      }
    }
  }));

  // ---------- World mirror ----------
  const snakes = new Map(); // server snake id -> Snake
  const foods = new Map(); // orb id -> orb
  let eating = []; // orbs flying into the mouth that ate them
  let pickups = [];
  const pickupCache = new Map();
  let bullets = [];
  let particles = [];
  let me = null; // our own snake while alive
  let state = 'menu'; // 'menu' | 'spawning' | 'playing' | 'dead'
  let time = performance.now() / 1000;
  let serverT = 0, serverTAt = 0; // last server clock, and the local time it arrived
  const serverNow = () => serverT + (time - serverTAt);
  let online = 0;
  let hudT = 0;
  let lbIdx = 0;
  let lbT = LB_ROTATE;
  const cam = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tr: 12 };

  // Our own head runs ahead of the server: each input is applied locally at once, then replayed on
  // top of every server update that hasn't processed it yet.
  let seq = 0, inputAcc = 0, targetAngle = 0;
  const pendingInputs = [];
  let pred = { x: 0, y: 0, angle: 0 }, prevPred = { x: 0, y: 0, angle: 0 }, predAt = 0;
  const corr = { x: 0, y: 0 }; // visual offset left over from a correction, decays to 0

  function predictStep(p, inp) {
    const boosting = inp.b && me.mass > S.MIN_BOOST_MASS;
    S.steer(p, inp.a, me.r, me.tu, S.moveSpeed(boosting, me.sp), INPUT_DT);
  }

  class Snake {
    constructor(id, e, t) {
      this.id = id;
      this.name = e.n || '?';
      this.skin = SKINS[clamp(e.s | 0, 0, SKINS.length - 1)];
      this.sprites = this.skin.map(bodySprite);
      this.glow = glowSprite(this.skin[0]);
      this.miniColor = rgba(this.skin[0], 0.7);
      this.pid = e.p || '';
      this.isPlayer = false;
      this.seen = t;
      this.samples = []; // server head positions {t, x, y, a}, oldest first
      this.trail = [];
      this.segs = [];
      this.hurt = new Map(); // damaged circle index -> severity 0-9
      this.hurtKey = '';
      this.upKey = null;
      this.stacks = {};
      this.bodyKey = '';
      this.hp = e.hp;
      this.shield = e.sh;
      this.hitFlash = 0;
      this.shieldFlash = 0;
      this.ghostLeft = 0;
      this.frenzyLeft = 0;
      this.x = e.x;
      this.y = e.y;
      this.angle = this.targetAngle = e.a;
      this.apply(e, t);
      if (!this.trail.length) {
        const L = S.bodyLength(this.mass) + 20, ca = Math.cos(this.angle), sa = Math.sin(this.angle);
        for (let d = L; d > 0; d -= 6) this.trail.push({ x: this.x - ca * d, y: this.y - sa * d });
        this.trail.push({ x: this.x, y: this.y });
      }
    }

    apply(e, t) {
      if (e.hp < this.hp) this.hitFlash = 0.15;
      if (e.sh < this.shield) this.shieldFlash = 0.2;
      this.mass = e.m;
      this.r = S.radius(e.m);
      this.boosting = !!e.bo;
      this.hp = e.hp;
      this.maxHp = e.mh;
      this.shield = e.sh;
      this.ge = e.ge;
      this.fe = e.fe;
      this.weapon = WEAPON_IDS[e.w] || 'blaster';
      this.score = e.sc;
      this.kills = e.k;
      this.dots = e.d;
      this.hits = e.hi;
      this.sp = e.sp || 1;
      this.tu = e.tu || 1;
      this.ack = e.ack | 0;
      if (e.up !== this.upKey) {
        this.upKey = e.up;
        this.stacks = {};
        for (const part of (e.up || '').split(',')) {
          const [id, n] = part.split(':');
          if (POWERUPS[id]) this.stacks[id] = n | 0;
        }
      }
      if (e.hu !== this.hurtKey) {
        this.hurtKey = e.hu;
        this.hurt.clear();
        for (const part of (e.hu || '').split(',')) {
          const k = part.indexOf(':');
          if (k > 0) this.hurt.set(part.slice(0, k) | 0, part.slice(k + 1) | 0);
        }
      }
      const last = this.samples[this.samples.length - 1];
      if (!last || last.x !== e.x || last.y !== e.y) {
        this.samples.push({ t, x: e.x, y: e.y, a: e.a });
        if (this.samples.length > 40) this.samples.shift();
      }
      // A fresh body outline only matters to snakes we just started seeing; after that the body
      // grows from the head path we've drawn.
      if (e.bd && e.bd !== this.bodyKey) {
        this.bodyKey = e.bd;
        if (!this.isPlayer && t - this.seen < 2) this.loadBody(e.bd, true);
      }
    }

    // Rebuild the trail from the server's outline (head first). Other snakes are drawn slightly in
    // the past, so `behind` drops the stretch nearest the head they haven't reached yet.
    loadBody(bd, behind) {
      const pts = bd.split(';').map((p) => {
        const k = p.indexOf(',');
        return { x: +p.slice(0, k), y: +p.slice(k + 1) };
      });
      let skip = behind ? S.moveSpeed(this.boosting, this.sp) * INTERP_DELAY : 0, i = 0;
      while (skip > 0 && i < pts.length - 2) {
        skip -= Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
        i++;
      }
      this.trail = pts.slice(i).reverse();
    }

    // Head position `INTERP_DELAY` ago, between the two server updates around it.
    interpolate(rt) {
      const sm = this.samples;
      while (sm.length > 2 && sm[1].t < rt - 1) sm.shift();
      let i = sm.length - 1;
      while (i > 0 && sm[i].t > rt) i--;
      const a = sm[i], b = sm[i + 1];
      if (!b) {
        const dt = clamp(rt - a.t, 0, 0.2), sp = S.moveSpeed(this.boosting, this.sp);
        this.x = a.x + Math.cos(a.a) * sp * dt;
        this.y = a.y + Math.sin(a.a) * sp * dt;
        this.angle = a.a;
      } else if (rt <= a.t) {
        this.x = a.x;
        this.y = a.y;
        this.angle = a.a;
      } else {
        const f = (rt - a.t) / (b.t - a.t);
        this.x = a.x + (b.x - a.x) * f;
        this.y = a.y + (b.y - a.y) * f;
        this.angle = a.a + angleDiff(a.a, b.a) * f;
      }
      this.targetAngle = this.angle;
    }

    tick(dt) {
      if (this.isPlayer) {
        const f = clamp((time - predAt) / INPUT_DT, 0, 1);
        this.x = prevPred.x + (pred.x - prevPred.x) * f + corr.x;
        this.y = prevPred.y + (pred.y - prevPred.y) * f + corr.y;
        this.angle = prevPred.angle + angleDiff(prevPred.angle, pred.angle) * f;
        this.targetAngle = targetAngle;
      } else {
        this.interpolate(time - INTERP_DELAY);
      }
      const tr = this.trail, last = tr[tr.length - 1];
      if (last && (last.x - this.x) ** 2 + (last.y - this.y) ** 2 < 4) {
        last.x = this.x;
        last.y = this.y;
      } else {
        tr.push({ x: this.x, y: this.y });
      }
      S.layoutBody(tr, this.segs, this.r, this.mass);
      const sn = serverNow();
      this.ghostLeft = Math.max(0, this.ge - sn);
      this.frenzyLeft = Math.max(0, this.fe - sn);
      if (this.hitFlash > 0) this.hitFlash -= dt;
      if (this.shieldFlash > 0) this.shieldFlash -= dt;
    }
  }

  function becomeMe(s) {
    if (me) me.isPlayer = false;
    me = s;
    s.isPlayer = true;
    const last = s.samples[s.samples.length - 1];
    pred = { x: last.x, y: last.y, angle: last.a };
    prevPred = { ...pred };
    predAt = time;
    corr.x = corr.y = 0;
    pendingInputs.length = 0;
    targetAngle = last.a;
    if (s.bodyKey) s.loadBody(s.bodyKey, false);
    cam.x = cam.tx = last.x;
    cam.y = cam.ty = last.y;
    state = 'playing';
    lbIdx = 0;
    lbT = LB_ROTATE;
    menu.hidden = true;
    guide.hidden = true;
    deathScreen.hidden = true;
    hud.hidden = false;
    input.reset();
    updateHud();
  }

  function reconcile(e) {
    while (pendingInputs.length && pendingInputs[0].q <= e.ack) pendingInputs.shift();
    const p = { x: e.x, y: e.y, angle: e.a };
    for (const inp of pendingInputs) predictStep(p, inp);
    const dx = p.x - pred.x, dy = p.y - pred.y, da = angleDiff(pred.angle, p.angle);
    // Keep the drawn head where it is and let the offset fade, unless it is a real jump.
    if (dx * dx + dy * dy < 250 * 250) {
      corr.x -= dx;
      corr.y -= dy;
    } else {
      corr.x = corr.y = 0;
    }
    prevPred.x += dx;
    prevPred.y += dy;
    prevPred.angle += da;
    pred = p;
  }

  function sendInput() {
    const inp = { q: ++seq, a: Math.round(targetAngle * 1000) / 1000, b: input.boost() ? 1 : 0, f: input.firing() ? 1 : 0 };
    mp.sendInput(inp);
    pendingInputs.push(inp);
    if (pendingInputs.length > 60) pendingInputs.shift();
    prevPred = { ...pred };
    predictStep(pred, inp);
    predAt = time;
  }

  // ---------- Server messages ----------
  function addFood(id, x, y, v10, c) {
    if (foods.has(id)) return;
    const value = v10 / 10;
    foods.set(id, {
      x, y,
      r: 3 + Math.sqrt(value) * 2.3,
      phase: rand(0, TAU),
      born: time,
      sprite: foodSprite(PALETTE[c] || PALETTE[0]),
    });
  }

  function eatFood(id, sid) {
    const f = foods.get(id);
    if (!f) return;
    foods.delete(id);
    const s = snakes.get(String(sid));
    if (s && inView(f.x, f.y, 60)) {
      f.eater = s;
      f.eatT = 0.12;
      eating.push(f);
    }
  }

  function addBullet(id, x, y, vx, vy, life, wi, ownerId) {
    const w = WEAPONS[WEAPON_IDS[wi]] || WEAPONS.blaster;
    const owner = snakes.get(String(ownerId));
    bullets.push({
      id, x, y, vx, vy, life,
      size: w.size,
      tail: w.tail || 0.02,
      homing: w.homing || 0,
      glow: w.explode ? fireSprite : owner ? owner.glow : sparkSprite,
      owner,
      target: null,
      retarget: 0,
      dead: false,
    });
  }

  function onTickEvents(batch) {
    if (!Array.isArray(batch)) return;
    for (const t of batch) {
      switch (t[0]) {
        case 'f': addFood(t[1], t[2], t[3], t[4], t[5]); break;
        case 'e': eatFood(t[1], t[2]); break;
        case 'b': addBullet(t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8]); break;
        case 'd': for (const b of bullets) if (b.id === t[1]) b.dead = true; break;
        case 'h': hitFx(snakes.get(String(t[1])), t[2], t[3], t[4], t[5], t[6], t[7]); break;
        case 'x': explosionFx(t[1], t[2], t[3]); break;
        case 'p': {
          const def = POWERUPS[t[3]];
          if (def && inView(t[1], t[2], 100)) spawnParticles(t[1], t[2], 0, Math.PI, 14, 380, 10, rarityGlow[def.rarity], true);
          break;
        }
      }
    }
  }

  function onFoodSnapshot(d) {
    if (!d || !Array.isArray(d.f)) return;
    if (d.i === 0) foods.clear();
    const f = d.f;
    for (let k = 0; k + 4 < f.length; k += 5) addFood(f[k], f[k + 1], f[k + 2], f[k + 3], f[k + 4]);
  }

  let lostMeAt = 0;
  function onState(st) {
    const t = performance.now() / 1000;
    const shared = st.shared || {};
    if (typeof shared.t === 'number' && shared.t !== serverT) {
      serverT = shared.t;
      serverTAt = t;
    }
    const ents = (st.entities && st.entities.snakes) || {};
    for (const id in ents) {
      const e = ents[id];
      if (typeof e.x !== 'number') continue;
      const s = snakes.get(id);
      if (s) s.apply(e, t);
      else snakes.set(id, new Snake(id, e, t));
    }
    for (const id of snakes.keys()) {
      if (ents[id]) continue;
      snakes.delete(id);
      if (me && me.id === id) {
        me = null;
        lostMeAt = t;
      }
    }

    const players = (st.entities && st.entities.players) || {};
    online = Object.keys(players).length;
    const mine = mp && players[mp.sessionId];
    const myId = mine && mine.sn ? String(mine.sn) : '';
    if (myId && (!me || me.id !== myId) && snakes.has(myId)) becomeMe(snakes.get(myId));
    if (me) reconcile(ents[me.id]);

    const pk = (st.entities && st.entities.pk) || {};
    const list = [];
    for (const id in pk) {
      const e = pk[id];
      if (!POWERUPS[e.t]) continue;
      let p = pickupCache.get(id);
      if (!p) pickupCache.set(id, (p = { phase: rand(0, TAU), born: t }));
      p.x = e.x;
      p.y = e.y;
      p.type = e.t;
      p.natural = !!e.n;
      p.serverBorn = e.b;
      list.push(p);
    }
    if (pickupCache.size > list.length + 50) {
      for (const id of pickupCache.keys()) if (!pk[id]) pickupCache.delete(id);
    }
    pickups = list;
  }

  function onDead(d) {
    if (!d || typeof d !== 'object') return;
    state = 'dead';
    me = null;
    hud.hidden = true;
    input.reset();
    $('deathCause').textContent = d.cause === 'edge' ? 'You hit the edge of the world'
      : d.cause === 'shot' ? `Shot down by ${d.by}` : d.by ? `Chomped by ${d.by}` : 'You got chomped';
    $('dScore').textContent = d.score | 0;
    $('dLen').textContent = d.len | 0;
    $('dKills').textContent = d.kills | 0;
    $('dDots').textContent = d.dots | 0;
    $('dHits').textContent = d.hits | 0;
    $('dTime').textContent = fmtTime(d.secs | 0);
    $('dBest').textContent = d.newBest ? 'New best score!' : `Your best score: ${d.best | 0}`;
    setTimeout(() => { if (state === 'dead') deathScreen.hidden = false; }, 1100);
    setTimeout(refreshMenuData, 1500); // saves and scores flush within about a second
  }

  // ---------- Effects ----------
  const inView = (x, y, margin) =>
    Math.abs(x - cam.x) < W / 2 / cam.zoom + margin && Math.abs(y - cam.y) < H / 2 / cam.zoom + margin;

  function spawnParticles(x, y, ang, spread, n, speed, size, sprite, glow) {
    for (let k = 0; k < n && particles.length < MAX_PARTICLES; k++) {
      const a = ang + rand(-spread, spread), sp = speed * rand(0.35, 1), life = rand(0.3, 0.65);
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, size: size * rand(0.6, 1.2), sprite, glow });
    }
  }

  // Chunks of the snake's skin plus white sparks, sprayed around `ang`.
  function hitFx(s, i, x, y, ang, spread, scale) {
    if (!inView(x, y, 150)) return;
    if (s) {
      const sprite = s.sprites[((i / 3) | 0) % s.sprites.length];
      spawnParticles(x, y, ang, spread, Math.round(8 * scale), 420, Math.max(5, s.r * 0.5), sprite, false);
    }
    spawnParticles(x, y, ang, spread * 1.3, Math.round(6 * scale), 650, 11, sparkSprite, true);
  }

  function explosionFx(x, y, R) {
    if (!inView(x, y, R + 100)) return;
    spawnParticles(x, y, 0, Math.PI, 30, R * 5, 22, fireSprite, true);
    spawnParticles(x, y, 0, Math.PI, 12, R * 6, 10, sparkSprite, true);
    particles.push({ x, y, vx: 0, vy: 0, life: 0.35, max: 0.35, size: R, ring: true });
  }

  function updateParticles(dt) {
    const drag = Math.max(0, 1 - 4 * dt);
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  // Bullets fly on their own between server messages; the server says when one hits something.
  function updateBullets(dt) {
    for (const b of bullets) {
      b.life -= dt;
      if (b.homing) {
        const sp = Math.hypot(b.vx, b.vy);
        b.retarget -= dt;
        if (b.retarget <= 0) {
          b.retarget = 0.15;
          b.target = null;
          let best = 650 * 650;
          const cx = b.vx / sp, cy = b.vy / sp;
          for (const o of snakes.values()) {
            if (o === b.owner || o.ghostLeft > 0) continue;
            const dx = o.x - b.x, dy = o.y - b.y, d2 = dx * dx + dy * dy;
            if (d2 < best && dx * cx + dy * cy > 0) { best = d2; b.target = o; }
          }
        }
        const t = b.target;
        if (t && snakes.get(t.id) === t) {
          const cur = Math.atan2(b.vy, b.vx);
          const a = cur + clamp(angleDiff(cur, Math.atan2(t.y - b.y, t.x - b.x)), -b.homing * dt, b.homing * dt);
          b.vx = Math.cos(a) * sp;
          b.vy = Math.sin(a) * sp;
        }
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.life <= 0 || b.x * b.x + b.y * b.y > WORLD_R * WORLD_R) b.dead = true;
    }
    bullets = bullets.filter((b) => !b.dead);
  }

  function updateEating(dt) {
    for (const f of eating) {
      f.eatT -= dt;
      const h = f.eater.segs[0];
      if (!h) continue;
      const k = Math.min(1, dt * 22);
      f.x += (h.x - f.x) * k;
      f.y += (h.y - f.y) * k;
    }
    eating = eating.filter((f) => f.eatT > 0);
  }

  // ---------- Update ----------
  function update(dt) {
    if (state === 'playing' && me && mp) {
      const dx = input.x - ((me.x - cam.x) * cam.zoom + W / 2);
      const dy = input.y - ((me.y - cam.y) * cam.zoom + H / 2);
      if (dx * dx + dy * dy > 25) targetAngle = Math.atan2(dy, dx);
      inputAcc += dt;
      for (let n = 0; inputAcc >= INPUT_DT && n < 3; n++) {
        inputAcc -= INPUT_DT;
        sendInput();
      }
      if (inputAcc > INPUT_DT) inputAcc = 0;
    }
    const k = Math.exp(-dt * 8);
    corr.x *= k;
    corr.y *= k;
    for (const s of snakes.values()) s.tick(dt);
    updateEating(dt);
    updateBullets(dt);
    updateParticles(dt);
    updateCamera(dt);

    // Our snake vanished without a death notice (e.g. a reconnect): back to the menu.
    if (state === 'playing' && !me && time - lostMeAt > 2.5) showMenu();
    if (state === 'spawning' && time - spawnAt > 4) {
      showMenu();
      setMenuMsg('Could not spawn. Try again.');
    }

    if (state === 'playing' && me) {
      updateHealthBar();
      lbT -= dt;
      if (lbT <= 0) {
        lbIdx = (lbIdx + 1) % LB_CATS.length;
        lbT = LB_ROTATE;
        hudT = 0;
      }
      lbTimerFill.style.width = `${(lbT / LB_ROTATE) * 100}%`;
      hudT -= dt;
      if (hudT <= 0) {
        updateHud();
        hudT = 0.25;
      }
    }
  }

  function updateCamera(dt) {
    let target = me;
    if (!target && state === 'menu') {
      for (const s of snakes.values()) if (!target || s.mass > target.mass) target = s;
    }
    if (target) {
      cam.tx = target.x;
      cam.ty = target.y;
      cam.tr = target.r;
    }
    const k = Math.min(1, dt * (state === 'playing' ? 12 : 2.5));
    cam.x += (cam.tx - cam.x) * k;
    cam.y += (cam.ty - cam.y) * k;
    const base = clamp(Math.min(W, H) / 850, 0.6, 1.5);
    const zt = base * Math.pow(14 / (cam.tr + 3), 0.55);
    cam.zoom += (zt - cam.zoom) * Math.min(1, dt * 2);
  }

  // ---------- Rendering ----------
  function drawSnake(s, vx0, vy0, vx1, vy1) {
    const segs = s.segs, n = segs.length, r = s.r;
    if (!n) return;
    const m = r * 2.6;
    const alpha = s.ghostLeft > 0 ? 0.35 + 0.1 * Math.sin(time * 10) : 1;

    if (s.boosting) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (0.55 + 0.25 * Math.sin(time * 18)) * alpha;
      for (let i = n - 1; i >= 0; i -= 2) {
        const p = segs[i];
        if (p.x < vx0 - m || p.x > vx1 + m || p.y < vy0 - m || p.y > vy1 + m) continue;
        ctx.drawImage(s.glow, p.x - m, p.y - m, m * 2, m * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.globalAlpha = alpha;
    const tailN = clamp(Math.floor(n * 0.35), 3, 12);
    for (let i = n - 1; i >= 0; i--) {
      const p = segs[i];
      if (p.x < vx0 - r || p.x > vx1 + r || p.y < vy0 - r || p.y > vy1 + r) continue;
      const fromTail = n - 1 - i;
      const sr = fromTail < tailN ? r * (0.45 + (0.55 * fromTail) / tailN) : r;
      ctx.drawImage(s.sprites[((i / 3) | 0) % s.sprites.length], p.x - sr, p.y - sr, sr * 2, sr * 2);
    }

    // Damaged circles: charred, cracked, and a blinking ring once close to breaking.
    // Drawn on top since each circle is mostly covered by the next one.
    if (s.hurt.size) {
      const blink = 0.5 + 0.5 * Math.sin(time * 16);
      const cr = r * 0.85;
      ctx.fillStyle = '#000';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1.5, r * 0.14);
      for (const [i, sev] of s.hurt) {
        const p = segs[i];
        if (!p || p.x < vx0 - r || p.x > vx1 + r || p.y < vy0 - r || p.y > vy1 + r) continue;
        const frac = (sev + 0.5) / 10;
        ctx.globalAlpha = (0.3 + 0.5 * frac) * alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, cr, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = Math.min(1, 0.5 + frac) * alpha;
        ctx.drawImage(crackSprites[i % 3], p.x - cr, p.y - cr, cr * 2, cr * 2);
        if (frac > 0.4) {
          ctx.globalAlpha = blink * frac * alpha;
          ctx.stroke();
        }
      }
    }

    const h = segs[0];
    if (s.frenzyLeft > 0) {
      const g = r * (2.4 + 0.4 * Math.sin(time * 20));
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.8 * alpha;
      ctx.drawImage(frenzyGlow, h.x - g, h.y - g, g * 2, g * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (s.hitFlash > 0) {
      ctx.globalAlpha = (s.hitFlash / 0.15) * 0.7 * alpha;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(h.x, h.y, r, 0, TAU);
      ctx.fill();
    }

    // Eyes
    ctx.globalAlpha = alpha;
    const ca = Math.cos(s.angle), sa = Math.sin(s.angle);
    const lc = Math.cos(s.targetAngle), ls = Math.sin(s.targetAngle);
    const er = r * 0.36, pr = r * 0.2;
    for (const side of [-1, 1]) {
      const ex = h.x + ca * r * 0.35 - sa * r * 0.48 * side;
      const ey = h.y + sa * r * 0.35 + ca * r * 0.48 * side;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex, ey, er, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(ex + lc * er * 0.45, ey + ls * er * 0.45, pr, 0, TAU);
      ctx.fill();
    }

    // Shield bubble around the head
    if (s.shield > 0) {
      const f = s.shield / MAX_SHIELD;
      ctx.beginPath();
      ctx.arc(h.x, h.y, r * 1.55, 0, TAU);
      ctx.globalAlpha = (0.12 + 0.15 * f + (s.shieldFlash > 0 ? 0.25 : 0)) * alpha;
      ctx.fillStyle = '#74c0fc';
      ctx.fill();
      ctx.globalAlpha = (0.45 + 0.4 * f + (s.shieldFlash > 0 ? 0.3 : 0)) * alpha;
      ctx.strokeStyle = '#a5d8ff';
      ctx.lineWidth = Math.max(2, r * 0.14);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawPickups(vx0, vy0, vx1, vy1) {
    const size = PICKUP_R * 2.3, gs = PICKUP_R * 4, sn = serverNow();
    for (const pk of pickups) {
      if (pk.x < vx0 - gs || pk.x > vx1 + gs || pk.y < vy0 - gs || pk.y > vy1 + gs) continue;
      const def = POWERUPS[pk.type];
      let a = Math.min(1, (time - pk.born) / 0.4);
      if (!pk.natural && PICKUP_DROP_LIFE - (sn - pk.serverBorn) < 10) a *= 0.55 + 0.45 * Math.sin(time * 12); // about to expire
      const y = pk.y + Math.sin(time * 3 + pk.phase) * 3;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * (0.55 + 0.25 * Math.sin(time * 4 + pk.phase));
      ctx.drawImage(rarityGlow[def.rarity], pk.x - gs / 2, y - gs / 2, gs, gs);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = a;
      ctx.drawImage(iconSprite(pk.type), pk.x - size / 2, y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  function drawMinimap() {
    const R = Math.min(75, Math.min(W, H) * 0.14);
    const cx = W - R - 16, cy = H - R - 16;
    const k = R / WORLD_R;
    ctx.fillStyle = 'rgba(10,14,20,0.7)';
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // Rare and epic loot shows up on the map.
    for (const pk of pickups) {
      const rarity = POWERUPS[pk.type].rarity;
      if (rarity !== 'rare' && rarity !== 'epic') continue;
      ctx.fillStyle = RARITY[rarity].color;
      ctx.fillRect(cx + pk.x * k - 1.5, cy + pk.y * k - 1.5, 3, 3);
    }
    ctx.lineCap = 'round';
    for (const s of snakes.values()) {
      ctx.strokeStyle = s.isPlayer ? '#fff' : s.miniColor;
      ctx.lineWidth = s.isPlayer ? 2.5 : clamp(s.r * 0.08, 1, 3);
      ctx.beginPath();
      for (let i = 0; i < s.segs.length; i += 3) ctx.lineTo(cx + s.segs[i].x * k, cy + s.segs[i].y * k);
      ctx.stroke();
    }
    if (me) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx + me.x * k, cy + me.y * k, 3, 0, TAU);
      ctx.fill();
    }
  }

  // Player's loadout along the bottom: weapon, stacked upgrades, timed effects.
  function drawTray() {
    const items = [{ id: 'w_' + me.weapon, label: WEAPONS[me.weapon].name }];
    for (const id of Object.keys(me.stacks)) items.push({ id, count: me.stacks[id] });
    if (me.ghostLeft > 0) items.push({ id: 'ghost', timer: me.ghostLeft });
    if (me.frenzyLeft > 0) items.push({ id: 'frenzy', timer: me.frenzyLeft });
    const gap = 6;
    const size = clamp((W - 140) / items.length - gap, 22, 40);
    const total = items.length * (size + gap) - gap;
    let x = Math.max(116, (W - total) / 2);
    const y = H - size - 16;
    ctx.textAlign = 'center';
    for (const it of items) {
      ctx.drawImage(iconSprite(it.id), x, y, size, size);
      if (it.label) {
        ctx.font = '600 11px Poppins, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillText(it.label, x + size / 2, y - 6);
      }
      if (it.count > 1 || it.timer) {
        const text = it.timer ? `${Math.ceil(it.timer)}s` : `x${it.count}`;
        ctx.font = '700 11px Poppins, system-ui, sans-serif';
        const tw = ctx.measureText(text).width + 8;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(x + size - tw + 2, y + size - 12, tw, 14);
        ctx.fillStyle = it.timer ? '#ffd43b' : '#fff';
        ctx.fillText(text, x + size - tw / 2 + 2, y + size - 1);
      }
      x += size + gap;
    }
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, W, H);

    const z = cam.zoom;
    const vx0 = cam.x - W / 2 / z, vx1 = cam.x + W / 2 / z;
    const vy0 = cam.y - H / 2 / z, vy1 = cam.y + H / 2 / z;
    ctx.setTransform(DPR * z, 0, 0, DPR * z, DPR * (W / 2 - cam.x * z), DPR * (H / 2 - cam.y * z));

    // Hex floor inside the world
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, WORLD_R, 0, TAU);
    ctx.clip();
    ctx.fillStyle = hexPattern;
    ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
    ctx.restore();

    // Danger zone outside + border
    ctx.beginPath();
    ctx.rect(vx0 - 10, vy0 - 10, vx1 - vx0 + 20, vy1 - vy0 + 20);
    ctx.arc(0, 0, WORLD_R, 0, TAU);
    ctx.fillStyle = 'rgba(110,10,25,0.35)';
    ctx.fill('evenodd');
    ctx.beginPath();
    ctx.arc(0, 0, WORLD_R, 0, TAU);
    ctx.strokeStyle = 'rgba(255,60,85,0.25)';
    ctx.lineWidth = 18;
    ctx.stroke();
    ctx.strokeStyle = '#ff3b55';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Food
    ctx.globalCompositeOperation = 'lighter';
    const drawFood = (f, shrink) => {
      if (f.x < vx0 - 30 || f.x > vx1 + 30 || f.y < vy0 - 30 || f.y > vy1 + 30) return;
      const age = time - f.born;
      ctx.globalAlpha = age < 0.4 ? age / 0.4 : 1;
      const sz = f.r * 6 * (1 + 0.15 * Math.sin(time * 4 + f.phase)) * shrink;
      const fx = f.x + Math.cos(time * 1.7 + f.phase) * 2;
      const fy = f.y + Math.sin(time * 1.3 + f.phase) * 2;
      ctx.drawImage(f.sprite, fx - sz / 2, fy - sz / 2, sz, sz);
    };
    for (const f of foods.values()) drawFood(f, 1);
    for (const f of eating) drawFood(f, f.eatT / 0.12);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    drawPickups(vx0, vy0, vx1, vy1);

    // Snakes (player on top)
    for (const s of snakes.values()) if (!s.isPlayer) drawSnake(s, vx0, vy0, vx1, vy1);
    if (me) drawSnake(me, vx0, vy0, vx1, vy1);

    // Bullets: glow, then a white streak
    ctx.globalCompositeOperation = 'lighter';
    for (const b of bullets) {
      if (b.x < vx0 - 30 || b.x > vx1 + 30 || b.y < vy0 - 30 || b.y > vy1 + 30) continue;
      const g = 14 * b.size;
      ctx.drawImage(b.glow, b.x - g, b.y - g, g * 2, g * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    for (const b of bullets) {
      if (b.x < vx0 - 30 || b.x > vx1 + 30 || b.y < vy0 - 30 || b.y > vy1 + 30) continue;
      ctx.lineWidth = BULLET_R * 1.2 * b.size;
      ctx.beginPath();
      ctx.moveTo(b.x - b.vx * b.tail, b.y - b.vy * b.tail);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Particles: skin chunks normally, sparks additively, blast rings as strokes
    for (const p of particles) {
      const t = p.life / p.max;
      if (p.ring) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = t;
        ctx.strokeStyle = '#ffd8a8';
        ctx.lineWidth = 6 * t + 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.3 + 0.7 * (1 - t)), 0, TAU);
        ctx.stroke();
        continue;
      }
      if (p.x < vx0 - 20 || p.x > vx1 + 20 || p.y < vy0 - 20 || p.y > vy1 + 20) continue;
      const sz = p.size * (0.4 + 0.6 * t);
      ctx.globalAlpha = Math.min(1, t * 1.5);
      ctx.globalCompositeOperation = p.glow ? 'lighter' : 'source-over';
      ctx.drawImage(p.sprite, p.x - sz, p.y - sz, sz * 2, sz * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Names + health bars (other players' names in white, bots dimmer)
    ctx.font = `600 ${Math.round(13 / z)}px Poppins, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    for (const s of snakes.values()) {
      const h = s.segs[0];
      if (!h || h.x < vx0 || h.x > vx1 || h.y < vy0 || h.y > vy1) continue;
      ctx.fillStyle = s.pid && !s.isPlayer ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)';
      ctx.fillText(s.name, h.x, h.y - s.r - 10 / z);
      if (s.hp < s.maxHp) {
        const bw = 40 / z, bh = 5 / z, bx = h.x - bw / 2, by = h.y - s.r - 34 / z;
        const frac = Math.max(0, s.hp / s.maxHp);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = frac > 0.5 ? '#7cff6b' : frac > 0.25 ? '#ffd43b' : '#ff4d6d';
        ctx.fillRect(bx, by, bw * frac, bh);
      }
    }

    // Screen space
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
    if (state === 'playing' && me) {
      drawMinimap();
      drawTray();
    }
  }

  // ---------- HUD / UI ----------
  const $ = (id) => document.getElementById(id);
  const hud = $('hud'), menu = $('menu'), deathScreen = $('deathScreen'), guide = $('guide');
  const nameInput = $('nameInput'), skinsEl = $('skins'), playBtn = $('playBtn');
  const boostBtn = $('boostBtn'), fireBtn = $('fireBtn');
  const hpFill = $('hpFill'), shBar = $('shBar'), shFill = $('shFill');
  const lbTimerFill = $('lbTimerFill');
  let skinIdx = clamp(parseInt(store.get('chomp.skin'), 10) || 0, 0, SKINS.length - 1);
  nameInput.value = store.get('chomp.name') || '';

  const LB_CATS = [
    { title: 'Top Score', val: (s) => s.score },
    { title: 'Most Kills', val: (s) => s.kills },
    { title: 'Longest', val: (s) => Math.floor(s.mass) },
    { title: 'Most Dots', val: (s) => s.dots },
  ];
  $('lbTabs').innerHTML = LB_CATS.map(() => '<i></i>').join('');

  function selectSkin(i) {
    skinIdx = i;
    skinsEl.querySelectorAll('.skin').forEach((el, j) => el.classList.toggle('sel', j === i));
  }
  SKINS.forEach((skin, i) => {
    const b = document.createElement('button');
    b.className = 'skin' + (i === skinIdx ? ' sel' : '');
    b.style.background = `repeating-linear-gradient(135deg, ${skin[0]} 0 10px, ${skin[1]} 10px 20px)`;
    b.setAttribute('aria-label', `Skin ${i + 1}`);
    b.addEventListener('click', () => selectSkin(i));
    skinsEl.appendChild(b);
  });

  // Power-up guide, grouped into upgrades and weapons.
  function buildGuide() {
    const row = (id) => {
      const d = POWERUPS[id], r = RARITY[d.rarity];
      return `<li><img src="${iconURL(id)}" alt=""><div><b>${esc(d.name)}</b>` +
        `<em style="color:${r.color}">${r.label}</em><span>${esc(d.desc)}</span></div></li>`;
    };
    const ids = Object.keys(POWERUPS).filter((id) => !POWERUPS[id].noSpawn);
    $('guideUpgrades').innerHTML = ids.filter((id) => !POWERUPS[id].weapon).map(row).join('');
    $('guideWeapons').innerHTML = ids.filter((id) => POWERUPS[id].weapon).map(row).join('');
  }
  buildGuide();

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function pickupToast(type, msg) {
    const def = POWERUPS[type];
    if (!def) return;
    const box = $('pickupToasts');
    const el = document.createElement('div');
    el.className = 'ptoast';
    el.style.setProperty('--rc', RARITY[def.rarity].color);
    el.innerHTML = `<img src="${iconURL(type)}" alt=""><div><b>${esc(def.name)}</b><span>${esc(msg)}</span></div>`;
    box.prepend(el);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => el.remove(), 2600);
  }

  function updateHud() {
    if (!me) return;
    const cat = LB_CATS[lbIdx];
    const sorted = [...snakes.values()].sort((a, b) => cat.val(b) - cat.val(a));
    $('lbTitle').textContent = cat.title;
    $('lbTabs').querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i === lbIdx));
    $('lbList').innerHTML = sorted.slice(0, 10).map((s, i) =>
      `<li class="${s.isPlayer ? 'me' : s.pid ? 'human' : ''}"><span>${i + 1}. ${esc(s.name)}</span><b>${cat.val(s)}</b></li>`
    ).join('');
    $('rank').textContent = `Your rank: ${sorted.indexOf(me) + 1} of ${sorted.length} · ${online} online`;
    $('score').textContent = me.score;
    $('len').textContent = Math.floor(me.mass);
    $('kills').textContent = me.kills;
    $('dots').textContent = me.dots;
    $('hits').textContent = me.hits;
  }

  function updateHealthBar() {
    const frac = Math.max(0, me.hp / me.maxHp);
    hpFill.style.width = `${frac * 100}%`;
    hpFill.style.background = frac > 0.5 ? '#7cff6b' : frac > 0.25 ? '#ffd43b' : '#ff4d6d';
    shBar.hidden = me.shield <= 0;
    shFill.style.width = `${(me.shield / MAX_SHIELD) * 100}%`;
  }

  const setMenuMsg = (msg) => { $('menuMsg').textContent = msg; };

  let spawnAt = 0;
  function startGame() {
    if (!mp || state === 'spawning' || state === 'playing') return;
    const name = nameInput.value.trim().slice(0, 16) || (account && account.username) || 'Guest';
    store.set('chomp.name', nameInput.value.trim());
    store.set('chomp.skin', String(skinIdx));
    savePrefs(nameInput.value.trim(), skinIdx);
    mp.send('spawn', { n: name, s: skinIdx });
    state = 'spawning';
    spawnAt = time;
    setMenuMsg('');
    menu.hidden = true;
    guide.hidden = true;
    deathScreen.hidden = true;
  }

  function showMenu() {
    state = 'menu';
    me = null;
    hud.hidden = true;
    deathScreen.hidden = true;
    menu.hidden = false;
    refreshMenuData();
  }

  playBtn.addEventListener('click', startGame);
  $('againBtn').addEventListener('click', startGame);
  $('menuBtn').addEventListener('click', showMenu);
  $('guideBtn').addEventListener('click', () => { guide.hidden = false; });
  $('guideClose').addEventListener('click', () => { guide.hidden = true; });

  // ---------- Accounts, saves & leaderboards ----------
  const auth = OFFLINE ? window.ChompLocal.auth() : MP.auth({ key: NET.key, apiUrl: NET.apiUrl });
  let mp = null;
  let account = null; // { id, username, claimed }
  let boardIdx = 0;

  function track(where, err) {
    try { if (mp) mp.track('error', { message: String((err && err.message) || err).slice(0, 200), where }); } catch { /* analytics is best-effort */ }
  }

  function setNet(msg, bad) {
    const el = $('netStatus');
    el.textContent = msg;
    el.classList.toggle('bad', !!bad);
    $('netBanner').hidden = !(bad && state === 'playing');
    $('netBanner').textContent = msg;
  }

  function updateAccountUI() {
    $('account').hidden = OFFLINE; // accounts live online
    const claimed = account && account.claimed;
    $('acctGuest').hidden = !!claimed;
    $('acctUserLine').hidden = !claimed;
    if (claimed) $('acctName').textContent = account.username;
    if (claimed) $('acctForm').hidden = true;
  }

  async function savePrefs(name, skin) {
    try { await auth.data.set({ name, skin }); } catch (err) { track('savePrefs', err); }
  }

  async function loadPrefs() {
    try {
      const { data } = await auth.data.get();
      if (data && typeof data.name === 'string' && data.name) nameInput.value = data.name.slice(0, 16);
      if (data && Number.isInteger(data.skin)) selectSkin(clamp(data.skin, 0, SKINS.length - 1));
    } catch (err) { track('loadPrefs', err); }
  }

  async function refreshStats() {
    try {
      const { data } = await auth.data.get('@save');
      const v = data || {};
      const cell = (label, val) => `<div><span>${label}</span><b>${val}</b></div>`;
      $('myStats').innerHTML = cell('Games', v.games || 0) + cell('Best score', v.best || 0) + cell('Longest', v.bestLen || 0)
        + cell('Kills', v.kills || 0) + cell('Dots', v.dots || 0) + cell('Time', fmtTime(v.time || 0));
    } catch (err) {
      track('refreshStats', err);
    }
  }

  async function refreshBoards() {
    const b = BOARDS[boardIdx];
    $('boardTabs').querySelectorAll('button').forEach((el, i) => el.classList.toggle('on', i === boardIdx));
    try {
      const board = auth.leaderboard(b.id);
      const [{ entries }, mine] = await Promise.all([board.top(10), board.myRank()]);
      if (BOARDS[boardIdx] !== b) return;
      $('boardList').innerHTML = entries.length ? entries.map((e) =>
        `<li class="${account && e.playerId === account.id ? 'me' : ''}"><span>${e.rank}. ${esc(e.username || 'Guest')}</span><b>${e.score}</b></li>`
      ).join('') : '<li class="empty">No scores yet. Be the first!</li>';
      $('boardMine').textContent = OFFLINE ? 'Offline: your bests on this device'
        : mine && mine.rank ? `You: #${mine.rank} of ${mine.total}`
        : 'Play a round to get on the board';
    } catch (err) {
      $('boardList').innerHTML = '<li class="empty">Leaderboard unavailable</li>';
      $('boardMine').textContent = '';
      track('refreshBoards', err);
    }
  }

  function refreshMenuData() {
    refreshBoards();
    refreshStats();
  }

  $('boardTabs').innerHTML = BOARDS.map((b) => `<button type="button">${b.title}</button>`).join('');
  $('boardTabs').querySelectorAll('button').forEach((el, i) => el.addEventListener('click', () => {
    boardIdx = i;
    refreshBoards();
  }));

  $('acctToggle').addEventListener('click', () => {
    $('acctForm').hidden = !$('acctForm').hidden;
    if (!$('acctForm').hidden) $('acctUser').focus();
  });

  async function accountAction(kind) {
    const user = $('acctUser').value.trim(), pass = $('acctPass').value;
    const msg = $('acctMsg');
    if (!user || !pass) {
      msg.textContent = 'Enter a username and password.';
      return;
    }
    msg.textContent = kind === 'claim' ? 'Creating account…' : 'Logging in…';
    try {
      if (kind === 'claim') {
        await auth.claim(user, pass); // same player id, so progress so far is kept
        account = await auth.getPlayer();
      } else {
        await auth.login(user, pass);
        account = await auth.getPlayer();
        await reconnect(); // a different player: rejoin so the server saves to the right account
        await loadPrefs();
      }
      $('acctPass').value = '';
      msg.textContent = '';
      if (!nameInput.value.trim()) nameInput.value = account.username || '';
      updateAccountUI();
      refreshMenuData();
    } catch (err) {
      msg.textContent = String((err && err.message) || err || 'Something went wrong');
    }
  }
  $('signupBtn').addEventListener('click', () => accountAction('claim'));
  $('loginBtn').addEventListener('click', () => accountAction('login'));
  $('logoutBtn').addEventListener('click', async () => {
    auth.logout();
    account = null;
    await reconnect();
    updateAccountUI();
    refreshMenuData();
  });

  // ---------- Connection ----------
  function resetWorld() {
    snakes.clear();
    foods.clear();
    pickupCache.clear();
    pickups = [];
    bullets = [];
    eating = [];
    me = null;
  }

  async function connect() {
    setNet('Connecting…');
    playBtn.disabled = true;
    try {
      account = await auth.getPlayer();
      mp = OFFLINE
        ? await window.ChompLocal.join()
        : await MP.join({ key: NET.key, room: NET.room, endpoint: NET.endpoint, apiUrl: NET.apiUrl, player: auth });
    } catch (err) {
      setNet('Could not connect. Retrying…', true);
      setTimeout(connect, 3000);
      return;
    }
    mp.onState(onState);
    mp.on('t', onTickEvents);
    mp.on('fs', onFoodSnapshot);
    mp.on('dead', onDead);
    mp.on('toast', (msg) => toast(String(msg).slice(0, 80)));
    mp.on('pu', (d) => Array.isArray(d) && pickupToast(d[0], String(d[1])));
    mp.onDisconnect(() => setNet('Reconnecting…', true));
    mp.onReconnect(() => {
      setNet('');
      mp.send('hello'); // re-sync orbs we may have missed
    });
    mp.send('hello');
    setNet(OFFLINE ? OFFLINE_NOTE : '');
    playBtn.disabled = false;
    updateAccountUI();
    refreshMenuData();
  }

  async function reconnect() {
    const old = mp;
    mp = null;
    resetWorld();
    if (old) {
      try { await old.leave(); } catch (err) { track('leave', err); }
    }
    await connect();
  }

  window.addEventListener('pagehide', () => { if (mp) mp.leave(); });

  // ---------- Input ----------
  const input = {
    x: W / 2, y: H / 2,
    key: false, mouse: false, touch: false, btn: false,
    fireKey: false, fireMouse: false, fireBtn: false,
    boost() { return this.key || this.mouse || this.touch || this.btn; },
    firing() { return this.fireKey || this.fireMouse || this.fireBtn; },
    reset() {
      this.key = this.mouse = this.touch = this.btn = false;
      this.fireKey = this.fireMouse = this.fireBtn = false;
      boostBtn.classList.remove('on');
      fireBtn.classList.remove('on');
    },
  };

  const BOOST_KEYS = ['Space', 'ArrowUp', 'KeyW'];
  window.addEventListener('mousemove', (e) => { input.x = e.clientX; input.y = e.clientY; });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) input.fireMouse = true;
    else if (e.button === 2) input.mouse = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.fireMouse = false;
    else if (e.button === 2) input.mouse = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => input.reset());

  window.addEventListener('keydown', (e) => {
    if (state === 'playing' && BOOST_KEYS.includes(e.code)) {
      e.preventDefault();
      input.key = true;
    } else if (state === 'playing' && e.code === 'KeyF') {
      input.fireKey = true;
    } else if (e.code === 'Escape') {
      guide.hidden = true;
    } else if (e.code === 'Enter' && guide.hidden && !e.target.closest('#acctForm')) {
      if (state === 'menu' || (state === 'dead' && !deathScreen.hidden)) startGame();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (BOOST_KEYS.includes(e.code)) input.key = false;
    else if (e.code === 'KeyF') input.fireKey = false;
  });

  function onTouch(e) {
    e.preventDefault();
    const t = e.targetTouches[0];
    if (t) { input.x = t.clientX; input.y = t.clientY; }
    input.touch = e.targetTouches.length >= 2;
  }
  canvas.addEventListener('touchstart', onTouch, { passive: false });
  canvas.addEventListener('touchmove', onTouch, { passive: false });
  canvas.addEventListener('touchend', onTouch, { passive: false });
  canvas.addEventListener('touchcancel', onTouch, { passive: false });

  function bindHoldButton(el, prop) {
    const set = (on) => (e) => {
      e.preventDefault();
      input[prop] = on;
      el.classList.toggle('on', on);
    };
    el.addEventListener('touchstart', set(true), { passive: false });
    el.addEventListener('touchend', set(false), { passive: false });
    el.addEventListener('touchcancel', set(false), { passive: false });
  }
  bindHoldButton(boostBtn, 'btn');
  bindHoldButton(fireBtn, 'fireBtn');
  if ('ontouchstart' in window || window.matchMedia('(pointer: coarse)').matches) {
    boostBtn.hidden = false;
    fireBtn.hidden = false;
  }

  // ---------- Boot ----------
  connect().then(loadPrefs);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time = now / 1000;
    try {
      update(dt);
      render();
    } catch (err) {
      track('frame', err);
      console.error(err);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
