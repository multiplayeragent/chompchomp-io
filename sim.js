'use strict';

// Game rules shared by the authoritative room logic (which runs the whole world) and the browser
// client (constants, movement prediction, body layout). Loaded after powerups.js.
window.ChompSim = (() => {
  const { MAX_SHIELD, WEAPONS, POWERUPS, rollPowerup } = window.ChompPowerups;

  // ---------- Config ----------
  const WORLD_R = 3500;
  const BOT_COUNT = 24; // bots in a world with nobody online
  const BOTS_PER_HUMAN = 3; // bots retired for each connected player
  const BOT_RETIRE_DIST = 1600; // bots are retired out of every player's sight when possible
  const FOOD_TARGET = 2400;
  const FOOD_MAX = 6000;
  const CELL = 100;
  const MAX_SEG_R = 38;
  const BASE_SPEED = 190;
  const BOOST_SPEED = 400;
  const BOOST_COST = 5; // mass per second
  const MIN_BOOST_MASS = 12;
  const START_MASS = 10;
  const MIN_MASS = 6;
  const HUNT_GRACE = 8; // seconds a new snake is ignored by hunting/shooting bots
  const SPAWN_CLEAR_PLAYER = 700; // px of open space required around a player spawn
  const SPAWN_CLEAR_BOT = 400;
  const SPAWN_AWAY_FROM_PLAYERS = 900; // bots never spawn this close to a player's head
  const BASE_HEALTH = 100;
  const HEADSHOT_DAMAGE = 12;
  const REGEN_DELAY = 2.5; // seconds after a hit before head health regenerates
  const REGEN_RATE = 20; // head health per second
  const BULLET_SPEED = 900;
  const BULLET_LIFE = 0.8;
  const BULLET_R = 4;
  const HEAD_SEGS = 1; // hits on segments 0..HEAD_SEGS count as headshots
  const BODY_DAMAGE = 10;
  const BODY_SPLASH = [0.5, 0.25]; // damage fraction dealt to circles 1 and 2 away from the one hit
  const segMaxHp = (mass) => 10 + Math.sqrt(mass) * 4; // per body circle; bigger snakes are tougher
  const FREE_FIRE_MASS = 100; // shooting is free below this length
  const SHOT_COST = 0.01; // fraction of mass per shot at or above FREE_FIRE_MASS
  const fireInterval = (mass) => clamp(0.1 + mass * 0.0018, 0.1, 1.2);
  const PICKUP_TARGET = 60; // natural power-ups kept in the world
  const PICKUP_R = 18;
  const PICKUP_DROP_LIFE = 90; // seconds a power-up dropped by a dead snake lasts
  const MAX_DROPS = 12; // power-ups a dying snake can drop
  const SCORE_DOT = 2;
  const SCORE_KILL = 250;
  const SCORE_HIT = 10;
  const SCORE_PER_LENGTH_SEC = 0.05; // score per unit of length per second
  const TAU = Math.PI * 2;

  const SKINS = [
    ['#ff4d6d', '#ff8fa3'],
    ['#4dabf7', '#a5d8ff'],
    ['#51cf66', '#b2f2bb'],
    ['#fcc419', '#ffe066'],
    ['#cc5de8', '#e599f7'],
    ['#ff922b', '#ffc078'],
    ['#22b8cf', '#99e9f2'],
    ['#f06595', '#5c7cfa'],
    ['#94d82d', '#2f9e44'],
    ['#f8f9fa', '#868e96'],
  ];
  const FOOD_COLORS = ['#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7', '#da77f2', '#ff922b', '#3bc9db', '#f783ac', '#a9e34b'];
  // Every colour an orb can have, so the network sends an index instead of a hex string.
  const PALETTE = [...new Set([...FOOD_COLORS, ...SKINS.flat()])];
  const colorIdx = (hex) => PALETTE.indexOf(hex);
  const WEAPON_IDS = Object.keys(WEAPONS);
  const BOT_NAMES = [
    'Noodle', 'Slinky', 'Mr. Wiggles', 'Danger Noodle', 'Sir Hiss', 'Spaghetti', 'Zigzag', 'Nope Rope',
    'Hissy Fit', 'Kaa', 'Viper', 'Mamba', 'Cobra Kai', 'Python', 'Anaconda', 'Wormy', 'Sneky', 'Snek',
    'Longboi', 'Chompy', 'Gobbler', 'Munch', 'Pretzel', 'Licorice', 'Garden Hose', 'Shoelace', 'Ramen',
    'Udon', 'Linguine', 'Gummy Worm', 'Slippy', 'Squiggles', 'Twisty', 'Coily', 'Neon', 'Glowstick',
  ];

  // ---------- Utils ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function angleDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    else if (d < -Math.PI) d += TAU;
    return d;
  }
  function randomPoint(frac) {
    const a = rand(0, TAU);
    const r = Math.sqrt(Math.random()) * WORLD_R * frac;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---------- Movement & body (shared with client prediction) ----------
  const radius = (mass) => 8 + Math.min(30, Math.sqrt(mass) * 0.95);
  const bodyLength = (mass) => 35 * Math.pow(mass, 0.6);
  const turnRate = (r, turnMod) => (5.2 * turnMod) / (1 + (r - 11) / 28);
  const moveSpeed = (boosting, speedMod) => (boosting ? BOOST_SPEED : BASE_SPEED) * speedMod;

  // Turn a head {x, y, angle} toward targetAngle, then move it forward one step.
  function steer(h, targetAngle, r, turnMod, speed, dt) {
    const maxTurn = turnRate(r, turnMod) * dt;
    h.angle += clamp(angleDiff(h.angle, targetAngle), -maxTurn, maxTurn);
    h.x += Math.cos(h.angle) * speed * dt;
    h.y += Math.sin(h.angle) * speed * dt;
  }

  // Sample evenly spaced segments along the head's trail (oldest point first, head last) so the
  // body follows the exact path. Trims trail points the body no longer needs.
  function layoutBody(t, segs, r, mass) {
    const sp = r * 0.5;
    const n = Math.max(6, Math.round(bodyLength(mass) / sp));
    const last = t.length - 1;
    if (!segs[0]) segs[0] = { x: 0, y: 0 };
    segs[0].x = t[last].x;
    segs[0].y = t[last].y;

    let k = 1, dist = 0, next = sp, i = last;
    for (; i > 0 && k < n; i--) {
      const a = t[i], b = t[i - 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      while (k < n && next <= dist + d) {
        const f = (next - dist) / d;
        const s = segs[k] || (segs[k] = { x: 0, y: 0 });
        s.x = a.x + dx * f;
        s.y = a.y + dy * f;
        k++;
        next += sp;
      }
      dist += d;
    }
    // Trail ran out (snake just grew): bunch remaining segments at the tail end.
    while (k < n) {
      const s = segs[k] || (segs[k] = { x: 0, y: 0 });
      s.x = t[0].x;
      s.y = t[0].y;
      k++;
    }
    segs.length = n;
    if (i > 2) t.splice(0, i - 2);
    return n;
  }

  // ---------- Spatial grid ----------
  class Grid {
    constructor(cell, radius) {
      this.cell = cell;
      this.off = radius;
      this.n = Math.ceil((radius * 2) / cell);
      this.cells = Array.from({ length: this.n * this.n }, () => []);
      this.used = []; // cells holding entries, so clear() skips the empty ones
    }
    clear() {
      for (const c of this.used) c.length = 0;
      this.used.length = 0;
    }
    add(x, y, a) {
      const c = this.cellAt(x, y);
      if (!c.length) this.used.push(c);
      c.push(a);
    }
    add2(x, y, a, b) {
      const c = this.cellAt(x, y);
      if (!c.length) this.used.push(c);
      c.push(a, b);
    }
    ci(v) {
      return clamp(Math.floor((v + this.off) / this.cell), 0, this.n - 1);
    }
    cellAt(x, y) {
      return this.cells[this.ci(y) * this.n + this.ci(x)];
    }
    // Calls fn(cellArray) for each cell overlapping the square around (x, y); fn returning false stops.
    forEach(x, y, r, fn) {
      const x0 = this.ci(x - r), x1 = this.ci(x + r), y0 = this.ci(y - r), y1 = this.ci(y + r);
      for (let gy = y0; gy <= y1; gy++) {
        for (let gx = x0; gx <= x1; gx++) {
          if (fn(this.cells[gy * this.n + gx]) === false) return;
        }
      }
    }
  }

  const defaultMods = () => ({
    maxHealth: BASE_HEALTH,
    speed: 1,
    turn: 1,
    boostCost: 1,
    fireRate: 1, // multiplier on the shot interval (lower = faster)
    damage: 1,
    bulletSpeed: 1,
    magnet: 1,
    armor: 1, // multiplier on body circle health
    shield: 0,
    repair: 0, // fraction of circle health repaired per second
    lifesteal: 0, // head health restored per hit landed
    score: 1,
  });

  // ---------- World (authoritative simulation) ----------
  // `hooks` receive everything other machines need to hear about; see the noop defaults below.
  function createWorld(hooks) {
    const H = Object.assign({
      foodAdd() {}, foodEat() {}, bullet() {}, bulletHit() {}, fx() {}, pickupAdd() {}, pickupGone() {},
      spawn() {}, chop() {}, death() {}, toast() {}, pickup() {},
    }, hooks);

    let snakes = [];
    let foods = [];
    let bullets = [];
    let pickups = [];
    let naturalFood = 0;
    let time = 0;
    let botRespawnT = 0;
    let botRetireT = 0;
    let pickupSpawnT = 0;
    let foodGridT = 0;
    let nextSnakeId = 1, nextFoodId = 1, nextBulletId = 1, nextPickupId = 1;
    const segGrid = new Grid(CELL, WORLD_R + 400); // entries stored as pairs: snake, segIndex
    const foodGrid = new Grid(CELL, WORLD_R + 400);

    // ---------- Food ----------
    function addFood(x, y, value, color, natural, force) {
      if (!natural && !force && foods.length > FOOD_MAX) return;
      const f = {
        id: nextFoodId++, x, y, value, natural,
        c: color >= 0 ? color : (Math.random() * FOOD_COLORS.length) | 0,
        r: 3 + Math.sqrt(value) * 2.3,
        eaten: false,
      };
      foods.push(f);
      foodGrid.add(x, y, f);
      if (natural) naturalFood++;
      H.foodAdd(f);
    }
    function spawnNaturalFood() {
      const p = randomPoint(0.98);
      const roll = Math.random();
      addFood(p.x, p.y, roll < 0.05 ? 4 : roll < 0.3 ? 2 : 1, -1, true);
    }

    // ---------- Power-up pickups ----------
    function addPickup(x, y, type, natural) {
      const pk = { id: nextPickupId++, x, y, type, natural, born: time, taken: false };
      pickups.push(pk);
      H.pickupAdd(pk);
    }
    function spawnNaturalPickup() {
      const p = randomPoint(0.95);
      addPickup(p.x, p.y, rollPowerup(), true);
    }

    function applyPowerup(s, type) {
      const def = POWERUPS[type];
      let msg = def.desc;
      if (def.weapon) {
        if (s.weapon === def.weapon) {
          s.mass += 10;
          msg = 'Already equipped: +10 length';
        } else {
          s.weapon = def.weapon;
        }
      } else if (def.max && (s.stacks[type] || 0) >= def.max) {
        s.mass += 10;
        msg = 'Maxed out: +10 length';
      } else {
        def.apply(s);
        if (!def.consumable) {
          s.stacks[type] = (s.stacks[type] || 0) + 1;
          s.upgrades.push(type);
        }
      }
      const h = s.segs[0];
      H.fx(['p', Math.round(h.x), Math.round(h.y), type]);
      if (s.human) H.pickup(s, type, msg);
    }

    // Drop the snake's held upgrades and non-default weapon among its remains.
    function dropPowerups(s) {
      const items = s.upgrades.slice();
      if (s.weapon !== 'blaster') items.push('w_' + s.weapon);
      shuffle(items);
      for (let k = 0; k < Math.min(items.length, MAX_DROPS); k++) {
        const p = s.segs[(Math.random() * s.segs.length) | 0];
        addPickup(p.x + rand(-20, 20), p.y + rand(-20, 20), items[k], false);
      }
    }

    // Anything inside magnet reach is grabbed (clients animate the pull).
    function collectPickups(s) {
      const h = s.segs[0], r = s.r;
      const reach = (r * 1.5 + 22) * s.mods.magnet + PICKUP_R;
      for (const pk of pickups) {
        if (pk.taken) continue;
        const dx = h.x - pk.x, dy = h.y - pk.y;
        if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
        if (dx * dx + dy * dy < reach * reach) {
          pk.taken = true;
          applyPowerup(s, pk.type);
        }
      }
    }

    // ---------- Snake ----------
    const segHp = (s) => segMaxHp(s.mass) * s.mods.armor;
    const addScore = (s, pts) => { s.stats.score += pts * s.mods.score; };

    function bulletRange(s) {
      const w = WEAPONS[s.weapon];
      return (BULLET_SPEED * w.speed * s.mods.bulletSpeed + BASE_SPEED) * BULLET_LIFE * w.life;
    }

    class Snake {
      constructor({ name, skin, mass, x, y, angle = rand(0, TAU), pid = null }) {
        this.id = nextSnakeId++;
        this.name = name;
        this.skin = skin; // index into SKINS
        this.pid = pid; // session id of the human driving it; null for bots
        this.human = !!pid;
        this.mass = mass;
        this.peakMass = mass;
        this.x = x;
        this.y = y;
        this.angle = angle;
        this.targetAngle = angle;
        this.wantBoost = false;
        this.boosting = false;
        this.alive = true;
        this.dropAcc = 0;
        this.kills = 0;
        this.born = time;
        this.mods = defaultMods();
        this.effects = { ghost: 0, frenzy: 0 }; // seconds remaining
        this.weapon = 'blaster';
        this.stacks = {}; // power-up id -> times collected
        this.upgrades = []; // permanent power-ups held, dropped on death
        this.stats = { score: 0, dots: 0, hits: 0 };
        this.health = this.mods.maxHealth;
        this.lastHit = -Infinity;
        this.wantFire = false;
        this.fireCd = 0;
        this.r = radius(mass);
        this.segs = [];
        // Remaining health of each body circle, parallel to segs; -1 = undamaged (always at the current max).
        // Damaged circles never regain health on their own, even as the max grows; only Medkit/Nanobots restore it.
        this.segLife = [];
        this.bodyHurt = false;
        this.trail = [];
        // AI
        this.thinkT = 0;
        this.aggro = Math.random();
        this.escapeDir = Math.random() < 0.5 ? -1 : 1;

        // Lay the initial body out in a straight line behind the head.
        const L = bodyLength(mass) + 20;
        for (let d = L; d > 0; d -= 6) {
          this.trail.push({ x: x - Math.cos(angle) * d, y: y - Math.sin(angle) * d });
        }
        this.trail.push({ x, y });
        this.updateBody();
      }

      update(dt) {
        const m = this.mods;
        this.r = radius(this.mass);
        this.boosting = this.wantBoost && this.mass > MIN_BOOST_MASS;
        steer(this, this.targetAngle, this.r, m.turn, moveSpeed(this.boosting, m.speed), dt);
        this.trail.push({ x: this.x, y: this.y });

        if (this.boosting) {
          const cost = BOOST_COST * m.boostCost * dt * (1 + this.mass / 800);
          this.mass -= cost;
          this.dropAcc += cost;
          if (this.dropAcc > 1.5) {
            const tail = this.segs[this.segs.length - 1];
            addFood(tail.x + rand(-4, 4), tail.y + rand(-4, 4), this.dropAcc * 0.8, colorIdx(SKINS[this.skin][0]), false);
            this.dropAcc = 0;
          }
        }
        if (this.mass > this.peakMass) this.peakMass = this.mass;
        this.updateBody();

        this.effects.ghost = Math.max(0, this.effects.ghost - dt);
        this.effects.frenzy = Math.max(0, this.effects.frenzy - dt);
        this.fireCd -= dt;
        if (this.wantFire && this.fireCd <= 0) this.shoot();
        if (time - this.lastHit > REGEN_DELAY) this.health = Math.min(m.maxHealth, this.health + REGEN_RATE * dt);
        if (m.repair > 0 && this.bodyHurt) this.repairBody(m.repair * dt);
        addScore(this, this.mass * SCORE_PER_LENGTH_SEC * dt);
      }

      // Nanobots: heal every damaged circle by `frac` of its max health.
      repairBody(frac) {
        const max = segHp(this), heal = max * frac, life = this.segLife;
        let hurt = false;
        for (let i = 0; i < life.length; i++) {
          if (life[i] < 0) continue;
          life[i] += heal;
          if (life[i] >= max) life[i] = -1;
          else hurt = true;
        }
        this.bodyHurt = hurt;
      }

      // Fire the current weapon from the center of the head along the current heading.
      shoot() {
        const w = WEAPONS[this.weapon], m = this.mods;
        const frenzy = this.effects.frenzy > 0;
        this.fireCd = fireInterval(this.mass) * w.interval * m.fireRate * (frenzy ? 0.33 : 1);
        if (this.mass >= FREE_FIRE_MASS && !frenzy) this.mass -= this.mass * SHOT_COST;
        const speed = BULLET_SPEED * w.speed * m.bulletSpeed + moveSpeed(this.boosting, m.speed);
        const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
        for (let k = 0; k < w.pellets; k++) {
          let ang = this.angle, ox = 0, oy = 0;
          if (w.spread) ang += -w.spread + (2 * w.spread * k) / (w.pellets - 1) + rand(-0.04, 0.04);
          if (w.jitter) ang += rand(-w.jitter, w.jitter);
          if (w.parallel) {
            const off = (k === 0 ? -1 : 1) * this.r * 0.55;
            ox = -sa * off;
            oy = ca * off;
          }
          const b = {
            id: nextBulletId++,
            x: this.x + ox,
            y: this.y + oy,
            vx: Math.cos(ang) * speed,
            vy: Math.sin(ang) * speed,
            life: BULLET_LIFE * w.life,
            owner: this,
            weapon: this.weapon,
            damage: w.damage * m.damage,
            pierce: w.pierce || 0,
            explode: w.explode || 0,
            homing: w.homing || 0,
            size: w.size,
            hitSet: null,
            target: null,
            retarget: 0,
            dead: false,
          };
          bullets.push(b);
          H.bullet(b);
        }
      }

      updateBody() {
        const n = layoutBody(this.trail, this.segs, this.r, this.mass);
        const life = this.segLife;
        while (life.length < n) life.push(-1);
        life.length = n;
      }
    }

    // Scatter `total` mass as orbs along segments [from, to).
    function dropOrbs(s, from, to, total) {
      const len = to - from;
      const count = clamp(Math.round(total / 2), 1, Math.max(1, Math.min(len, 160)));
      const step = len / count;
      const value = total / count;
      const skin = SKINS[s.skin];
      for (let k = 0; k < count; k++) {
        const idx = from + Math.floor(k * step);
        const p = s.segs[idx];
        const color = colorIdx(skin[Math.floor(idx / 3) % skin.length]);
        addFood(p.x + rand(-s.r, s.r) * 0.6, p.y + rand(-s.r, s.r) * 0.6, value, color, false, true);
      }
    }

    // cause: 'shot' | 'chomp' | 'edge' | 'left' | 'retired'
    function killSnake(s, killer, cause) {
      if (!s.alive) return;
      s.alive = false;
      dropOrbs(s, 0, s.segs.length, s.mass * 0.75);
      dropPowerups(s);
      if (killer) {
        killer.kills++;
        addScore(killer, SCORE_KILL);
        if (killer.human && killer.alive) H.toast(killer, cause === 'shot' ? `You shot down ${s.name}!` : `You chomped ${s.name}!`);
      }
      H.death(s, killer, cause);
    }

    function hitFx(s, i, x, y, ang, spread, scale) {
      H.fx(['h', s.id, i, Math.round(x), Math.round(y), Math.round(ang * 100) / 100, spread, scale]);
    }

    // Sever everything from segment i back; the severed part becomes orbs.
    function chopSnake(s, i, shooter) {
      const segs = s.segs;
      const newMass = clamp(Math.pow((i * s.r * 0.5) / 35, 1 / 0.6), MIN_MASS, s.mass);
      const lost = s.mass - newMass;
      if (lost < 0.5) return;
      hitFx(s, i, segs[i].x, segs[i].y, 0, Math.PI, 3);
      dropOrbs(s, i, segs.length, lost * 0.75);
      s.mass = newMass;
      segs.length = i;
      s.segLife.length = i;
      s.trail = segs.map((p) => ({ x: p.x, y: p.y })).reverse();
      H.chop(s);
      if (shooter.human && shooter.alive && lost >= 15) H.toast(shooter, `You sliced ${s.name}!`);
    }

    // Shield soaks damage first; returns the damage that gets through.
    function absorb(s, amount) {
      if (s.mods.shield <= 0) return amount;
      const soaked = Math.min(s.mods.shield, amount);
      s.mods.shield -= soaked;
      return amount - soaked;
    }

    function registerHit(shooter) {
      shooter.stats.hits++;
      addScore(shooter, SCORE_HIT);
      if (shooter.mods.lifesteal > 0 && shooter.alive) {
        shooter.health = Math.min(shooter.mods.maxHealth, shooter.health + shooter.mods.lifesteal);
      }
    }

    function damageSnake(s, shooter, amount) {
      amount = absorb(s, amount);
      if (amount <= 0) return;
      s.health -= amount;
      s.lastHit = time;
      if (s.health <= 0) {
        const h = s.segs[0];
        hitFx(s, 0, h.x, h.y, 0, Math.PI, 4);
        killSnake(s, shooter, 'shot');
      }
    }

    // Apply damage to body circles, given as a flat list of [index, amount, ...]; slice at the first circle that breaks.
    function woundSegments(s, wounds, shooter) {
      const max = segHp(s), life = s.segLife;
      s.bodyHurt = true;
      let cut = -1;
      for (let k = 0; k < wounds.length; k += 2) {
        const j = wounds[k];
        if (j <= HEAD_SEGS || j >= life.length) continue;
        life[j] = (life[j] < 0 ? max : Math.min(life[j], max)) - wounds[k + 1];
        if (life[j] <= 0 && (cut < 0 || j < cut)) cut = j;
      }
      if (cut >= 0) chopSnake(s, cut, shooter);
    }

    // Damage the circle hit plus splash to its neighbours.
    function damageBody(s, i, shooter, amount) {
      const through = absorb(s, amount);
      if (through <= 0) return;
      const wounds = [], reach = BODY_SPLASH.length;
      for (let k = -reach; k <= reach; k++) wounds.push(i + k, through * (k === 0 ? 1 : BODY_SPLASH[Math.abs(k) - 1]));
      woundSegments(s, wounds, shooter);
    }

    // Rocket blast: damages every circle of every other snake within the radius.
    function explode(b) {
      const R = b.explode;
      H.fx(['x', Math.round(b.x), Math.round(b.y), R]);
      const hit = new Map();
      segGrid.forEach(b.x, b.y, R + MAX_SEG_R, (cell) => {
        for (let j = 0; j < cell.length; j += 2) {
          const o = cell[j];
          if (o === b.owner || !o.alive || o.effects.ghost > 0) continue;
          const i = cell[j + 1], p = o.segs[i];
          if (!p) continue;
          const dx = p.x - b.x, dy = p.y - b.y, rr = R + o.r;
          if (dx * dx + dy * dy < rr * rr) {
            let list = hit.get(o);
            if (!list) hit.set(o, (list = []));
            list.push(i);
          }
        }
      });
      for (const [o, idxs] of hit) {
        if (!o.alive) continue;
        registerHit(b.owner);
        if (idxs.some((i) => i <= HEAD_SEGS)) damageSnake(o, b.owner, HEADSHOT_DAMAGE * b.damage);
        if (!o.alive) continue;
        const through = absorb(o, BODY_DAMAGE * b.damage);
        if (through <= 0) continue;
        const wounds = [];
        for (const i of idxs) wounds.push(i, through);
        woundSegments(o, wounds, b.owner);
      }
    }

    // Returns true when the bullet is used up.
    function bulletHit(b) {
      let hitS = null, hitI = Infinity;
      const br = BULLET_R * b.size;
      segGrid.forEach(b.x, b.y, MAX_SEG_R + br, (cell) => {
        for (let j = 0; j < cell.length; j += 2) {
          const o = cell[j];
          if (o === b.owner || !o.alive || o.effects.ghost > 0 || (b.hitSet && b.hitSet.includes(o))) continue;
          const i = cell[j + 1];
          const p = o.segs[i];
          if (!p) continue;
          const dx = p.x - b.x, dy = p.y - b.y, rr = o.r + br;
          if (dx * dx + dy * dy < rr * rr && (!hitS || (o === hitS && i < hitI))) {
            hitS = o;
            hitI = i;
          }
        }
      });
      if (!hitS) return false;
      if (b.explode) {
        explode(b);
        return true;
      }
      const head = hitI <= HEAD_SEGS;
      hitFx(hitS, hitI, b.x, b.y, Math.atan2(-b.vy, -b.vx), 1.2, head ? 1.4 : 1);
      registerHit(b.owner);
      if (head) damageSnake(hitS, b.owner, HEADSHOT_DAMAGE * b.damage);
      else damageBody(hitS, hitI, b.owner, BODY_DAMAGE * b.damage);
      if (b.pierce > 0) {
        b.pierce--;
        (b.hitSet || (b.hitSet = [])).push(hitS);
        return false;
      }
      return true;
    }

    // Seeker bullets turn toward the nearest enemy head in front of them.
    function steerBullet(b, dt) {
      const sp = Math.hypot(b.vx, b.vy);
      b.retarget -= dt;
      if (b.retarget <= 0) {
        b.retarget = 0.15;
        b.target = null;
        let best = 650 * 650;
        const cx = b.vx / sp, cy = b.vy / sp;
        for (const o of snakes) {
          if (o === b.owner || !o.alive || o.effects.ghost > 0) continue;
          const h = o.segs[0], dx = h.x - b.x, dy = h.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < best && dx * cx + dy * cy > 0) { best = d2; b.target = o; }
        }
      }
      const t = b.target;
      if (!t || !t.alive) return;
      const h = t.segs[0];
      const cur = Math.atan2(b.vy, b.vx);
      const a = cur + clamp(angleDiff(cur, Math.atan2(h.y - b.y, h.x - b.x)), -b.homing * dt, b.homing * dt);
      b.vx = Math.cos(a) * sp;
      b.vy = Math.sin(a) * sp;
    }

    function updateBullets(dt) {
      for (const b of bullets) {
        b.life -= dt;
        if (b.homing) steerBullet(b, dt);
        const steps = Math.max(2, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 12));
        const h = dt / steps;
        for (let k = 0; k < steps && !b.dead; k++) {
          b.x += b.vx * h;
          b.y += b.vy * h;
          if (b.x * b.x + b.y * b.y > WORLD_R * WORLD_R) b.dead = true;
          else if (bulletHit(b)) {
            b.dead = true;
            H.bulletHit(b);
          }
        }
        if (b.life <= 0 && !b.dead) {
          b.dead = true;
          if (b.explode) explode(b);
        }
      }
      bullets = bullets.filter((b) => !b.dead);
    }

    function rebuildSegGrid() {
      segGrid.clear();
      for (const s of snakes) {
        if (!s.alive) continue;
        const segs = s.segs;
        for (let i = 0; i < segs.length; i++) segGrid.add2(segs[i].x, segs[i].y, s, i);
      }
    }

    // Find a point with no snake body within clearR (or the most open point tried), at least
    // awayDist from every player's head, facing roughly toward the center.
    function findSpawn(awayDist, clearR) {
      const heads = snakes.filter((s) => s.human && s.alive).map((s) => s.segs[0]);
      let best = null, bestClear = -1;
      for (let tries = 0; tries < 40; tries++) {
        const p = randomPoint(0.8);
        if (heads.some((h) => Math.hypot(p.x - h.x, p.y - h.y) < awayDist)) continue;
        let nearest2 = Infinity;
        segGrid.forEach(p.x, p.y, clearR, (cell) => {
          for (let j = 0; j < cell.length; j += 2) {
            const o = cell[j], q = o.segs[cell[j + 1]];
            if (!o.alive || !q) continue;
            const dx = q.x - p.x, dy = q.y - p.y;
            nearest2 = Math.min(nearest2, dx * dx + dy * dy);
          }
        });
        if (nearest2 >= clearR * clearR) { best = p; break; }
        if (nearest2 > bestClear) { best = p; bestClear = nearest2; }
      }
      best = best || randomPoint(0.8);
      best.angle = Math.atan2(-best.y, -best.x) + rand(-1, 1);
      return best;
    }

    function addSnake(opts) {
      const s = new Snake(opts);
      snakes.push(s);
      H.spawn(s);
      return s;
    }

    function spawnBot() {
      const used = new Set(snakes.map((s) => s.name));
      const free = BOT_NAMES.filter((n) => !used.has(n));
      const p = findSpawn(SPAWN_AWAY_FROM_PLAYERS, SPAWN_CLEAR_BOT);
      return addSnake({
        name: pick(free.length ? free : BOT_NAMES),
        skin: (Math.random() * SKINS.length) | 0,
        mass: START_MASS,
        x: p.x,
        y: p.y,
        angle: p.angle,
      });
    }

    function spawnHuman(pid, name, skin) {
      const p = findSpawn(0, SPAWN_CLEAR_PLAYER);
      const s = addSnake({ name, skin, mass: START_MASS, x: p.x, y: p.y, angle: p.angle, pid });
      rebuildSegGrid();
      return s;
    }

    // Retire the smallest bot no player can see, else the smallest bot.
    function retireBot() {
      const heads = snakes.filter((s) => s.human && s.alive).map((s) => s.segs[0]);
      let best = null, bestHidden = false;
      for (const s of snakes) {
        if (s.human || !s.alive) continue;
        const h = s.segs[0];
        const hidden = !heads.some((p) => Math.hypot(p.x - h.x, p.y - h.y) < BOT_RETIRE_DIST);
        if (!best || (hidden && !bestHidden) || (hidden === bestHidden && s.mass < best.mass)) {
          best = s;
          bestHidden = hidden;
        }
      }
      if (best) killSnake(best, null, 'retired');
    }

    // ---------- Bot AI ----------
    const PROBE_OFFSETS = [-0.5, 0.5, -1.0, 1.0, -1.6, 1.6, -2.3, 2.3];
    const isTarget = (b, o) => o !== b && o.alive && o.effects.ghost <= 0 && time - o.born >= HUNT_GRACE;

    function probeDanger(b, ang, look) {
      const h = b.segs[0], r = b.r;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const edge = (WORLD_R - r - 20) ** 2;
      const rad = r + 24;
      let danger = 0;
      for (let k = 1; k <= 3; k++) {
        const t = k / 3;
        const px = h.x + ca * look * t, py = h.y + sa * look * t;
        if (px * px + py * py > edge) danger += 3 / t;
        if (b.effects.ghost > 0) continue;
        segGrid.forEach(px, py, rad + MAX_SEG_R, (cell) => {
          for (let j = 0; j < cell.length; j += 2) {
            const o = cell[j];
            if (o === b || !o.alive || o.effects.ghost > 0) continue;
            const p = o.segs[cell[j + 1]];
            if (!p) continue;
            const dx = p.x - px, dy = p.y - py, rr = rad + o.r;
            if (dx * dx + dy * dy < rr * rr) {
              danger += 1 / t;
              return false;
            }
          }
        });
      }
      return danger;
    }

    // Fire when another snake is in the line of fire; trigger-happiness scales with aggro, less when shots cost mass.
    function botWantsFire(b) {
      const paid = b.mass >= FREE_FIRE_MASS && b.effects.frenzy <= 0;
      const chance = (paid ? 0.12 : 0.35) * (0.4 + b.aggro);
      if (Math.random() > chance) return false;
      const h = b.segs[0];
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
      const range = bulletRange(b) * 0.8;
      for (const o of snakes) {
        if (!isTarget(b, o)) continue;
        const segs = o.segs;
        for (let i = 0; i < segs.length; i += 3) {
          const dx = segs[i].x - h.x, dy = segs[i].y - h.y;
          const t = dx * ca + dy * sa;
          if (t > 0 && t < range && Math.abs(dx * sa - dy * ca) < o.r) return true;
        }
      }
      return false;
    }

    function thinkBot(b, dt) {
      b.thinkT -= dt;
      if (b.thinkT > 0) return;
      b.thinkT = rand(0.07, 0.15);
      const h = b.segs[0], r = b.r;
      const look = 70 + r * 3.5;
      b.wantBoost = false;
      b.wantFire = botWantsFire(b);

      // 1. Avoid bodies and the border.
      const ahead = probeDanger(b, b.angle, look);
      if (ahead > 0) {
        let best = ahead, bestA = null;
        for (const off of PROBE_OFFSETS) {
          const a = b.angle + off;
          const d = probeDanger(b, a, look);
          if (d < best) { best = d; bestA = a; }
        }
        if (bestA === null) bestA = b.angle + 2.6 * b.escapeDir;
        else b.escapeDir = Math.sign(angleDiff(b.angle, bestA)) || 1;
        b.targetAngle = bestA;
        if (ahead >= 3 && b.mass > 30 && Math.random() < b.aggro * 0.5) b.wantBoost = true;
        b.thinkT = 0.04;
        return;
      }

      // 2. Drift back toward the middle when near the edge.
      if (Math.hypot(h.x, h.y) > WORLD_R - 400) {
        b.targetAngle = Math.atan2(-h.y, -h.x) + rand(-0.6, 0.6);
        return;
      }

      // 3. Grab nearby power-ups.
      let loot = null, lootD = 450;
      for (const pk of pickups) {
        if (pk.taken) continue;
        const d = Math.hypot(pk.x - h.x, pk.y - h.y);
        if (d < lootD) { lootD = d; loot = pk; }
      }
      if (loot && Math.random() < 0.85) {
        b.targetAngle = Math.atan2(loot.y - h.y, loot.x - h.x);
        b.wantBoost = lootD < 250 && b.mass > 40 && Math.random() < 0.3;
        return;
      }

      // 4. Fight any nearby snake (bots included): big aggressive bots cut them off, others shoot at their heads.
      if (Math.random() < b.aggro) {
        let prey = null, pd = Math.min(550, bulletRange(b) * 0.9);
        for (const o of snakes) {
          if (!isTarget(b, o)) continue;
          const oh = o.segs[0];
          const d = Math.hypot(oh.x - h.x, oh.y - h.y);
          if (d < pd) { pd = d; prey = o; }
        }
        if (prey) {
          const oh = prey.segs[0];
          const pc = Math.cos(prey.angle), ps = Math.sin(prey.angle);
          if (b.aggro > 0.6 && b.mass > 30 && prey.mass < b.mass * 1.3 && Math.random() < 0.5) {
            const lead = prey.r * 2 + 90 + pd * 0.3;
            b.targetAngle = Math.atan2(oh.y + ps * lead - h.y, oh.x + pc * lead - h.x);
            b.wantBoost = pd < 320 && b.mass > 45 && Math.random() < 0.7;
          } else {
            // Lead the target's head by bullet travel time.
            const w = WEAPONS[b.weapon];
            const bulletSpeed = BULLET_SPEED * w.speed * b.mods.bulletSpeed + BASE_SPEED;
            const lead = (pd / bulletSpeed) * moveSpeed(prey.boosting, prey.mods.speed);
            const aim = Math.atan2(oh.y + ps * lead - h.y, oh.x + pc * lead - h.x);
            b.targetAngle = aim;
            const paid = b.mass >= FREE_FIRE_MASS && b.effects.frenzy <= 0;
            if (Math.abs(angleDiff(b.angle, aim)) < 0.15 && (!paid || Math.random() < 0.4)) b.wantFire = true;
          }
          return;
        }
      }

      // 5. Go for the best food, preferring what's in front.
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
      let bestF = null, bestScore = 0;
      foodGrid.forEach(h.x, h.y, 360, (cell) => {
        for (let j = 0; j < cell.length; j++) {
          const f = cell[j];
          if (f.eaten) continue;
          const dx = f.x - h.x, dy = f.y - h.y;
          const d = Math.sqrt(dx * dx + dy * dy) + 1;
          if (d > 360) continue;
          const facing = (dx * ca + dy * sa) / d;
          const score = (f.value * (1.4 + facing)) / (d + 30);
          if (score > bestScore) { bestScore = score; bestF = f; }
        }
      });
      if (bestF) {
        b.targetAngle = Math.atan2(bestF.y - h.y, bestF.x - h.x);
        return;
      }

      // 6. Wander.
      b.targetAngle = b.angle + rand(-0.8, 0.8);
    }

    // ---------- Simulation ----------
    // Anything inside magnet reach is eaten (clients animate the pull).
    function eatFood(s) {
      const h = s.segs[0], r = s.r;
      const reach = (r * 1.5 + 22) * s.mods.magnet;
      foodGrid.forEach(h.x, h.y, reach + 10, (cell) => {
        for (let j = 0; j < cell.length; j++) {
          const f = cell[j];
          if (f.eaten) continue;
          const dx = h.x - f.x, dy = h.y - f.y, rr = reach + f.r;
          if (dx * dx + dy * dy < rr * rr) {
            f.eaten = true;
            s.mass += f.value;
            s.stats.dots++;
            addScore(s, SCORE_DOT);
            if (f.natural) naturalFood--;
            H.foodEat(f, s);
          }
        }
      });
    }

    function checkCollisions() {
      const deaths = [];
      for (const s of snakes) {
        if (!s.alive) continue;
        const h = s.segs[0], r = s.r;
        if (h.x * h.x + h.y * h.y > (WORLD_R - r * 0.3) ** 2) {
          deaths.push([s, null]);
          continue;
        }
        if (s.effects.ghost > 0) continue;
        let killer = null;
        segGrid.forEach(h.x, h.y, r + MAX_SEG_R, (cell) => {
          for (let j = 0; j < cell.length; j += 2) {
            const o = cell[j];
            if (o === s || o.effects.ghost > 0) continue;
            const p = o.segs[cell[j + 1]];
            if (!p) continue;
            const dx = p.x - h.x, dy = p.y - h.y, rr = (r + o.r) * 0.72;
            if (dx * dx + dy * dy < rr * rr) {
              killer = o;
              return false;
            }
          }
        });
        if (killer) deaths.push([s, killer]);
      }
      for (const [s, killer] of deaths) if (s.alive) killSnake(s, killer, killer ? 'chomp' : 'edge');
    }

    // botTarget: how many bots the world should hold right now.
    function step(dt, botTarget) {
      time += dt;

      for (const s of snakes) if (!s.human && s.alive) thinkBot(s, dt);
      for (const s of snakes) if (s.alive) s.update(dt);

      rebuildSegGrid();
      // Orbs never move here, so the food grid is kept up to date by addFood and only rebuilt
      // now and then to drop eaten entries.
      foodGridT -= dt;
      if (foodGridT <= 0) {
        foodGridT = 2;
        foodGrid.clear();
        for (const f of foods) if (!f.eaten) foodGrid.add(f.x, f.y, f);
      }

      for (const s of snakes) {
        if (!s.alive) continue;
        eatFood(s);
        collectPickups(s);
      }
      checkCollisions();
      updateBullets(dt);

      let w = 0;
      for (let i = 0; i < foods.length; i++) if (!foods[i].eaten) foods[w++] = foods[i];
      foods.length = w;
      pickups = pickups.filter((pk) => {
        const keep = !pk.taken && (pk.natural || time - pk.born < PICKUP_DROP_LIFE);
        if (!keep) H.pickupGone(pk);
        return keep;
      });
      snakes = snakes.filter((s) => s.alive);

      for (let i = 0; i < 40 && naturalFood < FOOD_TARGET; i++) spawnNaturalFood();

      pickupSpawnT -= dt;
      if (pickupSpawnT <= 0) {
        pickupSpawnT = 0.5;
        if (pickups.filter((pk) => pk.natural).length < PICKUP_TARGET) spawnNaturalPickup();
      }

      const bots = snakes.filter((s) => !s.human).length;
      botRespawnT -= dt;
      if (botRespawnT <= 0 && bots < botTarget) {
        spawnBot();
        botRespawnT = 0.4;
      }
      botRetireT -= dt;
      if (botRetireT <= 0 && bots > botTarget) {
        retireBot();
        botRetireT = 1;
      }
    }

    function init(botTarget) {
      for (let i = 0; i < FOOD_TARGET; i++) spawnNaturalFood();
      for (let i = 0; i < PICKUP_TARGET; i++) spawnNaturalPickup();
      for (let i = 0; i < botTarget; i++) {
        spawnBot();
        rebuildSegGrid();
      }
    }

    return {
      get time() { return time; },
      get snakes() { return snakes; },
      get foods() { return foods; },
      get pickups() { return pickups; },
      segHp,
      init,
      step,
      spawnHuman,
      killSnake,
    };
  }

  return {
    WORLD_R, BOT_COUNT, BOTS_PER_HUMAN, MAX_SEG_R, BASE_SPEED, BOOST_SPEED, MIN_BOOST_MASS, START_MASS,
    BULLET_SPEED, BULLET_LIFE, BULLET_R, PICKUP_R, PICKUP_DROP_LIFE, MAX_SHIELD, HEAD_SEGS, TAU,
    SKINS, FOOD_COLORS, PALETTE, WEAPON_IDS,
    clamp, angleDiff, radius, bodyLength, turnRate, moveSpeed, steer, layoutBody, segMaxHp,
    createWorld,
  };
})();
