
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
const MAX_WAVES = 30;
const BOSS_WAVE_INTERVAL = 6; // Bosses at waves 6, 12, 18, etc. (after every 5 regular levels)
const BOSS_WARNING_SECONDS = 4;
const MAX_SPARKS = 900;
const MAX_PROJECTILES = 700;
const MAX_ZONES = 220;
const LANE_SIDE_MARGIN = 110;
const SAVE_KEY = "dawnforge.walldef.v1";

function getLaneBounds(radius = 0) {
  return {
    left: LANE_SIDE_MARGIN + radius,
    right: WIDTH - LANE_SIDE_MARGIN - radius,
  };
}

const runtimeState = {
  fatalError: false,
  errorCount: 0,
};

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

const ESSENCE_BY_TYPE = {
  grunt: 3,
  runner: 4,
  brute: 7,
  boss: 30,
};

const input = {
  mouseX: WIDTH * 0.5,
  mouseY: HEIGHT * 0.5,
  mouseDown: false,
};

let startScreenBoxes = [];
let powerBarBoxes = [];

const powerOrder = ["fire", "earth", "water", "wind"];
const basePowerOrder = ["arc", ...powerOrder];

// Elemental combo definitions — priority order matters; first entry wins on overlapping skills.
// magma is unlock-gated via upgrade card and handled separately.
const COMBO_DEFS = [
  { key: "mist",      a: "fire",  b: "water", minLevel: 3 },
  { key: "storm",     a: "water", b: "wind",  minLevel: 3 },
  { key: "chain",     a: "arc",   b: "wind",  minLevel: 3 },
  { key: "quicksand", a: "earth", b: "water", minLevel: 3 },
];

// Triple fusions take priority over pair fusions.
const TRIPLE_COMBO_DEFS = [
  { key: "monsoon",  a: "fire",  b: "water", c: "wind",  minLevel: 3 },
  { key: "sandglass", a: "fire",  b: "earth", c: "wind",  minLevel: 3 },
  { key: "mudflow",  a: "fire",  b: "earth", c: "water", minLevel: 3 },
  { key: "blizzard", a: "earth", b: "water", c: "wind",  minLevel: 3 },
];

const QUAD_COMBO_DEF = { key: "cataclysm", a: "fire", b: "earth", c: "water", d: "wind", minLevel: 3 };

function getActiveFusionState() {
  const consumed = new Set();
  const activeComboKeys = [];
  const sourcesByKey = {};

  const qa = game.powers && game.powers[QUAD_COMBO_DEF.a];
  const qb = game.powers && game.powers[QUAD_COMBO_DEF.b];
  const qc = game.powers && game.powers[QUAD_COMBO_DEF.c];
  const qd = game.powers && game.powers[QUAD_COMBO_DEF.d];
  if (qa && qb && qc && qd && qa.unlocked && qb.unlocked && qc.unlocked && qd.unlocked &&
      qa.level >= QUAD_COMBO_DEF.minLevel && qb.level >= QUAD_COMBO_DEF.minLevel &&
      qc.level >= QUAD_COMBO_DEF.minLevel && qd.level >= QUAD_COMBO_DEF.minLevel) {
    activeComboKeys.push(QUAD_COMBO_DEF.key);
    sourcesByKey[QUAD_COMBO_DEF.key] = [QUAD_COMBO_DEF.a, QUAD_COMBO_DEF.b, QUAD_COMBO_DEF.c, QUAD_COMBO_DEF.d];
    consumed.add(QUAD_COMBO_DEF.a);
    consumed.add(QUAD_COMBO_DEF.b);
    consumed.add(QUAD_COMBO_DEF.c);
    consumed.add(QUAD_COMBO_DEF.d);
  }

  for (const def of TRIPLE_COMBO_DEFS) {
    if (consumed.has(def.a) || consumed.has(def.b) || consumed.has(def.c)) continue;
    const pa = game.powers && game.powers[def.a];
    const pb = game.powers && game.powers[def.b];
    const pc = game.powers && game.powers[def.c];
    if (pa && pb && pc && pa.unlocked && pb.unlocked && pc.unlocked &&
        pa.level >= def.minLevel && pb.level >= def.minLevel && pc.level >= def.minLevel) {
      activeComboKeys.push(def.key);
      sourcesByKey[def.key] = [def.a, def.b, def.c];
      consumed.add(def.a);
      consumed.add(def.b);
      consumed.add(def.c);
    }
  }

  if (game.magmaUnlocked && game.powers && game.powers.magma && game.powers.magma.unlocked &&
      !consumed.has("fire") && !consumed.has("earth")) {
    activeComboKeys.push("magma");
    sourcesByKey.magma = ["fire", "earth"];
    consumed.add("fire");
    consumed.add("earth");
  }

  for (const def of COMBO_DEFS) {
    if (consumed.has(def.a) || consumed.has(def.b)) continue;
    const pa = game.powers && game.powers[def.a];
    const pb = game.powers && game.powers[def.b];
    if (pa && pb && pa.unlocked && pb.unlocked && pa.level >= def.minLevel && pb.level >= def.minLevel) {
      activeComboKeys.push(def.key);
      sourcesByKey[def.key] = [def.a, def.b];
      consumed.add(def.a);
      consumed.add(def.b);
    }
  }

  return { consumed, activeComboKeys, sourcesByKey };
}

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
  bossPrep: false,
  bossPrepTimer: 0,
  bossSpawnedThisWave: false,
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
  preferredElements: [],
  pendingCrystalBonus: null,
  lastEndSummary: null,
  retryingBossWave: null,
  targetStartWave: null, // For jumping to any wave (regular or boss)
  selectedCastKey: null,
  meta: loadMeta(),
};
setupInput();
setupUi();
applyWindowMode();
resetOverlayToFeed();
openStartingElementOverlay();
installRuntimeGuards();
updateUi();
requestAnimationFrame(loop);

function setupUi() {
  ui.startBtn.textContent = "Pick Starting Power";
  ui.startBtn.onclick = () => {
    hideDefeatModal();
    input.mouseDown = false;
    game.mode = "hub";
    openStartingElementOverlay();
    updateUi();
  };
  if (ui.restartBtn) ui.restartBtn.onclick = () => {
    hideDefeatModal();
    input.mouseDown = false;
    game.mode = "hub";
    updateUi();
  };
  if (ui.popoutBtn) ui.popoutBtn.onclick = () => openPopoutWindow();

  if (ui.fullscreenBtn) {
    ui.fullscreenBtn.onclick = () => toggleFullscreen();
    document.addEventListener("fullscreenchange", updateFullscreenButton);
    document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
    document.addEventListener("MSFullscreenChange", updateFullscreenButton);
    updateFullscreenButton();
  }
}

function openStartingElementOverlay() {
  const choices = ["arc", "fire", "earth", "water", "wind"].map((key) => ({
    key,
    name: `Start with ${capitalize(key === "arc" ? "arc bolt" : key)}`,
    desc: getStartingPowerDesc(key),
  }));

  renderChoiceOverlay("Choose Your Starting Power", choices, (choice) => {
    hideDefeatModal();
    startGameWithElement(choice.key);
  });
  setToast("Pick a starting power from the cards or click one on the canvas.", "good");
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
  function updatePointerFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    input.mouseX = (clientX - rect.left) * sx;
    input.mouseY = (clientY - rect.top) * sy;
  }

  canvas.addEventListener("mousemove", (e) => {
    updatePointerFromClient(e.clientX, e.clientY);
    if (game.mode === "hub") {
      const hovered = startScreenBoxes.some(b =>
        input.mouseX >= b.x && input.mouseX <= b.x + b.w &&
        input.mouseY >= b.y && input.mouseY <= b.y + b.h
      );
      canvas.style.cursor = hovered ? "pointer" : "default";
    } else {
      canvas.style.cursor = "crosshair";
    }
  });

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    updatePointerFromClient(e.clientX, e.clientY);
    if (game.mode === "hub") {
      for (const box of startScreenBoxes) {
        if (input.mouseX >= box.x && input.mouseX <= box.x + box.w &&
            input.mouseY >= box.y && input.mouseY <= box.y + box.h) {
          startGameWithElement(box.key);
          return;
        }
      }
      return;
    }
    if (game.mode !== "running") return;

    for (const box of powerBarBoxes) {
      if (!box.selectable) continue;
      if (input.mouseX >= box.x && input.mouseX <= box.x + box.w &&
          input.mouseY >= box.y && input.mouseY <= box.y + box.h) {
        game.selectedCastKey = box.key;
        setToast(`Selected ${box.label}.`, "good");
        return;
      }
    }

    input.mouseDown = true;
    castSelectedPower(input.mouseX, input.mouseY);
  });

  canvas.addEventListener("mouseup", (e) => {
    if (e.button !== 0) return;
    input.mouseDown = false;
  });

  canvas.addEventListener("mouseleave", () => {
    input.mouseDown = false;
  });

  canvas.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length === 0) return;
    const t = e.touches[0];
    updatePointerFromClient(t.clientX, t.clientY);

    if (game.mode === "hub") {
      for (const box of startScreenBoxes) {
        if (input.mouseX >= box.x && input.mouseX <= box.x + box.w &&
            input.mouseY >= box.y && input.mouseY <= box.y + box.h) {
          startGameWithElement(box.key);
          e.preventDefault();
          return;
        }
      }
      return;
    }

    if (game.mode === "running") {
      for (const box of powerBarBoxes) {
        if (!box.selectable) continue;
        if (input.mouseX >= box.x && input.mouseX <= box.x + box.w &&
            input.mouseY >= box.y && input.mouseY <= box.y + box.h) {
          game.selectedCastKey = box.key;
          setToast(`Selected ${box.label}.`, "good");
          e.preventDefault();
          return;
        }
      }

      input.mouseDown = true;
      castSelectedPower(input.mouseX, input.mouseY);
      e.preventDefault();
    }
  }, { passive: false });

  canvas.addEventListener("touchend", () => {
    input.mouseDown = false;
  });

  window.addEventListener("keydown", (e) => {
    void e;
  });
}

function startGame() {
  hideDefeatModal();
  const carry = consumePendingCrystalBonus();
  game.mode = "upgrade";
  game.wave = 0;
  game.enemies = [];
  game.projectiles = [];
  game.zones = [];
  game.sparks = [];
  game.kills = 0;
  game.runEssence = 0;
  game.globalDamageMul = (1 + game.meta.defeatUpgrades.damageBoost * 0.1) * (1 + carry.damageBoostPct);
  game.cooldownMul = (1 / (1 + game.meta.defeatUpgrades.castSpeedBoost * 0.08)) / (1 + carry.castSpeedBoostPct);
  game.magmaUnlocked = false;
  game.bossPrep = false;
  game.bossPrepTimer = 0;
  game.bossSpawnedThisWave = false;
  game.level = 0;
  game.xp = 0;
  game.pendingLevelChoices = 0;
  game.xpToNext = getXpForNextLevel(game.level);
  game.time = 0;
  game.selectedCastKey = null;

  game.wall = {
    x: WIDTH * 0.5 - 190,
    y: HEIGHT - 160,
    w: 380,
    h: 26,
    maxHp: 1600 + game.meta.defeatUpgrades.wallTech * 120 + carry.wallHpBonus,
    hp: 1600 + game.meta.defeatUpgrades.wallTech * 120 + carry.wallHpBonus,
  };

  game.hero = {
    x: WIDTH * 0.5,
    y: HEIGHT - 95,
    r: 14,
  };

  game.powers = {
    arc: { level: 1, cd: 0.28, timer: 0, color: "#d6ecff", name: "Arc Bolt", unlocked: false, damageMul: 1.25, pierce: 1 },
    fire: { level: 1, cd: 1.0, timer: 0, color: "#ff8a52", name: "Fire", unlocked: false, areaMul: 1, burnDamageMul: 1, burnDurationBonus: 0 },
    earth: { level: 1, cd: 1.4, timer: 0, color: "#b7925a", name: "Earth", unlocked: false, damageMul: 1.22, slowBonus: 0.15, sizeMul: 1.15 },
    water: { level: 1, cd: 1.1, timer: 0, color: "#65b9ff", name: "Water", unlocked: false, radiusMul: 1.18, healMul: 1.18, damageMul: 1.18 },
    wind: { level: 1, cd: 0.95, timer: 0, color: "#bdeeff", name: "Wind", unlocked: false, widthMul: 1.18, pushMul: 1.18, durationMul: 1.18 },
    magma:     { level: 0, cd: 2.2,  timer: 0, color: "#ff533d", name: "Magma",     unlocked: false, radiusMul: 1, dpsMul: 1, blastMul: 1 },
    mist:      { level: 0, cd: 1.55, timer: 0, color: "#aaddcc", name: "Mist"      },
    storm:     { level: 0, cd: 1.75, timer: 0, color: "#88bbff", name: "Storm"     },
    chain:     { level: 0, cd: 0.6,  timer: 0, color: "#b8d8ff", name: "Chain Arc" },
    quicksand: { level: 0, cd: 1.9,  timer: 0, color: "#c8a868", name: "Quicksand" },
  };

  openStartingPowerDraft();
  setToast("Choose a starting power, then shape your build on each level up.", "good");
  updateUi();
}

function nextWave() {
  game.wave += 1;

  if (game.wave % BOSS_WAVE_INTERVAL === 0) {
    game.spawnLeft = 0;
    game.spawnInterval = 0;
    game.spawnTimer = 0;
    game.bossPrep = true;
    game.bossPrepTimer = BOSS_WARNING_SECONDS;
    game.bossSpawnedThisWave = false;
    feed(`Wave ${game.wave} is a boss wave. Brace for impact.`);
    setToast(`Boss incoming in ${BOSS_WARNING_SECONDS}s.`, "danger");
    return;
  }

  const earlyEase = getEarlyWaveEase();
  game.spawnLeft = Math.max(5, Math.round(6 + game.wave * 3 - earlyEase * 2));
  game.spawnInterval = Math.max(0.28, 1.02 - game.wave * 0.05 + earlyEase * 0.16);
  game.spawnTimer = 0.65 + earlyEase * 0.4;
  game.bossPrep = false;
  game.bossPrepTimer = 0;
  game.bossSpawnedThisWave = false;
  feed(`Wave ${game.wave} begins. Enemies incoming from the north.`);
}

function getEarlyWaveEase() {
  return Math.max(0, 4 - game.wave) / 3;
}

function getEnemyAttackCooldown(enemyType) {
  const bossTier = Math.max(1, Math.floor(game.wave / BOSS_WAVE_INTERVAL));
  const base = enemyType === "boss"
    ? Math.max(1.45, 1.95 - bossTier * 0.16)
    : enemyType === "brute" ? 1.55 : enemyType === "runner" ? 1.2 : 1.35;
  return Math.max(0.8, base - Math.max(0, game.wave - 4) * 0.05);
}

function getBossProfileForWave(wave) {
  const tier = Math.max(1, Math.floor(wave / BOSS_WAVE_INTERVAL));
  const waveBonus = Math.max(0, wave - BOSS_WAVE_INTERVAL);
  return {
    tier,
    hp: 820 + tier * 420 + waveBonus * 55,
    speed: 25 + tier * 4 + waveBonus * 0.5,
    damage: 48 + tier * 18 + waveBonus * 1.6,
    radius: 31 + tier * 3,
    color: tier >= 2 ? "#ff5ea9" : "#c264ff",
  };
}

function spawnBossEnemy() {
  const profile = getBossProfileForWave(game.wave);
  game.enemies.push({
    type: "boss",
    x: WIDTH * 0.5,
    y: -58,
    r: profile.radius,
    hp: profile.hp,
    maxHp: profile.hp,
    speed: profile.speed,
    damage: profile.damage,
    atkCd: 0,
    color: profile.color,
    enraged: false,
    burn: 0, slow: 0, stun: 0, snare: 0,
  });
  game.bossSpawnedThisWave = true;
  for (let i = 0; i < 20; i++) spawnSpark(WIDTH * 0.5, 42 + Math.random() * 48, profile.tier >= 2 ? "#ffb1d2" : "#d9a8ff", 1.8);
  setToast(`Boss tier ${profile.tier} entered the lane.`, "danger");
}

function loop(ts) {
  if (runtimeState.fatalError) return;
  if (!game.lastTs) game.lastTs = ts;
  const dt = Math.min(0.033, (ts - game.lastTs) / 1000);
  game.lastTs = ts;

  try {
    update(dt);
    render();
  } catch (err) {
    reportRuntimeError("Loop", err);
    return;
  }
  requestAnimationFrame(loop);
}

function installRuntimeGuards() {
  window.addEventListener("error", (ev) => {
    const msg = ev && ev.message ? ev.message : "Unknown script error";
    const where = ev && ev.filename ? `${ev.filename}:${ev.lineno || 0}` : "runtime";
    reportRuntimeError(where, msg);
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev && ev.reason ? (ev.reason.message || String(ev.reason)) : "Promise rejection";
    reportRuntimeError("Promise", reason);
  });
}

function reportRuntimeError(where, err) {
  runtimeState.errorCount += 1;
  const raw = err && err.message ? err.message : String(err);
  const msg = `${where}: ${raw}`.slice(0, 220);

  input.mouseDown = false;
  setToast("Runtime issue detected. Run paused.", "danger");
  ui.overlayTitle.textContent = "Runtime Error";
  ui.overlayCards.innerHTML = `<div class="card" style="cursor:default"><b>Game paused to prevent a crash.</b><br>${msg}<br>Refresh to continue.</div>`;

  // If errors start cascading, stop the loop completely to avoid browser lockups.
  if (runtimeState.errorCount >= 2) runtimeState.fatalError = true;
}

function update(dt) {
  if (game.mode !== "running") return;

  game.time += dt;

  for (const key of ["arc", "fire", "earth", "water", "wind", "magma", "mist", "storm", "chain", "quicksand", "monsoon", "sandglass", "mudflow", "blizzard", "cataclysm"]) {
    if (!game.powers[key]) continue;
    game.powers[key].timer = Math.max(0, game.powers[key].timer - dt);
  }

  if (input.mouseDown) {
    castSelectedPower(input.mouseX, input.mouseY);
  }

  if (game.bossPrep && !game.bossSpawnedThisWave) {
    game.bossPrepTimer -= dt;
    if (game.bossPrepTimer <= 0) {
      game.bossPrep = false;
      game.bossPrepTimer = 0;
      spawnBossEnemy();
    }
  }

  if (!game.bossPrep && game.spawnLeft > 0) {
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

  if (!game.bossPrep && game.spawnLeft <= 0 && game.enemies.length === 0) {
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

  const runnerBounds = getLaneBounds(13);
  const bruteBounds = getLaneBounds(20);
  const gruntBounds = getLaneBounds(15);

  const enemy =
    type === "runner"
      ? {
          type,
          x: runnerBounds.left + Math.random() * Math.max(1, runnerBounds.right - runnerBounds.left),
          y: -38,
          r: 13,
          hp: 54 * scale,
          maxHp: 54 * scale,
          speed: (76 + game.wave * 6) * (1 - earlyEase * 0.18),
          damage: (14 + game.wave * 1.4) * (1 - earlyEase * 0.12),
          atkCd: 0,
          color: "#9ae2ff",
          burn: 0, slow: 0, stun: 0, snare: 0,
        }
      : type === "brute"
      ? {
          type,
          x: bruteBounds.left + Math.random() * Math.max(1, bruteBounds.right - bruteBounds.left),
          y: -34,
          r: 20,
          hp: 190 * scale,
          maxHp: 190 * scale,
          speed: (34 + game.wave * 2.6) * (1 - earlyEase * 0.1),
          damage: (38 + game.wave * 3) * (1 - earlyEase * 0.08),
          atkCd: 0,
          color: "#de9467",
          burn: 0, slow: 0, stun: 0, snare: 0,
        }
      : {
          type,
          x: gruntBounds.left + Math.random() * Math.max(1, gruntBounds.right - gruntBounds.left),
          y: -36,
          r: 15,
          hp: 88 * scale,
          maxHp: 88 * scale,
          speed: (46 + game.wave * 3.5) * (1 - earlyEase * 0.16),
          damage: (20 + game.wave * 2) * (1 - earlyEase * 0.14),
          atkCd: 0,
          color: "#e17f7f",
          burn: 0, slow: 0, stun: 0, snare: 0,
        };

  game.enemies.push(enemy);
}

function updateEnemies(dt) {
  for (const e of game.enemies) {
    const lane = getLaneBounds(e.r || 0);
    if (e.x < lane.left) e.x = lane.left;
    if (e.x > lane.right) e.x = lane.right;

    if (e.type === "boss" && !e.enraged && e.maxHp > 0 && e.hp / e.maxHp <= 0.45) {
      e.enraged = true;
      e.speed *= 1.16;
      e.damage *= 1.2;
      for (let i = 0; i < 12; i++) spawnSpark(e.x, e.y, "#ff9ed0", 1.5);
      setToast("Boss enraged!", "danger");
    }

    const stunned = e.stun > 0;
    const snared = e.snare > 0;
    const slowMul = stunned ? 0 : snared ? 0.14 : (e.slow > 0 ? 0.50 : 1);
    const targetY = game.wall.y - 3;

    if (e.stun > 0) {
      e.stun -= dt;
      if (Math.random() < dt * 6) spawnSpark(e.x, e.y, "#88ccff", 0.7);
    }
    if (e.snare > 0) {
      e.snare -= dt;
      if (Math.random() < dt * 4) spawnSpark(e.x, e.y, "#c8a848", 0.4);
    }

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
    let essenceGain = 0;
    for (const enemy of defeated) essenceGain += ESSENCE_BY_TYPE[enemy.type] || ESSENCE_BY_TYPE.grunt;
    game.runEssence += essenceGain * essenceMul;
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

          if (p.forks > 0 && game.projectiles.length < MAX_PROJECTILES) {
            let target = null;
            let bestDist = p.forkRange || 120;
            for (const other of game.enemies) {
              if (other === e || other.hp <= 0) continue;
              const d = Math.hypot(other.x - e.x, other.y - e.y);
              if (d < bestDist) {
                bestDist = d;
                target = other;
              }
            }
            if (target) {
              const ang = Math.atan2(target.y - e.y, target.x - e.x);
              spawnSpark(e.x, e.y, "#bfe7ff", 1.4);
              spawnSpark(target.x, target.y, "#9fd3ff", 1.2);
              game.projectiles.push({
                type: "arcBolt",
                x: e.x,
                y: e.y,
                vx: Math.cos(ang) * 620,
                vy: Math.sin(ang) * 620,
                life: 0.28,
                r: 3,
                damage: p.damage * (p.forkDamageMul || 0.72),
                pierce: 0,
                forks: p.forks - 1,
                forkRange: p.forkRange,
                forkDamageMul: p.forkDamageMul,
              });
            }
          }

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

  let castAny = false;

  // Prioritize the selected power, but still cast the rest of the volley so all element effects are visible.
  if (game.selectedCastKey && game.powers[game.selectedCastKey] && game.powers[game.selectedCastKey].unlocked) {
    castAny = tryCastPower(game.selectedCastKey, tx, ty, 0) || castAny;
  }

  const others = volleyPowers.filter((k) => k !== game.selectedCastKey);
  const center = (others.length - 1) * 0.5;
  for (let i = 0; i < others.length; i++) {
    const offset = (i - center) * 0.035;
    castAny = tryCastPower(others[i], tx, ty, offset) || castAny;
  }

  // Fallback when nothing is selected.
  if (!game.selectedCastKey) {
    const baseCenter = (volleyPowers.length - 1) * 0.5;
    for (let i = 0; i < volleyPowers.length; i++) {
      const offset = (i - baseCenter) * 0.035;
      castAny = tryCastPower(volleyPowers[i], tx, ty, offset) || castAny;
    }
  }

  return castAny;
}

function getUnlockedBasePowers() {
  if (!game.powers) return [];
  return basePowerOrder.filter((k) => game.powers[k] && game.powers[k].unlocked);
}

// Returns array of volley powers. Combos consume base skills by priority order.
function getUnlockedVolleyPowers() {
  if (!game.powers) return [];
  const fusion = getActiveFusionState();
  const consumed = fusion.consumed;
  const activeComboKeys = fusion.activeComboKeys;

  const baseActive = basePowerOrder.filter(k => game.powers[k] && game.powers[k].unlocked && !consumed.has(k));
  return [...baseActive, ...activeComboKeys];
}

function getLockedBasePowers() {
  if (!game.powers) return [];
  return basePowerOrder.filter((k) => !game.powers[k] || !game.powers[k].unlocked);
}

function getOffsetTarget(tx, ty, angleOffset) {
  const baseAngle = Math.atan2(ty - game.hero.y, tx - game.hero.x);
  const dist = Math.max(24, Math.hypot(tx - game.hero.x, ty - game.hero.y));
  const ang = baseAngle + angleOffset;
  const lane = getLaneBounds(0);
  const targetX = Math.max(lane.left, Math.min(lane.right, game.hero.x + Math.cos(ang) * dist));
  return {
    x: targetX,
    y: game.hero.y + Math.sin(ang) * dist,
    angle: ang,
  };
}

function getCappedCastTimer(powerKey, baseCd) {
  const maxByPower = {
    arc: 1.05,
    fire: 1.65,
    earth: 1.8,
    water: 1.7,
    wind: 1.55,
    magma: 2.25,
    mist: 1.75,
    storm: 1.85,
    chain: 0.9,
    quicksand: 2.0,
    monsoon: 2.25,
    sandglass: 2.35,
    mudflow: 2.4,
    blizzard: 2.3,
    cataclysm: 2.8,
  };
  const maxCd = maxByPower[powerKey] || 1.8;
  return Math.max(0.16, Math.min(maxCd, baseCd * game.cooldownMul));
}

function tryCastPower(key, tx, ty, angleOffset = 0) {
  const aimed = getOffsetTarget(tx, ty, angleOffset);

  if (key === "cataclysm") {
    const cp = game.powers[key];
    if (!cp || cp.timer > 0) return false;
    cp.timer = getCappedCastTimer(key, cp.cd);
    const lv = ["fire", "earth", "water", "wind"].reduce((sum, k) => sum + ((game.powers[k] && game.powers[k].level) || 1), 0) / 4;
    if (game.zones.length >= MAX_ZONES) game.zones.shift();
    game.zones.push({
      type: "apex",
      variant: "cataclysm",
      x: aimed.x,
      y: aimed.y,
      r: 96 + lv * 12,
      dps: (30 + lv * 7) * game.globalDamageMul,
      pulseCd: 0.32,
      pulseTimer: 0.32,
      pulseDamage: (24 + lv * 6.2) * game.globalDamageMul,
      stun: 0.48 + lv * 0.05,
      slow: 0.58,
      burn: 1.05 + lv * 0.08,
      life: 2.8,
    });
    return true;
  }

  const tripleDef = TRIPLE_COMBO_DEFS.find(d => d.key === key);
  if (tripleDef) {
    const cp = game.powers[key];
    if (!cp || cp.timer > 0) return false;
    cp.timer = getCappedCastTimer(key, cp.cd);
    const la = (game.powers[tripleDef.a] && game.powers[tripleDef.a].level) || 1;
    const lb = (game.powers[tripleDef.b] && game.powers[tripleDef.b].level) || 1;
    const lc = (game.powers[tripleDef.c] && game.powers[tripleDef.c].level) || 1;
    const lAvg = (la + lb + lc) / 3;

    if (game.zones.length >= MAX_ZONES) game.zones.shift();

    if (key === "monsoon") {
      game.zones.push({
        type: "triad",
        variant: "monsoon",
        x: aimed.x, y: aimed.y,
        r: 78 + lAvg * 10,
        dps: (24 + lAvg * 6) * game.globalDamageMul,
        slow: 0.8,
        push: 52 + lAvg * 7,
        strikeCd: 0.28,
        strikeTimer: 0.28,
        strikeDamage: (18 + lAvg * 5.5) * game.globalDamageMul,
        life: 2.2,
      });
    } else if (key === "sandglass") {
      game.zones.push({
        type: "triad",
        variant: "sandglass",
        x: aimed.x, y: aimed.y,
        r: 72 + lAvg * 9,
        dps: (26 + lAvg * 5.5) * game.globalDamageMul,
        burn: 0.85 + lAvg * 0.08,
        snare: 0.9 + lAvg * 0.08,
        slashCd: 0.42,
        slashTimer: 0.42,
        slashDamage: (20 + lAvg * 5) * game.globalDamageMul,
        life: 2.3,
      });
    } else if (key === "mudflow") {
      game.zones.push({
        type: "triad",
        variant: "mudflow",
        x: aimed.x, y: aimed.y,
        r: 84 + lAvg * 11,
        dps: (22 + lAvg * 6.2) * game.globalDamageMul,
        slow: 0.62,
        pull: 44 + lAvg * 6,
        pulseCd: 0.5,
        pulseTimer: 0.5,
        pulseDamage: (21 + lAvg * 5.3) * game.globalDamageMul,
        life: 2.45,
      });
    } else if (key === "blizzard") {
      game.zones.push({
        type: "triad",
        variant: "blizzard",
        x: aimed.x, y: aimed.y,
        r: 86 + lAvg * 10,
        dps: (20 + lAvg * 5.5) * game.globalDamageMul,
        slow: 0.45,
        stun: 0.45 + lAvg * 0.06,
        burstCd: 0.34,
        burstTimer: 0.34,
        burstDamage: (16 + lAvg * 4.8) * game.globalDamageMul,
        life: 2.35,
      });
    }
    return true;
  }

  // --- Auto-combo skills (use own timer, scale from component skill levels) ---
  const comboDef = COMBO_DEFS.find(d => d.key === key);
  if (comboDef) {
    const cp = game.powers[key];
    if (!cp || cp.timer > 0) return false;
    cp.timer = getCappedCastTimer(key, cp.cd);
    const la = (game.powers[comboDef.a] && game.powers[comboDef.a].level) || 1;
    const lb = (game.powers[comboDef.b] && game.powers[comboDef.b].level) || 1;
    const lAvg = (la + lb) * 0.5;

    if (key === "mist") {
      if (game.zones.length >= MAX_ZONES) game.zones.shift();
      game.zones.push({
        type: "mist",
        x: aimed.x, y: aimed.y,
        r: 56 + lAvg * 8,
        dps: (22 + lAvg * 5) * game.globalDamageMul,
        slow: 0.7,
        burn: 0.6 + 0.08 * lAvg,
        pulseCd: 0.52,
        pulseTimer: 0.52,
        pulseDamage: (22 + lAvg * 4.5) * game.globalDamageMul,
        pulseHeal: 2 + lAvg * 0.7,
        life: 1.9,
      });
    } else if (key === "storm") {
      if (game.zones.length >= MAX_ZONES) game.zones.shift();
      game.zones.push({
        type: "storm",
        x: aimed.x, y: aimed.y,
        r: 68 + lAvg * 9,
        dps: (28 + lAvg * 6) * game.globalDamageMul,
        stun: 0.65 + 0.08 * lAvg,
        slow: 0.75,
        strikeCd: 0.36,
        strikeTimer: 0.36,
        strikeDamage: (18 + lAvg * 5) * game.globalDamageMul,
        life: 1.6,
      });
    } else if (key === "chain") {
      const bolts = Math.min(7, 3 + Math.floor(lAvg / 3));
      for (let i = 0; i < bolts; i++) {
        if (game.projectiles.length >= MAX_PROJECTILES) break;
        const angle = aimed.angle + (i - (bolts - 1) * 0.5) * 0.16;
        game.projectiles.push({
          type: "arcBolt",
          x: game.hero.x, y: game.hero.y - 8,
          vx: Math.cos(angle) * 560,
          vy: Math.sin(angle) * 560,
          life: 0.75, r: 4,
          damage: (20 + lAvg * 1.8) * game.globalDamageMul,
          pierce: 3,
          forks: 1,
          forkRange: 118 + lAvg * 6,
          forkDamageMul: 0.74,
        });
      }
    } else if (key === "quicksand") {
      if (game.zones.length >= MAX_ZONES) game.zones.shift();
      game.zones.push({
        type: "quicksand",
        x: aimed.x, y: aimed.y,
        r: 52 + lAvg * 8,
        dps: (14 + lAvg * 3) * game.globalDamageMul,
        snare: 1.2 + 0.1 * lAvg,
        slow: 0.5,
        pull: 36 + lAvg * 4,
        crushCd: 0.66,
        crushTimer: 0.66,
        crushDamage: (12 + lAvg * 3) * game.globalDamageMul,
        life: 2.4,
      });
    }
    return true;
  }

  // --- Base/vanilla powers ---
  const p = game.powers[key];
  if (!p) return false;
  if (!p.unlocked) return false;
  if (key === "magma" && !game.magmaUnlocked) return false;
  if (p.timer > 0) return false;

  p.timer = getCappedCastTimer(key, p.cd);

  if (key === "arc") {
    const speed = 520;
    if (game.projectiles.length >= MAX_PROJECTILES) return true;
    game.projectiles.push({
      type: "arcBolt",
      x: game.hero.x,
      y: game.hero.y - 8,
      vx: Math.cos(aimed.angle) * speed,
      vy: Math.sin(aimed.angle) * speed,
      life: 0.8,
      r: 3,
      damage: (18 + game.level * 1.6) * game.globalDamageMul * p.damageMul,
      pierce: p.pierce,
    });
    return true;
  }

  if (key === "fire") {
    const speed = 340 + p.level * 20;
    if (game.projectiles.length >= MAX_PROJECTILES) return true;
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
    const speed = 320 + p.level * 18;
    if (game.projectiles.length >= MAX_PROJECTILES) return true;
    game.projectiles.push({
      type: "rock",
      x: game.hero.x,
      y: game.hero.y - 10,
      vx: Math.cos(aimed.angle) * speed,
      vy: Math.sin(aimed.angle) * speed,
      life: 1.8,
      r: 9 * p.sizeMul,
    });
    return true;
  }

  if (key === "water") {
    const r = (54 + p.level * 10) * p.radiusMul;
    const dmg = (22 + p.level * 9) * game.globalDamageMul * p.damageMul;
    const heal = (12 + p.level * 7) * p.healMul;
    if (game.zones.length >= MAX_ZONES) game.zones.shift();
    game.zones.push({ type: "waterBurst", x: aimed.x, y: aimed.y, r, damage: dmg, heal, life: 0.32, applied: false });
    return true;
  }

  if (key === "wind") {
    const len = 440;
    if (game.zones.length >= MAX_ZONES) game.zones.shift();
    game.zones.push({
      type: "windLine",
      x1: game.hero.x,
      y1: game.hero.y,
      x2: game.hero.x + Math.cos(aimed.angle) * len,
      y2: game.hero.y + Math.sin(aimed.angle) * len,
      width: 22 * p.widthMul,
      dps: (32 + p.level * 10) * game.globalDamageMul,
      push: (88 + p.level * 14) * p.pushMul,
      life: 0.52 * p.durationMul,
    });
    return true;
  }

  if (key === "magma") {
    if (game.zones.length >= MAX_ZONES) game.zones.shift();
    game.zones.push({
      type: "lava",
      x: aimed.x,
      y: aimed.y,
      r: (74 + p.level * 7) * p.radiusMul,
      dps: (62 + p.level * 16) * game.globalDamageMul * p.dpsMul,
      pulseCd: 0.78,
      pulseTimer: 0.78,
      pulseDamage: (20 + p.level * 6) * game.globalDamageMul * p.blastMul,
      life: 3.6,
    });
    explodeAt(aimed.x, aimed.y, (62 + p.level * 14) * p.radiusMul, (46 + p.level * 14) * p.blastMul);
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
    el.onclick = () => {
      rememberPreferredElement(inferElementKeyFromChoice(choice));
      onPick(choice);
    };
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

  choices.sort((a, b) => getChoiceDraftWeight(b) - getChoiceDraftWeight(a));
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

function startGameWithElement(key) {
  hideDefeatModal();
  const carry = consumePendingCrystalBonus();
  game.preferredElements = [key];
  
  // Handle target start wave (from progress line or boss retry)
  if (game.targetStartWave !== null) {
    game.wave = game.targetStartWave;
  } else if (game.retryingBossWave && isBossWave(game.retryingBossWave)) {
    game.wave = game.retryingBossWave - 1;
  } else {
    game.wave = 0;
  }
  
  game.enemies = [];
  game.projectiles = [];
  game.zones = [];
  game.sparks = [];
  game.kills = 0;
  game.runEssence = 0;
  game.globalDamageMul = (1 + game.meta.defeatUpgrades.damageBoost * 0.1) * (1 + carry.damageBoostPct);
  game.cooldownMul = (1 / (1 + game.meta.defeatUpgrades.castSpeedBoost * 0.08)) / (1 + carry.castSpeedBoostPct);
  game.magmaUnlocked = false;
  game.bossPrep = false;
  game.bossPrepTimer = 0;
  game.bossSpawnedThisWave = false;
  game.level = 0;
  game.xp = 0;
  game.pendingLevelChoices = 0;
  game.xpToNext = getXpForNextLevel(0);
  game.time = 0;
  game.selectedCastKey = key;

  game.wall = {
    x: WIDTH * 0.5 - 190,
    y: HEIGHT - 160,
    w: 380,
    h: 26,
    maxHp: 1600 + game.meta.defeatUpgrades.wallTech * 120 + carry.wallHpBonus,
    hp: 1600 + game.meta.defeatUpgrades.wallTech * 120 + carry.wallHpBonus,
  };

  game.hero = {
    x: WIDTH * 0.5,
    y: HEIGHT - 95,
    r: 14,
  };

  game.powers = {
    arc:       { level: 1, cd: 0.28, timer: 0, color: "#d6ecff", name: "Arc Bolt", unlocked: false, damageMul: 1.25, pierce: 1 },
    fire:      { level: 1, cd: 1.0,  timer: 0, color: "#ff8a52", name: "Fire",     unlocked: false, areaMul: 1, burnDamageMul: 1, burnDurationBonus: 0 },
    earth:     { level: 1, cd: 1.4,  timer: 0, color: "#b7925a", name: "Earth",    unlocked: false, damageMul: 1.22, slowBonus: 0.15, sizeMul: 1.15 },
    water:     { level: 1, cd: 1.1,  timer: 0, color: "#65b9ff", name: "Water",    unlocked: false, radiusMul: 1.18, healMul: 1.18, damageMul: 1.18 },
    wind:      { level: 1, cd: 0.95, timer: 0, color: "#bdeeff", name: "Wind",     unlocked: false, widthMul: 1.18, pushMul: 1.18, durationMul: 1.18 },
    magma:     { level: 0, cd: 2.2,  timer: 0, color: "#ff533d", name: "Magma",    unlocked: false, radiusMul: 1, dpsMul: 1, blastMul: 1 },
    mist:      { level: 0, cd: 1.55, timer: 0, color: "#aaddcc", name: "Mist"      },
    storm:     { level: 0, cd: 1.75, timer: 0, color: "#88bbff", name: "Storm"     },
    chain:     { level: 0, cd: 0.6,  timer: 0, color: "#b8d8ff", name: "Chain Arc" },
    quicksand: { level: 0, cd: 1.9,  timer: 0, color: "#c8a868", name: "Quicksand" },
    monsoon:   { level: 0, cd: 2.05, timer: 0, color: "#7cd7ff", name: "Monsoon"   },
    sandglass: { level: 0, cd: 2.2,  timer: 0, color: "#ffcc88", name: "Sandglass" },
    mudflow:   { level: 0, cd: 2.25, timer: 0, color: "#d7865f", name: "Mudflow"   },
    blizzard:  { level: 0, cd: 2.1,  timer: 0, color: "#b8ecff", name: "Blizzard"  },
    cataclysm: { level: 0, cd: 2.6,  timer: 0, color: "#f3d2ff", name: "Cataclysm" },
    monsoon:   { level: 0, cd: 2.05, timer: 0, color: "#7cd7ff", name: "Monsoon"   },
    sandglass: { level: 0, cd: 2.2,  timer: 0, color: "#ffcc88", name: "Sandglass" },
    mudflow:   { level: 0, cd: 2.25, timer: 0, color: "#d7865f", name: "Mudflow"   },
    blizzard:  { level: 0, cd: 2.1,  timer: 0, color: "#b8ecff", name: "Blizzard"  },
    cataclysm: { level: 0, cd: 2.6,  timer: 0, color: "#f3d2ff", name: "Cataclysm" },
  };

  unlockPower(key, true);
  game.mode = "running";
  resetOverlayToFeed();
  nextWave();
  
  const retryText = game.retryingBossWave ? ` Retrying Boss Level ${getBossTierFromWave(game.retryingBossWave)}.` : "";
  feed(`${game.powers[key].name} bound to the sentinel.${retryText}`);
  if (carry.tier > 0) {
    setToast(
      `Starting with ${game.powers[key].name}. Crystal bonus active: +${carry.wallHpBonus} wall HP, +${(carry.damageBoostPct * 100).toFixed(1)}% damage, +${(carry.castSpeedBoostPct * 100).toFixed(1)}% cast speed.`,
      "good"
    );
  } else {
    setToast(`Starting with ${game.powers[key].name}. Hold the wall!`, "good");
  }
  
  game.retryingBossWave = null; // Reset after use
  game.targetStartWave = null; // Reset after use
  updateUi();
}

function drawStartScreen() {
  const g = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  g.addColorStop(0, "#12161f");
  g.addColorStop(1, "#0b0e16");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "rgba(242, 185, 72, 0.07)";
  ctx.fillRect(0, 0, WIDTH, 48);
  ctx.fillStyle = "rgba(255, 70, 60, 0.07)";
  ctx.fillRect(0, HEIGHT - 48, WIDTH, 48);

  ctx.fillStyle = "#ffd285";
  ctx.font = "bold 42px Trebuchet MS";
  ctx.textAlign = "center";
  ctx.fillText("DAWNFORGE DEFENSE", WIDTH / 2, 105);

  ctx.fillStyle = "#7a8fa8";
  ctx.font = "15px Trebuchet MS";
  ctx.fillText("Choose your starting element", WIDTH / 2, 140);

  const elements = [
    { key: "arc",   name: "Arc Bolt", color: "#d6ecff", desc: "Fast precise bolts",    note: "Single-target pressure"  },
    { key: "fire",  name: "Fire",     color: "#ff8a52", desc: "Explosive area blasts", note: "Area + burn clusters"     },
    { key: "earth", name: "Earth",    color: "#c49a5a", desc: "Heavy slowing shots",   note: "Impact + crowd control"   },
    { key: "water", name: "Water",    color: "#65b9ff", desc: "Burst + wall healing",  note: "Sustain + area damage"    },
    { key: "wind",  name: "Wind",     color: "#bdeeff", desc: "Pushing gust lanes",    note: "Push + damage over time"  },
  ];

  const boxW = 154;
  const boxH = 138;
  const gap = 12;
  const totalW = elements.length * boxW + (elements.length - 1) * gap;
  const bx0 = (WIDTH - totalW) / 2;
  const by0 = 180;

  startScreenBoxes = [];

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const bx = bx0 + i * (boxW + gap);
    const by = by0;
    startScreenBoxes.push({ key: el.key, x: bx, y: by, w: boxW, h: boxH });

    const hovered =
      input.mouseX >= bx && input.mouseX <= bx + boxW &&
      input.mouseY >= by && input.mouseY <= by + boxH;

    ctx.fillStyle = hovered ? "#242c3f" : "#181f2e";
    ctx.fillRect(bx, by, boxW, boxH);

    ctx.strokeStyle = hovered ? el.color : "rgba(255,255,255,0.08)";
    ctx.lineWidth = hovered ? 2 : 1;
    ctx.strokeRect(bx, by, boxW, boxH);

    ctx.fillStyle = el.color;
    ctx.fillRect(bx, by, boxW, 4);

    ctx.fillStyle = el.color;
    ctx.font = "bold 16px Trebuchet MS";
    ctx.textAlign = "center";
    ctx.fillText(el.name, bx + boxW / 2, by + 32);

    ctx.fillStyle = "#cdd9ee";
    ctx.font = "12px Trebuchet MS";
    ctx.fillText(el.desc, bx + boxW / 2, by + 56);

    ctx.fillStyle = "#7a8fa8";
    ctx.font = "11px Trebuchet MS";
    ctx.fillText(el.note, bx + boxW / 2, by + 76);

    ctx.fillStyle = hovered ? "#ffd285" : "#806e38";
    ctx.font = "bold 12px Trebuchet MS";
    ctx.fillText("\u25B6 Click to Start", bx + boxW / 2, by + 114);
  }

  if (game.meta.bestWave > 0 || game.meta.totalEssence > 0) {
    ctx.fillStyle = "#3d4f66";
    ctx.font = "12px Trebuchet MS";
    ctx.textAlign = "center";
    ctx.fillText(
      `Best Wave: ${game.meta.bestWave}   |   Total Essence: ${game.meta.totalEssence}`,
      WIDTH / 2,
      HEIGHT - 24
    );
  }

  ctx.textAlign = "left";
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

function getEmptyCrystalBonus() {
  return {
    tier: 0,
    wallHpBonus: 0,
    damageBoostPct: 0,
    castSpeedBoostPct: 0,
  };
}

function buildCrystalBonusFromRun(crystals) {
  const tier = Math.min(10, Math.floor(Math.max(0, crystals) / 120));
  return {
    tier,
    wallHpBonus: tier * 24,
    damageBoostPct: tier * 0.012,
    castSpeedBoostPct: tier * 0.01,
  };
}

function consumePendingCrystalBonus() {
  if (!game.pendingCrystalBonus) return getEmptyCrystalBonus();
  const out = game.pendingCrystalBonus;
  game.pendingCrystalBonus = null;
  return out;
}

function inferElementKeyFromChoice(choice) {
  if (!choice) return null;
  const text = `${choice.name || ""} ${choice.desc || ""}`.toLowerCase();

  if (text.indexOf("magma") !== -1) return "magma";
  if (text.indexOf("fire") !== -1 || text.indexOf("cinder") !== -1 || text.indexOf("ember") !== -1) return "fire";
  if (text.indexOf("earth") !== -1 || text.indexOf("boulder") !== -1 || text.indexOf("stone") !== -1 || text.indexOf("quagmire") !== -1) return "earth";
  if (text.indexOf("water") !== -1 || text.indexOf("flood") !== -1 || text.indexOf("spray") !== -1) return "water";
  if (text.indexOf("wind") !== -1 || text.indexOf("gale") !== -1 || text.indexOf("backdraft") !== -1 || text.indexOf("tailwind") !== -1) return "wind";
  if (text.indexOf("arc bolt") !== -1 || text.indexOf("arc overcharge") !== -1 || text.indexOf("forked arc") !== -1 || text.indexOf("awaken arc") !== -1) return "arc";

  return null;
}

function rememberPreferredElement(key) {
  if (!key) return;
  if (!Array.isArray(game.preferredElements)) game.preferredElements = [];

  game.preferredElements = game.preferredElements.filter((k) => k !== key);
  game.preferredElements.unshift(key);
  if (game.preferredElements.length > 3) game.preferredElements.length = 3;
}

function getElementDraftWeight(key) {
  if (!key) return 1;

  let weight = 1;
  const idx = Array.isArray(game.preferredElements) ? game.preferredElements.indexOf(key) : -1;
  if (idx === 0) weight += 3;
  else if (idx === 1) weight += 2;
  else if (idx === 2) weight += 1;

  const p = game.powers && game.powers[key];
  if (p && p.unlocked) weight += Math.min(2, Math.floor(Math.max(0, p.level - 1) / 2));
  if (key === "magma" && game.magmaUnlocked) weight += 1;

  return Math.max(1, Math.min(6, weight));
}

function getChoiceDraftWeight(choice) {
  const key = inferElementKeyFromChoice(choice);
  if (!key) return 1;
  return getElementDraftWeight(key);
}

// Progression system: waves are grouped as [1-5, boss5], [6-10, boss10], [11-15, boss15], etc.
function isBossWave(waveNum) {
  return waveNum > 0 && waveNum % BOSS_WAVE_INTERVAL === 0;
}

function getBossWaveNumber(bossTier) {
  // bossTier 1 = wave 5, bossTier 2 = wave 10, bossTier 3 = wave 15
  return bossTier * BOSS_WAVE_INTERVAL;
}

function getBossTierFromWave(waveNum) {
  if (!isBossWave(waveNum)) return 0;
  return waveNum / BOSS_WAVE_INTERVAL;
}

function recordLostBoss(bossWave) {
  if (!isBossWave(bossWave)) return;
  if (!game.meta.lostBosses.includes(bossWave)) {
    game.meta.lostBosses.push(bossWave);
    game.meta.lostBosses.sort((a, b) => a - b);
    saveMeta(game.meta);
  }
}

function getHighestBossAvailableWave() {
  // Return the highest boss wave the player has reached
  let highest = 0;
  for (let tier = 1; tier <= 20; tier++) {
    const bossWave = getBossWaveNumber(tier);
    if (bossWave <= game.meta.bestWave) {
      highest = bossWave;
    } else {
      break;
    }
  }
  return highest;
}

function getProgressionTiers() {
  // Return array of tiers up to bestWave + 1
  // Each tier: 5 regular levels + 1 boss level
  const tiers = [];
  const maxTier = Math.ceil((game.meta.bestWave + 1) / BOSS_WAVE_INTERVAL);
  for (let tier = 1; tier <= maxTier; tier++) {
    const startWave = (tier - 1) * BOSS_WAVE_INTERVAL + 1;
    const bossWave = tier * BOSS_WAVE_INTERVAL;
    const regularWaves = [];
    for (let w = startWave; w < bossWave; w++) {
      regularWaves.push(w);
    }
    const isLost = game.meta.lostBosses.includes(bossWave);
    const isReached = game.meta.bestWave >= bossWave;
    tiers.push({
      tier,
      startWave,
      bossWave,
      regularWaves,
      isLost,
      isReached,
    });
  }
  return tiers;
}

function endGame(victory) {
  if (game.mode !== "running") return;

  input.mouseDown = false;
  game.mode = victory ? "victory" : "gameover";

  const crystals = Math.floor(Math.max(0, game.runEssence));
  const baseReward = victory ? 90 : 45;
  const waveReward = game.wave * (victory ? 8 : 5);
  const crystalReward = Math.floor(crystals * (victory ? 1.05 : 0.9));
  const crystalBonus = Math.floor(Math.sqrt(crystals) * 4);
  const totalGain = Math.max(0, Math.floor(baseReward + waveReward + crystalReward + crystalBonus));

  game.meta.totalEssence += totalGain;
  game.meta.bestWave = Math.max(game.meta.bestWave, game.wave);

  // Track if player lost at a boss wave
  if (!victory && isBossWave(game.wave)) {
    recordLostBoss(game.wave);
  }

  const carry = buildCrystalBonusFromRun(crystals);
  game.pendingCrystalBonus = carry.tier > 0 ? carry : null;
  game.lastEndSummary = {
    victory,
    crystals,
    baseReward,
    waveReward,
    crystalReward,
    crystalBonus,
    totalGain,
    carry,
  };

  saveMeta(game.meta);

  if (victory) {
    feed(`Victory. Wave ${game.wave} cleared and ${totalGain} essence secured.`);
    setToast(`Victory. +${totalGain} essence banked.`, "good");
  } else {
    const bossInfo = isBossWave(game.wave) ? " (Boss Level)" : "";
    feed(`Wall lost at wave ${game.wave}${bossInfo}. ${totalGain} essence salvaged.`);
    setToast(`Wall breached. +${totalGain} essence salvaged.`, "danger");
  }

  renderDefeatOverlay(totalGain);
  updateUi();
}

function addElementUpgradeChoices(pool, key) {
  const power = game.powers[key];
  if (!power || !power.unlocked) return;

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
    pool.push({
      name: "Capacitor Lattice",
      desc: "Arc damage +34%, cast speed -9%",
      apply: () => {
        power.damageMul *= 1.34;
        power.cd = Math.min(1.3, power.cd * 1.09);
        feed("Arc bolts hit harder, but cycle slower.");
      },
    });
    pool.push({
      name: "Pulse Cycling",
      desc: "Arc cast speed +18%, damage -12%",
      apply: () => {
        power.cd = Math.max(0.18, power.cd * 0.82);
        power.damageMul *= 0.88;
        feed("Arc bolts fire faster with reduced impact.");
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
    pool.push({
      name: "Inferno Bloom",
      desc: "Fire area +42%, cast speed -10%",
      apply: () => {
        power.areaMul *= 1.42;
        power.cd = Math.min(1.9, power.cd * 1.1);
        feed("Fire blooms wider, but with slower cadence.");
      },
    });
    pool.push({
      name: "Kindled Rhythm",
      desc: "Fire cast speed +20%, area -18%",
      apply: () => {
        power.cd = Math.max(0.35, power.cd * 0.8);
        power.areaMul *= 0.82;
        feed("Fire cadence quickened, blast radius tightened.");
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
    pool.push({
      name: "Seismic Payload",
      desc: "Earth size +32%, cast speed -10%",
      apply: () => {
        power.sizeMul *= 1.32;
        power.cd = Math.min(2.05, power.cd * 1.1);
        feed("Earth payload enlarged at a slower firing rhythm.");
      },
    });
    pool.push({
      name: "Pebble Salvo",
      desc: "Earth cast speed +18%, size -16%",
      apply: () => {
        power.cd = Math.max(0.4, power.cd * 0.82);
        power.sizeMul *= 0.84;
        feed("Earth shots fly more often, but smaller.");
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
    pool.push({
      name: "Tidal Reservoir",
      desc: "Water radius +36%, cast speed -9%",
      apply: () => {
        power.radiusMul *= 1.36;
        power.cd = Math.min(1.85, power.cd * 1.09);
        feed("Water bursts spread farther with slower recast.");
      },
    });
    pool.push({
      name: "Jet Weave",
      desc: "Water cast speed +18%, radius -15%",
      apply: () => {
        power.cd = Math.max(0.35, power.cd * 0.82);
        power.radiusMul *= 0.85;
        feed("Water pulses quickened, with tighter coverage.");
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
    pool.push({
      name: "Cyclone Front",
      desc: "Wind width +34%, cast speed -10%",
      apply: () => {
        power.widthMul *= 1.34;
        power.cd = Math.min(1.78, power.cd * 1.1);
        feed("Wind fronts widened, but cycle slower.");
      },
    });
    pool.push({
      name: "Razor Draft",
      desc: "Wind cast speed +20%, width -18%",
      apply: () => {
        power.cd = Math.max(0.3, power.cd * 0.8);
        power.widthMul *= 0.82;
        feed("Wind casts faster through narrower lanes.");
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
    pool.push({
      name: "Caldera Field",
      desc: "Magma radius +34%, cast speed -11%",
      apply: () => {
        power.radiusMul *= 1.34;
        power.cd = Math.min(2.9, power.cd * 1.11);
        feed("Magma fields expanded with slower cycling.");
      },
    });
    pool.push({
      name: "Splinter Vent",
      desc: "Magma cast speed +16%, radius -16%",
      apply: () => {
        power.cd = Math.max(1.2, power.cd * 0.84);
        power.radiusMul *= 0.84;
        feed("Magma vents trigger faster in smaller pools.");
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

  const out = pickWeightedUnique(pool, 4);

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

function pickWeightedUnique(arr, count) {
  const pool = [...arr];
  const out = [];

  while (out.length < count && pool.length) {
    let total = 0;
    for (const item of pool) total += Math.max(1, getChoiceDraftWeight(item));

    let roll = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      roll -= Math.max(1, getChoiceDraftWeight(pool[idx]));
      if (roll <= 0) break;
    }

    if (idx >= pool.length) idx = pool.length - 1;
    out.push(pool.splice(idx, 1)[0]);
  }

  return out;
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

      z.pulseTimer = (z.pulseTimer || 0) - dt;
      if (z.pulseTimer <= 0) {
        z.pulseTimer += z.pulseCd || 0.78;
        explodeAt(z.x, z.y, z.r * 0.55, z.pulseDamage || z.dps * 0.25);
        for (let i = 0; i < 8; i++) spawnSpark(z.x, z.y, "#ff8f62", 1.7);
      }
    }

    // Mist: slow, burn, dps
    if (z.type === "mist") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.slow = Math.max(e.slow, z.slow);
          e.burn = Math.max(e.burn, z.burn);
        }
      }

      z.pulseTimer = (z.pulseTimer || 0) - dt;
      if (z.pulseTimer <= 0) {
        z.pulseTimer += z.pulseCd || 0.52;
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r * 0.62 + e.r) {
            e.hp -= z.pulseDamage || z.dps * 0.5;
            e.slow = Math.max(e.slow, z.slow + 0.08);
          }
        }
        if (game.wall) game.wall.hp = Math.min(game.wall.maxHp, game.wall.hp + (z.pulseHeal || 3));
        for (let i = 0; i < 5; i++) spawnSpark(z.x, z.y, "#9fdcb8", 1.0);
      }
    }
    // Storm: stun, dps, slow
    if (z.type === "storm") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.slow = Math.max(e.slow, z.slow);
          if (!e.stun || e.stun < z.stun) e.stun = z.stun;
        }
      }

      z.strikeTimer = (z.strikeTimer || 0) - dt;
      if (z.strikeTimer <= 0) {
        z.strikeTimer += z.strikeCd || 0.36;
        let target = null;
        let maxHp = 0;
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r && e.hp > maxHp) {
            maxHp = e.hp;
            target = e;
          }
        }
        if (target) {
          target.hp -= z.strikeDamage || z.dps * 0.45;
          target.stun = Math.max(target.stun || 0, z.stun * 0.7);
          for (let i = 0; i < 3; i++) {
            const t = (i + 1) / 4;
            spawnSpark(z.x + (target.x - z.x) * t, z.y + (target.y - z.y) * t, "#c9e8ff", 0.9);
          }
          for (let i = 0; i < 5; i++) spawnSpark(target.x, target.y, "#a8d2ff", 1.2);
        }
      }
    }
    // Supercharged Mist: dps, slow
    if (z.type === "chargedMist") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.slow = Math.max(e.slow, z.slow);
        }
      }
    }
    // Quicksand: dps, snare, slow
    if (z.type === "quicksand") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.slow = Math.max(e.slow, z.slow);
          if (!e.snare || e.snare < z.snare) e.snare = z.snare;

          const dx = z.x - e.x;
          const dy = z.y - e.y;
          const dist = Math.hypot(dx, dy) || 1;
          e.x += (dx / dist) * (z.pull || 36) * dt;
          e.y += (dy / dist) * (z.pull || 36) * dt;
        }
      }

      z.crushTimer = (z.crushTimer || 0) - dt;
      if (z.crushTimer <= 0) {
        z.crushTimer += z.crushCd || 0.66;
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r * 0.55 + e.r) {
            e.hp -= z.crushDamage || z.dps * 0.6;
            e.snare = Math.max(e.snare || 0, 0.55);
            spawnSpark(e.x, e.y, "#d8b466", 0.9);
          }
        }
        for (let i = 0; i < 4; i++) spawnSpark(z.x, z.y, "#b8964c", 0.8);
      }
    }

    if (z.type === "triad") {
      if (z.variant === "monsoon") {
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
            e.hp -= z.dps * dt;
            e.slow = Math.max(e.slow, z.slow);
            e.y -= z.push * dt;
          }
        }
        z.strikeTimer -= dt;
        if (z.strikeTimer <= 0) {
          z.strikeTimer += z.strikeCd;
          let target = null;
          let bestHp = 0;
          for (const e of game.enemies) {
            if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r && e.hp > bestHp) {
              bestHp = e.hp;
              target = e;
            }
          }
          if (target) {
            target.hp -= z.strikeDamage;
            for (let i = 0; i < 6; i++) spawnSpark(target.x, target.y, "#a9ecff", 1.3);
          }
        }
      } else if (z.variant === "sandglass") {
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
            e.hp -= z.dps * dt;
            e.burn = Math.max(e.burn, z.burn);
            e.snare = Math.max(e.snare || 0, z.snare);
          }
        }
        z.slashTimer -= dt;
        if (z.slashTimer <= 0) {
          z.slashTimer += z.slashCd;
          explodeAt(z.x, z.y, z.r * 0.68, z.slashDamage);
        }
      } else if (z.variant === "mudflow") {
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
            e.hp -= z.dps * dt;
            e.slow = Math.max(e.slow, z.slow);
            const dx = z.x - e.x;
            const dy = z.y - e.y;
            const dist = Math.hypot(dx, dy) || 1;
            e.x += (dx / dist) * z.pull * dt;
            e.y += (dy / dist) * z.pull * dt;
          }
        }
        z.pulseTimer -= dt;
        if (z.pulseTimer <= 0) {
          z.pulseTimer += z.pulseCd;
          explodeAt(z.x, z.y, z.r * 0.58, z.pulseDamage);
          for (let i = 0; i < 6; i++) spawnSpark(z.x, z.y, "#ffaf7f", 1.2);
        }
      } else if (z.variant === "blizzard") {
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
            e.hp -= z.dps * dt;
            e.slow = Math.max(e.slow, z.slow);
          }
        }
        z.burstTimer -= dt;
        if (z.burstTimer <= 0) {
          z.burstTimer += z.burstCd;
          for (const e of game.enemies) {
            if (Math.hypot(e.x - z.x, e.y - z.y) < z.r * 0.78 + e.r) {
              e.hp -= z.burstDamage;
              e.stun = Math.max(e.stun || 0, z.stun);
            }
          }
          for (let i = 0; i < 7; i++) spawnSpark(z.x, z.y, "#d2f5ff", 1.1);
        }
      }
    }

    if (z.type === "apex" && z.variant === "cataclysm") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.slow = Math.max(e.slow, z.slow);
          e.burn = Math.max(e.burn, z.burn);
        }
      }

      z.pulseTimer -= dt;
      if (z.pulseTimer <= 0) {
        z.pulseTimer += z.pulseCd;
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r * 0.82 + e.r) {
            e.hp -= z.pulseDamage;
            e.stun = Math.max(e.stun || 0, z.stun);
          }
        }
        explodeAt(z.x, z.y, z.r * 0.72, z.pulseDamage * 0.6);
        for (let i = 0; i < 10; i++) spawnSpark(z.x, z.y, "#e3b8ff", 1.45);
      }
    }
  }

  game.zones = game.zones.filter((z) => z.life > 0);
}

function renderDefeatUpgradeMenu() {
  for (const up of DEFEAT_UPGRADES) {
    const current = game.meta.defeatUpgrades[up.id] || 0;
    const dynamicCost = Math.round(up.cost * Math.pow(1.5, current));
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
  const summaryData = game.lastEndSummary || {
    victory: false,
    crystals: Math.floor(Math.max(0, game.runEssence)),
    baseReward: 45,
    waveReward: game.wave * 5,
    crystalReward: Math.floor(game.runEssence),
    crystalBonus: 0,
    totalGain: Math.floor(45 + game.runEssence),
    carry: getEmptyCrystalBonus(),
  };
  const isVictory = !!summaryData.victory;

  ui.defeatModalTitle.textContent = isVictory ? "Citadel Holds" : "Wall Breached";
  ui.defeatModalCards.innerHTML = "";
  ui.defeatModal.classList.add("visible");

  const essenceMul = 1 + game.meta.defeatUpgrades.essenceBoost * 0.1;
  const summary = document.createElement("div");
  summary.className = "card";
  summary.style.cursor = "default";
  const durationSec = Math.max(1, Math.floor(game.time || 0));
  const kpm = (game.kills / (durationSec / 60)).toFixed(1);
  summary.innerHTML = `
    <b>${isVictory ? "Defense held." : "Defense failed."}</b><br>
    Time survived: ${durationSec}s<br>
    Wave reached: ${game.wave}<br>
    Level reached: ${game.level}<br>
    Kills: ${game.kills} (${kpm}/min)<br>
    Crystals gathered: ${summaryData.crystals}<br>
    Crystal bonus: +${summaryData.crystalBonus} essence<br>
    Essence gained: ${Math.floor(gainOverride != null ? gainOverride : summaryData.totalGain)}<br>
    Meta essence: ${Math.floor(game.meta.totalEssence)}<br>
    Essence bonus: ${(essenceMul * 100).toFixed(0)}%<br>
    Next run bonus: ${summaryData.carry.tier > 0
      ? `+${summaryData.carry.wallHpBonus} HP, +${(summaryData.carry.damageBoostPct * 100).toFixed(1)}% damage, +${(summaryData.carry.castSpeedBoostPct * 100).toFixed(1)}% cast speed`
      : "None"}
  `;
  ui.defeatModalCards.appendChild(summary);

  // Progress line visualization with clickable milestones
  const bestWave = game.meta.bestWave;
  const progressLine = document.createElement("div");
  progressLine.className = "card";
  progressLine.style.cursor = "default";
  progressLine.style.textAlign = "center";
  
  let lineHtml = "<b>Progress</b><br><div style='font-size: 20px; letter-spacing: 2px; margin: 12px 0; user-select: none;'>";
  
  // Create progress symbols for all waves up to bestWave + 1 more tier
  const maxWaveToShow = Math.min(bestWave + BOSS_WAVE_INTERVAL, 24);
  for (let wave = 1; wave <= maxWaveToShow; wave++) {
    const isBoss = isBossWave(wave);
    const isReached = wave <= bestWave;
    const isCurrentWave = wave === game.wave;
    
    if (isBoss) {
      const tier = getBossTierFromWave(wave);
      const isLost = game.meta.lostBosses.includes(wave);
      const symbol = isReached ? (isLost ? "✕" : "✓") : "○";
      const color = isReached ? (isLost ? "#ff6b6b" : "#51cf66") : "#666";
      const fontSize = isCurrentWave ? "24px" : "18px";
      lineHtml += `<span style='font-size: ${fontSize}; color: ${color}; cursor: pointer; margin: 0 1px; display: inline-block; font-weight: bold; transition: all 0.2s;' onclick='document.dispatchEvent(new CustomEvent("startFromWave", { detail: { wave: ${wave - 1} } }))' onmouseover='this.style.fontSize="22px"; this.style.textShadow="0 0 8px ${color}";' onmouseout='this.style.fontSize="${fontSize}"; this.style.textShadow="none";' title='Boss ${tier}'>O</span>`;
    } else {
      const isLost = false; // Regular levels don't get marked as lost
      const levelNum = wave % BOSS_WAVE_INTERVAL;
      const color = isReached ? "#aaa" : "#666";
      const fontSize = isCurrentWave ? "14px" : "12px";
      lineHtml += `<span style='font-size: ${fontSize}; color: ${color}; cursor: pointer; margin: 0 1px; transition: all 0.2s;' onclick='document.dispatchEvent(new CustomEvent("startFromWave", { detail: { wave: ${wave - 1} } }))' onmouseover='this.style.fontSize="14px"; this.style.textShadow="0 0 4px ${color}";' onmouseout='this.style.fontSize="${fontSize}"; this.style.textShadow="none";' title='Level ${levelNum}'>o</span>`;
    }
  }
  
  lineHtml += "</div>";
  progressLine.innerHTML = lineHtml;
  ui.defeatModalCards.appendChild(progressLine);
  
  // Handle wave selection from progress line
  document.addEventListener("startFromWave", (e) => {
    const targetWave = e.detail.wave;
    game.targetStartWave = targetWave;
    game.mode = "hub";
    hideDefeatModal();
    
    // Determine what we're starting at
    const startingWave = targetWave + 1;
    if (isBossWave(startingWave)) {
      const tier = getBossTierFromWave(startingWave);
      feed(`Ready to attempt Boss Level ${tier}. Choose an element.`);
      setToast(`Starting at Boss Level ${tier}.`, "good");
    } else {
      const tierNum = Math.ceil(startingWave / BOSS_WAVE_INTERVAL);
      const levelInTier = startingWave % BOSS_WAVE_INTERVAL;
      feed(`Ready to begin at Level ${levelInTier}. Choose an element.`);
      setToast(`Starting at Tier ${tierNum}, Level ${levelInTier}.`, "good");
    }
    updateUi();
  }, { once: false });

  // Progression tree with boss retry options
  const tiers = getProgressionTiers();

  if (tiers.length > 0) {
    const progressionDiv = document.createElement("div");
    progressionDiv.className = "card";
    progressionDiv.style.cursor = "default";
    const tierElements = tiers.map(tier => {
      const levelLabels = tier.regularWaves.map(w => `Lv${w % BOSS_WAVE_INTERVAL}`).join(" → ");
      const bossLabel = `Boss ${tier.tier}`;
      const isReached = tier.isReached;
      const isLost = tier.isLost;
      const status = !isReached ? "⊘" : isLost ? "✕" : "✓";
      const color = !isReached ? "#666" : isLost ? "#ff6b6b" : "#51cf66";
      return `<div style="margin: 8px 0; padding: 8px; border-left: 4px solid ${color}; background: rgba(255,255,255,0.02); color: ${color}; font-size: 13px;">
                <b>Tier ${tier.tier}:</b> ${levelLabels} → <b>${bossLabel}</b> ${status}
              </div>`;
    }).join("");
    progressionDiv.innerHTML = `<b>Progression Tree</b>${tierElements}`;
    ui.defeatModalCards.appendChild(progressionDiv);
  }

  // Retry boss buttons for lost bosses
  const lostBosses = game.meta.lostBosses || [];
  if (lostBosses.length > 0) {
    const retryTitle = document.createElement("div");
    retryTitle.className = "card";
    retryTitle.style.cursor = "default";
    retryTitle.innerHTML = "<b>Retry Boss Challenges</b>";
    ui.defeatModalCards.appendChild(retryTitle);
    
    lostBosses.forEach(bossWave => {
      const tier = getBossTierFromWave(bossWave);
      const retryBtn = document.createElement("button");
      retryBtn.className = "card";
      retryBtn.innerHTML = `<b>Retry Boss Level ${tier}</b><br>Start from before this boss challenge.`;
      retryBtn.style.background = "#c92a2a";
      retryBtn.style.color = "white";
      retryBtn.onclick = () => {
        game.retryingBossWave = bossWave;
        game.mode = "hub";
        hideDefeatModal();
        feed(`Ready to retry Boss Level ${tier}. Choose an element.`);
        setToast(`Retrying Boss Level ${tier}.`, "good");
        updateUi();
      };
      ui.defeatModalCards.appendChild(retryBtn);
    });
  }

  const restartRun = document.createElement("button");
  restartRun.className = "card";
  restartRun.innerHTML = `<b>Restart Run</b><br>Jump back to element select and start again.`;
  restartRun.onclick = () => {
    hideDefeatModal();
    game.mode = "hub";
    feed("Choose an element on the canvas to begin.");
    setToast("Ready for a new run.", "good");
    updateUi();
  };
  ui.defeatModalCards.appendChild(restartRun);

  const closeScreen = document.createElement("button");
  closeScreen.className = "card";
  closeScreen.innerHTML = `<b>Close End Screen</b><br>Stay here and manage upgrades.`;
  closeScreen.onclick = () => {
    hideDefeatModal();
    game.mode = "hub";
    feed("Choose an element on the canvas to begin.");
    updateUi();
  };
  ui.defeatModalCards.appendChild(closeScreen);

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
  
  // Display wave info with tier/boss structure
  let waveDisplay = `Wave ${game.wave} / ${MAX_WAVES}`;
  if (game.wave > 0 && game.mode === "running") {
    if (isBossWave(game.wave)) {
      const bossTier = getBossTierFromWave(game.wave);
      waveDisplay = `Boss Level ${bossTier}`;
    } else {
      const bossTier = Math.ceil(game.wave / BOSS_WAVE_INTERVAL);
      const levelInTier = game.wave % BOSS_WAVE_INTERVAL;
      waveDisplay = `Tier ${bossTier}, Level ${levelInTier}/5`;
    }
  }
  
  ui.room.textContent = `${waveDisplay} (Lv ${game.level})`;

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
  if (game.bossPrep) {
    ui.modifier.textContent = `Boss in ${Math.max(0, Math.ceil(game.bossPrepTimer))}s | XP ${Math.floor(game.xp)} / ${Math.floor(game.xpToNext)}`;
  } else {
    ui.modifier.textContent = `XP ${Math.floor(game.xp)} / ${Math.floor(game.xpToNext)}`;
  }
  ui.character.textContent = "Sentinel (Stationary)";

  ui.runShards.textContent = Math.floor(game.runEssence);
  ui.metaShards.textContent = `${game.meta.totalEssence} (Best Wave ${game.meta.bestWave})`;
}

function render() {
  if (game.mode === "hub") {
    drawStartScreen();
    return;
  }
  drawBackground();
  drawXpHud();
  drawWall();
  drawHero();
  drawZones();
  drawProjectiles();
  drawEnemies();
  drawSparks();
  drawPowerBar();
  drawBossCountdown();
}

function drawBossCountdown() {
  if (!game.bossPrep) return;
  const secs = Math.max(0, Math.ceil(game.bossPrepTimer));
  ctx.fillStyle = "rgba(120, 20, 30, 0.4)";
  ctx.fillRect(WIDTH * 0.5 - 138, 72, 276, 34);
  ctx.strokeStyle = "rgba(255, 150, 160, 0.7)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(WIDTH * 0.5 - 138, 72, 276, 34);
  ctx.fillStyle = "#ffd0d6";
  ctx.font = "bold 15px Trebuchet MS";
  ctx.textAlign = "center";
  ctx.fillText(`Boss incoming: ${secs}s`, WIDTH * 0.5, 94);
  ctx.textAlign = "left";
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
  } else if (game.powers && game.powers.fire && game.powers.fire.unlocked && game.powers.earth && game.powers.earth.unlocked && !game.magmaUnlocked) {
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
      const heat = 0.78 + Math.sin(game.time * 7) * 0.18;
      ctx.fillStyle = `rgba(255, 95, 60, ${0.24 + heat * 0.12})`;
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(255, 140, 90, 0.75)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 196, 120, ${0.24 + heat * 0.28})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r * 0.58 + Math.sin(game.time * 5.4) * 3, 0, Math.PI * 2);
      ctx.stroke();
    } else if (z.type === "mist") {
      const swirl = Math.sin(game.time * 4.5);
      ctx.fillStyle = `rgba(160, 220, 190, ${0.14 + (swirl + 1) * 0.03})`;
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(160, 220, 190, 0.55)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "rgba(160, 220, 190, 0.25)";
      circle(z.x + swirl * 6, z.y - swirl * 3, z.r * 0.42);
      ctx.fillStyle = "rgba(178, 240, 210, 0.16)";
      circle(z.x - swirl * 5, z.y + swirl * 4, z.r * 0.3);
    } else if (z.type === "storm") {
      const pulse = (Math.sin(game.time * 8) * 0.12 + 0.88);
      ctx.fillStyle = `rgba(120, 180, 255, ${0.18 * pulse})`;
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = `rgba(130, 190, 255, ${0.65 * pulse})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = `rgba(200, 230, 255, ${0.35 * pulse})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      drawZigZagLine(z.x - z.r * 0.45, z.y - z.r * 0.2, z.x + z.r * 0.45, z.y + z.r * 0.2, "rgba(205,232,255,0.55)", 1.2);
    } else if (z.type === "quicksand") {
      ctx.fillStyle = "rgba(180, 150, 80, 0.22)";
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(200, 165, 90, 0.55)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.strokeStyle = "rgba(200, 165, 90, 0.25)";
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.r * 0.5 + Math.sin(game.time * 3) * 4, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const a = game.time * 1.6 + i * 2.09;
        const rr = z.r * (0.33 + i * 0.16);
        ctx.fillStyle = "rgba(216, 186, 120, 0.24)";
        circle(z.x + Math.cos(a) * rr * 0.35, z.y + Math.sin(a) * rr * 0.35, 2 + i);
      }
    } else if (z.type === "triad" && z.variant === "monsoon") {
      const pulse = 0.75 + Math.sin(game.time * 9) * 0.2;
      ctx.fillStyle = `rgba(115, 215, 255, ${0.18 * pulse})`;
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(170, 240, 255, 0.68)";
      ctx.lineWidth = 2;
      ctx.stroke();
      drawZigZagLine(z.x - z.r * 0.5, z.y, z.x + z.r * 0.5, z.y, "rgba(210, 250, 255, 0.55)", 1.5);
    } else if (z.type === "triad" && z.variant === "sandglass") {
      const spin = game.time * 2.6;
      ctx.fillStyle = "rgba(255, 205, 125, 0.2)";
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(255, 176, 110, 0.62)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const a = spin + i * (Math.PI * 0.5);
        drawZigZagLine(z.x, z.y, z.x + Math.cos(a) * z.r * 0.72, z.y + Math.sin(a) * z.r * 0.72, "rgba(255, 145, 95, 0.62)", 1.2);
      }
    } else if (z.type === "triad" && z.variant === "mudflow") {
      const wobble = Math.sin(game.time * 5.5) * 0.18;
      ctx.fillStyle = `rgba(208, 122, 86, ${0.22 + wobble * 0.08})`;
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(255, 182, 130, 0.55)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "rgba(120, 80, 58, 0.18)";
      circle(z.x + 4, z.y - 3, z.r * 0.52);
    } else if (z.type === "triad" && z.variant === "blizzard") {
      const chill = 0.75 + Math.sin(game.time * 7.2) * 0.15;
      ctx.fillStyle = `rgba(180, 235, 255, ${0.2 * chill})`;
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(220, 248, 255, 0.74)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = i * (Math.PI / 3) + game.time * 0.7;
        drawZigZagLine(z.x, z.y, z.x + Math.cos(a) * z.r * 0.62, z.y + Math.sin(a) * z.r * 0.62, "rgba(215,245,255,0.45)", 1);
      }
    } else if (z.type === "apex" && z.variant === "cataclysm") {
      const pulse = 0.78 + Math.sin(game.time * 10.5) * 0.2;
      ctx.fillStyle = `rgba(226, 170, 255, ${0.2 * pulse})`;
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(248, 216, 255, 0.78)";
      ctx.lineWidth = 2.2;
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = i * (Math.PI / 4) + game.time * 1.1;
        drawZigZagLine(z.x, z.y, z.x + Math.cos(a) * z.r * 0.7, z.y + Math.sin(a) * z.r * 0.7, "rgba(255, 228, 255, 0.55)", 1.2);
      }
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

function getSynergyStateTag(key) {
  if (key === "mist") return "PULSE+HEAL";
  if (key === "storm") return "STRIKE";
  if (key === "chain") return "FORK";
  if (key === "quicksand") return "PULL+CRUSH";
  if (key === "magma") return "ERUPT";
  if (key === "monsoon") return "GALE+SURGE";
  if (key === "sandglass") return "SEAR+SNARE";
  if (key === "mudflow") return "PULL+BURST";
  if (key === "blizzard") return "FREEZE+SHOCK";
  if (key === "cataclysm") return "APEX";
  return "";
}

function getSynergyTagColors(key) {
  if (key === "mist") return { bg: "rgba(130, 220, 176, 0.2)", line: "rgba(160, 250, 205, 0.6)", text: "#b9ffe0" };
  if (key === "storm") return { bg: "rgba(120, 170, 255, 0.2)", line: "rgba(170, 210, 255, 0.65)", text: "#d8ecff" };
  if (key === "chain") return { bg: "rgba(160, 210, 255, 0.2)", line: "rgba(195, 235, 255, 0.65)", text: "#e2f6ff" };
  if (key === "quicksand") return { bg: "rgba(200, 165, 95, 0.24)", line: "rgba(230, 200, 130, 0.65)", text: "#ffe6b8" };
  if (key === "magma") return { bg: "rgba(255, 120, 80, 0.22)", line: "rgba(255, 170, 130, 0.68)", text: "#ffd2bf" };
  if (key === "monsoon") return { bg: "rgba(112, 214, 255, 0.24)", line: "rgba(177, 240, 255, 0.7)", text: "#d2f6ff" };
  if (key === "sandglass") return { bg: "rgba(255, 186, 122, 0.24)", line: "rgba(255, 221, 168, 0.7)", text: "#ffe8c8" };
  if (key === "mudflow") return { bg: "rgba(217, 134, 95, 0.24)", line: "rgba(252, 184, 148, 0.68)", text: "#ffe0d1" };
  if (key === "blizzard") return { bg: "rgba(170, 225, 255, 0.24)", line: "rgba(220, 247, 255, 0.75)", text: "#ecfaff" };
  if (key === "cataclysm") return { bg: "rgba(222, 168, 255, 0.28)", line: "rgba(244, 218, 255, 0.82)", text: "#fff2ff" };
  return { bg: "rgba(122, 232, 216, 0.16)", line: "rgba(122, 232, 216, 0.55)", text: "#9ef3e7" };
}

function drawPowerBar() {
  if (!game.powers) return;
  powerBarBoxes = [];

  const fusion = getActiveFusionState();
  const consumed = fusion.consumed;
  const activeComboKeys = fusion.activeComboKeys;
  const sourcesByKey = fusion.sourcesByKey;

  // Build display list: base powers not consumed + active combos
  const displayKeys = [];
  for (const k of basePowerOrder) displayKeys.push(k); // always show all base
  for (const k of activeComboKeys) displayKeys.push(k);
  if (game.magmaUnlocked && game.powers.magma && game.powers.magma.unlocked && !activeComboKeys.includes("magma"))
    displayKeys.push("magma");

  // Merge hints for base skills (only when partner is also unlocked but not yet level 3)
  const mergeHints = {};
  for (const def of COMBO_DEFS) {
    const pa = game.powers[def.a], pb = game.powers[def.b];
    if (pa && pb && pa.unlocked && pb.unlocked && (pa.level < def.minLevel || pb.level < def.minLevel)) {
      const hint = `→${capitalize(def.key)}@Lv${def.minLevel}`;
      if (!mergeHints[def.a]) mergeHints[def.a] = hint;
      if (!mergeHints[def.b]) mergeHints[def.b] = hint;
    }
  }
  for (const def of TRIPLE_COMBO_DEFS) {
    const pa = game.powers[def.a], pb = game.powers[def.b], pc = game.powers[def.c];
    if (pa && pb && pc && pa.unlocked && pb.unlocked && pc.unlocked &&
        (pa.level < def.minLevel || pb.level < def.minLevel || pc.level < def.minLevel)) {
      const hint = `→${capitalize(def.key)}@Lv${def.minLevel}`;
      if (!mergeHints[def.a]) mergeHints[def.a] = hint;
      if (!mergeHints[def.b]) mergeHints[def.b] = hint;
      if (!mergeHints[def.c]) mergeHints[def.c] = hint;
    }
  }
  {
    const def = QUAD_COMBO_DEF;
    const pa = game.powers[def.a], pb = game.powers[def.b], pc = game.powers[def.c], pd = game.powers[def.d];
    if (pa && pb && pc && pd && pa.unlocked && pb.unlocked && pc.unlocked && pd.unlocked &&
        (pa.level < def.minLevel || pb.level < def.minLevel || pc.level < def.minLevel || pd.level < def.minLevel)) {
      const hint = `→${capitalize(def.key)}@Lv${def.minLevel}`;
      if (!mergeHints[def.a]) mergeHints[def.a] = hint;
      if (!mergeHints[def.b]) mergeHints[def.b] = hint;
      if (!mergeHints[def.c]) mergeHints[def.c] = hint;
      if (!mergeHints[def.d]) mergeHints[def.d] = hint;
    }
  }

  const BOX_W = 120, BOX_H = 46, GAP = 6;
  const totalW = displayKeys.length * BOX_W + (displayKeys.length - 1) * GAP;
  let x = WIDTH * 0.5 - totalW * 0.5;
  const y = HEIGHT - 56;

  for (const key of displayKeys) {
    const p = game.powers[key];
    if (!p) { x += BOX_W + GAP; continue; }

    const comboSources = sourcesByKey[key] || null;
    const isCombo = !!comboSources;
    const isConsumed = consumed.has(key);
    const isActive = (isCombo && activeComboKeys.includes(key)) ||
                     (!isCombo && p.unlocked && !isConsumed && (key !== "magma" || game.magmaUnlocked));

    // Combo level = avg of component levels; base level = p.level
    let displayLevel = p.level;
    if (comboSources && comboSources.length > 0) {
      let total = 0;
      for (const sourceKey of comboSources) total += (game.powers[sourceKey] && game.powers[sourceKey].level) || 1;
      displayLevel = Math.floor(total / comboSources.length);
    }

    // Box
    ctx.fillStyle = isActive && isCombo ? "#14202e" : isActive ? "#2a251a" : isConsumed ? "#181e26" : "#1d222d";
    ctx.fillRect(x, y, BOX_W, BOX_H);
    ctx.lineWidth = isActive && isCombo ? 2 : 1;
    ctx.strokeStyle = isActive && isCombo ? "#7ae8d8"
      : isActive ? "#ffd285"
      : isConsumed ? "#7ae8d855"
      : "#41506a";
    ctx.strokeRect(x, y, BOX_W, BOX_H);

    if (game.selectedCastKey === key && p.unlocked) {
      ctx.strokeStyle = "#7ee89f";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, BOX_W - 2, BOX_H - 2);
    }

    // Name + Level
    ctx.fillStyle = isConsumed ? "#7ae8d888" : isActive ? p.color : "#6f7a8a";
    ctx.font = "bold 11px Trebuchet MS";
    const lvSuffix = isActive ? ` Lv.${displayLevel}` : p.unlocked ? ` Lv.${displayLevel}` : " Locked";
    ctx.fillText(p.name + lvSuffix, x + 6, y + 14);

    // Sub-line: combo source pair OR merge hint OR consumed-into label
    ctx.font = "9px Trebuchet MS";
    if (isCombo && isActive && comboSources) {
      ctx.fillStyle = "#7ae8d8";
      ctx.fillText(comboSources.map(capitalize).join("+"), x + 6, y + 26);
    } else if (isConsumed) {
      const comboName = activeComboKeys.find(ck => {
        const src = sourcesByKey[ck] || [];
        return src.includes(key);
      }) || null;
      ctx.fillStyle = "#7ae8d866";
      ctx.fillText(comboName ? `→${capitalize(comboName)}` : "merged", x + 6, y + 26);
    } else if (!isCombo && mergeHints[key]) {
      ctx.fillStyle = "#ffa040";
      ctx.fillText(mergeHints[key], x + 6, y + 26);
    }

    if (isCombo && isActive) {
      const tag = getSynergyStateTag(key);
      if (tag) {
        const tagColors = getSynergyTagColors(key);
        const tagW = Math.min(58, 8 + tag.length * 4);
        ctx.fillStyle = tagColors.bg;
        ctx.fillRect(x + BOX_W - tagW - 5, y + 3, tagW, 10);
        ctx.strokeStyle = tagColors.line;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + BOX_W - tagW - 5, y + 3, tagW, 10);
        ctx.fillStyle = tagColors.text;
        ctx.font = "bold 7px Trebuchet MS";
        ctx.fillText(tag, x + BOX_W - tagW + 0, y + 10);
      }
    }

    // CD bar
    const cooldownRef = isCombo ? game.powers[key].cd : p.cd;
    const cdRatio = isActive && cooldownRef > 0
      ? 1 - game.powers[key].timer / (cooldownRef * (game.cooldownMul || 1)) : 0;
    ctx.fillStyle = "#112031";
    ctx.fillRect(x + 6, y + 32, BOX_W - 12, 7);
    ctx.fillStyle = !isActive ? "#4d5766" : game.powers[key].timer <= 0 ? "#7ee89f" : "#8cb7ff";
    ctx.fillRect(x + 6, y + 32, (BOX_W - 12) * Math.max(0, Math.min(1, cdRatio)), 7);

    powerBarBoxes.push({
      key,
      label: p.name,
      x,
      y,
      w: BOX_W,
      h: BOX_H,
      active: isActive,
      selectable: !!p.unlocked,
    });

    x += BOX_W + GAP;
  }
}

function spawnSpark(x, y, color, mult) {
  if (game.sparks.length >= MAX_SPARKS) return;
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
    lostBosses: [], // Array of boss wave numbers where player was defeated
    defeatUpgrades: { wallTech: 0, xpBoost: 0, essenceBoost: 0, damageBoost: 0, castSpeedBoost: 0 },
  };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      totalEssence: parsed.totalEssence || 0,
      bestWave: parsed.bestWave || 0,
      lostBosses: parsed.lostBosses || [],
      defeatUpgrades: {
        wallTech: (parsed.defeatUpgrades && parsed.defeatUpgrades.wallTech) || 0,
        xpBoost: (parsed.defeatUpgrades && parsed.defeatUpgrades.xpBoost) || 0,
        essenceBoost: (parsed.defeatUpgrades && parsed.defeatUpgrades.essenceBoost) || 0,
        damageBoost: (parsed.defeatUpgrades && parsed.defeatUpgrades.damageBoost) || 0,
        castSpeedBoost: (parsed.defeatUpgrades && parsed.defeatUpgrades.castSpeedBoost) || 0,
      },
    };
  } catch (err) {
    void err;
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
