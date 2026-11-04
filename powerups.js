'use strict';

// Power-up, weapon and icon definitions. Loaded before game.js, which reads window.ChompPowerups.
window.ChompPowerups = (() => {
  const TAU = Math.PI * 2;
  const MAX_SHIELD = 200;

  // `weight` is the relative chance a natural spawn rolls a power-up of this rarity.
  const RARITY = {
    common: { weight: 10, color: '#ced4da', label: 'Common' },
    uncommon: { weight: 5, color: '#51cf66', label: 'Uncommon' },
    rare: { weight: 2.2, color: '#4dabf7', label: 'Rare' },
    epic: { weight: 0.8, color: '#cc5de8', label: 'Epic' },
  };

  // Multipliers on the base gun: shot interval, damage, bullet speed, bullet lifetime (range), visual size.
  const WEAPONS = {
    blaster: { name: 'Blaster', interval: 1, damage: 1, speed: 1, life: 1, pellets: 1, size: 1 },
    shotgun: { name: 'Shotgun', interval: 2.2, damage: 0.6, speed: 0.9, life: 0.45, pellets: 5, spread: 0.3, size: 0.8 },
    twin: { name: 'Twin Guns', interval: 1.1, damage: 0.75, speed: 1, life: 1, pellets: 2, parallel: true, size: 0.9 },
    smg: { name: 'SMG', interval: 0.4, damage: 0.4, speed: 1.1, life: 0.8, pellets: 1, jitter: 0.09, size: 0.7 },
    rail: { name: 'Railgun', interval: 3.2, damage: 3, speed: 2.2, life: 0.7, pellets: 1, pierce: 3, size: 1.2, tail: 0.035 },
    rocket: { name: 'Rocket Launcher', interval: 3.5, damage: 1.5, speed: 0.55, life: 1.6, pellets: 1, explode: 110, size: 1.8 },
    seeker: { name: 'Seeker', interval: 1.4, damage: 0.9, speed: 0.7, life: 1.8, pellets: 1, homing: 5, size: 1.1 },
  };

  // `max`: stack cap for permanent upgrades. `consumable`: used up on pickup, not kept or dropped on death.
  const POWERUPS = {
    medkit: { name: 'Medkit', desc: 'Full heal & body repair', rarity: 'common', accent: '#ff6b6b', consumable: true,
      apply: (s) => { s.health = s.mods.maxHealth; s.segLife.fill(-1); s.bodyHurt = false; } },
    feast: { name: 'Feast', desc: '+25 length', rarity: 'common', accent: '#ffd43b', consumable: true,
      apply: (s) => { s.mass += 25; } },
    magnet: { name: 'Magnet', desc: '+50% pickup reach', rarity: 'common', accent: '#ff4d4d', max: 4,
      apply: (s) => { s.mods.magnet += 0.5; } },
    turbo: { name: 'Turbo', desc: '+10% speed', rarity: 'common', accent: '#3bc9db', max: 5,
      apply: (s) => { s.mods.speed += 0.1; } },
    shield: { name: 'Shield', desc: '+50 shield, absorbs damage', rarity: 'uncommon', accent: '#4dabf7', consumable: true,
      apply: (s) => { s.mods.shield = Math.min(MAX_SHIELD, s.mods.shield + 50); } },
    trigger: { name: 'Hair Trigger', desc: '+15% fire rate', rarity: 'uncommon', accent: '#ffd43b', max: 5,
      apply: (s) => { s.mods.fireRate *= 0.87; } },
    vitality: { name: 'Vitality', desc: '+25 max head health', rarity: 'uncommon', accent: '#ff4d6d', max: 4,
      apply: (s) => { s.mods.maxHealth += 25; s.health += 25; } },
    plating: { name: 'Plating', desc: 'Body 30% tougher', rarity: 'uncommon', accent: '#adb5bd', max: 5,
      apply: (s) => { s.mods.armor += 0.3; } },
    agility: { name: 'Agility', desc: 'Turn 20% sharper', rarity: 'uncommon', accent: '#69db7c', max: 3,
      apply: (s) => { s.mods.turn += 0.2; } },
    nitro: { name: 'Nitro', desc: 'Boost costs 30% less', rarity: 'uncommon', accent: '#ff922b', max: 3,
      apply: (s) => { s.mods.boostCost *= 0.7; } },
    hollow: { name: 'Hollow Points', desc: '+25% damage', rarity: 'rare', accent: '#fcc419', max: 5,
      apply: (s) => { s.mods.damage += 0.25; } },
    barrel: { name: 'Long Barrel', desc: '+30% bullet speed & range', rarity: 'rare', accent: '#ff6b6b', max: 3,
      apply: (s) => { s.mods.bulletSpeed += 0.3; } },
    nanobots: { name: 'Nanobots', desc: 'Body slowly repairs itself', rarity: 'rare', accent: '#38d9a9', max: 3,
      apply: (s) => { s.mods.repair += 0.05; } },
    vampire: { name: 'Vampire', desc: 'Your hits heal your head', rarity: 'rare', accent: '#e03131', max: 3,
      apply: (s) => { s.mods.lifesteal += 3; } },
    golden: { name: 'Golden Scales', desc: '+25% score', rarity: 'rare', accent: '#fcc419', max: 4,
      apply: (s) => { s.mods.score += 0.25; } },
    ghost: { name: 'Ghost', desc: '7s: pass through snakes & bullets', rarity: 'epic', accent: '#f8f9fa', consumable: true,
      apply: (s) => { s.effects.ghost = 7; } },
    frenzy: { name: 'Frenzy', desc: '8s: triple fire rate, free shots', rarity: 'epic', accent: '#ff6b6b', consumable: true,
      apply: (s) => { s.effects.frenzy = 8; } },
    w_blaster: { weapon: 'blaster', desc: 'Standard gun', rarity: 'common', accent: '#dee2e6', noSpawn: true },
    w_shotgun: { weapon: 'shotgun', desc: '5-pellet spread, short range', rarity: 'uncommon', accent: '#ffa94d' },
    w_twin: { weapon: 'twin', desc: 'Two parallel guns', rarity: 'uncommon', accent: '#74c0fc' },
    w_smg: { weapon: 'smg', desc: 'Rapid fire, low damage', rarity: 'uncommon', accent: '#b197fc' },
    w_rail: { weapon: 'rail', desc: 'Huge damage, pierces 3 snakes', rarity: 'rare', accent: '#66d9e8' },
    w_rocket: { weapon: 'rocket', desc: 'Explodes, hurting everything nearby', rarity: 'rare', accent: '#ff8787' },
    w_seeker: { weapon: 'seeker', desc: 'Homing shots', rarity: 'epic', accent: '#da77f2' },
  };
  for (const def of Object.values(POWERUPS)) if (def.weapon) def.name = WEAPONS[def.weapon].name;

  const SPAWNABLE = Object.keys(POWERUPS).filter((id) => !POWERUPS[id].noSpawn);
  const TOTAL_WEIGHT = SPAWNABLE.reduce((a, id) => a + RARITY[POWERUPS[id].rarity].weight, 0);
  function rollPowerup() {
    let r = Math.random() * TOTAL_WEIGHT;
    for (const id of SPAWNABLE) {
      r -= RARITY[POWERUPS[id].rarity].weight;
      if (r <= 0) return id;
    }
    return SPAWNABLE[0];
  }

  // ---------- Icons ----------
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const circle = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, TAU); };
  const fill = (g, color) => { g.fillStyle = color; g.fill(); };
  const stroke = (g, color, w) => { g.strokeStyle = color; g.lineWidth = w; g.stroke(); };
  function poly(g, pts, close = true) {
    g.beginPath();
    for (const [x, y] of pts) g.lineTo(x, y);
    if (close) g.closePath();
  }
  function rrect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function star(g, n, r1, r2) {
    const pts = [];
    for (let k = 0; k < n * 2; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / n, r = k % 2 ? r2 : r1;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    poly(g, pts);
  }
  function hexagon(g, x, y, r) {
    const pts = [];
    for (let k = 0; k < 6; k++) pts.push([x + Math.cos(k * Math.PI / 3 + Math.PI / 6) * r, y + Math.sin(k * Math.PI / 3 + Math.PI / 6) * r]);
    poly(g, pts);
  }
  function arrowHead(g, x, y, ang, size, color) {
    poly(g, [
      [x + Math.cos(ang) * size, y + Math.sin(ang) * size],
      [x + Math.cos(ang + 2.4) * size, y + Math.sin(ang + 2.4) * size],
      [x + Math.cos(ang - 2.4) * size, y + Math.sin(ang - 2.4) * size],
    ]);
    fill(g, color);
  }
  // A bullet pointing along `ang`: body colour with a contrasting tip.
  function bullet(g, x, y, ang, len, w, tip, body) {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    const front = len / 2 - w / 2;
    g.beginPath();
    g.moveTo(-len / 2, -w / 2);
    g.lineTo(front, -w / 2);
    g.arc(front, 0, w / 2, -Math.PI / 2, Math.PI / 2);
    g.lineTo(-len / 2, w / 2);
    g.closePath();
    fill(g, body);
    g.beginPath();
    g.moveTo(front - w * 0.7, -w / 2);
    g.lineTo(front, -w / 2);
    g.arc(front, 0, w / 2, -Math.PI / 2, Math.PI / 2);
    g.lineTo(front - w * 0.7, w / 2);
    g.closePath();
    fill(g, tip);
    g.restore();
  }
  function flame(g, s, dy, color) {
    g.beginPath();
    g.moveTo(0, -18 * s + dy);
    g.bezierCurveTo(8 * s, -8 * s + dy, 14 * s, dy, 10 * s, 10 * s + dy);
    g.bezierCurveTo(7 * s, 17 * s + dy, -7 * s, 17 * s + dy, -10 * s, 10 * s + dy);
    g.bezierCurveTo(-14 * s, dy, -6 * s, -6 * s + dy, 0, -18 * s + dy);
    fill(g, color);
  }
  function shieldPath(g, s) {
    g.beginPath();
    g.moveTo(0, -17 * s);
    g.bezierCurveTo(6 * s, -13 * s, 12 * s, -13 * s, 14 * s, -12 * s);
    g.lineTo(14 * s, 0);
    g.quadraticCurveTo(13 * s, 12 * s, 0, 18 * s);
    g.quadraticCurveTo(-13 * s, 12 * s, -14 * s, 0);
    g.lineTo(-14 * s, -12 * s);
    g.bezierCurveTo(-12 * s, -13 * s, -6 * s, -13 * s, 0, -17 * s);
  }

  // Each glyph draws centred on (0, 0) within a radius of about 20.
  const GLYPHS = {
    medkit(g) {
      rrect(g, -14, -14, 28, 28, 6); fill(g, '#f8f9fa');
      rrect(g, -3.5, -10, 7, 20, 1.5); fill(g, '#e03131');
      rrect(g, -10, -3.5, 20, 7, 1.5); fill(g, '#e03131');
    },
    feast(g) {
      for (const [x, y, c] of [[-7, 5, '#ffd43b'], [7, 5, '#ff6b6b'], [0, -7, '#69db7c']]) {
        circle(g, x, y, 7.5); fill(g, c);
        circle(g, x - 2.5, y - 2.5, 2); fill(g, 'rgba(255,255,255,0.85)');
      }
    },
    magnet(g) {
      g.lineCap = 'butt';
      g.beginPath();
      g.moveTo(-11, -12);
      g.lineTo(-11, 2);
      g.arc(0, 2, 11, Math.PI, 0, true);
      g.lineTo(11, -12);
      stroke(g, '#ff4d4d', 8);
      rrect(g, -15, -18, 8, 6, 1); fill(g, '#f1f3f5');
      rrect(g, 7, -18, 8, 6, 1); fill(g, '#f1f3f5');
    },
    turbo(g, c) {
      poly(g, [[-13, -11], [-3, 0], [-13, 11]], false); stroke(g, c, 5.5);
      poly(g, [[0, -11], [10, 0], [0, 11]], false); stroke(g, c, 5.5);
    },
    shield(g, c) {
      shieldPath(g, 1); fill(g, c);
      shieldPath(g, 0.6); stroke(g, 'rgba(255,255,255,0.75)', 2);
    },
    trigger(g, c) {
      poly(g, [[4, -18], [-9, 3], [-1, 3], [-5, 18], [10, -4], [2, -4], [7, -18]]); fill(g, c);
    },
    vitality(g, c) {
      g.beginPath();
      g.moveTo(0, 15);
      g.bezierCurveTo(-20, 2, -12, -17, 0, -7);
      g.bezierCurveTo(12, -17, 20, 2, 0, 15);
      fill(g, c);
      rrect(g, -1.6, -5, 3.2, 10, 1); fill(g, '#fff');
      rrect(g, -5, -1.6, 10, 3.2, 1); fill(g, '#fff');
    },
    plating(g) {
      for (const [x, y] of [[-7, -5], [7, -5], [0, 7]]) {
        hexagon(g, x, y, 8.5); fill(g, '#ced4da'); stroke(g, '#495057', 2);
      }
    },
    agility(g, c) {
      const a0 = 0.75 * Math.PI, a1 = 2.15 * Math.PI;
      g.beginPath(); g.arc(0, 1, 11, a0, a1); stroke(g, c, 5);
      arrowHead(g, Math.cos(a1) * 11, 1 + Math.sin(a1) * 11, a1 + Math.PI / 2, 8, c);
    },
    nitro(g, c) {
      flame(g, 1, 0, c);
      flame(g, 0.55, 5, '#ffd43b');
    },
    hollow(g) {
      bullet(g, 0, 0, -Math.PI / 2, 36, 13, '#e8590c', '#fcc419');
    },
    barrel(g, c) {
      circle(g, 0, 0, 12); stroke(g, c, 3.5);
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        poly(g, [[Math.cos(a) * 6, Math.sin(a) * 6], [Math.cos(a) * 19, Math.sin(a) * 19]], false);
        stroke(g, c, 3.5);
      }
      circle(g, 0, 0, 2.5); fill(g, c);
    },
    nanobots(g, c) {
      for (let k = 0; k < 8; k++) {
        g.save();
        g.rotate((k * TAU) / 8);
        rrect(g, -3.5, -18, 7, 8, 1.5); fill(g, c);
        g.restore();
      }
      circle(g, 0, 0, 12.5); fill(g, c);
      circle(g, 0, 0, 5); fill(g, '#0d1218');
    },
    vampire(g, c) {
      g.beginPath();
      g.moveTo(0, -18);
      g.bezierCurveTo(5, -9, 13, -2, 13, 5);
      g.arc(0, 5, 13, 0, Math.PI);
      g.bezierCurveTo(-13, -2, -5, -9, 0, -18);
      fill(g, c);
      g.beginPath(); g.ellipse(-5, 5, 2.5, 4, 0.3, 0, TAU); fill(g, 'rgba(255,255,255,0.6)');
    },
    golden(g, c) {
      poly(g, [[-16, 10], [-17, -9], [-8, -1], [0, -15], [8, -1], [17, -9], [16, 10]]); fill(g, c);
      rrect(g, -16, 9, 32, 5, 1.5); fill(g, '#f59f00');
      circle(g, 0, 3, 2.5); fill(g, '#e03131');
      circle(g, -8, 4, 2); fill(g, '#4dabf7');
      circle(g, 8, 4, 2); fill(g, '#69db7c');
    },
    ghost(g, c) {
      g.beginPath();
      g.moveTo(-12, 15);
      g.lineTo(-12, -3);
      g.arc(0, -3, 12, Math.PI, TAU);
      g.lineTo(12, 15);
      for (const [x, y] of [[8, 11], [4, 15], [0, 11], [-4, 15], [-8, 11]]) g.lineTo(x, y);
      g.closePath();
      fill(g, c);
      circle(g, -4.5, -3, 2.6); fill(g, '#1c1f24');
      circle(g, 4.5, -3, 2.6); fill(g, '#1c1f24');
    },
    frenzy(g, c) {
      star(g, 12, 19, 10); fill(g, c);
      star(g, 12, 10, 5); fill(g, '#ffd43b');
    },
    w_blaster(g, c) {
      bullet(g, 0, 0, -Math.PI / 4, 34, 11, '#868e96', c);
    },
    w_shotgun(g, c) {
      const ox = -13, oy = 10;
      for (const a of [-1.0, -0.6, -0.2]) {
        const ex = ox + Math.cos(a) * 26, ey = oy + Math.sin(a) * 26;
        poly(g, [[ox, oy], [ex, ey]], false); stroke(g, rgba(c, 0.55), 2.5);
        circle(g, ex, ey, 3.8); fill(g, c);
      }
    },
    w_twin(g, c) {
      bullet(g, 0, -6, 0, 30, 8, '#e8590c', c);
      bullet(g, 0, 7, 0, 30, 8, '#e8590c', c);
    },
    w_smg(g, c) {
      for (const [x, y] of [[-10, 9], [0, 0], [10, -9]]) bullet(g, x, y, -0.73, 15, 6.5, '#e8590c', c);
    },
    w_rail(g, c) {
      poly(g, [[-18, 0], [18, 0]], false); stroke(g, rgba(c, 0.35), 9);
      stroke(g, c, 4);
      for (const x of [-8, 0, 8]) {
        g.beginPath(); g.ellipse(x, 0, 3, 9, 0, 0, TAU); stroke(g, '#e3fafc', 2);
      }
    },
    w_rocket(g, c) {
      g.save();
      g.rotate(Math.PI / 4);
      poly(g, [[-3, 10], [0, 19], [3, 10]]); fill(g, '#ffd43b');
      poly(g, [[-5, 3], [-10, 12], [-5, 10]]); fill(g, '#c92a2a');
      poly(g, [[5, 3], [10, 12], [5, 10]]); fill(g, '#c92a2a');
      rrect(g, -5, -10, 10, 21, 3); fill(g, c);
      poly(g, [[-5, -9], [0, -19], [5, -9]]); fill(g, '#f1f3f5');
      circle(g, 0, -2, 2.5); fill(g, '#74c0fc');
      g.restore();
    },
    w_seeker(g, c) {
      circle(g, 9, -9, 6.5); stroke(g, c, 2.5);
      circle(g, 9, -9, 2); fill(g, c);
      g.setLineDash([3, 3.5]);
      g.beginPath(); g.moveTo(-15, 13); g.quadraticCurveTo(-14, -6, 0, -5); stroke(g, c, 2.5);
      g.setLineDash([]);
      arrowHead(g, 1, -5, -0.15, 6, c);
    },
  };

  const iconCache = new Map();
  const urlCache = new Map();

  // 128px badge: dark disc tinted by the power-up's accent, ringed in its rarity colour.
  function iconSprite(id) {
    let c = iconCache.get(id);
    if (c) return c;
    const def = POWERUPS[id];
    c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.scale(2, 2);
    g.translate(32, 32);
    circle(g, 0, 0, 29);
    fill(g, '#0d1218');
    const grad = g.createRadialGradient(0, -6, 2, 0, 0, 29);
    grad.addColorStop(0, rgba(def.accent, 0.5));
    grad.addColorStop(1, rgba(def.accent, 0.06));
    fill(g, grad);
    stroke(g, RARITY[def.rarity].color, 3.5);
    g.lineCap = g.lineJoin = 'round';
    g.shadowColor = 'rgba(0,0,0,0.7)';
    g.shadowBlur = 3;
    g.shadowOffsetY = 1;
    g.save();
    GLYPHS[id](g, def.accent);
    g.restore();
    iconCache.set(id, c);
    return c;
  }

  function iconURL(id) {
    let u = urlCache.get(id);
    if (!u) urlCache.set(id, (u = iconSprite(id).toDataURL()));
    return u;
  }

  return { MAX_SHIELD, RARITY, WEAPONS, POWERUPS, rollPowerup, iconSprite, iconURL };
})();
