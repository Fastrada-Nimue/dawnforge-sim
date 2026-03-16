const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const arenaWrap = document.querySelector(".arena-wrap");
const urlState = new URL(window.location.href);
const isPopoutWindow = urlState.searchParams.get("popout") === "1";

const ui = {
  phase: document.getElementById("phase"),
  room: document.getElementById("room"),
  hp: document.getElementById("hp"),
  dmg: document.getElementById("dmg"),
  weapon: document.getElementById("weapon"),
  biome: document.getElementById("biome"),
  modifier: document.getElementById("modifier"),
  character: document.getElementById("character"),
  runShards: document.getElementById("run-shards"),
  metaShards: document.getElementById("meta-shards"),
  overlayTitle: document.getElementById("overlay-title"),
  overlayCards: document.getElementById("overlay-cards"),
  defeatModal: document.getElementById("defeat-modal"),
  defeatModalTitle: document.getElementById("defeat-modal-title"),
  defeatModalCards: document.getElementById("defeat-modal-cards"),
  startBtn: document.getElementById("start-btn"),
  restartBtn: document.getElementById("restart-btn"),
  popoutBtn: document.getElementById("arena-popout-btn"),
  fullscreenBtn: document.getElementById("arena-fullscreen-btn"),
  toast: document.getElementById("toast"),
};

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const MAX_WAVES = 10;
const SAVE_KEY = "dawnforge.walldef.v1";

const DEFEAT_UPGRADES = [
  { id: "wallTech", name: "Wall Engineering", cost: 80, desc: "+120 starting wall HP (stacking)", max: 8 },
  { id: "xpBoost", name: "Battle Study", cost: 95, desc: "+12% XP gain (stacking)", max: 6 },
  { id: "essenceBoost", name: "Salvage Protocol", cost: 100, desc: "+10% essence gain (stacking)", max: 6 },
  { id: "damageBoost", name: "Rune Temper", cost: 110, desc: "+10% starting damage (stacking)", max: 6 },
  { id: "castSpeedBoost", name: "Quick Sigils", cost: 110, desc: "+8% starting cast speed (stacking)", max: 6 },
];

const XP_BY_TYPE = {
  grunt: 6,
  runner: 9,
  brute: 16,
  boss: 60,
};

const input = {
  mouseX: WIDTH * 0.5,
  mouseY: HEIGHT * 0.5,
};

const powerOrder = ["fire", "earth", "water", "wind"];
const basePowerOrder = ["arc", ...powerOrder];

const game = {
  mode: "hub", // hub | running | upgrade | gameover | victory
  wave: 0,
  enemies: [],
  projectiles: [],
  zones: [],
  sparks: [],
  spawnLeft: 0,
  spawnTimer: 0,
  spawnInterval: 0.8,
  kills: 0,
  runEssence: 0,
  globalDamageMul: 1,
  cooldownMul: 1,
  level: 0,
  xp: 0,
  xpToNext: 24,
  pendingLevelChoices: 0,
  time: 0,
  lastTs: 0,
  wall: null,
  hero: null,
  powers: null,
  magmaUnlocked: false,
  upgradeChoices: [],
  meta: loadMeta(),
};

setupInput();
setupUi();
applyWindowMode();
resetOverlayToFeed();
updateUi();
requestAnimationFrame(loop);

function setupUi() {
  ui.startBtn.textContent = "Start Defense";
  ui.startBtn.onclick = () => startGame();
  if (ui.restartBtn) ui.restartBtn.onclick = () => startGame();
  if (ui.popoutBtn) ui.popoutBtn.onclick = () => openPopoutWindow();

  if (ui.fullscreenBtn) {
    ui.fullscreenBtn.onclick = () => toggleFullscreen();
    document.addEventListener("fullscreenchange", updateFullscreenButton);
    document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
    document.addEventListener("MSFullscreenChange", updateFullscreenButton);
    updateFullscreenButton();
  }
}

function applyWindowMode() {
  if (isPopoutWindow) {
    document.body.classList.add("popout-window");
    document.title = "Dawnforge Defense Popout";
    if (ui.popoutBtn) ui.popoutBtn.style.display = "none";
  }
}

function openPopoutWindow() {
  const popoutUrl = new URL(window.location.href);
  popoutUrl.searchParams.set("popout", "1");

  const popup = window.open(
    popoutUrl.toString(),
    "dawnforge-popout",
    "popup=yes,width=1600,height=960,resizable=yes,scrollbars=no"
  );

  if (popup) {
    popup.focus();
    setToast("Opened the game in a separate window.", "good");
  } else {
    setToast("Pop-out was blocked by the browser.", "danger");
  }
}

function setupInput() {
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    input.mouseX = (e.clientX - rect.left) * sx;
    input.mouseY = (e.clientY - rect.top) * sy;
  });

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (game.mode !== "running") return;
    castSelectedPower(input.mouseX, input.mouseY);
  });

  window.addEventListener("keydown", (e) => {
    void e;
  });
}

function startGame() {
  hideDefeatModal();
  game.mode = "upgrade";
  game.wave = 0;
  game.enemies = [];
  game.projectiles = [];
  game.zones = [];
  game.sparks = [];
  game.kills = 0;
  game.runEssence = 0;
  game.globalDamageMul = 1 + game.meta.defeatUpgrades.damageBoost * 0.1;
  game.cooldownMul = 1 / (1 + game.meta.defeatUpgrades.castSpeedBoost * 0.08);
  game.magmaUnlocked = false;
  game.level = 0;
  game.xp = 0;
  game.pendingLevelChoices = 0;
  game.xpToNext = getXpForNextLevel(game.level);
  game.time = 0;

  game.wall = {
    x: WIDTH * 0.5 - 190,
    y: HEIGHT - 160,
    w: 380,
    h: 26,
    maxHp: 1600 + game.meta.defeatUpgrades.wallTech * 120,
    hp: 1600 + game.meta.defeatUpgrades.wallTech * 120,
  };

  game.hero = {
    x: WIDTH * 0.5,
    y: HEIGHT - 95,
    r: 14,
  };

  game.powers = {
    arc: { level: 1, cd: 0.35, timer: 0, color: "#d6ecff", name: "Arc Bolt", unlocked: false, damageMul: 1, pierce: 0 },
    fire: { level: 1, cd: 1.0, timer: 0, color: "#ff8a52", name: "Fire", unlocked: false, areaMul: 1, burnDamageMul: 1, burnDurationBonus: 0 },
    earth: { level: 1, cd: 1.8, timer: 0, color: "#b7925a", name: "Earth", unlocked: false, damageMul: 1, slowBonus: 0, sizeMul: 1 },
    water: { level: 1, cd: 1.5, timer: 0, color: "#65b9ff", name: "Water", unlocked: false, radiusMul: 1, healMul: 1, damageMul: 1 },
    wind: { level: 1, cd: 1.2, timer: 0, color: "#bdeeff", name: "Wind", unlocked: false, widthMul: 1, pushMul: 1, durationMul: 1 },
    magma: { level: 0, cd: 2.8, timer: 0, color: "#ff533d", name: "Magma", unlocked: false, radiusMul: 1, dpsMul: 1, blastMul: 1 },
  };

  openStartingPowerDraft();
  setToast("Choose a starting power, then shape your build on each level up.", "good");
  updateUi();
}

function nextWave() {
  game.wave += 1;
  const earlyEase = getEarlyWaveEase();
  game.spawnLeft = Math.max(5, Math.round(6 + game.wave * 3 - earlyEase * 2));
  game.spawnInterval = Math.max(0.28, 1.02 - game.wave * 0.05 + earlyEase * 0.16);
  game.spawnTimer = 0.65 + earlyEase * 0.4;
  feed(`Wave ${game.wave} begins. Enemies incoming from the north.`);
}

function getEarlyWaveEase() {
  return Math.max(0, 4 - game.wave) / 3;
}

function getEnemyAttackCooldown(enemyType) {
  const base = enemyType === "brute" ? 1.55 : enemyType === "runner" ? 1.2 : 1.35;
  return Math.max(0.8, base - Math.max(0, game.wave - 4) * 0.05);
}

function loop(ts) {
  if (!game.lastTs) game.lastTs = ts;
  const dt = Math.min(0.033, (ts - game.lastTs) / 1000);
  game.lastTs = ts;

  update(dt);
  render();
  requestAnimationFrame(loop);
}

function update(dt) {
  if (game.mode !== "running") return;

  game.time += dt;

  for (const key of ["arc", "fire", "earth", "water", "wind", "magma"]) {
    if (!game.powers[key]) continue;
    game.powers[key].timer = Math.max(0, game.powers[key].timer - dt);
  }

  if (game.spawnLeft > 0) {
    game.spawnTimer -= dt;
    if (game.spawnTimer <= 0) {
      spawnEnemy();
      game.spawnLeft -= 1;
      game.spawnTimer = game.spawnInterval;
    }
  }

  updateEnemies(dt);
  updateProjectiles(dt);
  updateZones(dt);
  updateSparks(dt);

  if (game.wall.hp <= 0) {
    game.wall.hp = 0;
    endGame(false);
    return;
  }

  if (game.pendingLevelChoices > 0) {
    openLevelUpDraft();
    return;
  }

  if (game.spawnLeft <= 0 && game.enemies.length === 0) {
    if (game.wave >= MAX_WAVES) {
      endGame(true);
      return;
    }
    openUpgradeDraft();
  }

  updateUi();
}

function spawnEnemy() {
  const earlyEase = getEarlyWaveEase();
  const roll = Math.random();
  let type = "grunt";
  if (game.wave >= 2 && roll > 0.88 + earlyEase * 0.05) type = "runner";
  if (game.wave >= 4 && (roll > 0.97 || (game.wave >= 6 && Math.random() > 0.9))) type = "brute";

  const scale = (1 + Math.max(0, game.wave - 1) * 0.1) * (1 - earlyEase * 0.08);

  const enemy =
    type === "runner"
      ? {
          type,
          x: 40 + Math.random() * (WIDTH - 80),
          y: -38,
          r: 10,
          hp: 54 * scale,
          maxHp: 54 * scale,
          speed: (76 + game.wave * 6) * (1 - earlyEase * 0.18),
          damage: (14 + game.wave * 1.4) * (1 - earlyEase * 0.12),
          atkCd: 0,
          color: "#9ae2ff",
          burn: 0,
          slow: 0,
        }
      : type === "brute"
      ? {
          type,
          x: 50 + Math.random() * (WIDTH - 100),
          y: -34,
          r: 16,
          hp: 190 * scale,
          maxHp: 190 * scale,
          speed: (34 + game.wave * 2.6) * (1 - earlyEase * 0.1),
          damage: (38 + game.wave * 3) * (1 - earlyEase * 0.08),
          atkCd: 0,
          color: "#de9467",
          burn: 0,
          slow: 0,
        }
      : {
          type,
          x: 45 + Math.random() * (WIDTH - 90),
          y: -36,
          r: 12,
          hp: 88 * scale,
          maxHp: 88 * scale,
          speed: (46 + game.wave * 3.5) * (1 - earlyEase * 0.16),
          damage: (20 + game.wave * 2) * (1 - earlyEase * 0.14),
          atkCd: 0,
          color: "#e17f7f",
          burn: 0,
          slow: 0,
        };

  game.enemies.push(enemy);
}

function updateEnemies(dt) {
  for (const e of game.enemies) {
    const slowMul = e.slow > 0 ? 0.52 : 1;
    const targetY = game.wall.y - 3;

    if (e.y + e.r < targetY) {
      e.y += e.speed * slowMul * dt;
    } else {
      e.atkCd -= dt;
      if (e.atkCd <= 0) {
        e.atkCd = getEnemyAttackCooldown(e.type);
        game.wall.hp -= e.damage;
        spawnSpark(e.x, game.wall.y, "#ffcf8f", 5);
      }
    }

    if (e.burn > 0) {
      const burnDps = (10 + game.powers.fire.level * 5) * game.powers.fire.burnDamageMul;
      e.hp -= burnDps * dt;
      e.burn -= dt;
      spawnSpark(e.x, e.y, "#ff9966", 1);
    }

    if (e.slow > 0) e.slow -= dt;
  }

  const defeated = game.enemies.filter((e) => e.hp <= 0);
  game.enemies = game.enemies.filter((e) => e.hp > 0);
  const killed = defeated.length;
  if (killed > 0) {
    game.kills += killed;
    const essenceMul = 1 + game.meta.defeatUpgrades.essenceBoost * 0.1;
    game.runEssence += killed * 3 * essenceMul;
    let xpGain = 0;
    for (const enemy of defeated) xpGain += XP_BY_TYPE[enemy.type] || XP_BY_TYPE.grunt;
    gainXp(xpGain);
  }
}

function updateProjectiles(dt) {
  for (const p of game.projectiles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;

    if (p.type === "fireball" && Math.hypot(p.x - p.tx, p.y - p.ty) < 18) {
      explodeFire(p.tx, p.ty);
      p.life = 0;
    }

    if (p.type === "rock") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r) {
          const dmg = (26 + game.powers.earth.level * 10) * game.globalDamageMul * game.powers.earth.damageMul;
          e.hp -= dmg;
          e.slow = Math.max(e.slow, 0.8 + game.powers.earth.level * 0.2 + game.powers.earth.slowBonus);
          p.life = 0;
          break;
        }
      }
    }

    if (p.type === "arcBolt") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r) {
          e.hp -= p.damage;
          spawnSpark(e.x, e.y, "#d6ecff", 1.1);
          if (p.pierce > 0) p.pierce -= 1;
          else p.life = 0;
          break;
        }
      }
    }
  }

  game.projectiles = game.projectiles.filter((p) => p.life > 0 && p.x > -20 && p.x < WIDTH + 20 && p.y > -20 && p.y < HEIGHT + 20);
}

function updateZones(dt) {
  for (const z of game.zones) {
    z.life -= dt;

    if (z.type === "waterBurst" && !z.applied) {
      z.applied = true;
      for (const e of game.enemies) {
        const d = Math.hypot(e.x - z.x, e.y - z.y);
        if (d < z.r + e.r) {
          e.hp -= z.damage;
          e.slow = Math.max(e.slow, 0.9 + game.powers.water.level * 0.15);
        }
      }
      game.wall.hp = Math.min(game.wall.maxHp, game.wall.hp + z.heal);
    }

    if (z.type === "windLine") {
      for (const e of game.enemies) {
        const d = distanceToSegment(e.x, e.y, z.x1, z.y1, z.x2, z.y2);
        if (d < z.width + e.r) {
          e.hp -= z.dps * dt;
          e.y -= z.push * dt;
        }
      }
    }

    if (z.type === "lava") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.slow = Math.max(e.slow, 0.6);
        }
      }
    }
  }

  game.zones = game.zones.filter((z) => z.life > 0);
}

function updateSparks(dt) {
  for (const s of game.sparks) {
    s.life -= dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }
  game.sparks = game.sparks.filter((s) => s.life > 0);
}

function castSelectedPower(tx, ty) {
  const volleyPowers = getUnlockedVolleyPowers();
  if (volleyPowers.length === 0) return;

  const center = (volleyPowers.length - 1) * 0.5;
  let castAny = false;
  for (let i = 0; i < volleyPowers.length; i++) {
    const offset = (i - center) * 0.1;
    castAny = tryCastPower(volleyPowers[i], tx, ty, offset) || castAny;
  }

  return castAny;
}

function getUnlockedBasePowers() {
  if (!game.powers) return [];
  return basePowerOrder.filter((k) => game.powers[k]?.unlocked);
}

function getUnlockedVolleyPowers() {
  const out = getUnlockedBasePowers();
  if (game.magmaUnlocked && game.powers?.magma?.unlocked) out.push("magma");
  return out;
}

function getLockedBasePowers() {
  if (!game.powers) return [];
  return basePowerOrder.filter((k) => !game.powers[k]?.unlocked);
}

function getOffsetTarget(tx, ty, angleOffset) {
  const baseAngle = Math.atan2(ty - game.hero.y, tx - game.hero.x);
  const dist = Math.max(24, Math.hypot(tx - game.hero.x, ty - game.hero.y));
  const ang = baseAngle + angleOffset;
  return {
    x: game.hero.x + Math.cos(ang) * dist,
    y: game.hero.y + Math.sin(ang) * dist,
    angle: ang,
  };
}

function tryCastPower(key, tx, ty, angleOffset = 0) {
  const p = game.powers[key];
  if (!p) return false;
  if (!p.unlocked) return false;
  if (key === "magma" && !game.magmaUnlocked) return false;
  if (p.timer > 0) return false;

  p.timer = p.cd * game.cooldownMul;
  const aimed = getOffsetTarget(tx, ty, angleOffset);

  if (key === "arc") {
    const speed = 520;
    game.projectiles.push({
      type: "arcBolt",
      x: game.hero.x,
      y: game.hero.y - 8,
      vx: Math.cos(aimed.angle) * speed,
      vy: Math.sin(aimed.angle) * speed,
      life: 0.8,
      r: 3,
      damage: (14 + game.level * 1.3) * game.globalDamageMul * p.damageMul,
      pierce: p.pierce,
    });
    return true;
  }

  if (key === "fire") {
    const speed = 340 + p.level * 20;
    game.projectiles.push({
      type: "fireball",
      x: game.hero.x,
      y: game.hero.y - 8,
      vx: Math.cos(aimed.angle) * speed,
      vy: Math.sin(aimed.angle) * speed,
      tx: aimed.x,
      ty: aimed.y,
      life: 2,
      r: 6,
    });
    return true;
  }

  if (key === "earth") {
    const speed = 280 + p.level * 16;
    game.projectiles.push({
      type: "rock",
      x: game.hero.x,
      y: game.hero.y - 10,
      vx: Math.cos(aimed.angle) * speed,
      vy: Math.sin(aimed.angle) * speed,
      life: 1.8,
      r: 8 * p.sizeMul,
    });
    return true;
  }

  if (key === "water") {
    const r = (44 + p.level * 8) * p.radiusMul;
    const dmg = (16 + p.level * 7) * game.globalDamageMul * p.damageMul;
    const heal = (8 + p.level * 5) * p.healMul;
    game.zones.push({ type: "waterBurst", x: aimed.x, y: aimed.y, r, damage: dmg, heal, life: 0.28, applied: false });
    return true;
  }

  if (key === "wind") {
    const len = 420;
    game.zones.push({
      type: "windLine",
      x1: game.hero.x,
      y1: game.hero.y,
      x2: game.hero.x + Math.cos(aimed.angle) * len,
      y2: game.hero.y + Math.sin(aimed.angle) * len,
      width: 18 * p.widthMul,
      dps: (26 + p.level * 8) * game.globalDamageMul,
      push: (68 + p.level * 12) * p.pushMul,
      life: 0.42 * p.durationMul,
    });
    return true;
  }

  if (key === "magma") {
    game.zones.push({
      type: "lava",
      x: aimed.x,
      y: aimed.y,
      r: (64 + p.level * 5) * p.radiusMul,
      dps: (52 + p.level * 14) * game.globalDamageMul * p.dpsMul,
      life: 3.3,
    });
    explodeAt(aimed.x, aimed.y, (52 + p.level * 12) * p.radiusMul, (36 + p.level * 12) * p.blastMul);
    return true;
  }

  return false;
}

function explodeFire(x, y) {
  const p = game.powers.fire;
  const r = (44 + p.level * 10) * p.areaMul;
  const dmg = (28 + p.level * 12) * game.globalDamageMul;

  explodeAt(x, y, r, dmg);
  for (const e of game.enemies) {
    if (Math.hypot(e.x - x, e.y - y) < r + e.r) {
      e.burn = Math.max(e.burn, 1.1 + p.level * 0.3 + p.burnDurationBonus);
    }
  }
}

function explodeAt(x, y, radius, damage) {
  for (const e of game.enemies) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < radius + e.r) {
      const falloff = 1 - Math.min(0.85, d / radius);
      e.hp -= damage * Math.max(0.2, falloff);
    }
  }
  for (let i = 0; i < 14; i++) spawnSpark(x, y, "#ff9f70", 2.6);
}

function renderChoiceOverlay(title, choices, onPick) {
  ui.overlayTitle.textContent = title;
  ui.overlayCards.innerHTML = "";

  for (const choice of choices) {
    const el = document.createElement("button");
    el.className = "card";
    el.innerHTML = `<b>${choice.name}</b><br>${choice.desc}`;
    el.onclick = () => onPick(choice);
    ui.overlayCards.appendChild(el);
  }
}

function getStartingPowerDesc(key) {
  if (key === "arc") return "Fast direct bolts for reliable single-target pressure.";
  if (key === "fire") return "Explosive fireballs that burn clustered enemies.";
  if (key === "earth") return "Heavy stone shots that slow threats before wall contact.";
  if (key === "water") return "Burst damage with wall healing on every cast.";
  if (key === "wind") return "A piercing gust lane that damages and pushes enemies back.";
  return "Unlock this power.";
}

function unlockPower(key, selectPower = false) {
  const power = game.powers[key];
  if (!power || power.unlocked) return;
  power.unlocked = true;
  void selectPower;
}

function makePowerUpgradeChoice(key, descPrefix) {
  return {
    name: `Upgrade ${game.powers[key].name}`,
    desc: `${descPrefix} ${game.powers[key].name} level +1 and 5% faster cooldown.`,
    apply: () => {
      game.powers[key].level += 1;
      game.powers[key].cd = Math.max(0.28, game.powers[key].cd * 0.95);
      feed(`${game.powers[key].name} reached level ${game.powers[key].level}.`);
      setToast(`${game.powers[key].name} upgraded.`, "good");
    },
  };
}

function generateLevelUpChoices() {
  const choices = [];

  for (const key of getLockedBasePowers()) {
    choices.push({
      name: `Learn ${game.powers[key].name}`,
      desc: `${getStartingPowerDesc(key)} Unlock it now and it joins every future volley.`,
      apply: () => {
        unlockPower(key, false);
        feed(`${game.powers[key].name} learned at level ${game.level}.`);
        setToast(`${game.powers[key].name} joined your attack volley.`, "good");
      },
    });
  }

  for (const key of getUnlockedBasePowers()) {
    choices.push(makePowerUpgradeChoice(key, `Strengthen one part of your volley.`));
  }

  return choices.slice(0, 4);
}

function openStartingPowerDraft() {
  const choices = basePowerOrder.map((key) => ({
    name: `Awaken ${game.powers[key].name}`,
    desc: getStartingPowerDesc(key),
    apply: () => unlockPower(key, true),
  }));

  renderChoiceOverlay("Choose Your Starting Power", choices, (choice) => {
    choice.apply();
    game.mode = "running";
    resetOverlayToFeed();
    nextWave();
    feed(`${choice.name.replace("Awaken ", "")} bound to the sentinel.`);
    updateUi();
  });
}

function openLevelUpDraft() {
  if (game.mode !== "running") return;
  game.pendingLevelChoices -= 1;
  game.mode = "upgrade";
  game.upgradeChoices = generateLevelUpChoices();

  renderChoiceOverlay(`Level ${game.level} Power Choice`, game.upgradeChoices, (choice) => {
    choice.apply();
    game.mode = "running";
    resetOverlayToFeed();
    updateUi();
  });
}

function openUpgradeDraft() {
  game.mode = "upgrade";
  game.upgradeChoices = generateUpgradeChoices();

  renderChoiceOverlay("Choose 1 Upgrade", game.upgradeChoices, (choice) => {
      choice.apply();
      game.mode = "running";
      resetOverlayToFeed();
      nextWave();
      updateUi();
  });
}

function addElementUpgradeChoices(pool, key) {
  const power = game.powers[key];
  if (!power?.unlocked) return;

  if (key === "arc") {
    pool.push({
      name: "Arc Overcharge",
      desc: "Arc Bolt damage +22%",
      apply: () => {
        power.damageMul *= 1.22;
        feed("Arc Bolt damage surged.");
      },
    });
    pool.push({
      name: "Forked Arc",
      desc: "+1 Arc Bolt pierce",
      apply: () => {
        power.pierce += 1;
        feed("Arc Bolt now pierces deeper into the wave.");
      },
    });
  }

  if (key === "fire") {
    pool.push({
      name: "Widened Blaze",
      desc: "Fire blast area +28%",
      apply: () => {
        power.areaMul *= 1.28;
        feed("Fire blast radius expanded.");
      },
    });
    pool.push({
      name: "Cinder Heart",
      desc: "Fire burn damage +30%",
      apply: () => {
        power.burnDamageMul *= 1.3;
        feed("Fire burn damage intensified.");
      },
    });
    pool.push({
      name: "Lingering Embers",
      desc: "Fire burn lasts 0.5s longer",
      apply: () => {
        power.burnDurationBonus += 0.5;
        feed("Burning embers linger longer.");
      },
    });
  }

  if (key === "earth") {
    pool.push({
      name: "Crushing Stone",
      desc: "Earth impact damage +24%",
      apply: () => {
        power.damageMul *= 1.24;
        feed("Earth impacts hit harder.");
      },
    });
    pool.push({
      name: "Quagmire Core",
      desc: "Earth slow duration +0.35s",
      apply: () => {
        power.slowBonus += 0.35;
        feed("Earth now drags enemies longer.");
      },
    });
    pool.push({
      name: "Boulder Mass",
      desc: "Earth projectile size +20%",
      apply: () => {
        power.sizeMul *= 1.2;
        feed("Earth boulders grew in size.");
      },
    });
  }

  if (key === "water") {
    pool.push({
      name: "Flood Basin",
      desc: "Water burst radius +25%",
      apply: () => {
        power.radiusMul *= 1.25;
        feed("Water bursts cover more ground.");
      },
    });
    pool.push({
      name: "Restorative Spray",
      desc: "Water wall healing +30%",
      apply: () => {
        power.healMul *= 1.3;
        feed("Water restores more wall integrity.");
      },
    });
    pool.push({
      name: "Pressure Wave",
      desc: "Water burst damage +22%",
      apply: () => {
        power.damageMul *= 1.22;
        feed("Water bursts strike harder.");
      },
    });
  }

  if (key === "wind") {
    pool.push({
      name: "Gale Corridor",
      desc: "Wind width +24%",
      apply: () => {
        power.widthMul *= 1.24;
        feed("Wind lanes widened.");
      },
    });
    pool.push({
      name: "Backdraft",
      desc: "Wind push +26%",
      apply: () => {
        power.pushMul *= 1.26;
        feed("Wind now shoves enemies farther back.");
      },
    });
    pool.push({
      name: "Tailwind Sustain",
      desc: "Wind duration +20%",
      apply: () => {
        power.durationMul *= 1.2;
        feed("Wind lines remain active longer.");
      },
    });
  }

  if (key === "magma") {
    pool.push({
      name: "Volcanic Spread",
      desc: "Magma radius +22%",
      apply: () => {
        power.radiusMul *= 1.22;
        feed("Magma spread widened.");
      },
    });
    pool.push({
      name: "Core Heat",
      desc: "Magma damage-over-time +24%",
      apply: () => {
        power.dpsMul *= 1.24;
        feed("Magma heat intensified.");
      },
    });
    pool.push({
      name: "Eruption Force",
      desc: "Magma blast damage +26%",
      apply: () => {
        power.blastMul *= 1.26;
        feed("Magma eruptions hit harder.");
      },
    });
  }
}

function generateUpgradeChoices() {
  const pool = [];

  const unlockedPowers = powerOrder.filter((key) => game.powers[key].unlocked);
  if (game.powers.arc.unlocked) addElementUpgradeChoices(pool, "arc");
  for (const key of unlockedPowers) {
    pool.push({
      name: `Upgrade ${game.powers[key].name}`,
      desc: `${game.powers[key].name} level +1 (damage/utility scales)`,
      apply: () => {
        game.powers[key].level += 1;
        game.powers[key].cd = Math.max(0.45, game.powers[key].cd * 0.95);
        feed(`${game.powers[key].name} reached level ${game.powers[key].level}.`);
      },
    });
    addElementUpgradeChoices(pool, key);
  }

  if (game.magmaUnlocked && game.powers.magma.unlocked) {
    pool.push({
      name: `Upgrade ${game.powers.magma.name}`,
      desc: `${game.powers.magma.name} level +1 (damage/utility scales)`,
      apply: () => {
        game.powers.magma.level += 1;
        game.powers.magma.cd = Math.max(1.6, game.powers.magma.cd * 0.95);
        feed(`${game.powers.magma.name} reached level ${game.powers.magma.level}.`);
      },
    });
    addElementUpgradeChoices(pool, "magma");
  }

  pool.push({
    name: "Fortify Wall",
    desc: "+220 max wall HP and repair 220",
    apply: () => {
      game.wall.maxHp += 220;
      game.wall.hp = Math.min(game.wall.maxHp, game.wall.hp + 220);
      feed("Wall reinforced.");
    },
  });

  pool.push({
    name: "Arcane Tempo",
    desc: "All cooldowns 10% faster",
    apply: () => {
      game.cooldownMul *= 0.9;
      feed("Casting tempo accelerated.");
    },
  });

  pool.push({
    name: "Quickened Sigils",
    desc: "+15% cast speed",
    apply: () => {
      game.cooldownMul *= 0.85;
      feed("Sigils quickened.");
    },
  });

  pool.push({
    name: "Spell Surge",
    desc: "+18% global damage",
    apply: () => {
      game.globalDamageMul *= 1.18;
      feed("Arcane output increased.");
    },
  });

  pool.push({
    name: "Rune Sharpening",
    desc: "+12% spell damage",
    apply: () => {
      game.globalDamageMul *= 1.12;
      feed("Runes sharpened for higher damage.");
    },
  });

  pool.push({
    name: "Emergency Repairs",
    desc: "Repair wall by 30% of max HP",
    apply: () => {
      game.wall.hp = Math.min(game.wall.maxHp, game.wall.hp + game.wall.maxHp * 0.3);
      feed("Repair crews restored the wall.");
    },
  });

  const out = pickUnique(pool, 4);

  const magmaEligible = game.powers.fire.unlocked && game.powers.earth.unlocked && game.powers.fire.level >= 3 && game.powers.earth.level >= 3 && !game.magmaUnlocked;
  if (magmaEligible) {
    out[0] = {
      name: "Awaken Magma",
      desc: "Fire + Earth fusion unlocked. Magma joins your full attack volley.",
      apply: () => {
        game.magmaUnlocked = true;
        game.powers.magma.level = 1;
        game.powers.magma.unlocked = true;
        feed("Magma awakened and added to your volley.");
      },
    };
  }

  return out;
}

function pickUnique(arr, count) {
  const pool = [...arr];
  const out = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = (Math.random() * pool.length) | 0;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function endGame(victory) {
  game.mode = victory ? "victory" : "gameover";

  const gain = Math.floor(game.runEssence + (victory ? 160 : 45));
  game.meta.totalEssence += gain;
  game.meta.bestWave = Math.max(game.meta.bestWave, game.wave);
  saveMeta(game.meta);

  if (victory) {
    hideDefeatModal();
    ui.overlayTitle.textContent = "Victory";
    ui.overlayCards.innerHTML = `
      <div class="card" style="cursor:default">
        <b>You held all waves.</b><br>
        Wave reached: ${game.wave}<br>
        Level reached: ${game.level}<br>
        Kills: ${game.kills}<br>
        Essence gained: ${gain}
      </div>
    `;
  } else {
    renderDefeatOverlay(gain);
  }

  setToast(victory ? "Great defense. Start again to try a new build." : "Try different power upgrades and fusion timing.", victory ? "good" : "danger");
  updateUi();
}

function renderDefeatUpgradeMenu() {
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.style.cursor = "default";
  wrap.innerHTML = `<b>Defeat Upgrades</b><br>Spend essence to get stronger next run.`;
  ui.defeatModalCards.appendChild(wrap);

  for (const up of DEFEAT_UPGRADES) {
    const current = game.meta.defeatUpgrades[up.id] || 0;
    const dynamicCost = getDefeatUpgradeCost(up, current);
    const btn = document.createElement("button");
    btn.className = "card";
    btn.innerHTML = `<b>${up.name} ${current}/${up.max}</b><br>${up.desc}<br>Cost: ${dynamicCost}`;
    btn.onclick = () => {
      buyDefeatUpgrade(up.id);
      renderDefeatOverlay();
      updateUi();
    };
    ui.defeatModalCards.appendChild(btn);
  }
}

function renderDefeatOverlay(gainOverride) {
  if (!ui.defeatModal || !ui.defeatModalCards || !ui.defeatModalTitle) return;
  ui.defeatModalTitle.textContent = "Wall Breached";
  ui.defeatModalCards.innerHTML = "";
  ui.defeatModal.classList.add("visible");

  const essenceMul = 1 + game.meta.defeatUpgrades.essenceBoost * 0.1;
  const summary = document.createElement("div");
  summary.className = "card";
  summary.style.cursor = "default";
  summary.innerHTML = `
    <b>Defense failed.</b><br>
    Wave reached: ${game.wave}<br>
    Level reached: ${game.level}<br>
    Kills: ${game.kills}<br>
    Essence gained: ${Math.floor(gainOverride ?? 45 + game.runEssence)}<br>
    Meta essence: ${Math.floor(game.meta.totalEssence)}<br>
    Essence bonus: ${(essenceMul * 100).toFixed(0)}%
  `;
  ui.defeatModalCards.appendChild(summary);
  renderDefeatUpgradeMenu();
}

function hideDefeatModal() {
  if (!ui.defeatModal || !ui.defeatModalCards) return;
  ui.defeatModal.classList.remove("visible");
  ui.defeatModalCards.innerHTML = "";
}

function buyDefeatUpgrade(id) {
  const up = DEFEAT_UPGRADES.find((u) => u.id === id);
  if (!up) return;
  const current = game.meta.defeatUpgrades[id] || 0;
  if (current >= up.max) {
    setToast("This upgrade is already maxed.", "danger");
    return;
  }

  const cost = getDefeatUpgradeCost(up, current);
  if (game.meta.totalEssence < cost) {
    setToast(`Need ${cost} essence.`, "danger");
    return;
  }

  game.meta.totalEssence -= cost;
  game.meta.defeatUpgrades[id] = current + 1;
  saveMeta(game.meta);
  setToast(`${up.name} upgraded to ${game.meta.defeatUpgrades[id]}/${up.max}.`, "good");
}

function getDefeatUpgradeCost(upgrade, currentTier) {
  return Math.floor(upgrade.cost * (1 + currentTier * 0.35));
}

function resetOverlayToFeed() {
  ui.overlayTitle.textContent = "Run Feed";
  ui.overlayCards.innerHTML = `<div class="card" style="cursor:default">Hold the wall and build your power synergy.</div>`;
}

function feed(msg) {
  ui.overlayTitle.textContent = "Run Feed";
  ui.overlayCards.innerHTML = `<div class="card" style="cursor:default">${msg}</div>`;
}

function updateUi() {
  ui.phase.textContent = capitalize(game.mode);
  ui.room.textContent = `${game.wave} / ${MAX_WAVES} (Lv ${game.level})`;

  const wallHp = game.wall ? `${Math.max(0, game.wall.hp).toFixed(0)} / ${game.wall.maxHp.toFixed(0)}` : "-";
  ui.hp.textContent = wallHp;
  ui.dmg.textContent = `${game.globalDamageMul.toFixed(2)}x`;

  if (game.powers) {
    const volley = getUnlockedVolleyPowers();
    ui.weapon.innerHTML = volley.length
      ? `${volley.length} Powers Active`
      : "Choose a starting power";
  } else {
    ui.weapon.textContent = "-";
  }

  ui.biome.textContent = "North Siege Lane";
  ui.modifier.textContent = `XP ${Math.floor(game.xp)} / ${Math.floor(game.xpToNext)}`;
  ui.character.textContent = "Sentinel (Stationary)";

  ui.runShards.textContent = Math.floor(game.runEssence);
  ui.metaShards.textContent = `${game.meta.totalEssence} (Best Wave ${game.meta.bestWave})`;
}

function render() {
  drawBackground();
  drawXpHud();
  drawWall();
  drawHero();
  drawZones();
  drawProjectiles();
  drawEnemies();
  drawSparks();
  drawPowerBar();
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  g.addColorStop(0, "#1a1012");
  g.addColorStop(1, "#0f141c");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.strokeStyle = "rgba(180, 170, 165, 0.08)";
  for (let y = 0; y < HEIGHT; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255, 70, 60, 0.1)";
  ctx.fillRect(0, 0, WIDTH, 36);
}

function drawXpHud() {
  const x = 16;
  const y = 42;
  const w = 260;
  const h = 10;
  const ratio = game.xpToNext > 0 ? Math.max(0, Math.min(1, game.xp / game.xpToNext)) : 0;
  const nextHint = getNextPowerHint();

  ctx.fillStyle = "#1a2331";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#7fb3ff";
  ctx.fillRect(x, y, w * ratio, h);
  ctx.strokeStyle = "#4d6e9f";
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = "#c8dbff";
  ctx.font = "12px Trebuchet MS";
  const xpText = `Level ${game.level} XP ${Math.floor(game.xp)} / ${Math.floor(game.xpToNext)}`;
  ctx.fillText(xpText, x, y - 6);

  if (nextHint) {
    ctx.fillStyle = "#9ec7ff";
    ctx.fillText(nextHint, x + w + 14, y + 9);
  } else if (game.powers?.fire?.unlocked && game.powers?.earth?.unlocked && !game.magmaUnlocked) {
    ctx.fillStyle = "#ffb18c";
    ctx.fillText("Next: Magma via Fire+Earth level 3", x + w + 14, y + 9);
  }
}

function getNextPowerHint() {
  if (!game.powers || getUnlockedBasePowers().length === 0) return "Pick a starting power to begin.";
  if (getLockedBasePowers().length > 0) return "Next level: learn a new power or upgrade one in your volley.";
  return "Next level: strengthen one of your volley powers.";
}

function drawWall() {
  if (!game.wall) return;
  const w = game.wall;

  ctx.fillStyle = "#6b5848";
  ctx.fillRect(w.x, w.y, w.w, w.h);
  ctx.strokeStyle = "#8f7762";
  ctx.lineWidth = 2;
  ctx.strokeRect(w.x, w.y, w.w, w.h);

  ctx.fillStyle = "#2a1a18";
  ctx.fillRect(w.x, w.y - 12, w.w, 7);
  const ratio = Math.max(0, w.hp / w.maxHp);
  ctx.fillStyle = ratio > 0.45 ? "#7ce08a" : ratio > 0.2 ? "#f0c665" : "#ef6f6f";
  ctx.fillRect(w.x, w.y - 12, w.w * ratio, 7);
}

function drawHero() {
  if (!game.hero) return;
  const h = game.hero;

  ctx.fillStyle = "#9edcff";
  circle(h.x, h.y, h.r);

  ctx.fillStyle = "rgba(140, 220, 255, 0.25)";
  circle(h.x, h.y, h.r + 7);
}

function drawEnemies() {
  for (const e of game.enemies) {
    ctx.fillStyle = e.color;
    circle(e.x, e.y, e.r);

    const r = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = "#2d1010";
    ctx.fillRect(e.x - e.r, e.y - e.r - 8, e.r * 2, 4);
    ctx.fillStyle = "#f07f7f";
    ctx.fillRect(e.x - e.r, e.y - e.r - 8, e.r * 2 * r, 4);
  }
}

function drawProjectiles() {
  for (const p of game.projectiles) {
    if (p.type === "arcBolt") {
      drawLightningBolt(p.x, p.y, p.vx, p.vy, "#d8f1ff");
    } else if (p.type === "fireball") {
      drawFlame(p.x, p.y, 7);
    } else if (p.type === "rock") {
      ctx.fillStyle = "#b79167";
      circle(p.x, p.y, p.r);
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      circle(p.x - 2, p.y - 2, Math.max(2, p.r * 0.28));
    }
  }
}

function drawZones() {
  for (const z of game.zones) {
    if (z.type === "waterBurst") {
      ctx.fillStyle = "rgba(90, 170, 255, 0.18)";
      circle(z.x, z.y, z.r);
      drawDropletRing(z.x, z.y, z.r, 7);
    } else if (z.type === "windLine") {
      drawZigZagLine(z.x1, z.y1, z.x2, z.y2, "rgba(190, 245, 255, 0.82)", 5);
    } else if (z.type === "lava") {
      ctx.fillStyle = "rgba(255, 95, 60, 0.30)";
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(255, 140, 90, 0.75)";
      ctx.stroke();
    }
  }
}

function drawSparks() {
  for (const s of game.sparks) {
    ctx.globalAlpha = Math.max(0, s.life / s.maxLife);
    ctx.fillStyle = s.color;
    circle(s.x, s.y, s.r);
    ctx.globalAlpha = 1;
  }
}

function drawPowerBar() {
  if (!game.powers) return;

  const keys = ["arc", ...powerOrder, "magma"];
  const totalW = keys.length * 128 + (keys.length - 1) * 8;
  let x = WIDTH * 0.5 - totalW * 0.5;
  const y = HEIGHT - 52;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const p = game.powers[key];
    const unlocked = !!p.unlocked && (key !== "magma" || game.magmaUnlocked);

    ctx.fillStyle = unlocked ? "#2f2a1a" : "#1d222d";
    ctx.fillRect(x, y, 128, 36);
    ctx.strokeStyle = unlocked ? "#ffd285" : "#41506a";
    ctx.strokeRect(x, y, 128, 36);

    ctx.fillStyle = unlocked ? p.color : "#6f7a8a";
    ctx.font = "12px Trebuchet MS";
    const suffix = unlocked ? `Lv.${p.level}` : "Locked";
    ctx.fillText(`${p.name} ${suffix}`, x + 8, y + 15);

    const cdRatio = unlocked && p.cd > 0 ? 1 - p.timer / (p.cd * game.cooldownMul) : 0;
    ctx.fillStyle = "#112031";
    ctx.fillRect(x + 8, y + 22, 112, 8);
    ctx.fillStyle = !unlocked ? "#4d5766" : p.timer <= 0 ? "#7ee89f" : "#8cb7ff";
    ctx.fillRect(x + 8, y + 22, 112 * Math.max(0, Math.min(1, cdRatio)), 8);

    x += 136;
  }
}

function spawnSpark(x, y, color, mult) {
  const angle = Math.random() * Math.PI * 2;
  const speed = 25 + Math.random() * 80 * mult;
  game.sparks.push({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: 1.5 + Math.random() * 2,
    color,
    life: 0.2 + Math.random() * 0.25,
    maxLife: 0.45,
  });
}

function drawFlame(x, y, size) {
  ctx.fillStyle = "rgba(255, 156, 86, 0.95)";
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.quadraticCurveTo(x + size * 0.9, y - size * 0.2, x + size * 0.35, y + size);
  ctx.quadraticCurveTo(x, y + size * 0.55, x - size * 0.35, y + size);
  ctx.quadraticCurveTo(x - size * 0.9, y - size * 0.2, x, y - size);
  ctx.fill();

  ctx.fillStyle = "rgba(255, 228, 145, 0.9)";
  ctx.beginPath();
  ctx.moveTo(x, y - size * 0.52);
  ctx.quadraticCurveTo(x + size * 0.45, y, x, y + size * 0.52);
  ctx.quadraticCurveTo(x - size * 0.45, y, x, y - size * 0.52);
  ctx.fill();
}

function drawDropletRing(x, y, radius, count) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + game.time * 0.7;
    drawDroplet(x + Math.cos(a) * radius * 0.72, y + Math.sin(a) * radius * 0.72, 6);
  }
}

function drawDroplet(x, y, size) {
  ctx.fillStyle = "rgba(124, 201, 255, 0.92)";
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.quadraticCurveTo(x + size * 0.9, y - size * 0.1, x, y + size);
  ctx.quadraticCurveTo(x - size * 0.9, y - size * 0.1, x, y - size);
  ctx.fill();
}

function drawLightningBolt(x, y, vx, vy, color) {
  const angle = Math.atan2(vy, vx);
  const len = 16;
  const points = [
    { x: x - Math.cos(angle) * len * 0.5, y: y - Math.sin(angle) * len * 0.5 },
    { x: x - Math.cos(angle) * len * 0.18 + Math.cos(angle + Math.PI / 2) * 4, y: y - Math.sin(angle) * len * 0.18 + Math.sin(angle + Math.PI / 2) * 4 },
    { x, y },
    { x: x + Math.cos(angle) * len * 0.18 - Math.cos(angle + Math.PI / 2) * 4, y: y + Math.sin(angle) * len * 0.18 - Math.sin(angle + Math.PI / 2) * 4 },
    { x: x + Math.cos(angle) * len * 0.5, y: y + Math.sin(angle) * len * 0.5 },
  ];
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
}

function drawZigZagLine(x1, y1, x2, y2, color, width) {
  const segments = 10;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;

  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const amp = i % 2 === 0 ? 10 : -10;
    ctx.lineTo(x1 + dx * t + nx * amp, y1 + dy * t + ny * amp);
  }
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * (x2 - x1);
  const cy = y1 + t * (y2 - y1);
  return Math.hypot(px - cx, py - cy);
}

function circle(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function setToast(msg, kind) {
  ui.toast.textContent = msg;
  ui.toast.className = "toast";
  if (kind === "good") ui.toast.classList.add("good");
  if (kind === "danger") ui.toast.classList.add("danger");
}

function capitalize(s) {
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

function loadMeta() {
  const fallback = {
    totalEssence: 0,
    bestWave: 0,
    defeatUpgrades: { wallTech: 0, xpBoost: 0, essenceBoost: 0, damageBoost: 0, castSpeedBoost: 0 },
  };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      totalEssence: parsed.totalEssence || 0,
      bestWave: parsed.bestWave || 0,
      defeatUpgrades: {
        wallTech: parsed.defeatUpgrades?.wallTech || 0,
        xpBoost: parsed.defeatUpgrades?.xpBoost || 0,
        essenceBoost: parsed.defeatUpgrades?.essenceBoost || 0,
        damageBoost: parsed.defeatUpgrades?.damageBoost || 0,
        castSpeedBoost: parsed.defeatUpgrades?.castSpeedBoost || 0,
      },
    };
  } catch {
    return fallback;
  }
}

function gainXp(amount) {
  const xpMul = 1 + game.meta.defeatUpgrades.xpBoost * 0.12;
  game.xp += amount * xpMul;
  while (game.xp >= game.xpToNext) {
    game.xp -= game.xpToNext;
    game.level += 1;
    game.xpToNext = getXpForNextLevel(game.level);
    game.pendingLevelChoices += 1;
    feed(`Level ${game.level} reached.`);
    setToast(`Level ${game.level}. Choose a power action.`, "good");
  }
}

function getXpForNextLevel(level) {
  return 16 + level * 10 + level * level * 1.5;
}

function toggleFullscreen() {
  const target = arenaWrap || document.documentElement;
  const active = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;

  if (document.body.classList.contains("arena-expanded") && !active) {
    setArenaExpanded(false);
    return;
  }

  if (!active) {
    const enter =
      target.requestFullscreen
      || target.webkitRequestFullscreen
      || target.msRequestFullscreen;
    if (enter) {
      const result = enter.call(target);
      if (result && typeof result.catch === "function") {
        result.catch(() => {
          setArenaExpanded(true);
          setToast("Fullscreen was blocked. Switched to expanded view instead.", "good");
        });
      }
    } else {
      setArenaExpanded(true);
      setToast("Fullscreen is not supported here. Expanded view enabled instead.", "good");
    }
    return;
  }

  const exit =
    document.exitFullscreen
    || document.webkitExitFullscreen
    || document.msExitFullscreen;
  if (exit) exit.call(document);
}

function setArenaExpanded(expanded) {
  document.body.classList.toggle("arena-expanded", expanded);
  updateFullscreenButton();
}

function updateFullscreenButton() {
  if (!ui.fullscreenBtn) return;
  const active = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
  const expanded = document.body.classList.contains("arena-expanded");
  ui.fullscreenBtn.innerHTML = active || expanded ? "&#x2715;" : "&#9974;";
  ui.fullscreenBtn.title = active || expanded ? "Exit Expanded View" : "Fullscreen / Expand";
}

function saveMeta(meta) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(meta));
}
