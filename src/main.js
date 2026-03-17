
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
const MAX_CAST_PULSES = 48;
const AMBIENT_MOTE_COUNT = 56;
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

const powerOrder = ["fire", "earth", "water", "wind", "nature"];
const basePowerOrder = ["arc", ...powerOrder];

// Elemental combo definitions — priority order matters; first entry wins on overlapping skills.
// magma is unlock-gated via upgrade card and handled separately.
const COMBO_DEFS = [
  { key: "chain",     a: "arc",   b: "wind",  minLevel: 3 },
  { key: "plasma",    a: "arc",   b: "fire",  minLevel: 3 },
  { key: "riptide",   a: "arc",   b: "water", minLevel: 3 },
  { key: "mist",      a: "fire",  b: "water", minLevel: 3 },
  { key: "storm",     a: "water", b: "wind",  minLevel: 3 },
  { key: "quicksand", a: "earth", b: "water", minLevel: 3 },
  { key: "overgrowth", a: "arc",    b: "nature", minLevel: 3 },
  { key: "wildfire",   a: "fire",   b: "nature", minLevel: 3 },
  { key: "dustbloom",  a: "earth",  b: "nature", minLevel: 3 },
  { key: "bloomtide",  a: "water",  b: "nature", minLevel: 3 },
  { key: "pollenstorm", a: "wind",  b: "nature", minLevel: 3 },
  { key: "lodestone",   a: "arc",   b: "earth",  minLevel: 3 },
  { key: "sirocco",     a: "fire",  b: "wind",   minLevel: 3 },
  { key: "dustdevil",   a: "earth", b: "wind",   minLevel: 3 },
];

// Triple fusions take priority over pair fusions.
const TRIPLE_COMBO_DEFS = [
  { key: "monsoon",  a: "fire",  b: "water", c: "wind",  minLevel: 3 },
  { key: "sandglass", a: "fire",  b: "earth", c: "wind",  minLevel: 3 },
  { key: "mudflow",  a: "fire",  b: "earth", c: "water", minLevel: 3 },
  { key: "blizzard", a: "earth", b: "water", c: "wind",  minLevel: 3 },
  { key: "thornforge", a: "fire", b: "earth", c: "nature", minLevel: 3 },
  { key: "canopy", a: "earth", b: "water", c: "nature", minLevel: 3 },
  { key: "briarstorm", a: "water", b: "wind", c: "nature", minLevel: 3 },
  { key: "sunbloom", a: "fire", b: "wind", c: "nature", minLevel: 3 },
];

const APEX_COMBO_DEFS = [
  { key: "cataclysm", a: "fire", b: "earth", c: "water", d: "wind", minLevel: 3 },
  { key: "worldroot", a: "earth", b: "water", c: "wind", d: "nature", minLevel: 3 },
];

function getApexDef(key) {
  return APEX_COMBO_DEFS.find((def) => def.key === key) || null;
}

function makeFusionUnlockMap(defs) {
  const map = {};
  for (const def of defs) map[def.key] = false;
  return map;
}

function getActiveFusionState() {
  const consumed = new Set();
  const activeComboKeys = [];
  const sourcesByKey = {};

  for (const def of APEX_COMBO_DEFS) {
    const unlocked = game.apexFusionUnlocked && game.apexFusionUnlocked[def.key];
    const pa = game.powers && game.powers[def.a];
    const pb = game.powers && game.powers[def.b];
    const pc = game.powers && game.powers[def.c];
    const pd = game.powers && game.powers[def.d];
    if (!unlocked) continue;
    if (consumed.has(def.a) || consumed.has(def.b) || consumed.has(def.c) || consumed.has(def.d)) continue;
    if (pa && pb && pc && pd && pa.unlocked && pb.unlocked && pc.unlocked && pd.unlocked &&
        pa.level >= def.minLevel && pb.level >= def.minLevel && pc.level >= def.minLevel && pd.level >= def.minLevel) {
      activeComboKeys.push(def.key);
      sourcesByKey[def.key] = [def.a, def.b, def.c, def.d];
      consumed.add(def.a);
      consumed.add(def.b);
      consumed.add(def.c);
      consumed.add(def.d);
    }
  }

  for (const def of TRIPLE_COMBO_DEFS) {
    const unlocked = game.tripleFusionUnlocked && game.tripleFusionUnlocked[def.key];
    if (!unlocked) continue;
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
    const unlocked = game.pairFusionUnlocked && game.pairFusionUnlocked[def.key];
    if (!unlocked) continue;
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

function getApexConvergenceOptions(fusion) {
  const srcMap = (fusion && fusion.sourcesByKey) || {};
  const pairKeys = Object.keys(srcMap).filter((k) => {
    const src = srcMap[k] || [];
    return src.length === 2;
  });

  const out = [];

  for (const def of APEX_COMBO_DEFS) {
    if (game.apexFusionUnlocked && game.apexFusionUnlocked[def.key]) continue;
    for (let i = 0; i < pairKeys.length; i++) {
      for (let j = i + 1; j < pairKeys.length; j++) {
        const a = srcMap[pairKeys[i]] || [];
        const b = srcMap[pairKeys[j]] || [];
        const union = new Set([...a, ...b]);
        if (union.size !== 4) continue;
        const ok = [def.a, def.b, def.c, def.d].every((k) => union.has(k));
        if (ok) {
          out.push({ def, sources: [...union] });
          i = pairKeys.length;
          break;
        }
      }
    }
  }

  return out;
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
  pairFusionUnlocked: makeFusionUnlockMap(COMBO_DEFS),
  tripleFusionUnlocked: makeFusionUnlockMap(TRIPLE_COMBO_DEFS),
  upgradeChoices: [],
  preferredElements: [],
  unlockChainFocus: [],
  unlockChainStacks: 0,
  pendingCrystalBonus: null,
  lastEndSummary: null,
  retryingBossWave: null,
  targetStartWave: null, // For jumping to any wave (regular or boss)
  selectedCastKey: null,
  apexFusionUnlocked: makeFusionUnlockMap(APEX_COMBO_DEFS),
  screenShake: 0,
  screenShakeMag: 0,
  castPulses: [],
  ambientMotes: [],
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
  const choices = ["arc", "fire", "earth", "water", "wind", "nature"].map((key) => ({
    key,
    name: `Start with ${capitalize(key === "arc" ? "arc bolt" : key)}`,
    desc: `${getStartingPowerDesc(key)} ${getElementComboHint(key)}`,
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
    "popup=yes,width=1280,height=960,resizable=yes,scrollbars=no"
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
  game.castPulses = [];
  game.ambientMotes = [];
  game.kills = 0;
  game.runEssence = 0;
  game.globalDamageMul = (1 + game.meta.defeatUpgrades.damageBoost * 0.1) * (1 + carry.damageBoostPct);
  game.cooldownMul = (1 / (1 + game.meta.defeatUpgrades.castSpeedBoost * 0.08)) / (1 + carry.castSpeedBoostPct);
  game.magmaUnlocked = false;
  game.pairFusionUnlocked = makeFusionUnlockMap(COMBO_DEFS);
  game.tripleFusionUnlocked = makeFusionUnlockMap(TRIPLE_COMBO_DEFS);
  game.unlockChainFocus = [];
  game.unlockChainStacks = 0;
  game.bossPrep = false;
  game.bossPrepTimer = 0;
  game.bossSpawnedThisWave = false;
  game.level = 0;
  game.xp = 0;
  game.pendingLevelChoices = 0;
  game.xpToNext = getXpForNextLevel(game.level);
  game.time = 0;
  game.selectedCastKey = null;
  game.apexFusionUnlocked = makeFusionUnlockMap(APEX_COMBO_DEFS);
  game.screenShake = 0;
  game.screenShakeMag = 0;

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

  game.powers = createInitialPowers();

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
    hitFlash: 0,
    critFlash: 0,
    lastRenderHp: 0,
    burn: 0, slow: 0, stun: 0, snare: 0,
  });
  game.bossSpawnedThisWave = true;
  spawnCastPulse(WIDTH * 0.5, 54, "rgba(255, 170, 196, 0.95)", 120, 0.46);
  triggerScreenShake(0.15, 3.6);
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
  game.screenShake = Math.max(0, game.screenShake - dt);
  updateCastPulses(dt);
  updateAmbientMotes(dt);

  for (const key of ["arc", "fire", "earth", "water", "wind", "nature", "magma", "mist", "storm", "chain", "plasma", "riptide", "quicksand", "overgrowth", "wildfire", "dustbloom", "bloomtide", "pollenstorm", "monsoon", "sandglass", "mudflow", "blizzard", "thornforge", "canopy", "briarstorm", "sunbloom", "cataclysm", "worldroot"]) {
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
          hitFlash: 0,
          critFlash: 0,
          lastRenderHp: 0,
          prevX: 0,
          prevY: 0,
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
          hitFlash: 0,
          critFlash: 0,
          lastRenderHp: 0,
          prevX: 0,
          prevY: 0,
          stompTimer: 0.2 + Math.random() * 0.16,
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
          hitFlash: 0,
          critFlash: 0,
          lastRenderHp: 0,
          prevX: 0,
          prevY: 0,
          burn: 0, slow: 0, stun: 0, snare: 0,
        };

  enemy.prevX = enemy.x;
  enemy.prevY = enemy.y;

  game.enemies.push(enemy);
}

function updateEnemies(dt) {
  for (const e of game.enemies) {
    const prevX = e.x;
    const prevY = e.y;
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

      if (e.type === "runner" && !stunned && Math.random() < dt * 14) {
        spawnSpark(e.x, e.y + e.r * 0.3, "#bceeff", 0.55);
      }

      if (e.type === "brute" && !stunned && slowMul > 0.2) {
        e.stompTimer = (e.stompTimer || 0.26) - dt;
        if (e.stompTimer <= 0) {
          e.stompTimer = 0.24 + Math.random() * 0.16;
          for (let i = 0; i < 3; i++) {
            spawnSpark(e.x + (Math.random() - 0.5) * e.r * 0.9, e.y + e.r * 0.85, "#c9a180", 0.78);
          }
        }
      }
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
    e.prevX = prevX;
    e.prevY = prevY;
    e.hitFlash = Math.max(0, (e.hitFlash || 0) - dt * 4.8);
    e.critFlash = Math.max(0, (e.critFlash || 0) - dt * 5.4);
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

    if (z.type === "briar") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.slow = Math.max(e.slow, z.slow);
          e.snare = Math.max(e.snare || 0, z.snare);
        }
      }
      z.pulseTimer = (z.pulseTimer || 0) - dt;
      if (z.pulseTimer <= 0) {
        z.pulseTimer += z.pulseCd || 0.48;
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r * 0.7 + e.r) {
            e.hp -= z.pulseDamage || z.dps * 0.45;
            e.snare = Math.max(e.snare || 0, z.snare + 0.08);
          }
        }
        for (let i = 0; i < 4; i++) spawnSpark(z.x, z.y, "#a6e087", 0.9);
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

function triggerScreenShake(duration, magnitude) {
  game.screenShake = Math.max(game.screenShake || 0, duration);
  game.screenShakeMag = Math.max(game.screenShakeMag || 0, magnitude);
}

function spawnCastPulse(x, y, color, radius, life = 0.32) {
  if (!Array.isArray(game.castPulses)) game.castPulses = [];
  if (game.castPulses.length >= MAX_CAST_PULSES) game.castPulses.shift();
  game.castPulses.push({ x, y, color, radius, life, maxLife: life });
}

function updateCastPulses(dt) {
  if (!Array.isArray(game.castPulses)) game.castPulses = [];
  for (const p of game.castPulses) p.life -= dt;
  game.castPulses = game.castPulses.filter((p) => p.life > 0);
}

function ensureAmbientMotes() {
  if (!Array.isArray(game.ambientMotes)) game.ambientMotes = [];
  if (game.ambientMotes.length >= AMBIENT_MOTE_COUNT) return;
  for (let i = game.ambientMotes.length; i < AMBIENT_MOTE_COUNT; i++) {
    game.ambientMotes.push({
      x: Math.random() * WIDTH,
      y: Math.random() * HEIGHT,
      z: 0.45 + Math.random() * 1.1,
      vx: -8 + Math.random() * 16,
      vy: 6 + Math.random() * 18,
      r: 1 + Math.random() * 2.2,
      hue: Math.random() > 0.5 ? "255,168,120" : "126,188,255",
    });
  }
}

function updateAmbientMotes(dt) {
  ensureAmbientMotes();
  for (const m of game.ambientMotes) {
    m.x += m.vx * m.z * dt;
    m.y += m.vy * m.z * dt;
    if (m.y > HEIGHT + 24) {
      m.y = -16;
      m.x = Math.random() * WIDTH;
    }
    if (m.x < -20) m.x = WIDTH + 10;
    if (m.x > WIDTH + 20) m.x = -10;
  }
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
    nature: 1.7,
    magma: 2.25,
    mist: 1.75,
    storm: 1.85,
    chain: 0.9,
    plasma: 1.7,
    riptide: 1.75,
    quicksand: 2.0,
    overgrowth: 1.85,
    wildfire: 2.0,
    dustbloom: 2.05,
    bloomtide: 1.9,
    pollenstorm: 1.95,
    lodestone: 1.88,
    sirocco: 1.92,
    dustdevil: 1.95,
    monsoon: 2.25,
    sandglass: 2.35,
    mudflow: 2.4,
    blizzard: 2.3,
    thornforge: 2.3,
    canopy: 2.25,
    briarstorm: 2.25,
    sunbloom: 2.2,
    cataclysm: 2.8,
    worldroot: 2.75,
  };
  const maxCd = maxByPower[powerKey] || 1.8;
  return Math.max(0.16, Math.min(maxCd, baseCd * game.cooldownMul));
}

function tryCastPower(key, tx, ty, angleOffset = 0) {
  const aimed = getOffsetTarget(tx, ty, angleOffset);

  const apexDef = getApexDef(key);
  if (apexDef) {
    const cp = game.powers[key];
    if (!cp || cp.timer > 0) return false;
    cp.timer = getCappedCastTimer(key, cp.cd);
    const lv = [apexDef.a, apexDef.b, apexDef.c, apexDef.d].reduce((sum, k) => sum + ((game.powers[k] && game.powers[k].level) || 1), 0) / 4;
    if (game.zones.length >= MAX_ZONES) game.zones.shift();
    if (key === "cataclysm") {
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
      spawnCastPulse(aimed.x, aimed.y, "rgba(233, 185, 255, 0.95)", 124, 0.44);
      triggerScreenShake(0.18, 4.6);
    } else if (key === "worldroot") {
      game.zones.push({
        type: "apex",
        variant: "worldroot",
        x: aimed.x,
        y: aimed.y,
        r: 92 + lv * 12,
        dps: (24 + lv * 6.2) * game.globalDamageMul,
        pulseCd: 0.34,
        pulseTimer: 0.34,
        pulseDamage: (20 + lv * 5.6) * game.globalDamageMul,
        slow: 0.72,
        snare: 0.7 + lv * 0.06,
        healPulse: 3 + lv * 0.8,
        pull: 46 + lv * 5,
        life: 2.95,
      });
      spawnCastPulse(aimed.x, aimed.y, "rgba(210, 255, 186, 0.94)", 118, 0.44);
      triggerScreenShake(0.16, 4.1);
    }
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
      spawnCastPulse(aimed.x, aimed.y, "rgba(166, 235, 255, 0.88)", 94, 0.36);
      triggerScreenShake(0.09, 2.1);
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
      spawnCastPulse(aimed.x, aimed.y, "rgba(255, 207, 148, 0.88)", 88, 0.35);
      triggerScreenShake(0.1, 2.25);
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
      spawnCastPulse(aimed.x, aimed.y, "rgba(245, 164, 124, 0.85)", 92, 0.36);
      triggerScreenShake(0.1, 2.2);
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
      spawnCastPulse(aimed.x, aimed.y, "rgba(197, 236, 255, 0.9)", 92, 0.36);
      triggerScreenShake(0.1, 2.2);
    } else if (key === "thornforge") {
      game.zones.push({
        type: "triad",
        variant: "thornforge",
        x: aimed.x, y: aimed.y,
        r: 82 + lAvg * 10,
        dps: (24 + lAvg * 5.8) * game.globalDamageMul,
        burn: 0.8 + lAvg * 0.08,
        snare: 0.95 + lAvg * 0.06,
        pulseCd: 0.42,
        pulseTimer: 0.42,
        pulseDamage: (18 + lAvg * 4.8) * game.globalDamageMul,
        life: 2.35,
      });
      spawnCastPulse(aimed.x, aimed.y, "rgba(255, 188, 142, 0.88)", 92, 0.36);
      triggerScreenShake(0.1, 2.2);
    } else if (key === "canopy") {
      game.zones.push({
        type: "triad",
        variant: "canopy",
        x: aimed.x, y: aimed.y,
        r: 88 + lAvg * 10,
        dps: (20 + lAvg * 5.2) * game.globalDamageMul,
        slow: 0.62,
        snare: 0.86 + lAvg * 0.06,
        pulseCd: 0.38,
        pulseTimer: 0.38,
        pulseDamage: (14 + lAvg * 4.3) * game.globalDamageMul,
        healPulse: 2.8 + lAvg * 0.75,
        life: 2.4,
      });
      spawnCastPulse(aimed.x, aimed.y, "rgba(178, 240, 204, 0.88)", 94, 0.36);
      triggerScreenShake(0.09, 2.05);
    } else if (key === "briarstorm") {
      game.zones.push({
        type: "triad",
        variant: "briarstorm",
        x: aimed.x, y: aimed.y,
        r: 86 + lAvg * 10,
        dps: (21 + lAvg * 5.4) * game.globalDamageMul,
        slow: 0.7,
        push: 48 + lAvg * 6,
        strikeCd: 0.32,
        strikeTimer: 0.32,
        strikeDamage: (16 + lAvg * 4.6) * game.globalDamageMul,
        life: 2.25,
      });
      spawnCastPulse(aimed.x, aimed.y, "rgba(215, 245, 168, 0.88)", 94, 0.36);
      triggerScreenShake(0.09, 2.1);
    } else if (key === "sunbloom") {
      game.zones.push({
        type: "triad",
        variant: "sunbloom",
        x: aimed.x, y: aimed.y,
        r: 84 + lAvg * 10,
        dps: (23 + lAvg * 5.6) * game.globalDamageMul,
        burn: 0.72 + lAvg * 0.07,
        slow: 0.55,
        burstCd: 0.4,
        burstTimer: 0.4,
        burstDamage: (18 + lAvg * 4.5) * game.globalDamageMul,
        life: 2.25,
      });
      spawnCastPulse(aimed.x, aimed.y, "rgba(255, 226, 146, 0.88)", 92, 0.36);
      triggerScreenShake(0.09, 2.1);
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
      spawnCastPulse(aimed.x, aimed.y, "rgba(166, 229, 195, 0.78)", 78, 0.3);
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
      spawnCastPulse(aimed.x, aimed.y, "rgba(170, 210, 255, 0.78)", 84, 0.32);
    } else if (key === "chain") {
      if (game.zones.length >= MAX_ZONES) game.zones.shift();
      game.zones.push({
        type: "chainField",
        x: aimed.x, y: aimed.y,
        r: 78 + lAvg * 8,
        dps: (12 + lAvg * 3.8) * game.globalDamageMul,
        linkCd: 0.26,
        linkTimer: 0.26,
        linkDamage: (20 + lAvg * 5) * game.globalDamageMul,
        maxJumps: Math.min(7, 3 + Math.floor(lAvg / 2.5)),
        links: [],
        linkVisual: 0,
        life: 1.85,
      });
      spawnCastPulse(aimed.x, aimed.y, "rgba(214, 164, 255, 0.82)", 86, 0.32);
    } else if (key === "plasma") {
      if (game.zones.length >= MAX_ZONES) game.zones.shift();
      game.zones.push({
        type: "plasma",
        x: aimed.x, y: aimed.y,
        r: 64 + lAvg * 8,
        dps: (24 + lAvg * 5.5) * game.globalDamageMul,
        burn: 0.75 + lAvg * 0.08,
        surgeCd: 0.44,
        surgeTimer: 0.44,
        surgeDamage: (18 + lAvg * 4.8) * game.globalDamageMul,
        life: 2.0,
      });
      spawnCastPulse(aimed.x, aimed.y, "rgba(255, 174, 216, 0.84)", 82, 0.32);
    } else if (key === "riptide") {
      if (game.zones.length >= MAX_ZONES) game.zones.shift();
      game.zones.push({
        type: "riptide",
        x: aimed.x, y: aimed.y,
        r: 70 + lAvg * 8,
        dps: (20 + lAvg * 5) * game.globalDamageMul,
        slow: 0.72,
        pulseCd: 0.38,
        pulseTimer: 0.38,
        pulseDamage: (14 + lAvg * 4.2) * game.globalDamageMul,
        healPulse: 2.2 + lAvg * 0.7,
        life: 2.05,
      });
      spawnCastPulse(aimed.x, aimed.y, "rgba(176, 218, 255, 0.84)", 84, 0.32);
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
      spawnCastPulse(aimed.x, aimed.y, "rgba(223, 188, 124, 0.8)", 80, 0.32);
    } else if (key === "overgrowth") {
      if (game.zones.length >= MAX_ZONES) game.zones.shift();
      game.zones.push({
        type: "overgrowth",
        x: aimed.x, y: aimed.y,
        r: 72 + lAvg * 8,
        dps: (15 + lAvg * 4) * game.globalDamageMul,
        linkCd: 0.28,
        linkTimer: 0.28,
        linkDamage: (18 + lAvg * 4.8) * game.globalDamageMul,
        snare: 0.68 + lAvg * 0.05,
        links: [],
        linkVisual: 0,
        maxJumps: Math.min(6, 3 + Math.floor(lAvg / 3)),
        life: 1.95,
      });
      spawnCastPulse(aimed.x, aimed.y, "rgba(178, 240, 166, 0.82)", 84, 0.32);
    } else if (key === "wildfire") {
      if (game.zones.length >= MAX_ZONES) game.zones.shift();
      game.zones.push({
        type: "wildfire",
        x: aimed.x, y: aimed.y,
        r: 68 + lAvg * 8,
        dps: (24 + lAvg * 5.8) * game.globalDamageMul,
        burn: 0.9 + lAvg * 0.08,
        pulseCd: 0.44,
        pulseTimer: 0.44,
        pulseDamage: (17 + lAvg * 4.4) * game.globalDamageMul,
        life: 2.1,
      });
      spawnCastPulse(aimed.x, aimed.y, "rgba(255, 175, 112, 0.84)", 82, 0.32);
    } else if (key === "dustbloom") {
      if (game.zones.length >= MAX_ZONES) game.zones.shift();
      game.zones.push({
        type: "dustbloom",
        x: aimed.x, y: aimed.y,
        r: 66 + lAvg * 8,
        dps: (18 + lAvg * 4.5) * game.globalDamageMul,
        slow: 0.58,
        snare: 0.85 + lAvg * 0.06,
        crushCd: 0.56,
        crushTimer: 0.56,
        crushDamage: (14 + lAvg * 4.1) * game.globalDamageMul,
        life: 2.25,
      });
      spawnCastPulse(aimed.x, aimed.y, "rgba(224, 208, 138, 0.82)", 82, 0.32);
    } else if (key === "bloomtide") {
      if (game.zones.length >= MAX_ZONES) game.zones.shift();
      game.zones.push({
        type: "bloomtide",
        x: aimed.x, y: aimed.y,
        r: 72 + lAvg * 8,
        dps: (18 + lAvg * 4.6) * game.globalDamageMul,
        slow: 0.62,
        snare: 0.72 + lAvg * 0.05,
        pulseCd: 0.38,
        pulseTimer: 0.38,
        pulseDamage: (13 + lAvg * 4) * game.globalDamageMul,
        healPulse: 2.4 + lAvg * 0.7,
        life: 2.05,
      });
      spawnCastPulse(aimed.x, aimed.y, "rgba(176, 235, 198, 0.84)", 84, 0.32);
    } else if (key === "pollenstorm") {
      if (game.zones.length >= MAX_ZONES) game.zones.shift();
      game.zones.push({
        type: "pollenstorm",
        x: aimed.x, y: aimed.y,
        r: 74 + lAvg * 8,
        dps: (19 + lAvg * 4.7) * game.globalDamageMul,
        slow: 0.68,
        pull: 28 + lAvg * 4,
        strikeCd: 0.34,
        strikeTimer: 0.34,
        strikeDamage: (15 + lAvg * 4.2) * game.globalDamageMul,
        life: 2.0,
      });
      spawnCastPulse(aimed.x, aimed.y, "rgba(232, 250, 166, 0.84)", 84, 0.32);
    } else if (key === "lodestone") {
      if (game.zones.length >= MAX_ZONES) game.zones.shift();
      game.zones.push({
        type: "lodestone",
        x: aimed.x, y: aimed.y,
        r: 64 + lAvg * 8,
        dps: (16 + lAvg * 4.2) * game.globalDamageMul,
        pull: 54 + lAvg * 7,
        slow: 0.52,
        linkCd: 0.30,
        linkTimer: 0.30,
        linkDamage: (20 + lAvg * 5.2) * game.globalDamageMul,
        links: [],
        linkVisual: 0,
        maxJumps: Math.min(5, 3 + Math.floor(lAvg / 3)),
        life: 2.2,
      });
      spawnCastPulse(aimed.x, aimed.y, "rgba(172, 136, 225, 0.84)", 82, 0.32);
    } else if (key === "sirocco") {
      if (game.zones.length >= MAX_ZONES) game.zones.shift();
      game.zones.push({
        type: "sirocco",
        x: aimed.x, y: aimed.y,
        r: 70 + lAvg * 8,
        dps: (26 + lAvg * 5.8) * game.globalDamageMul,
        burn: 0.88 + lAvg * 0.08,
        push: 58 + lAvg * 7,
        burstCd: 0.42,
        burstTimer: 0.42,
        burstDamage: (18 + lAvg * 4.8) * game.globalDamageMul,
        life: 1.95,
      });
      spawnCastPulse(aimed.x, aimed.y, "rgba(255, 158, 80, 0.84)", 84, 0.32);
    } else if (key === "dustdevil") {
      if (game.zones.length >= MAX_ZONES) game.zones.shift();
      game.zones.push({
        type: "dustdevil",
        x: aimed.x, y: aimed.y,
        r: 68 + lAvg * 8,
        dps: (18 + lAvg * 4.5) * game.globalDamageMul,
        slow: 0.55,
        push: 44 + lAvg * 6,
        snare: 0.7 + lAvg * 0.05,
        strikeCd: 0.38,
        strikeTimer: 0.38,
        strikeDamage: (15 + lAvg * 4.2) * game.globalDamageMul,
        life: 2.05,
      });
      spawnCastPulse(aimed.x, aimed.y, "rgba(210, 180, 100, 0.82)", 82, 0.32);
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
    spawnCastPulse(aimed.x, aimed.y, "rgba(159, 212, 255, 0.72)", Math.max(48, r * 0.82), 0.24);
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

  if (key === "nature") {
    if (game.zones.length >= MAX_ZONES) game.zones.shift();
    game.zones.push({
      type: "briar",
      x: aimed.x,
      y: aimed.y,
      r: (52 + p.level * 8) * p.radiusMul,
      dps: (22 + p.level * 7.8) * game.globalDamageMul * p.damageMul,
      slow: 0.5,
      snare: 0.82 + p.snareBonus,
      pulseCd: 0.48,
      pulseTimer: 0.48,
      pulseDamage: (15 + p.level * 4.8) * game.globalDamageMul * p.damageMul,
      life: 1.55 * p.durationMul,
    });
    spawnCastPulse(aimed.x, aimed.y, "rgba(178, 236, 156, 0.78)", Math.max(46, (52 + p.level * 8) * p.radiusMul * 0.9), 0.28);
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
    spawnCastPulse(aimed.x, aimed.y, "rgba(255, 179, 120, 0.95)", 108, 0.42);
    triggerScreenShake(0.16, 3.8);
    for (let i = 0; i < 14; i++) spawnSpark(aimed.x, aimed.y, i % 2 === 0 ? "#ff7c40" : "#ffcf87", 2.3);
    for (let i = 0; i < 6; i++) spawnSpark(aimed.x, aimed.y, "#5e2f1c", 1.2);
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
  if (key === "arc") return "Fast single-target bolts.";
  if (key === "fire") return "Explosive burn shots.";
  if (key === "earth") return "Heavy slows and impact.";
  if (key === "water") return "Burst damage plus wall heal.";
  if (key === "wind") return "Piercing push lane.";
  if (key === "nature") return "Rooting briar control.";
  return "Unlock this power.";
}

function summarizeComboKeys(keys, maxItems = 2) {
  const uniq = [...new Set((keys || []).filter(Boolean))];
  if (uniq.length === 0) return "none";
  const shown = uniq.slice(0, maxItems).map((k) => capitalize(k));
  const extra = uniq.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} +${extra}` : shown.join(", ");
}

function getElementComboHint(key) {
  const unlocked = new Set(getUnlockedBasePowers());
  unlocked.delete(key);

  const pairKeys = COMBO_DEFS
    .filter((d) => d.a === key || d.b === key)
    .map((d) => d.key);
  if ((key === "fire" || key === "earth") && !pairKeys.includes("magma")) pairKeys.push("magma");

  const immediatePairs = COMBO_DEFS
    .filter((d) => (d.a === key && unlocked.has(d.b)) || (d.b === key && unlocked.has(d.a)))
    .map((d) => d.key);
  if (((key === "fire" && unlocked.has("earth")) || (key === "earth" && unlocked.has("fire"))) && !game.magmaUnlocked) {
    immediatePairs.push("magma");
  }

  const triCount = TRIPLE_COMBO_DEFS.filter((d) => d.a === key || d.b === key || d.c === key).length;
  const apexCount = APEX_COMBO_DEFS.filter((d) => d.a === key || d.b === key || d.c === key || d.d === key).length;

  const nowText = immediatePairs.length > 0 ? `Now: ${summarizeComboKeys(immediatePairs, 2)} | ` : "";
  return `${nowText}Paths: ${summarizeComboKeys(pairKeys, 2)} | T${triCount} A${apexCount}`;
}

function unlockPower(key, selectPower = false) {
  const power = game.powers[key];
  if (!power || power.unlocked) return;
  power.unlocked = true;
  void selectPower;
}

function createInitialPowers() {
  return {
    arc:       { level: 1, cd: 0.28, timer: 0, color: "#d6ecff", name: "Arc Bolt", unlocked: false, damageMul: 1.25, pierce: 1 },
    fire:      { level: 1, cd: 1.0,  timer: 0, color: "#ff8a52", name: "Fire",     unlocked: false, areaMul: 1, burnDamageMul: 1, burnDurationBonus: 0 },
    earth:     { level: 1, cd: 1.4,  timer: 0, color: "#b7925a", name: "Earth",    unlocked: false, damageMul: 1.22, slowBonus: 0.15, sizeMul: 1.15 },
    water:     { level: 1, cd: 1.1,  timer: 0, color: "#65b9ff", name: "Water",    unlocked: false, radiusMul: 1.18, healMul: 1.18, damageMul: 1.18 },
    wind:      { level: 1, cd: 0.95, timer: 0, color: "#bdeeff", name: "Wind",     unlocked: false, widthMul: 1.18, pushMul: 1.18, durationMul: 1.18 },
    nature:    { level: 1, cd: 1.18, timer: 0, color: "#8fd47b", name: "Nature",   unlocked: false, radiusMul: 1.12, snareBonus: 0.18, damageMul: 1.14, durationMul: 1.15 },
    magma:     { level: 0, cd: 2.2,  timer: 0, color: "#ff533d", name: "Magma",    unlocked: false, radiusMul: 1, dpsMul: 1, blastMul: 1 },
    chain:     { level: 0, cd: 0.62, timer: 0, color: "#b885ff", name: "Chain Arc" },
    plasma:    { level: 0, cd: 1.45, timer: 0, color: "#ff7fa6", name: "Plasma"    },
    riptide:   { level: 0, cd: 1.48, timer: 0, color: "#8bc7ff", name: "Riptide"   },
    mist:      { level: 0, cd: 1.55, timer: 0, color: "#aaddcc", name: "Mist"      },
    storm:     { level: 0, cd: 1.75, timer: 0, color: "#88bbff", name: "Storm"     },
    quicksand: { level: 0, cd: 1.9,  timer: 0, color: "#c8a868", name: "Quicksand" },
    overgrowth:{ level: 0, cd: 1.58, timer: 0, color: "#9fe39a", name: "Overgrowth" },
    wildfire:  { level: 0, cd: 1.82, timer: 0, color: "#ff9d66", name: "Wildfire"  },
    dustbloom: { level: 0, cd: 1.95, timer: 0, color: "#c6b276", name: "Dustbloom" },
    bloomtide: { level: 0, cd: 1.72, timer: 0, color: "#98e0b2", name: "Bloomtide" },
    pollenstorm: { level: 0, cd: 1.78, timer: 0, color: "#d9f19a", name: "Pollenstorm" },
    lodestone: { level: 0, cd: 1.65, timer: 0, color: "#9370db", name: "Lodestone"  },
    sirocco:   { level: 0, cd: 1.72, timer: 0, color: "#ff8938", name: "Sirocco"    },
    dustdevil: { level: 0, cd: 1.82, timer: 0, color: "#c4a050", name: "Dustdevil"  },
    monsoon:   { level: 0, cd: 2.05, timer: 0, color: "#7cd7ff", name: "Monsoon"   },
    sandglass: { level: 0, cd: 2.2,  timer: 0, color: "#ffcc88", name: "Sandglass" },
    mudflow:   { level: 0, cd: 2.25, timer: 0, color: "#d7865f", name: "Mudflow"   },
    blizzard:  { level: 0, cd: 2.1,  timer: 0, color: "#b8ecff", name: "Blizzard"  },
    thornforge:{ level: 0, cd: 2.15, timer: 0, color: "#d2aa7b", name: "Thornforge" },
    canopy:    { level: 0, cd: 2.1,  timer: 0, color: "#8fdab8", name: "Canopy"    },
    briarstorm:{ level: 0, cd: 2.1,  timer: 0, color: "#bdeaa0", name: "Briarstorm" },
    sunbloom:  { level: 0, cd: 2.05, timer: 0, color: "#ffd98a", name: "Sunbloom"  },
    cataclysm: { level: 0, cd: 2.6,  timer: 0, color: "#f3d2ff", name: "Cataclysm" },
    worldroot: { level: 0, cd: 2.55, timer: 0, color: "#c8f2b8", name: "Worldroot" },
  };
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

function makeFusionUpgradeChoice(key, sources) {
  return {
    name: `Empower ${capitalize(key)}`,
    desc: `${sources.map(capitalize).join("+")} levels +1 and ${capitalize(key)} cast speed +6%.`,
    apply: () => {
      for (const source of sources) {
        if (game.powers[source]) game.powers[source].level += 1;
      }
      if (game.powers[key]) game.powers[key].cd = Math.max(0.3, game.powers[key].cd * 0.94);
      feed(`${capitalize(key)} synergy surged.`);
      setToast(`${capitalize(key)} empowered.`, "good");
    },
  };
}

function generateLevelUpChoices() {
  const choices = [];

  // Level-ups only offer combat tempo boosts; unlocks now come from the between-wave upgrade draft.
  choices.push({
    name: "Spell Surge",
    desc: "+18% global damage",
    apply: () => { game.globalDamageMul *= 1.18; feed("Arcane output increased."); },
  });
  choices.push({
    name: "Arcane Tempo",
    desc: "All cooldowns 10% faster",
    apply: () => { game.cooldownMul *= 0.9; feed("Casting tempo accelerated."); },
  });
  choices.push({
    name: "Rune Sharpening",
    desc: "+12% spell damage",
    apply: () => { game.globalDamageMul *= 1.12; feed("Runes sharpened for higher damage."); },
  });
  choices.push({
    name: "Quickened Sigils",
    desc: "+15% cast speed",
    apply: () => { game.cooldownMul *= 0.85; feed("Sigils quickened."); },
  });
  choices.push({
    name: "Fortify Wall",
    desc: "+180 max wall HP and repair 180",
    apply: () => {
      game.wall.maxHp += 180;
      game.wall.hp = Math.min(game.wall.maxHp, game.wall.hp + 180);
      feed("Wall reinforced.");
    },
  });
  choices.push({
    name: "Emergency Repairs",
    desc: "Repair wall by 25% of max HP",
    apply: () => {
      game.wall.hp = Math.min(game.wall.maxHp, game.wall.hp + game.wall.maxHp * 0.25);
      feed("Repair crews restored the wall.");
    },
  });

  return pickWeightedUnique(choices, 6);
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
  game.castPulses = [];
  game.ambientMotes = [];
  game.kills = 0;
  game.runEssence = 0;
  game.globalDamageMul = (1 + game.meta.defeatUpgrades.damageBoost * 0.1) * (1 + carry.damageBoostPct);
  game.cooldownMul = (1 / (1 + game.meta.defeatUpgrades.castSpeedBoost * 0.08)) / (1 + carry.castSpeedBoostPct);
  game.magmaUnlocked = false;
  game.pairFusionUnlocked = makeFusionUnlockMap(COMBO_DEFS);
  game.tripleFusionUnlocked = makeFusionUnlockMap(TRIPLE_COMBO_DEFS);
  game.unlockChainFocus = [];
  game.unlockChainStacks = 0;
  game.bossPrep = false;
  game.bossPrepTimer = 0;
  game.bossSpawnedThisWave = false;
  game.level = 0;
  game.xp = 0;
  game.pendingLevelChoices = 0;
  game.xpToNext = getXpForNextLevel(0);
  game.time = 0;
  game.selectedCastKey = key;
  game.apexFusionUnlocked = makeFusionUnlockMap(APEX_COMBO_DEFS);
  game.screenShake = 0;
  game.screenShakeMag = 0;

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

  game.powers = createInitialPowers();

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
    { key: "nature",name: "Nature",   color: "#8fd47b", desc: "Briar fields and roots", note: "Snare + zone control"   },
  ];

  const boxW = elements.length > 5 ? 142 : 154;
  const boxH = 138;
  const gap = elements.length > 5 ? 8 : 12;
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
  if (text.indexOf("earth") !== -1 || text.indexOf("boulder") !== -1 || text.indexOf("stone") !== -1 || text.indexOf("quagmire") !== -1 || text.indexOf("dustdevil") !== -1) return "earth";
  if (text.indexOf("water") !== -1 || text.indexOf("flood") !== -1 || text.indexOf("spray") !== -1) return "water";
  if (text.indexOf("wind") !== -1 || text.indexOf("gale") !== -1 || text.indexOf("backdraft") !== -1 || text.indexOf("tailwind") !== -1 || text.indexOf("sirocco") !== -1) return "wind";
  if (text.indexOf("nature") !== -1 || text.indexOf("briar") !== -1 || text.indexOf("seed") !== -1 || text.indexOf("grove") !== -1 || text.indexOf("root") !== -1) return "nature";
  if (text.indexOf("arc bolt") !== -1 || text.indexOf("arc overcharge") !== -1 || text.indexOf("forked arc") !== -1 || text.indexOf("awaken arc") !== -1 || text.indexOf("lodestone") !== -1) return "arc";

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

  const levelCdFloor = key === "magma" ? 1.6 : 0.45;
  const push = (choice) => {
    pool.push({
      ...choice,
      desc: `${choice.desc} Also +1 ${power.name} level.`,
      apply: () => {
        power.level += 1;
        power.cd = Math.max(levelCdFloor, power.cd * 0.95);
        choice.apply();
        setToast(`${power.name} reached level ${power.level}.`, "good");
      },
    });
  };

  if (key === "arc") {
    push({
      name: "Arc Overcharge",
      desc: "Arc Bolt damage +22%",
      apply: () => {
        power.damageMul *= 1.22;
        feed("Arc Bolt damage surged.");
      },
    });
    push({
      name: "Forked Arc",
      desc: "+1 Arc Bolt pierce",
      apply: () => {
        power.pierce += 1;
        feed("Arc Bolt now pierces deeper into the wave.");
      },
    });
    push({
      name: "Capacitor Lattice",
      desc: "Arc damage +34%, cast speed -9%",
      apply: () => {
        power.damageMul *= 1.34;
        power.cd = Math.min(1.3, power.cd * 1.09);
        feed("Arc bolts hit harder, but cycle slower.");
      },
    });
    push({
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
    push({
      name: "Widened Blaze",
      desc: "Fire blast area +28%",
      apply: () => {
        power.areaMul *= 1.28;
        feed("Fire blast radius expanded.");
      },
    });
    push({
      name: "Cinder Heart",
      desc: "Fire burn damage +30%",
      apply: () => {
        power.burnDamageMul *= 1.3;
        feed("Fire burn damage intensified.");
      },
    });
    push({
      name: "Lingering Embers",
      desc: "Fire burn lasts 0.5s longer",
      apply: () => {
        power.burnDurationBonus += 0.5;
        feed("Burning embers linger longer.");
      },
    });
    push({
      name: "Inferno Bloom",
      desc: "Fire area +42%, cast speed -10%",
      apply: () => {
        power.areaMul *= 1.42;
        power.cd = Math.min(1.9, power.cd * 1.1);
        feed("Fire blooms wider, but with slower cadence.");
      },
    });
    push({
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
    push({
      name: "Crushing Stone",
      desc: "Earth impact damage +24%",
      apply: () => {
        power.damageMul *= 1.24;
        feed("Earth impacts hit harder.");
      },
    });
    push({
      name: "Quagmire Core",
      desc: "Earth slow duration +0.35s",
      apply: () => {
        power.slowBonus += 0.35;
        feed("Earth now drags enemies longer.");
      },
    });
    push({
      name: "Boulder Mass",
      desc: "Earth projectile size +20%",
      apply: () => {
        power.sizeMul *= 1.2;
        feed("Earth boulders grew in size.");
      },
    });
    push({
      name: "Seismic Payload",
      desc: "Earth size +32%, cast speed -10%",
      apply: () => {
        power.sizeMul *= 1.32;
        power.cd = Math.min(2.05, power.cd * 1.1);
        feed("Earth payload enlarged at a slower firing rhythm.");
      },
    });
    push({
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
    push({
      name: "Flood Basin",
      desc: "Water burst radius +25%",
      apply: () => {
        power.radiusMul *= 1.25;
        feed("Water bursts cover more ground.");
      },
    });
    push({
      name: "Restorative Spray",
      desc: "Water wall healing +30%",
      apply: () => {
        power.healMul *= 1.3;
        feed("Water restores more wall integrity.");
      },
    });
    push({
      name: "Pressure Wave",
      desc: "Water burst damage +22%",
      apply: () => {
        power.damageMul *= 1.22;
        feed("Water bursts strike harder.");
      },
    });
    push({
      name: "Tidal Reservoir",
      desc: "Water radius +36%, cast speed -9%",
      apply: () => {
        power.radiusMul *= 1.36;
        power.cd = Math.min(1.85, power.cd * 1.09);
        feed("Water bursts spread farther with slower recast.");
      },
    });
    push({
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
    push({
      name: "Gale Corridor",
      desc: "Wind width +24%",
      apply: () => {
        power.widthMul *= 1.24;
        feed("Wind lanes widened.");
      },
    });
    push({
      name: "Backdraft",
      desc: "Wind push +26%",
      apply: () => {
        power.pushMul *= 1.26;
        feed("Wind now shoves enemies farther back.");
      },
    });
    push({
      name: "Tailwind Sustain",
      desc: "Wind duration +20%",
      apply: () => {
        power.durationMul *= 1.2;
        feed("Wind lines remain active longer.");
      },
    });
    push({
      name: "Cyclone Front",
      desc: "Wind width +34%, cast speed -10%",
      apply: () => {
        power.widthMul *= 1.34;
        power.cd = Math.min(1.78, power.cd * 1.1);
        feed("Wind fronts widened, but cycle slower.");
      },
    });
    push({
      name: "Razor Draft",
      desc: "Wind cast speed +20%, width -18%",
      apply: () => {
        power.cd = Math.max(0.3, power.cd * 0.8);
        power.widthMul *= 0.82;
        feed("Wind casts faster through narrower lanes.");
      },
    });
  }

  if (key === "nature") {
    push({
      name: "Widened Briars",
      desc: "Nature patch radius +24%",
      apply: () => {
        power.radiusMul *= 1.24;
        feed("Nature patches cover more ground.");
      },
    });
    push({
      name: "Griproot",
      desc: "Nature root strength +0.18s",
      apply: () => {
        power.snareBonus += 0.18;
        feed("Nature roots hold enemies longer.");
      },
    });
    push({
      name: "Bramble Edge",
      desc: "Nature damage +24%",
      apply: () => {
        power.damageMul *= 1.24;
        feed("Nature thorns cut deeper.");
      },
    });
    push({
      name: "Deep Grove",
      desc: "Nature duration +24%, cast speed -10%",
      apply: () => {
        power.durationMul *= 1.24;
        power.cd = Math.min(1.95, power.cd * 1.1);
        feed("Nature patches linger longer with a slower cadence.");
      },
    });
    push({
      name: "Seed Volley",
      desc: "Nature cast speed +18%, radius -14%",
      apply: () => {
        power.cd = Math.max(0.34, power.cd * 0.82);
        power.radiusMul *= 0.86;
        feed("Nature casts faster with tighter placement.");
      },
    });
  }

  if (key === "magma") {
    push({
      name: "Volcanic Spread",
      desc: "Magma radius +22%",
      apply: () => {
        power.radiusMul *= 1.22;
        feed("Magma spread widened.");
      },
    });
    push({
      name: "Core Heat",
      desc: "Magma damage-over-time +24%",
      apply: () => {
        power.dpsMul *= 1.24;
        feed("Magma heat intensified.");
      },
    });
    push({
      name: "Eruption Force",
      desc: "Magma blast damage +26%",
      apply: () => {
        power.blastMul *= 1.26;
        feed("Magma eruptions hit harder.");
      },
    });
    push({
      name: "Caldera Field",
      desc: "Magma radius +34%, cast speed -11%",
      apply: () => {
        power.radiusMul *= 1.34;
        power.cd = Math.min(2.9, power.cd * 1.11);
        feed("Magma fields expanded with slower cycling.");
      },
    });
    push({
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
  const unlockPool = [];
  const fusion = getActiveFusionState();
  const consumed = fusion.consumed;
  const chainFocus = Array.isArray(game.unlockChainFocus) ? game.unlockChainFocus : [];
  const chainStacks = Math.max(0, game.unlockChainStacks || 0);

  const getSourcesForPowerKey = (key) => {
    if (!key) return [];
    if (basePowerOrder.includes(key)) return [key];
    if (key === "magma") return ["fire", "earth"];
    const pairDef = COMBO_DEFS.find((d) => d.key === key);
    if (pairDef) return [pairDef.a, pairDef.b];
    const triadDef = TRIPLE_COMBO_DEFS.find((d) => d.key === key);
    if (triadDef) return [triadDef.a, triadDef.b, triadDef.c];
    const apexDef = getApexDef(key);
    if (apexDef) return [apexDef.a, apexDef.b, apexDef.c, apexDef.d];
    return [];
  };

  const pickWeightedUnlockCards = (cards, count) => {
    const poolCards = [...cards];
    const picked = [];
    const selectedSources = getSourcesForPowerKey(game.selectedCastKey);

    const weightFor = (card) => {
      const keys = Array.isArray(card.unlockKeys) ? card.unlockKeys : [];
      let weight = 1;

      for (const k of keys) {
        weight += (getElementDraftWeight(k) - 1) * 0.9;
      }

      if (keys.length > 0 && selectedSources.length > 0) {
        const overlap = keys.filter((k) => selectedSources.includes(k)).length;
        weight += overlap * 1.2;
      }

      if (keys.length > 0 && chainFocus.length > 0) {
        const chainOverlap = keys.filter((k) => chainFocus.includes(k)).length;
        if (chainOverlap > 0) {
          weight += chainOverlap * (1.05 + chainStacks * 0.35);
        } else {
          weight *= 0.88;
        }
      }

      if (card.unlockType === "triple") weight += 0.4;
      if (card.unlockType === "pair") weight += 0.25;

      return Math.max(1, Math.min(14, weight));
    };

    while (picked.length < count && poolCards.length) {
      let total = 0;
      for (const c of poolCards) total += weightFor(c);

      let roll = Math.random() * total;
      let idx = 0;
      for (; idx < poolCards.length; idx++) {
        roll -= weightFor(poolCards[idx]);
        if (roll <= 0) break;
      }
      if (idx >= poolCards.length) idx = poolCards.length - 1;
      picked.push(poolCards.splice(idx, 1)[0]);
    }

    return picked;
  };

  const noteUnlockChain = (keys) => {
    const fresh = (Array.isArray(keys) ? keys : []).filter((k) => basePowerOrder.includes(k));
    if (!fresh.length) return;
    const merged = [...new Set([...fresh, ...(Array.isArray(game.unlockChainFocus) ? game.unlockChainFocus : [])])];
    game.unlockChainFocus = merged.slice(0, 3);
    game.unlockChainStacks = Math.min(4, (game.unlockChainStacks || 0) + 1);
    for (const key of fresh) rememberPreferredElement(key);
  };

  const lockedBase = getLockedBasePowers();
  for (const key of lockedBase) {
    unlockPool.push({
      name: `Learn ${game.powers[key].name}`,
      desc: `${getStartingPowerDesc(key)} ${getElementComboHint(key)}`,
      unlockType: "element",
      unlockKeys: [key],
      apply: () => {
        unlockPower(key, false);
        noteUnlockChain([key]);
        feed(`${game.powers[key].name} learned at wave ${game.wave}.`);
        setToast(`${game.powers[key].name} joined your attack volley.`, "good");
      },
    });
  }

  for (const def of COMBO_DEFS) {
    if (game.pairFusionUnlocked && game.pairFusionUnlocked[def.key]) continue;
    const pa = game.powers[def.a];
    const pb = game.powers[def.b];
    if (!pa || !pb || !pa.unlocked || !pb.unlocked) continue;
    if (pa.level < def.minLevel || pb.level < def.minLevel) continue;

    unlockPool.push({
      name: `Awaken ${capitalize(def.key)}`,
      desc: `${capitalize(def.a)}+${capitalize(def.b)} fusion.`,
      unlockType: "pair",
      unlockKeys: [def.a, def.b],
      apply: () => {
        game.pairFusionUnlocked[def.key] = true;
        noteUnlockChain([def.a, def.b]);
        game.selectedCastKey = def.key;
        feed(`${capitalize(def.key)} awakened.`);
        setToast(`${capitalize(def.key)} unlocked.`, "good");
      },
    });
  }

  for (const def of TRIPLE_COMBO_DEFS) {
    if (game.tripleFusionUnlocked && game.tripleFusionUnlocked[def.key]) continue;
    const pa = game.powers[def.a];
    const pb = game.powers[def.b];
    const pc = game.powers[def.c];
    if (!pa || !pb || !pc || !pa.unlocked || !pb.unlocked || !pc.unlocked) continue;
    if (pa.level < def.minLevel || pb.level < def.minLevel || pc.level < def.minLevel) continue;

    unlockPool.push({
      name: `Awaken ${capitalize(def.key)}`,
      desc: `${capitalize(def.a)}+${capitalize(def.b)}+${capitalize(def.c)} triad fusion.`,
      unlockType: "triple",
      unlockKeys: [def.a, def.b, def.c],
      apply: () => {
        game.tripleFusionUnlocked[def.key] = true;
        noteUnlockChain([def.a, def.b, def.c]);
        game.selectedCastKey = def.key;
        feed(`${capitalize(def.key)} awakened.`);
        setToast(`${capitalize(def.key)} unlocked.`, "good");
      },
    });
  }

  const magmaEligible = game.powers.fire.unlocked && game.powers.earth.unlocked && game.powers.fire.level >= 3 && game.powers.earth.level >= 3 && !game.magmaUnlocked;
  if (magmaEligible) {
    unlockPool.push({
      name: "Awaken Magma",
      desc: "Fire+Earth fusion.",
      unlockType: "pair",
      unlockKeys: ["fire", "earth"],
      apply: () => {
        game.magmaUnlocked = true;
        game.powers.magma.level = 1;
        game.powers.magma.unlocked = true;
        noteUnlockChain(["fire", "earth"]);
        game.selectedCastKey = "magma";
        feed("Magma awakened and added to your volley.");
      },
    });
  }

  const unlockedPowers = powerOrder.filter((key) => game.powers[key].unlocked);
  if (game.powers.arc.unlocked && !consumed.has("arc")) addElementUpgradeChoices(pool, "arc");
  for (const key of unlockedPowers) {
    if (consumed.has(key)) continue;
    addElementUpgradeChoices(pool, key);
  }

  if (game.magmaUnlocked && game.powers.magma.unlocked) {
    addElementUpgradeChoices(pool, "magma");
  }

  for (const comboKey of fusion.activeComboKeys) {
    if (comboKey === "magma") continue;
    const sources = fusion.sourcesByKey[comboKey] || [];
    if (sources.length) pool.push(makeFusionUpgradeChoice(comboKey, sources));
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

  const out = pickWeightedUnique(pool, 6);

  if (unlockPool.length > 0) {
    const unlockCards = pickWeightedUnlockCards(unlockPool, Math.min(2, unlockPool.length));
    for (let i = 0; i < unlockCards.length && i < out.length; i++) out[i] = unlockCards[i];
  }

  const apexOptions = getApexConvergenceOptions(fusion);
  const apexOption = apexOptions[0] || null;
  const canConvergeToApex = !!apexOption;
  if (canConvergeToApex) {
    out[0] = {
      name: `Converge into ${game.powers[apexOption.def.key].name}`,
      desc: `Fuse active dual synergies into ${game.powers[apexOption.def.key].name} (${apexOption.def.a}+${apexOption.def.b}+${apexOption.def.c}+${apexOption.def.d}).`,
      apply: () => {
        game.apexFusionUnlocked[apexOption.def.key] = true;
        for (const k of [apexOption.def.a, apexOption.def.b, apexOption.def.c, apexOption.def.d]) {
          if (game.powers[k]) {
            game.powers[k].unlocked = true;
            game.powers[k].level = Math.max(game.powers[k].level, apexOption.def.minLevel);
          }
        }
        game.selectedCastKey = apexOption.def.key;
        feed(`Active synergies converged into ${game.powers[apexOption.def.key].name}.`);
        setToast(`${game.powers[apexOption.def.key].name} unlocked.`, "good");
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

    if (z.type === "overgrowth") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.snare = Math.max(e.snare || 0, z.snare);
        }
      }

      z.linkVisual = Math.max(0, (z.linkVisual || 0) - dt);
      z.linkTimer = (z.linkTimer || 0) - dt;
      if (z.linkTimer <= 0) {
        z.linkTimer += z.linkCd || 0.28;
        const inRange = game.enemies
          .filter((e) => Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r)
          .sort((a, b) => Math.hypot(a.x - z.x, a.y - z.y) - Math.hypot(b.x - z.x, b.y - z.y));
        z.links = [];
        if (inRange.length >= 2) {
          const maxLinks = Math.min(inRange.length - 1, z.maxJumps || 4);
          for (let i = 0; i < maxLinks; i++) {
            const a = inRange[i];
            const b = inRange[i + 1];
            b.hp -= z.linkDamage;
            b.snare = Math.max(b.snare || 0, z.snare * 0.9);
            z.links.push([a.x, a.y, b.x, b.y]);
            for (let j = 0; j < 2; j++) spawnSpark(b.x, b.y, "#baf59e", 0.85);
          }
          z.linkVisual = 0.16;
        }
      }
    }

    if (z.type === "wildfire") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.burn = Math.max(e.burn, z.burn);
          e.snare = Math.max(e.snare || 0, 0.35);
        }
      }
      z.pulseTimer = (z.pulseTimer || 0) - dt;
      if (z.pulseTimer <= 0) {
        z.pulseTimer += z.pulseCd || 0.44;
        explodeAt(z.x, z.y, z.r * 0.52, z.pulseDamage || z.dps * 0.45);
        for (let i = 0; i < 5; i++) spawnSpark(z.x, z.y, "#ff9e62", 1.05);
      }
    }

    if (z.type === "dustbloom") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.slow = Math.max(e.slow, z.slow);
          e.snare = Math.max(e.snare || 0, z.snare);
        }
      }
      z.crushTimer = (z.crushTimer || 0) - dt;
      if (z.crushTimer <= 0) {
        z.crushTimer += z.crushCd || 0.56;
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r * 0.58 + e.r) {
            e.hp -= z.crushDamage || z.dps * 0.55;
            e.snare = Math.max(e.snare || 0, z.snare + 0.1);
          }
        }
        for (let i = 0; i < 4; i++) spawnSpark(z.x, z.y, "#d8c27a", 0.85);
      }
    }

    if (z.type === "bloomtide") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.slow = Math.max(e.slow, z.slow);
          e.snare = Math.max(e.snare || 0, z.snare);
        }
      }
      z.pulseTimer = (z.pulseTimer || 0) - dt;
      if (z.pulseTimer <= 0) {
        z.pulseTimer += z.pulseCd || 0.38;
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r * 0.68 + e.r) {
            e.hp -= z.pulseDamage || z.dps * 0.45;
            e.snare = Math.max(e.snare || 0, z.snare + 0.08);
          }
        }
        if (game.wall) game.wall.hp = Math.min(game.wall.maxHp, game.wall.hp + (z.healPulse || 2));
        for (let i = 0; i < 4; i++) spawnSpark(z.x, z.y, "#99efb8", 0.9);
      }
    }

    if (z.type === "pollenstorm") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.slow = Math.max(e.slow, z.slow);
          const dx = z.x - e.x;
          const dy = z.y - e.y;
          const dist = Math.hypot(dx, dy) || 1;
          e.x += (dx / dist) * (z.pull || 28) * dt;
          e.y += (dy / dist) * (z.pull || 28) * dt;
        }
      }
      z.strikeTimer = (z.strikeTimer || 0) - dt;
      if (z.strikeTimer <= 0) {
        z.strikeTimer += z.strikeCd || 0.34;
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r * 0.72 + e.r) e.hp -= z.strikeDamage || z.dps * 0.5;
        }
        for (let i = 0; i < 5; i++) spawnSpark(z.x, z.y, "#dff39c", 0.95);
      }
    }

    if (z.type === "chainField") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
        }
      }

      z.linkVisual = Math.max(0, (z.linkVisual || 0) - dt);
      z.linkTimer = (z.linkTimer || 0) - dt;
      if (z.linkTimer <= 0) {
        z.linkTimer += z.linkCd || 0.26;
        const inRange = game.enemies
          .filter((e) => Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r)
          .sort((a, b) => Math.hypot(a.x - z.x, a.y - z.y) - Math.hypot(b.x - z.x, b.y - z.y));
        z.links = [];
        if (inRange.length >= 2) {
          const maxLinks = Math.min(inRange.length - 1, z.maxJumps || 4);
          for (let i = 0; i < maxLinks; i++) {
            const a = inRange[i];
            const b = inRange[i + 1];
            b.hp -= z.linkDamage;
            z.links.push([a.x, a.y, b.x, b.y]);
            for (let j = 0; j < 2; j++) spawnSpark(b.x, b.y, "#c88dff", 0.9);
          }
          z.linkVisual = 0.16;
        }
      }
    }

    if (z.type === "plasma") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.burn = Math.max(e.burn, z.burn);
        }
      }
      z.surgeTimer = (z.surgeTimer || 0) - dt;
      if (z.surgeTimer <= 0) {
        z.surgeTimer += z.surgeCd || 0.44;
        explodeAt(z.x, z.y, z.r * 0.5, z.surgeDamage || z.dps * 0.5);
        for (let i = 0; i < 6; i++) spawnSpark(z.x, z.y, "#ff9ad1", 1.1);
      }
    }

    if (z.type === "riptide") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.slow = Math.max(e.slow, z.slow);
        }
      }
      z.pulseTimer = (z.pulseTimer || 0) - dt;
      if (z.pulseTimer <= 0) {
        z.pulseTimer += z.pulseCd || 0.38;
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r * 0.68 + e.r) {
            e.hp -= z.pulseDamage || z.dps * 0.45;
          }
        }
        if (game.wall) game.wall.hp = Math.min(game.wall.maxHp, game.wall.hp + (z.healPulse || 2));
        for (let i = 0; i < 5; i++) spawnSpark(z.x, z.y, "#98d4ff", 1.0);
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
      } else if (z.variant === "thornforge") {
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
            e.hp -= z.dps * dt;
            e.burn = Math.max(e.burn, z.burn);
            e.snare = Math.max(e.snare || 0, z.snare);
          }
        }
        z.pulseTimer -= dt;
        if (z.pulseTimer <= 0) {
          z.pulseTimer += z.pulseCd;
          explodeAt(z.x, z.y, z.r * 0.6, z.pulseDamage);
          for (let i = 0; i < 6; i++) spawnSpark(z.x, z.y, "#efbf7d", 1.05);
        }
      } else if (z.variant === "canopy") {
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
            e.hp -= z.dps * dt;
            e.slow = Math.max(e.slow, z.slow);
            e.snare = Math.max(e.snare || 0, z.snare);
          }
        }
        z.pulseTimer -= dt;
        if (z.pulseTimer <= 0) {
          z.pulseTimer += z.pulseCd;
          for (const e of game.enemies) {
            if (Math.hypot(e.x - z.x, e.y - z.y) < z.r * 0.74 + e.r) e.hp -= z.pulseDamage;
          }
          if (game.wall) game.wall.hp = Math.min(game.wall.maxHp, game.wall.hp + z.healPulse);
          for (let i = 0; i < 6; i++) spawnSpark(z.x, z.y, "#a6eabf", 1.0);
        }
      } else if (z.variant === "briarstorm") {
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
          for (const e of game.enemies) {
            if (Math.hypot(e.x - z.x, e.y - z.y) < z.r * 0.72 + e.r) {
              e.hp -= z.strikeDamage;
              e.snare = Math.max(e.snare || 0, 0.58);
            }
          }
          for (let i = 0; i < 6; i++) spawnSpark(z.x, z.y, "#d9f39c", 1.0);
        }
      } else if (z.variant === "sunbloom") {
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
            e.hp -= z.dps * dt;
            e.burn = Math.max(e.burn, z.burn);
            e.slow = Math.max(e.slow, z.slow);
          }
        }
        z.burstTimer -= dt;
        if (z.burstTimer <= 0) {
          z.burstTimer += z.burstCd;
          explodeAt(z.x, z.y, z.r * 0.62, z.burstDamage);
          for (let i = 0; i < 6; i++) spawnSpark(z.x, z.y, "#ffe493", 1.0);
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

    if (z.type === "apex" && z.variant === "worldroot") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.slow = Math.max(e.slow, z.slow);
          e.snare = Math.max(e.snare || 0, z.snare);
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
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r * 0.8 + e.r) {
            e.hp -= z.pulseDamage;
            e.snare = Math.max(e.snare || 0, z.snare + 0.12);
          }
        }
        if (game.wall) game.wall.hp = Math.min(game.wall.maxHp, game.wall.hp + z.healPulse);
        for (let i = 0; i < 10; i++) spawnSpark(z.x, z.y, "#c7f5b7", 1.3);
      }
    }

    if (z.type === "lodestone") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.slow = Math.max(e.slow, z.slow);
          const dx = z.x - e.x;
          const dy = z.y - e.y;
          const dist = Math.hypot(dx, dy) || 1;
          e.x += (dx / dist) * (z.pull || 54) * dt;
          e.y += (dy / dist) * (z.pull || 54) * dt;
        }
      }
      z.linkVisual = Math.max(0, (z.linkVisual || 0) - dt);
      z.linkTimer = (z.linkTimer || 0) - dt;
      if (z.linkTimer <= 0) {
        z.linkTimer += z.linkCd || 0.30;
        const inRange = game.enemies
          .filter((e) => Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r)
          .sort((a, b) => Math.hypot(a.x - z.x, a.y - z.y) - Math.hypot(b.x - z.x, b.y - z.y));
        z.links = [];
        if (inRange.length >= 2) {
          const maxLinks = Math.min(inRange.length - 1, z.maxJumps || 4);
          for (let i = 0; i < maxLinks; i++) {
            const a = inRange[i];
            const b = inRange[i + 1];
            b.hp -= z.linkDamage;
            z.links.push([a.x, a.y, b.x, b.y]);
            for (let j = 0; j < 3; j++) spawnSpark(b.x, b.y, "#c2a8f8", 0.95);
          }
          z.linkVisual = 0.16;
        }
      }
    }

    if (z.type === "sirocco") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.burn = Math.max(e.burn, z.burn);
          e.y -= z.push * dt;
        }
      }
      z.burstTimer = (z.burstTimer || 0) - dt;
      if (z.burstTimer <= 0) {
        z.burstTimer += z.burstCd || 0.42;
        explodeAt(z.x, z.y, z.r * 0.62, z.burstDamage || z.dps * 0.45);
        for (let i = 0; i < 6; i++) spawnSpark(z.x, z.y, "#ffb462", 1.1);
      }
    }

    if (z.type === "dustdevil") {
      for (const e of game.enemies) {
        if (Math.hypot(e.x - z.x, e.y - z.y) < z.r + e.r) {
          e.hp -= z.dps * dt;
          e.slow = Math.max(e.slow, z.slow);
          e.snare = Math.max(e.snare || 0, z.snare);
          // Tangential spiral push + upward push
          const dx = e.x - z.x;
          const dy = e.y - z.y;
          const dist = Math.hypot(dx, dy) || 1;
          const tx = -dy / dist;
          const ty = dx / dist;
          e.x += tx * (z.push || 44) * 0.35 * dt;
          e.y += ty * (z.push || 44) * 0.35 * dt;
          e.y -= (z.push || 44) * 0.65 * dt;
        }
      }
      z.strikeTimer = (z.strikeTimer || 0) - dt;
      if (z.strikeTimer <= 0) {
        z.strikeTimer += z.strikeCd || 0.38;
        for (const e of game.enemies) {
          if (Math.hypot(e.x - z.x, e.y - z.y) < z.r * 0.72 + e.r) {
            e.hp -= z.strikeDamage || z.dps * 0.5;
            e.snare = Math.max(e.snare || 0, z.snare + 0.1);
          }
        }
        for (let i = 0; i < 5; i++) spawnSpark(z.x, z.y, "#dabc7a", 1.0);
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
  const shaking = (game.screenShake || 0) > 0;
  const shakeMag = (game.screenShakeMag || 0) * Math.min(1, (game.screenShake || 0) * 11);
  const sx = shaking ? (Math.random() * 2 - 1) * shakeMag : 0;
  const sy = shaking ? (Math.random() * 2 - 1) * shakeMag : 0;

  ctx.save();
  if (shaking) ctx.translate(sx, sy);
  drawBackground();
  drawXpHud();
  drawWall();
  drawHero();
  drawZones();
  drawProjectiles();
  drawEnemies();
  drawSparks();
  drawCastPulses();
  drawPowerBar();
  drawBossCountdown();
  ctx.restore();
}

function drawBossCountdown() {
  if (!game.bossPrep) return;
  const secs = Math.max(0, Math.ceil(game.bossPrepTimer));

  const pulse = 0.5 + Math.sin(game.time * 8.5) * 0.5;
  const dangerAlpha = 0.1 + pulse * 0.12;
  ctx.fillStyle = `rgba(255, 64, 88, ${dangerAlpha})`;
  ctx.fillRect(0, 0, WIDTH, 26 + pulse * 8);
  drawZigZagLine(WIDTH * 0.5, 22, WIDTH * 0.5 - 180, 98, "rgba(255, 124, 148, 0.42)", 1.1);
  drawZigZagLine(WIDTH * 0.5, 22, WIDTH * 0.5 + 180, 98, "rgba(255, 124, 148, 0.42)", 1.1);

  ctx.globalAlpha = 0.3 + pulse * 0.2;
  ctx.strokeStyle = "#ff9caf";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(WIDTH * 0.5, 54, 14 + pulse * 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(120, 20, 30, 0.45)";
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

function getBiomeVisualTheme() {
  const wave = Math.max(1, game.wave || 1);
  const tier = Math.max(1, Math.ceil(wave / BOSS_WAVE_INTERVAL));
  const phase = ((wave - 1) % BOSS_WAVE_INTERVAL) / BOSS_WAVE_INTERVAL;
  const warm = phase;
  const cool = 1 - phase;
  const bossBoost = game.bossPrep ? 0.18 : 0;

  const top = {
    r: Math.round(20 + warm * 32 + bossBoost * 140),
    g: Math.round(16 + cool * 16),
    b: Math.round(25 + cool * 40),
  };
  const mid = {
    r: Math.round(14 + warm * 20 + tier * 2),
    g: Math.round(24 + cool * 28),
    b: Math.round(36 + cool * 34),
  };
  const bot = {
    r: Math.round(10 + warm * 8),
    g: Math.round(16 + cool * 12),
    b: Math.round(24 + cool * 18),
  };

  const lane = {
    r: Math.round(88 + cool * 18),
    g: Math.round(124 + cool * 24 - warm * 14),
    b: Math.round(198 - warm * 46 + cool * 8),
    a: 0.1 + cool * 0.04 + bossBoost * 0.2,
  };

  return {
    top: `rgb(${top.r}, ${top.g}, ${top.b})`,
    mid: `rgb(${mid.r}, ${mid.g}, ${mid.b})`,
    bot: `rgb(${bot.r}, ${bot.g}, ${bot.b})`,
    lane: `rgba(${lane.r}, ${lane.g}, ${lane.b}, ${lane.a.toFixed(3)})`,
    grid: `rgba(${178 + tier * 2}, ${164 + tier}, ${156 + tier}, ${(0.045 + cool * 0.03).toFixed(3)})`,
    topBand: `rgba(255, ${90 + Math.round(cool * 26)}, ${72 + Math.round(cool * 18)}, ${(0.08 + warm * 0.06 + bossBoost * 0.32).toFixed(3)})`,
  };
}

function drawFusionBloom(x, y, radius, core, edge, alpha = 0.34) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(x, y, radius * 0.2, x, y, radius);
  g.addColorStop(0, core);
  g.addColorStop(1, edge);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  circle(x, y, radius);
  ctx.restore();
}

function drawBackground() {
  ensureAmbientMotes();
  const theme = getBiomeVisualTheme();

  const g = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  g.addColorStop(0, theme.top);
  g.addColorStop(0.45, theme.mid);
  g.addColorStop(1, theme.bot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const laneGlow = ctx.createRadialGradient(WIDTH * 0.5, HEIGHT * 0.38, 40, WIDTH * 0.5, HEIGHT * 0.38, WIDTH * 0.55);
  laneGlow.addColorStop(0, theme.lane);
  laneGlow.addColorStop(1, "rgba(88, 130, 198, 0)");
  ctx.fillStyle = laneGlow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.strokeStyle = theme.grid;
  for (let y = 0; y < HEIGHT; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(game.time * 0.35 + y * 0.05) * 1.2);
    ctx.lineTo(WIDTH, y + Math.sin(game.time * 0.35 + y * 0.05) * 1.2);
    ctx.stroke();
  }

  for (const m of game.ambientMotes) {
    ctx.fillStyle = `rgba(${m.hue}, ${0.08 + m.z * 0.12})`;
    circle(m.x, m.y, m.r * m.z);
  }

  ctx.fillStyle = theme.topBand;
  ctx.fillRect(0, 0, WIDTH, 34);

  const vignette = ctx.createRadialGradient(WIDTH * 0.5, HEIGHT * 0.52, WIDTH * 0.22, WIDTH * 0.5, HEIGHT * 0.52, WIDTH * 0.72);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.2)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
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
  if (getLockedBasePowers().length > 0) return "Between waves: unlock elements/fusions or take run upgrades.";
  return "Between waves: pick upgrades to strengthen your current build.";
}

function drawWall() {
  if (!game.wall) return;
  const w = game.wall;
  const ratio = Math.max(0, w.hp / w.maxHp);

  // Rear battlement silhouette for depth
  ctx.fillStyle = "#4f4137";
  ctx.fillRect(w.x - 8, w.y - 9, w.w + 16, 10);
  for (let i = 0; i < 8; i++) {
    const bx = w.x + 8 + i * (w.w - 16) / 7;
    ctx.fillRect(bx - 6, w.y - 15, 12, 7);
  }

  // Main wall body gradient
  const wallGrad = ctx.createLinearGradient(w.x, w.y, w.x, w.y + w.h);
  wallGrad.addColorStop(0, "#7a6450");
  wallGrad.addColorStop(1, "#564536");
  ctx.fillStyle = wallGrad;
  ctx.fillRect(w.x, w.y, w.w, w.h);

  // Front lip for layered profile
  ctx.fillStyle = "rgba(40, 28, 22, 0.35)";
  ctx.fillRect(w.x, w.y + w.h * 0.62, w.w, w.h * 0.38);

  // Masonry joints
  ctx.strokeStyle = "rgba(42, 28, 22, 0.32)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 9; i++) {
    const xx = w.x + i * (w.w / 9);
    ctx.beginPath();
    ctx.moveTo(xx, w.y + 1);
    ctx.lineTo(xx, w.y + w.h - 1);
    ctx.stroke();
  }

  // Rune sockets that react to selected cast
  const selected = game.selectedCastKey;
  let runeColor = "rgba(170, 214, 255, 0.55)";
  if (selected && game.powers && game.powers[selected] && game.powers[selected].color) {
    runeColor = game.powers[selected].color;
  }
  for (let i = 0; i < 3; i++) {
    const rx = w.x + w.w * (0.2 + i * 0.3);
    const ry = w.y + w.h * 0.48;
    const pulse = 0.62 + Math.sin(game.time * 4 + i * 1.7) * 0.2;
    ctx.fillStyle = "rgba(24, 20, 18, 0.55)";
    circle(rx, ry, 7.4);
    ctx.globalAlpha = Math.max(0.24, pulse);
    ctx.strokeStyle = runeColor;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(rx, ry, 4.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Damage-state cracks and chips
  if (ratio < 0.72) {
    const severity = Math.min(1, (0.72 - ratio) / 0.72);
    const crackCount = 2 + Math.floor(severity * 6);
    for (let i = 0; i < crackCount; i++) {
      const sx = w.x + 16 + (i * 73) % Math.max(24, w.w - 28);
      const sy = w.y + 3 + (i * 11) % Math.max(12, w.h - 8);
      const ex = sx + ((i % 2 === 0 ? -1 : 1) * (9 + severity * 13));
      const ey = sy + 8 + severity * 8;
      drawZigZagLine(sx, sy, ex, ey, "rgba(38, 22, 20, 0.55)", 1.2);
    }
  }

  ctx.strokeStyle = "#9a8168";
  ctx.lineWidth = 2;
  ctx.strokeRect(w.x, w.y, w.w, w.h);

  // HP bar
  ctx.fillStyle = "#2a1a18";
  ctx.fillRect(w.x, w.y - 12, w.w, 7);
  ctx.fillStyle = ratio > 0.45 ? "#7ce08a" : ratio > 0.2 ? "#f0c665" : "#ef6f6f";
  ctx.fillRect(w.x, w.y - 12, w.w * ratio, 7);
}

function drawHero() {
  if (!game.hero) return;
  const h = game.hero;
  const selected = game.selectedCastKey;
  const auraColor = selected && game.powers && game.powers[selected] ? game.powers[selected].color : "#8fdcff";
  const idleBob = Math.sin(game.time * 2.6) * 1.6;
  const castPulse = 0.75 + Math.sin(game.time * 5.4) * 0.18;

  // Ground contact shadow anchors the hero to lane
  ctx.fillStyle = "rgba(10, 8, 12, 0.32)";
  ctx.beginPath();
  ctx.ellipse(h.x, h.y + h.r + 8, h.r * 1.05, h.r * 0.38, 0, 0, Math.PI * 2);
  ctx.fill();

  // Outer aura ring reacts to selected cast key
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = auraColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(h.x, h.y + idleBob * 0.3, h.r + 7 + castPulse * 2.1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Main body with gradient for rounded look
  const g = ctx.createRadialGradient(h.x - 3, h.y - 4 + idleBob, 2, h.x, h.y + idleBob, h.r + 2);
  g.addColorStop(0, "#d6f4ff");
  g.addColorStop(1, "#70b7d9");
  ctx.fillStyle = g;
  circle(h.x, h.y + idleBob, h.r);

  // Rim + face core
  ctx.strokeStyle = "rgba(230, 247, 255, 0.58)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(h.x, h.y + idleBob, h.r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(210, 246, 255, 0.5)";
  circle(h.x - 3.5, h.y - 3 + idleBob, Math.max(2.2, h.r * 0.24));

  // Orbiting micro runes hint current power state
  for (let i = 0; i < 2; i++) {
    const a = game.time * 1.9 + i * Math.PI;
    const rx = h.x + Math.cos(a) * (h.r + 5.5);
    const ry = h.y + idleBob + Math.sin(a) * (h.r * 0.42);
    ctx.fillStyle = auraColor;
    ctx.globalAlpha = 0.62;
    circle(rx, ry, 1.6);
    ctx.globalAlpha = 1;
  }
}

function drawEnemies() {
  for (const e of game.enemies) {
    if (!Number.isFinite(e.lastRenderHp) || e.lastRenderHp <= 0) e.lastRenderHp = e.hp;
    const delta = Math.max(0, e.lastRenderHp - e.hp);
    if (delta > 0.4) {
      e.hitFlash = Math.min(0.26, Math.max(e.hitFlash || 0, 0.05 + delta / Math.max(220, e.maxHp * 0.9)));
      if (delta > Math.max(18, e.maxHp * 0.16)) {
        e.critFlash = Math.min(0.32, Math.max(e.critFlash || 0, 0.16));
        if (Math.random() > 0.4) spawnSpark(e.x, e.y, "#fff3ba", 1.1);
      }
      e.lastRenderHp = e.hp;
    }

    const dx = e.x - (Number.isFinite(e.prevX) ? e.prevX : e.x);
    const dy = e.y - (Number.isFinite(e.prevY) ? e.prevY : e.y);
    const speedVis = Math.hypot(dx, dy);

    // Runner streak trail for a clearer speed read.
    if (e.type === "runner" && speedVis > 0.1) {
      const tailLen = Math.min(e.r * 1.6, speedVis * 10.5 + e.r * 0.45);
      const ux = dx / (speedVis || 1);
      const uy = dy / (speedVis || 1);
      const tx = e.x - ux * tailLen;
      const ty = e.y - uy * tailLen;
      ctx.globalAlpha = 0.34;
      drawZigZagLine(e.x, e.y, tx, ty, "rgba(184, 236, 255, 0.62)", 1.4);
      ctx.globalAlpha = 1;
    }

    // Per-type silhouette for faster read: runner diamond, brute hex, boss crown ring, grunt round.
    if (e.type === "runner") {
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y - e.r);
      ctx.lineTo(e.x + e.r * 0.9, e.y);
      ctx.lineTo(e.x, e.y + e.r);
      ctx.lineTo(e.x - e.r * 0.9, e.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(240, 255, 255, 0.34)";
      ctx.lineWidth = 1.3;
      ctx.stroke();
    } else if (e.type === "brute") {
      const stompPhase = (e.stompTimer || 0.2) / 0.4;
      const ringPulse = Math.max(0, Math.min(1, 1 - stompPhase));
      ctx.globalAlpha = 0.12 + ringPulse * 0.12;
      ctx.strokeStyle = "rgba(230, 176, 138, 0.6)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(e.x, e.y + e.r * 0.85, e.r * (0.6 + ringPulse * 0.5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.fillStyle = e.color;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * (Math.PI / 3) + Math.PI / 6;
        const px = e.x + Math.cos(a) * e.r;
        const py = e.y + Math.sin(a) * e.r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 229, 210, 0.35)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    } else if (e.type === "boss") {
      const targetY = game.wall ? game.wall.y - 3 : HEIGHT;
      const nearWall = e.y + e.r >= targetY - 3;
      const atkTele = nearWall ? Math.max(0, 1 - ((e.atkCd || 0) / Math.max(0.3, getEnemyAttackCooldown("boss")))) : 0;
      if (atkTele > 0) {
        ctx.globalAlpha = 0.15 + atkTele * 0.2;
        ctx.strokeStyle = "rgba(255, 120, 120, 0.72)";
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 10 + atkTele * 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = e.color;
      circle(e.x, e.y, e.r);
      ctx.strokeStyle = "rgba(255, 242, 214, 0.52)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 4 + Math.sin(game.time * 3.2) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = e.color;
      circle(e.x, e.y, e.r);
    }

    // Core and shadow make enemies feel less flat.
    ctx.fillStyle = "rgba(20, 12, 12, 0.2)";
    circle(e.x + 2, e.y + 2, Math.max(2.6, e.r * 0.56));
    ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
    circle(e.x - e.r * 0.28, e.y - e.r * 0.24, Math.max(2.2, e.r * 0.28));

    if ((e.hitFlash || 0) > 0) {
      ctx.globalAlpha = Math.min(0.85, e.hitFlash * 2.6);
      ctx.fillStyle = "#ffe8d4";
      circle(e.x, e.y, e.r + 1.4);
      ctx.globalAlpha = 1;
    }
    if ((e.critFlash || 0) > 0) {
      ctx.globalAlpha = Math.min(0.8, e.critFlash * 2.2);
      ctx.strokeStyle = "#fff6cc";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

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
    } else if (z.type === "briar") {
      ctx.fillStyle = "rgba(136, 206, 100, 0.18)";
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(190, 245, 150, 0.65)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      for (let i = 0; i < 5; i++) {
        const a = game.time * 1.2 + i * (Math.PI * 0.4);
        drawZigZagLine(z.x, z.y, z.x + Math.cos(a) * z.r * 0.7, z.y + Math.sin(a) * z.r * 0.7, "rgba(120, 175, 84, 0.55)", 1.1);
      }
    } else if (z.type === "windLine") {
      drawZigZagLine(z.x1, z.y1, z.x2, z.y2, "rgba(190, 245, 255, 0.82)", 5);
    } else if (z.type === "lava") {
      drawFusionBloom(z.x, z.y, z.r * 1.35, "rgba(255, 166, 120, 0.55)", "rgba(255, 110, 56, 0)", 0.22);
      const heat = 0.76 + Math.sin(game.time * 7.5) * 0.2;
      const innerPulse = z.r * (0.45 + 0.06 * Math.sin(game.time * 6.2));

      // Outer heat haze ring
      ctx.fillStyle = `rgba(255, 78, 42, ${0.18 + heat * 0.12})`;
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(255, 148, 98, 0.68)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Molten core
      ctx.fillStyle = `rgba(255, 170, 84, ${0.28 + heat * 0.16})`;
      circle(z.x, z.y, innerPulse);
      ctx.strokeStyle = "rgba(255, 224, 150, 0.54)";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Crack spokes for a distinct magma signature
      for (let i = 0; i < 6; i++) {
        const a = game.time * 0.9 + i * (Math.PI / 3);
        const len = z.r * (0.55 + 0.12 * Math.sin(game.time * 4 + i));
        drawZigZagLine(
          z.x + Math.cos(a) * (innerPulse * 0.25),
          z.y + Math.sin(a) * (innerPulse * 0.25),
          z.x + Math.cos(a) * len,
          z.y + Math.sin(a) * len,
          "rgba(92, 34, 16, 0.65)",
          1.2
        );
      }

      // Ember vents orbiting around the core
      for (let i = 0; i < 4; i++) {
        const a = game.time * 1.8 + i * (Math.PI * 0.5);
        const rr = innerPulse * 0.85;
        ctx.fillStyle = "rgba(255, 210, 122, 0.6)";
        circle(z.x + Math.cos(a) * rr, z.y + Math.sin(a) * rr, 3);
        ctx.fillStyle = "rgba(255, 120, 66, 0.6)";
        circle(z.x + Math.cos(a) * rr * 0.7, z.y + Math.sin(a) * rr * 0.7, 2.2);
      }
    } else if (z.type === "mist") {
      drawFusionBloom(z.x, z.y, z.r * 1.25, "rgba(186, 246, 214, 0.52)", "rgba(126, 202, 178, 0)", 0.2);
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
      drawFusionBloom(z.x, z.y, z.r * 1.25, "rgba(176, 210, 255, 0.48)", "rgba(120, 160, 245, 0)", 0.2);
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
      drawFusionBloom(z.x, z.y, z.r * 1.2, "rgba(255, 218, 150, 0.44)", "rgba(215, 165, 92, 0)", 0.18);
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
    } else if (z.type === "chainField") {
      drawFusionBloom(z.x, z.y, z.r * 1.22, "rgba(220, 184, 255, 0.52)", "rgba(166, 116, 255, 0)", 0.22);
      const pulse = 0.78 + Math.sin(game.time * 11) * 0.18;
      ctx.fillStyle = `rgba(166, 116, 255, ${0.18 * pulse})`;
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(209, 160, 255, 0.7)";
      ctx.lineWidth = 1.8;
      ctx.stroke();
      if (z.linkVisual > 0 && Array.isArray(z.links)) {
        for (const link of z.links) {
          drawZigZagLine(link[0], link[1], link[2], link[3], "rgba(214, 164, 255, 0.85)", 2.1);
        }
      }
    } else if (z.type === "plasma") {
      drawFusionBloom(z.x, z.y, z.r * 1.22, "rgba(255, 190, 226, 0.56)", "rgba(255, 110, 182, 0)", 0.22);
      const pulse = 0.8 + Math.sin(game.time * 8.3) * 0.16;
      ctx.fillStyle = `rgba(255, 104, 170, ${0.18 * pulse})`;
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(255, 178, 220, 0.7)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      drawZigZagLine(z.x - z.r * 0.45, z.y + z.r * 0.2, z.x + z.r * 0.45, z.y - z.r * 0.2, "rgba(255, 190, 230, 0.52)", 1.1);
    } else if (z.type === "riptide") {
      drawFusionBloom(z.x, z.y, z.r * 1.22, "rgba(188, 226, 255, 0.54)", "rgba(118, 178, 255, 0)", 0.2);
      const pulse = 0.8 + Math.sin(game.time * 7.2) * 0.14;
      ctx.fillStyle = `rgba(118, 178, 255, ${0.16 * pulse})`;
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(180, 220, 255, 0.62)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = "rgba(150, 210, 255, 0.4)";
      ctx.arc(z.x, z.y, z.r * 0.55 + Math.sin(game.time * 4.5) * 2.5, 0, Math.PI * 2);
      ctx.stroke();
    } else if (z.type === "overgrowth") {
      drawFusionBloom(z.x, z.y, z.r * 1.22, "rgba(194, 248, 176, 0.56)", "rgba(128, 192, 92, 0)", 0.22);
      ctx.fillStyle = "rgba(150, 220, 120, 0.18)";
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(206, 250, 174, 0.72)";
      ctx.lineWidth = 1.8;
      ctx.stroke();
      if (z.linkVisual > 0 && Array.isArray(z.links)) {
        for (const link of z.links) {
          drawZigZagLine(link[0], link[1], link[2], link[3], "rgba(186, 245, 155, 0.88)", 2.2);
        }
      }
    } else if (z.type === "wildfire") {
      drawFusionBloom(z.x, z.y, z.r * 1.22, "rgba(255, 196, 136, 0.58)", "rgba(255, 116, 72, 0)", 0.22);
      ctx.fillStyle = "rgba(255, 132, 78, 0.18)";
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(255, 212, 146, 0.72)";
      ctx.lineWidth = 1.7;
      ctx.stroke();
      for (let i = 0; i < 4; i++) drawFlame(z.x + Math.cos(game.time * 1.7 + i) * z.r * 0.35, z.y + Math.sin(game.time * 1.5 + i) * z.r * 0.35, 5);
    } else if (z.type === "dustbloom") {
      drawFusionBloom(z.x, z.y, z.r * 1.2, "rgba(240, 224, 164, 0.5)", "rgba(206, 176, 110, 0)", 0.2);
      ctx.fillStyle = "rgba(204, 182, 104, 0.18)";
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(244, 228, 164, 0.68)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      for (let i = 0; i < 5; i++) {
        const a = i * (Math.PI * 0.4) + game.time * 0.8;
        drawZigZagLine(z.x, z.y, z.x + Math.cos(a) * z.r * 0.62, z.y + Math.sin(a) * z.r * 0.62, "rgba(156, 138, 82, 0.58)", 1.1);
      }
    } else if (z.type === "bloomtide") {
      drawFusionBloom(z.x, z.y, z.r * 1.22, "rgba(184, 245, 206, 0.56)", "rgba(124, 214, 178, 0)", 0.22);
      ctx.fillStyle = "rgba(116, 210, 168, 0.16)";
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(198, 255, 226, 0.72)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      drawDropletRing(z.x, z.y, z.r * 0.9, 6);
    } else if (z.type === "pollenstorm") {
      drawFusionBloom(z.x, z.y, z.r * 1.2, "rgba(240, 255, 186, 0.54)", "rgba(206, 230, 120, 0)", 0.22);
      ctx.fillStyle = "rgba(214, 238, 120, 0.16)";
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(245, 255, 176, 0.7)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = game.time * 2.1 + i * (Math.PI / 3);
        circle(z.x + Math.cos(a) * z.r * 0.48, z.y + Math.sin(a) * z.r * 0.3, 2.1);
      }
    } else if (z.type === "lodestone") {
      // Indigo magnetic field: spinning arcs + chain links — distinct from chain (lavender links) and riptide (blue ripple)
      drawFusionBloom(z.x, z.y, z.r * 1.22, "rgba(188, 158, 255, 0.52)", "rgba(102, 68, 196, 0)", 0.22);
      const mag = 0.8 + Math.sin(game.time * 9.5) * 0.18;
      ctx.fillStyle = `rgba(90, 60, 195, ${0.14 * mag})`;
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(186, 152, 255, 0.72)";
      ctx.lineWidth = 1.8;
      ctx.stroke();
      // Three spinning magnetic arc bands
      for (let i = 0; i < 3; i++) {
        const a = game.time * 1.6 + i * (Math.PI * 0.667);
        ctx.beginPath();
        ctx.strokeStyle = `rgba(210, 178, 255, ${0.48 - i * 0.06})`;
        ctx.lineWidth = 1.3;
        ctx.arc(z.x, z.y, z.r * (0.36 + i * 0.22), a, a + Math.PI * 1.2);
        ctx.stroke();
      }
      // Electric chain links between targets
      if (z.linkVisual > 0 && Array.isArray(z.links)) {
        for (const link of z.links) {
          drawZigZagLine(link[0], link[1], link[2], link[3], "rgba(224, 200, 255, 0.90)", 2.0);
        }
      }
    } else if (z.type === "sirocco") {
      // Amber scorching wind: asymmetric flame wisps + upward arrow streams — distinct from mist/wildfire
      drawFusionBloom(z.x, z.y, z.r * 1.22, "rgba(255, 186, 108, 0.56)", "rgba(255, 104, 36, 0)", 0.22);
      const heat = 0.8 + Math.sin(game.time * 7.2) * 0.14;
      ctx.fillStyle = `rgba(255, 120, 46, ${0.15 * heat})`;
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(255, 190, 128, 0.68)";
      ctx.lineWidth = 1.7;
      ctx.stroke();
      // Upward wind streamers (push direction) — no full circles, just swept lines
      for (let i = 0; i < 4; i++) {
        const xOff = (i - 1.5) * z.r * 0.38;
        const wavble = Math.sin(game.time * 3.5 + i * 1.4) * 6;
        drawZigZagLine(
          z.x + xOff + wavble, z.y + z.r * 0.42,
          z.x + xOff - wavble, z.y - z.r * 0.78,
          `rgba(255, 210, 128, ${0.5 + i * 0.04})`, 1.2
        );
      }
      // Fire wisps
      for (let i = 0; i < 3; i++) {
        drawFlame(
          z.x + Math.cos(game.time * 2.0 + i * 2.1) * z.r * 0.34,
          z.y + Math.sin(game.time * 1.6 + i * 2.1) * z.r * 0.28,
          4.5
        );
      }
    } else if (z.type === "dustdevil") {
      // Spinning sand vortex: nested rotating arcs + orbiting dust motes — distinct from quicksand/dustbloom
      drawFusionBloom(z.x, z.y, z.r * 1.22, "rgba(228, 196, 124, 0.5)", "rgba(176, 140, 62, 0)", 0.2);
      const spin = game.time * 2.8;
      ctx.fillStyle = "rgba(190, 160, 88, 0.15)";
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(226, 196, 126, 0.65)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Nested spinning arc rings — the vortex funnel shape
      for (let ring = 0; ring < 3; ring++) {
        const rr = z.r * (0.28 + ring * 0.25);
        const startA = spin + ring * (Math.PI * 0.667);
        ctx.beginPath();
        ctx.strokeStyle = `rgba(214, 178, 100, ${0.52 - ring * 0.1})`;
        ctx.lineWidth = 1.6 - ring * 0.3;
        ctx.arc(z.x, z.y, rr, startA, startA + Math.PI * 1.4);
        ctx.stroke();
      }
      // Orbiting sand/dust particles
      for (let i = 0; i < 8; i++) {
        const a = spin * 1.4 + i * (Math.PI / 4);
        const rr = z.r * (0.5 + 0.1 * Math.sin(game.time * 4.2 + i));
        ctx.fillStyle = `rgba(212, 176, 102, 0.45)`;
        circle(z.x + Math.cos(a) * rr, z.y + Math.sin(a) * rr * 0.72, 2.2);
      }
    } else if (z.type === "triad" && z.variant === "monsoon") {
      drawFusionBloom(z.x, z.y, z.r * 1.24, "rgba(184, 242, 255, 0.54)", "rgba(115, 215, 255, 0)", 0.22);
      const pulse = 0.75 + Math.sin(game.time * 9) * 0.2;
      ctx.fillStyle = `rgba(115, 215, 255, ${0.18 * pulse})`;
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(170, 240, 255, 0.68)";
      ctx.lineWidth = 2;
      ctx.stroke();
      drawZigZagLine(z.x - z.r * 0.5, z.y, z.x + z.r * 0.5, z.y, "rgba(210, 250, 255, 0.55)", 1.5);
    } else if (z.type === "triad" && z.variant === "sandglass") {
      drawFusionBloom(z.x, z.y, z.r * 1.2, "rgba(255, 226, 170, 0.5)", "rgba(255, 176, 110, 0)", 0.2);
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
      drawFusionBloom(z.x, z.y, z.r * 1.2, "rgba(255, 194, 152, 0.46)", "rgba(208, 122, 86, 0)", 0.2);
      const wobble = Math.sin(game.time * 5.5) * 0.18;
      ctx.fillStyle = `rgba(208, 122, 86, ${0.22 + wobble * 0.08})`;
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(255, 182, 130, 0.55)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "rgba(120, 80, 58, 0.18)";
      circle(z.x + 4, z.y - 3, z.r * 0.52);
    } else if (z.type === "triad" && z.variant === "blizzard") {
      drawFusionBloom(z.x, z.y, z.r * 1.24, "rgba(220, 248, 255, 0.58)", "rgba(164, 220, 255, 0)", 0.23);
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
    } else if (z.type === "triad" && z.variant === "thornforge") {
      drawFusionBloom(z.x, z.y, z.r * 1.22, "rgba(255, 214, 162, 0.56)", "rgba(204, 146, 92, 0)", 0.22);
      ctx.fillStyle = "rgba(212, 154, 98, 0.2)";
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(255, 224, 176, 0.7)";
      ctx.lineWidth = 1.7;
      ctx.stroke();
      for (let i = 0; i < 6; i++) drawZigZagLine(z.x, z.y, z.x + Math.cos(i * Math.PI / 3) * z.r * 0.68, z.y + Math.sin(i * Math.PI / 3) * z.r * 0.68, "rgba(139, 108, 60, 0.56)", 1.1);
    } else if (z.type === "triad" && z.variant === "canopy") {
      drawFusionBloom(z.x, z.y, z.r * 1.24, "rgba(196, 248, 220, 0.58)", "rgba(132, 220, 176, 0)", 0.22);
      ctx.fillStyle = "rgba(124, 216, 174, 0.18)";
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(210, 255, 234, 0.72)";
      ctx.lineWidth = 1.7;
      ctx.stroke();
      for (let i = 0; i < 5; i++) {
        const a = game.time * 1.1 + i * (Math.PI * 0.4);
        circle(z.x + Math.cos(a) * z.r * 0.42, z.y + Math.sin(a) * z.r * 0.22, 2.4);
      }
    } else if (z.type === "triad" && z.variant === "briarstorm") {
      drawFusionBloom(z.x, z.y, z.r * 1.22, "rgba(224, 250, 176, 0.56)", "rgba(180, 220, 98, 0)", 0.22);
      ctx.fillStyle = "rgba(182, 224, 108, 0.18)";
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(244, 255, 188, 0.7)";
      ctx.lineWidth = 1.7;
      ctx.stroke();
      drawZigZagLine(z.x - z.r * 0.5, z.y + z.r * 0.18, z.x + z.r * 0.5, z.y - z.r * 0.18, "rgba(230, 255, 172, 0.55)", 1.3);
    } else if (z.type === "triad" && z.variant === "sunbloom") {
      drawFusionBloom(z.x, z.y, z.r * 1.22, "rgba(255, 236, 166, 0.58)", "rgba(255, 196, 94, 0)", 0.22);
      ctx.fillStyle = "rgba(255, 206, 102, 0.18)";
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(255, 246, 194, 0.72)";
      ctx.lineWidth = 1.7;
      ctx.stroke();
      for (let i = 0; i < 5; i++) drawFlame(z.x + Math.cos(game.time * 1.4 + i) * z.r * 0.3, z.y + Math.sin(game.time * 1.1 + i) * z.r * 0.3, 4.4);
    } else if (z.type === "apex" && z.variant === "cataclysm") {
      drawFusionBloom(z.x, z.y, z.r * 1.26, "rgba(248, 230, 255, 0.64)", "rgba(226, 170, 255, 0)", 0.26);
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
    } else if (z.type === "apex" && z.variant === "worldroot") {
      drawFusionBloom(z.x, z.y, z.r * 1.26, "rgba(230, 255, 204, 0.64)", "rgba(178, 230, 144, 0)", 0.26);
      ctx.fillStyle = "rgba(176, 228, 128, 0.18)";
      circle(z.x, z.y, z.r);
      ctx.strokeStyle = "rgba(232, 255, 214, 0.82)";
      ctx.lineWidth = 2.1;
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = i * (Math.PI / 4) + game.time * 0.9;
        drawZigZagLine(z.x, z.y, z.x + Math.cos(a) * z.r * 0.68, z.y + Math.sin(a) * z.r * 0.68, "rgba(214, 255, 180, 0.58)", 1.2);
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

function drawCastPulses() {
  if (!Array.isArray(game.castPulses)) return;
  for (const p of game.castPulses) {
    const t = Math.max(0, p.life / p.maxLife);
    const r = p.radius * (1.1 - t * 0.35);
    ctx.globalAlpha = Math.min(1, 0.36 * t);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2 + (1 - t) * 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function getSynergyStateTag(key) {
  if (key === "mist") return "PULSE+HEAL";
  if (key === "storm") return "STRIKE";
  if (key === "chain") return "FORK";
  if (key === "plasma") return "SURGE";
  if (key === "riptide") return "FLOW";
  if (key === "quicksand") return "PULL+CRUSH";
  if (key === "overgrowth") return "VINECHAIN";
  if (key === "wildfire") return "BURN+ROOT";
  if (key === "dustbloom") return "SNARE+CRUSH";
  if (key === "bloomtide") return "HEAL+ROOT";
  if (key === "pollenstorm") return "SWIRL";
  if (key === "magma") return "ERUPT";
  if (key === "monsoon") return "GALE+SURGE";
  if (key === "sandglass") return "SEAR+SNARE";
  if (key === "mudflow") return "PULL+BURST";
  if (key === "blizzard") return "FREEZE+SHOCK";
  if (key === "thornforge") return "SPIKE+BURN";
  if (key === "canopy") return "ROOT+HEAL";
  if (key === "briarstorm") return "GALE+ROOT";
  if (key === "sunbloom") return "BURST+BURN";
  if (key === "cataclysm") return "APEX";
  if (key === "worldroot") return "APEX";
  if (key === "lodestone") return "PULL+ZAP";
  if (key === "sirocco") return "SEAR+GUST";
  if (key === "dustdevil") return "SPIN+SNARE";
  return "";
}

function getSynergyTagColors(key) {
  if (key === "mist") return { bg: "rgba(130, 220, 176, 0.2)", line: "rgba(160, 250, 205, 0.6)", text: "#b9ffe0" };
  if (key === "storm") return { bg: "rgba(120, 170, 255, 0.2)", line: "rgba(170, 210, 255, 0.65)", text: "#d8ecff" };
  if (key === "chain") return { bg: "rgba(180, 132, 255, 0.24)", line: "rgba(215, 170, 255, 0.72)", text: "#f0dbff" };
  if (key === "plasma") return { bg: "rgba(255, 130, 188, 0.24)", line: "rgba(255, 192, 225, 0.72)", text: "#ffe0ef" };
  if (key === "riptide") return { bg: "rgba(130, 190, 255, 0.22)", line: "rgba(186, 225, 255, 0.68)", text: "#e3f2ff" };
  if (key === "quicksand") return { bg: "rgba(200, 165, 95, 0.24)", line: "rgba(230, 200, 130, 0.65)", text: "#ffe6b8" };
  if (key === "overgrowth") return { bg: "rgba(150, 220, 120, 0.24)", line: "rgba(196, 247, 160, 0.68)", text: "#ecffd8" };
  if (key === "wildfire") return { bg: "rgba(255, 158, 102, 0.24)", line: "rgba(255, 214, 150, 0.7)", text: "#fff0d1" };
  if (key === "dustbloom") return { bg: "rgba(213, 190, 118, 0.24)", line: "rgba(245, 226, 160, 0.68)", text: "#fff2c8" };
  if (key === "bloomtide") return { bg: "rgba(124, 224, 174, 0.22)", line: "rgba(185, 250, 220, 0.7)", text: "#e6fff2" };
  if (key === "pollenstorm") return { bg: "rgba(214, 238, 132, 0.22)", line: "rgba(240, 255, 180, 0.7)", text: "#fbffd8" };
  if (key === "magma") return { bg: "rgba(255, 120, 80, 0.22)", line: "rgba(255, 170, 130, 0.68)", text: "#ffd2bf" };
  if (key === "monsoon") return { bg: "rgba(112, 214, 255, 0.24)", line: "rgba(177, 240, 255, 0.7)", text: "#d2f6ff" };
  if (key === "sandglass") return { bg: "rgba(255, 186, 122, 0.24)", line: "rgba(255, 221, 168, 0.7)", text: "#ffe8c8" };
  if (key === "mudflow") return { bg: "rgba(217, 134, 95, 0.24)", line: "rgba(252, 184, 148, 0.68)", text: "#ffe0d1" };
  if (key === "blizzard") return { bg: "rgba(170, 225, 255, 0.24)", line: "rgba(220, 247, 255, 0.75)", text: "#ecfaff" };
  if (key === "thornforge") return { bg: "rgba(226, 173, 113, 0.24)", line: "rgba(255, 218, 166, 0.72)", text: "#fff0d7" };
  if (key === "canopy") return { bg: "rgba(124, 220, 180, 0.24)", line: "rgba(188, 252, 224, 0.72)", text: "#e7fff5" };
  if (key === "briarstorm") return { bg: "rgba(190, 232, 130, 0.24)", line: "rgba(234, 255, 184, 0.72)", text: "#fbffd9" };
  if (key === "sunbloom") return { bg: "rgba(255, 214, 120, 0.24)", line: "rgba(255, 240, 182, 0.72)", text: "#fff6d8" };
  if (key === "cataclysm") return { bg: "rgba(222, 168, 255, 0.28)", line: "rgba(244, 218, 255, 0.82)", text: "#fff2ff" };
  if (key === "worldroot") return { bg: "rgba(186, 238, 160, 0.28)", line: "rgba(228, 255, 214, 0.82)", text: "#f4ffe8" };
  if (key === "lodestone") return { bg: "rgba(138, 102, 224, 0.24)", line: "rgba(198, 166, 255, 0.72)", text: "#ede0ff" };
  if (key === "sirocco") return { bg: "rgba(255, 148, 64, 0.24)", line: "rgba(255, 202, 140, 0.72)", text: "#fff0d0" };
  if (key === "dustdevil") return { bg: "rgba(196, 166, 82, 0.24)", line: "rgba(230, 202, 132, 0.7)", text: "#fff4d0" };
  return { bg: "rgba(122, 232, 216, 0.16)", line: "rgba(122, 232, 216, 0.55)", text: "#9ef3e7" };
}

function drawPowerBar() {
  if (!game.powers) return;
  powerBarBoxes = [];

  const fusion = getActiveFusionState();
  const consumed = fusion.consumed;
  const activeComboKeys = fusion.activeComboKeys;
  const sourcesByKey = fusion.sourcesByKey;

  // Build display list: only unlocked, non-consumed base powers + active combos
  const displayKeys = [];
  for (const k of basePowerOrder) {
    if (game.powers[k] && game.powers[k].unlocked && !consumed.has(k)) displayKeys.push(k);
  }
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
  for (const def of APEX_COMBO_DEFS) {
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

    // Rune tile background + frame
    const tileGrad = ctx.createLinearGradient(x, y, x, y + BOX_H);
    if (isActive && isCombo) {
      tileGrad.addColorStop(0, "#112735");
      tileGrad.addColorStop(1, "#0a1521");
    } else if (isActive) {
      tileGrad.addColorStop(0, "#2b2217");
      tileGrad.addColorStop(1, "#16131d");
    } else {
      tileGrad.addColorStop(0, "#1b2432");
      tileGrad.addColorStop(1, "#111722");
    }
    ctx.fillStyle = tileGrad;
    ctx.fillRect(x, y, BOX_W, BOX_H);

    ctx.lineWidth = isActive && isCombo ? 2 : 1;
    ctx.strokeStyle = isActive && isCombo ? "#7ae8d8"
      : isActive ? "#ffd285"
      : isConsumed ? "#7ae8d855"
      : "#41506a";
    ctx.strokeRect(x, y, BOX_W, BOX_H);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 2, y + 2, BOX_W - 4, BOX_H - 4);

    if (game.selectedCastKey === key && p.unlocked) {
      ctx.strokeStyle = "#7ee89f";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, BOX_W - 2, BOX_H - 2);
    }

    // Name + Level
    ctx.fillStyle = isConsumed ? "#7ae8d888" : isActive ? p.color : "#6f7a8a";
    ctx.font = "bold 10px Trebuchet MS";
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

    // CD bar + radial rune cooldown
    const cooldownRef = isCombo ? game.powers[key].cd : p.cd;
    const cdRatio = isActive && cooldownRef > 0
      ? 1 - game.powers[key].timer / (cooldownRef * (game.cooldownMul || 1)) : 0;
    ctx.fillStyle = "#112031";
    ctx.fillRect(x + 6, y + 32, BOX_W - 12, 7);
    ctx.fillStyle = !isActive ? "#4d5766" : game.powers[key].timer <= 0 ? "#7ee89f" : "#8cb7ff";
    ctx.fillRect(x + 6, y + 32, (BOX_W - 12) * Math.max(0, Math.min(1, cdRatio)), 7);

    const rx = x + BOX_W - 12;
    const ry = y + 22;
    ctx.fillStyle = "rgba(8, 15, 25, 0.9)";
    circle(rx, ry, 8.5);
    ctx.strokeStyle = "rgba(190, 210, 240, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(rx, ry, 8.5, 0, Math.PI * 2);
    ctx.stroke();
    if (isActive) {
      const clamped = Math.max(0, Math.min(1, cdRatio));
      ctx.fillStyle = game.powers[key].timer <= 0 ? "rgba(126, 232, 159, 0.92)" : "rgba(148, 183, 255, 0.88)";
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.arc(rx, ry, 7.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamped);
      ctx.closePath();
      ctx.fill();
    }

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
