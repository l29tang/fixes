// ============================================================
// TACTIC — a small platformer about Tourette Syndrome
// Engine: plain canvas 2D, fixed-timestep-ish update loop.
// ============================================================

let blinkState = { visible: true, timer: 0 };

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const VIEW_W = 1280;
const VIEW_H = 720;

const GRAVITY = 1800; // px/s^2
const JUMP_VELOCITY = -680; // px/s
const MOVE_SPEED = 320; // px/s
const FRICTION_GROUND = 0.0; // (instant accel model, kept for tuning)
const PLAYER_W = 28;
const PLAYER_H = 64;
const TRAP_FALL_DELAY = 0.28; // seconds between jump-trigger and collapse
const TRAP_TRIGGER_RANGE = 520; // how far from player a trap can be armed

let world = null; // the one continuous map (mutable runtime state)
let checkpoint = { x: 0, y: 0 }; // latest activated mailbox (or the world start)
let player = null;
let camera = { x: 0 };
let keys = { left: false, right: false, up: false };
let lastTime = null;
let gameTime = 0;
let deathFlashTimer = 0;
let hazardSpawner = null; // interval ID for the dynamic section-1 hazard
let isPaused = false;

const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const overlayBtn = document.getElementById("overlay-btn");
const levelLabel = document.getElementById("level-label");
const restartBtn = document.getElementById("restart-btn");

const BOX_SRC = "assets/images/2box.png";
const DOG_SRC = "assets/images/dog.png";
const HAZARD_W = 79;
const HAZARD_H = 56;

const boxImg = new Image();
boxImg.src = BOX_SRC;
let boxLoaded = false;

// Level 1 / Stage 1's dynamic hazard uses dog.png instead of box.png (same
// size, same mechanics — just a different sprite so the very first
// hazard the player meets reads a little friendlier). The static hazards
// in the last stage keep box.png.
const dogImg = new Image();
dogImg.src = DOG_SRC;
let dogLoaded = false;

const SPRITE_SHEET_SRC = "assets/images/mailman.png";

const SPRITE_FRAME_W = 117;
const SPRITE_FRAME_H = 189;
const SPRITE_COLS = 4;
const SPRITE_FRAME_DURATION = 0.12;

const spriteSheet = new Image();

let spriteLoaded = false;

function preloadSprite() {
  return new Promise((resolve) => {
    spriteSheet.onload = () => {
      spriteLoaded = true;
      console.log("Sprite loaded successfully");
      resolve(true);
    };

    spriteSheet.onerror = () => {
      console.error("FAILED TO LOAD SPRITE:", SPRITE_SHEET_SRC);
      resolve(false); // game still runs
    };

    spriteSheet.src = SPRITE_SHEET_SRC;
  });
}

// Mailbox (replaces the plain door rectangle), level background art,
// and the title-screen background. Door rects in levels.js are 56x90,
// matching mailboxup.png/mailboxdown.png's native size, so the door
// hitbox doubles as the mailbox hitbox with no changes needed there —
// including levels that override the door's y position (e.g. Level 5).
// Mailboxes render "up" until their checkpoint is reached, then swap to
// "down" to show the stage has been passed.
const MAILBOX_UP_SRC = "assets/images/mailboxup.png";
const MAILBOX_DOWN_SRC = "assets/images/mailboxdown.png";
// BG.png is one continuous 6400x720 backdrop — exactly the width of the
// whole 5-stage map (5 x 1280) — so it's drawn once in world space and
// pans naturally with the camera instead of sitting fixed to the screen.
const LEVEL_BG_SRC = "assets/images/BG.png";
const TITLE_BG_SRC = "assets/images/titlebg.png";

const mailboxUpImg = new Image();
const mailboxDownImg = new Image();
const levelBgImg = new Image();
const titleBgImg = new Image();

let mailboxUpLoaded = false;
let mailboxDownLoaded = false;
let levelBgLoaded = false;
let titleBgLoaded = false;

function preloadImage(img, src, onDone) {
  return new Promise((resolve) => {
    img.onload = () => {
      onDone(true);
      resolve(true);
    };
    img.onerror = () => {
      console.error("FAILED TO LOAD IMAGE:", src);
      onDone(false);
      resolve(false); // game still runs with a flat-color fallback
    };
    img.src = src;
  });
}

function preloadAllAssets() {
  return Promise.all([
    preloadSprite(),
    preloadImage(mailboxUpImg, MAILBOX_UP_SRC, (ok) => (mailboxUpLoaded = ok)),
    preloadImage(
      mailboxDownImg,
      MAILBOX_DOWN_SRC,
      (ok) => (mailboxDownLoaded = ok),
    ),
    preloadImage(levelBgImg, LEVEL_BG_SRC, (ok) => (levelBgLoaded = ok)),
    preloadImage(titleBgImg, TITLE_BG_SRC, (ok) => (titleBgLoaded = ok)),
    preloadImage(boxImg, BOX_SRC, (ok) => (boxLoaded = ok)),
    preloadImage(dogImg, DOG_SRC, (ok) => (dogLoaded = ok)),
  ]);
}

function makePlayer(spawn) {
  return {
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    w: PLAYER_W,
    h: PLAYER_H,
    grounded: false,
    wasGrounded: false,
    facing: 1,
    alive: true,
    standingTrapId: null,
  };
}

function freshTrapState() {
  return WORLD.trapGround.map((t) => ({
    ...t,
    // `prefallen` lets a section (e.g. the old Level 4's gap-seed) start
    // already collapsed, so it renders as an open pit from the very first
    // frame.
    armed: t.prefallen || false,
    fallTimer: 0,
    fallen: t.prefallen || false,
    fallOffset: t.prefallen ? 400 : 0,
  }));
}

// Builds the one continuous map from scratch. Called once at startup and
// again when the player returns to the main menu (a full game reset).
function loadWorld() {
  blinkState = { visible: true, timer: 0 };

  world = {
    def: WORLD,
    trapState: freshTrapState(),
    movingPlatforms: WORLD.movingPlatforms.map((p) => ({ ...p })),
    // mutable copies so `activated` can flip on without touching WORLD
    mailboxes: WORLD.mailboxes.map((m) => ({ ...m })),
  };

  // Restore each checkpoint's activated/glow state from the saved
  // Progress (level-select.js) rather than always starting blank, so
  // returning to the main menu doesn't visually "forget" cleared stages.
  syncMailboxActivationFromProgress();

  checkpoint = { x: WORLD.spawn.x, y: WORLD.spawn.y };
  player = makePlayer(checkpoint);
  camera.x = clampCamera(player.x + player.w / 2);
  updateLevelLabel();

  // ensure input state is reset and clear pause state
  keys.left = keys.right = keys.up = false;
  isPaused = false;
  const menuBtn = document.getElementById("overlay-menu-btn");
  if (menuBtn) menuBtn.remove();

  if (hazardSpawner !== null) {
    clearInterval(hazardSpawner);
    hazardSpawner = null;
  }

  initDynamicHazard();
  initGapExpansion();
}

// Puts the player back at the latest checkpoint and resets the map's
// resettable hazards (falling traps, the expanding gap, the flashing
// hazard, the blink cycle) without touching already-activated mailboxes —
// checkpoints, once reached, stay reached.
function respawnPlayer() {
  world.trapState = freshTrapState();
  world.movingPlatforms = WORLD.movingPlatforms.map((p) => ({ ...p }));
  blinkState = { visible: true, timer: 0 };

  if (hazardSpawner !== null) {
    clearInterval(hazardSpawner);
    hazardSpawner = null;
  }
  initDynamicHazard();
  initGapExpansion();

  player = makePlayer(checkpoint);
  camera.x = clampCamera(player.x + player.w / 2);
  keys.left = keys.right = keys.up = false;
}

// The old dynamic red-cube hazard from "Level 1" — kept scoped to that
// section's stretch of the map, since it was only ever meant to threaten
// that part of the level.
function initDynamicHazard() {
  const section = WORLD.sections[0];
  const doorForSection = world.mailboxes[0];
  const hw = HAZARD_W;
  const hh = HAZARD_H;
  const minGapPlayer = 200; // avoid spawning too close to player center
  const minGapDoor = 180; // avoid spawning too close to mailbox center
  const leftBound = section.startX;
  const rightBound = Math.max(section.startX, section.endX - hw);
  const pickX = () => {
    let attempts = 0;
    while (attempts < 50) {
      const nx =
        Math.floor(Math.random() * (rightBound - leftBound + 1)) + leftBound;
      const hazardCenter = nx + hw / 2;
      const playerCenter = player.x + player.w / 2;
      const doorCenter = doorForSection.x + doorForSection.width / 2;
      if (
        Math.abs(hazardCenter - playerCenter) >= minGapPlayer &&
        Math.abs(hazardCenter - doorCenter) >= minGapDoor
      ) {
        return nx;
      }
      attempts++;
    }
    // fallback if we couldn't find a spot after many attempts
    return Math.floor(Math.random() * (rightBound - leftBound + 1)) + leftBound;
  };

  // sprite: "dog" — Stage 1's hazard renders as dog.png instead of
  // box.png (same size/mechanics, just a different look for this stage).
  world.dynamicHazard = { x: pickX(), width: hw, height: hh, sprite: "dog" };
  hazardSpawner = setInterval(() => {
    if (!world) return;
    const oldX = world.dynamicHazard ? world.dynamicHazard.x : -9999;
    let nx = pickX();
    // avoid trivial repeats
    let attempts = 0;
    while (Math.abs(nx - oldX) < 8 && attempts < 8) {
      nx = pickX();
      attempts++;
    }
    world.dynamicHazard = { x: nx, width: hw, height: hh, sprite: "dog" };
  }, 1500);
}

// Which of the 5 original levels does world-x `x` fall inside? Drives the
// section-specific mechanics below (slippery movement, the expanding gap,
// the blink cycle) now that they all share one map instead of separate
// pages.
function getSectionIndexForX(x) {
  for (const s of WORLD.sections) {
    if (x >= s.startX && x < s.endX) return s.index;
  }
  return WORLD.sections[WORLD.sections.length - 1].index;
}

function updateLevelLabel() {
  const idx = getSectionIndexForX(player.x);
  levelLabel.textContent = WORLD.sections[idx].title.split("—")[0].trim();
}

function clampCamera(targetX) {
  const half = VIEW_W / 2;
  let cx = targetX - half;
  cx = Math.max(0, cx);
  cx = Math.min(Math.max(0, WORLD.width - VIEW_W), cx);
  if (WORLD.width < VIEW_W) cx = 0;
  return cx;
}

// Toggles the title-screen art background on the overlay. Only used for the
// very first "Press Play" screen, since titlebg.png already has "TACTIC /
// TITLE PAGE" drawn into the art itself — so we hide the duplicate <h1> on
// that screen only and restore it everywhere else (level intros, pause,
// end screen) which keep the plain dark overlay styling.
function setTitleBackground(active) {
  if (active) {
    overlay.classList.add("title-bg");
    overlayTitle.style.display = "none";
  } else {
    overlay.classList.remove("title-bg");
    overlayTitle.style.display = "";
  }
}

function showStartOverlay() {
  setTitleBackground(true);
  overlayTitle.textContent = "TACTIC";
  overlayBtn.textContent = "Play";
  overlay.classList.remove("hidden");
  overlay.dataset.end = "";
  // Flags this as the title screen so the shared button handler below
  // knows "Play" should open Level Select rather than just dismissing
  // the overlay.
  overlay.dataset.title = "1";
}

function showEndOverlay() {
  setTitleBackground(false);

  overlayTitle.textContent = "You made it!";
  overlayText.textContent =
    "You've reached the end of the road, checkpoint by checkpoint.";
  overlayBtn.textContent = "Return To Menu";
  overlay.classList.remove("hidden");
  overlay.dataset.end = "1";
}

overlayBtn.addEventListener("click", () => {
  if (overlay.dataset.title === "1") {
    // "Play" on the title screen — hand off to the level-select screen
    // instead of dropping straight into gameplay. This is also where a
    // returning player picks up wherever they left off.
    overlay.dataset.title = "";
    overlay.classList.add("hidden");
    showLevelSelect();
    return;
  }
  if (overlay.dataset.pauseAction === "restart") {
    overlay.dataset.pauseAction = "";
    isPaused = false;
    const menuBtn = document.getElementById("overlay-menu-btn");
    if (menuBtn) menuBtn.remove();
    respawnPlayer();
    overlay.classList.add("hidden");
  } else if (overlay.dataset.end === "1") {
    overlay.dataset.end = "";

    loadWorld();
    showStartOverlay();
  } else {
    overlay.classList.add("hidden");
  }
});

restartBtn.addEventListener("click", () => {
  respawnPlayer();
});

window.addEventListener("keydown", (e) => {
  if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = true;
  if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = true;
  if (e.code === "ArrowUp" || e.code === "Space" || e.code === "KeyW") {
    keys.up = true;
  }
  if (e.code === "Escape") {
    if (!isPaused && overlay.classList.contains("hidden")) {
      // show pause menu
      isPaused = true;
      setTitleBackground(false);
      overlayTitle.textContent = "PAUSED";
      overlayBtn.textContent = "Restart From Checkpoint";
      overlay.dataset.pauseAction = "restart";
      overlay.classList.remove("hidden");
      // add main menu button if not already there
      let menuBtn = document.getElementById("overlay-menu-btn");
      if (!menuBtn) {
        menuBtn = document.createElement("button");
        menuBtn.id = "overlay-menu-btn";
        menuBtn.textContent = "Main Menu";
        menuBtn.style.marginLeft = "10px";
        overlayBtn.parentNode.insertBefore(menuBtn, overlayBtn.nextSibling);
        menuBtn.addEventListener("click", () => {
          isPaused = false;
          overlay.dataset.pauseAction = "";

          const menuBtn = document.getElementById("overlay-menu-btn");
          if (menuBtn) menuBtn.remove();

          loadWorld(); // RESET GAME STATE (whole map, back to the first checkpoint)
          showStartOverlay(); // SHOW TITLE SCREEN PROPERLY
        });
      }
    } else if (isPaused) {
      // ESC to resume
      isPaused = false;
      overlay.dataset.pauseAction = "";
      const menuBtn = document.getElementById("overlay-menu-btn");
      if (menuBtn) menuBtn.remove();
      overlay.classList.add("hidden");
    }
    e.preventDefault();
  }
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space"].includes(e.code)) {
    e.preventDefault();
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "ArrowLeft" || e.code === "KeyA") keys.left = false;
  if (e.code === "ArrowRight" || e.code === "KeyD") keys.right = false;
  if (e.code === "ArrowUp" || e.code === "Space" || e.code === "KeyW") {
    keys.up = false;
  }
});

// ------------------------------------------------------------
// Collision helpers
// ------------------------------------------------------------

function getGroundSegmentsAt(x) {
  // returns array of {left, right, top} solid ground spans at world x
  // Start with the defined ground segments, then subtract any fallen trap ranges
  const segs = [];
  for (const g of world.def.ground) {
    segs.push({ left: g.x, right: g.x + g.width, top: world.def.groundY });
  }

  for (const t of world.trapState) {
    if (!t.fallen) continue;
    const newSegs = [];
    for (const s of segs) {
      // no overlap
      if (t.x >= s.right || t.x + t.width <= s.left) {
        newSegs.push(s);
        continue;
      }
      // left piece
      if (t.x > s.left) {
        newSegs.push({
          left: s.left,
          right: Math.min(t.x, s.right),
          top: s.top,
        });
      }
      // right piece
      const rightStart = t.x + t.width;
      if (rightStart < s.right) {
        newSegs.push({
          left: Math.max(rightStart, s.left),
          right: s.right,
          top: s.top,
        });
      }
    }
    segs.length = 0;
    segs.push(...newSegs);
  }

  if (world.def.blocks && world.def.blocks.length) {
    for (const b of world.def.blocks) {
      segs.push({
        left: b.x,
        right: b.x + b.width,
        top: world.def.groundY - b.height,
      });
    }
  }

  return segs;
}

function getAllHazards() {
  const staticHazards = world.def.hazards || [];
  const dyn = world.dynamicHazard ? [world.dynamicHazard] : [];
  return staticHazards.concat(dyn);
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// ------------------------------------------------------------
// Update
// ------------------------------------------------------------

function triggerJumpTraps() {
  // Called the instant the player leaves the ground via a jump.
  for (const t of world.trapState) {
    if (t.armed || t.fallen) continue;
    const centerX = t.x + t.width / 2;
    if (Math.abs(centerX - (player.x + player.w / 2)) <= TRAP_TRIGGER_RANGE) {
      t.armed = true;
      t.fallTimer = TRAP_FALL_DELAY;
    }
  }
}

function killPlayer() {
  if (!player.alive) return;
  player.alive = false;
  deathFlashTimer = 0.5;
  setTimeout(() => {
    respawnPlayer();
  }, 420);
}

function updateMovingPlatforms(dt) {
  for (const p of world.movingPlatforms) {
    const t = gameTime * p.speed * 0.01 + p.phase * Math.PI;
    // ping-pong via sine wave for smooth back-and-forth motion
    const norm = (Math.sin(t) + 1) / 2; // 0..1
    p.currentX = p.x + norm * p.range;
  }
}

function updateTraps(dt) {
  for (const t of world.trapState) {
    if (t.armed && !t.fallen) {
      t.fallTimer -= dt;
      if (t.fallTimer <= 0) {
        t.fallen = true;
      }
    }
    if (t.fallen && t.fallOffset < 400) {
      t.fallOffset += 1400 * dt;
    }
  }
}

// ---------- Section 4 (old "Level 4") gap expansion ----------
// Attached to `world` at load time as world.gapExpansion:
// {
//   triggered: false,
//   x: <section start> + 380, // left edge of gap (never moves)
//   width: 80,                // current gap width — grows rightward
//   maxWidth: 700,            // stops well short of the mailbox shelf
//   speed: 190,               // px/s the gap expands (tune this for difficulty)
// }
function initGapExpansion() {
  // Section 4 is the old Level 4. Its gap-seed trap lives at
  // (section start + 380) in world space; maxWidth is tuned so the gap
  // stops well short of that section's mailbox.
  const section = WORLD.sections[3];
  world.gapExpansion = {
    triggered: false,
    x: section.startX + 380,
    width: 80,
    maxWidth: 700,
    speed: 190,
  };
}

function updateGapExpansion(dt) {
  const g = world.gapExpansion;
  if (!g) return;

  // Trigger: player has crossed the gap and is standing on the right side
  if (!g.triggered) {
    const playerCenterX = player.x + player.w / 2;
    if (player.grounded && playerCenterX > g.x + g.width) {
      g.triggered = true;
    }
  }

  if (!g.triggered) return;

  // Grow the gap rightward
  g.width = Math.min(g.maxWidth, g.width + g.speed * dt);

  // Sync the trapState entry so the renderer and collision system see it
  const t = world.trapState.find((t) => t.id === "gap-seed");
  if (t) {
    t.width = g.width;
    // Make sure it's in the fully-fallen state so it renders black and
    // its ground is subtracted from getGroundSegmentsAt
    t.fallen = true;
    t.fallOffset = 400;
  }
}

// ---------- Section 5 (old "Level 5") flashing hazard boxes ----------
// Drives blinkState.visible, which the last stage's `flash`-tagged
// hazard boxes use to fade in/out (see the hazard loop in draw()). The
// player itself is always drawn normally now.
function updateBlink(dt) {
  if (getSectionIndexForX(player.x) !== 4) {
    blinkState.visible = true;
    return;
  }

  blinkState.timer -= dt;
  if (blinkState.timer <= 0) {
    blinkState.visible = !blinkState.visible;
    if (blinkState.visible) {
      // visible for a moderate random duration
      blinkState.timer = 0.4 + Math.random() * 0.9;
    } else {
      // invisible for a short random duration — feels like a blink not a vanish
      blinkState.timer = 0.08 + Math.random() * 0.18;
    }
  }
}

function update(dt) {
  if (!player.alive) return;

  updateMovingPlatforms(dt);
  updateTraps(dt);
  updateGapExpansion(dt);
  updateBlink(dt);

  // horizontal input
  // Normal levels use instant velocity for responsive controls.
  // Level 3 has a slippery feel: smooth velocity changes both on ground and in the air.
  const targetVx = keys.left ? -MOVE_SPEED : keys.right ? MOVE_SPEED : 0;
  if (getSectionIndexForX(player.x) === 2 && player.grounded) {
    // smaller accel => more slippery on ground only
    const slipAccel = 1.0;
    const blend = Math.min(1, slipAccel * dt);
    player.vx += (targetVx - player.vx) * blend;
    if (player.vx < 0) player.facing = -1;
    else if (player.vx > 0) player.facing = 1;
  } else {
    player.vx = targetVx;
    if (player.vx < 0) player.facing = -1;
    else if (player.vx > 0) player.facing = 1;
  }

  // jump
  if (keys.up && player.grounded) {
    player.vy = JUMP_VELOCITY;
    player.grounded = false;
    triggerJumpTraps();
  }

  // gravity
  player.vy += GRAVITY * dt;

  // integrate horizontal
  const prevX = player.x;
  player.x += player.vx * dt;

  // horizontal collision with blocking `blocks` (solid obstacles)
  if (world.def.blocks && world.def.blocks.length) {
    for (const b of world.def.blocks) {
      const bx = b.x;
      const bTop = world.def.groundY - b.height;
      if (
        rectsOverlap(
          player.x,
          player.y,
          player.w,
          player.h,
          bx,
          bTop,
          b.width,
          b.height,
        )
      ) {
        if (player.x > prevX) {
          // moved right into a block
          player.x = bx - player.w;
        } else if (player.x < prevX) {
          // moved left into a block
          player.x = bx + b.width;
        }
        player.vx = 0;
      }
    }
  }

  // horizontal collision with the ground itself, treated as a solid wall
  // on its sides. Ground tiles only ever resolved as a "stand on top of
  // it" surface before, so a falling/jumping player could be pushed
  // sideways straight through the edge of a ground slab (e.g. an
  // elevated step) and end up embedded inside it instead of being
  // blocked by it like a cliff face.
  const wallSegs = getGroundSegmentsAt(player.x);
  for (const seg of wallSegs) {
    const overlapX = player.x + player.w > seg.left && player.x < seg.right;
    const embedded = player.y + player.h > seg.top + 4;
    if (overlapX && embedded) {
      if (player.x > prevX) {
        player.x = seg.left - player.w;
      } else if (player.x < prevX) {
        player.x = seg.right;
      }
      player.vx = 0;
    }
  }

  player.x = Math.max(0, Math.min(world.def.width - player.w, player.x));

  // integrate vertical
  player.y += player.vy * dt;

  // ---- collisions: ground segments ----
  player.grounded = false;
  const feetY = player.y + player.h;
  const segs = getGroundSegmentsAt(player.x);
  for (const seg of segs) {
    const overlapX = player.x + player.w > seg.left && player.x < seg.right;
    if (
      overlapX &&
      player.vy >= 0 &&
      feetY >= seg.top &&
      feetY - player.vy * dt <= seg.top + 12
    ) {
      player.y = seg.top - player.h;
      player.vy = 0;
      player.grounded = true;
    }
  }

  // ---- collisions: moving platforms ----
  for (const p of world.movingPlatforms) {
    const px = p.currentX !== undefined ? p.currentX : p.x;
    const overlapX = player.x + player.w > px && player.x < px + p.width;
    const top = p.y;
    if (
      overlapX &&
      player.vy >= 0 &&
      feetY >= top &&
      feetY - player.vy * dt <= top + 14
    ) {
      player.y = top - player.h;
      player.vy = 0;
      player.grounded = true;
      // carry player with platform horizontal motion
      player.x += px - (p.lastX !== undefined ? p.lastX : px);
    }
    p.lastX = px;
  }

  // ---- hazards (flashing tic blocks) ----
  // hz.y lets a level (e.g. Level 5's airborne hazards) place a hazard at an
  // explicit height instead of sitting on the ground.
  for (const hz of getAllHazards()) {
    const hzY = hz.y !== undefined ? hz.y : world.def.groundY - hz.height;
    if (
      rectsOverlap(
        player.x,
        player.y,
        player.w,
        player.h,
        hz.x,
        hzY,
        hz.width,
        hz.height,
      )
    ) {
      killPlayer();
      return;
    }
  }

  // ---- fell into a pit / off the world ----
  // Each section keeps its own "how far can you fall before you die" rule
  // (e.g. the old Level 5's tall vertical climb needed a much lower limit
  // than the default), chosen by whichever section the player is over.
  const fallLimit = WORLD.sections[getSectionIndexForX(player.x)].fallLimit;
  if (player.y > fallLimit) {
    killPlayer();
    return;
  }

  // ---- mailbox checkpoints ----
  // mb.y lets a section (e.g. the old Level 5's door perched up high)
  // override the default "sitting on the ground" position. Hitbox size
  // (56x90) is unchanged and still matches mailbox.png exactly. Touching
  // a mailbox sets it as the respawn point; it no longer ends the level.
  for (const mb of world.mailboxes) {
    const mbTop = mb.y !== undefined ? mb.y : world.def.groundY - mb.height;
    if (
      rectsOverlap(
        player.x,
        player.y,
        player.w,
        player.h,
        mb.x,
        mbTop,
        mb.width,
        mb.height,
      )
    ) {
      activateCheckpoint(mb);
    }
  }

  updateLevelLabel();

  // scroll the camera to follow the player across the full continuous map
  camera.x = clampCamera(player.x + player.w / 2);
}

// Marks a mailbox as this run's latest checkpoint (once), records the
// stage as completed in the persistent save, and figures out where that
// leaves the player: on to the next stage's respawn point, or — if that
// was the last stage in this level — off to the Level Select screen so
// they can choose where to go next. Reaching the very last stage of the
// very last level still ends the game like before.
function activateCheckpoint(mb) {
  if (mb.activated) return;
  mb.activated = true;

  Progress.completeStage(mb.levelIndex, mb.stageIndex);

  const isLastStageOfLevel = mb.stageIndex === STAGES_PER_LEVEL - 1;
  const isLastLevel = mb.levelIndex === LEVEL_COUNT - 1;

  if (isLastStageOfLevel && isLastLevel) {
    // The true end of the game (Level 5's 5th stage). Dormant for now
    // since only Level 1 is built — this fires once Levels 2-5 exist.
    showEndOverlay();
    return;
  }

  // Respawn point becomes wherever this checkpoint is (mirrors the old
  // "checkpoint = the mailbox you just hit" behavior).
  checkpoint = {
    x: mb.x,
    y: mb.y !== undefined ? mb.y : world.def.groundY - mb.height,
  };

  if (isLastStageOfLevel) {
    // Cleared every stage in this level — hand the player back to Level
    // Select to pick where to go next.
    showLevelSelect();
  }
}

// ------------------------------------------------------------
// Render
// ------------------------------------------------------------

function draw() {
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);

  ctx.save();
  // shift the whole world left by the camera's position so the section
  // currently under the player is what's visible — everything below is
  // drawn in world (not screen) coordinates.
  ctx.translate(-camera.x, 0);

  // ground/backdrop art — BG.png spans the entire map (one continuous
  // image, not a per-screen tile), so it's drawn once in world space here
  // and naturally pans/cycles under the player as the camera scrolls
  // across each checkpoint, instead of sitting fixed to the screen.
  if (levelBgLoaded) {
    ctx.drawImage(levelBgImg, 0, 0, world.def.width, VIEW_H);
  } else {
    ctx.fillStyle = "#d0d0d0";
    ctx.fillRect(0, 0, world.def.width, VIEW_H);
  }

  // ground line — semi-transparent so the dirt texture from levelbg.png
  // shows through instead of being completely hidden behind a flat fill
  ctx.fillStyle = "rgba(191, 191, 191, 0)";
  for (const g of world.def.ground) {
    ctx.fillRect(g.x, world.def.groundY, g.width, VIEW_H);
  }

  for (const t of world.trapState) {
    if (t.fallen) {
      // falling slab graphic dropping out of view
      ctx.fillStyle = "tan";
      ctx.fillRect(t.x, world.def.groundY + t.fallOffset, t.width, 14);
      // pit interior (darker) revealed behind it
      ctx.fillStyle = "black";
      ctx.fillRect(t.x, world.def.groundY, t.width, VIEW_H);
    } else if (t.armed) {
      // subtle pre-collapse tremor cue
      const shake = Math.sin(gameTime * 60) * 2;
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.fillRect(t.x + shake, world.def.groundY, t.width, 6);
    }
  }

  // moving platforms
  for (const p of world.movingPlatforms) {
    const px = p.currentX !== undefined ? p.currentX : p.x;
    ctx.fillStyle = "#caa24c";
    ctx.fillRect(px, p.y, p.width, 14);
    ctx.fillStyle = "#8a5d1d";
    ctx.fillRect(px, p.y + 14, p.width, 8);
  }

  // blocking blocks (solid obstacles the player must jump over)
  for (const b of world.def.blocks || []) {
    const top = world.def.groundY - b.height;
    ctx.fillStyle = "#6b6b6b";
    ctx.fillRect(b.x, top, b.width, b.height);
    ctx.strokeStyle = "#444444";
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x, top, b.width, b.height);
  }

  // hazards (box/dog tics). Last-stage hazards are tagged `flash: true` —
  // they still damage the player the whole time (collision is handled
  // separately in update()), they just skip their own draw call while
  // blinkState is in its "invisible" phase, so the box appears to flash
  // in and out instead of the player blinking.
  for (const hz of getAllHazards()) {
    if (hz.flash && !blinkState.visible) continue;

    const hzY = hz.y !== undefined ? hz.y : world.def.groundY - hz.height;
    const useDog = hz.sprite === "dog";
    const img = useDog ? dogImg : boxImg;
    const imgReady = useDog ? dogLoaded : boxLoaded;

    if (imgReady) {
      ctx.drawImage(img, hz.x, hzY, hz.width, hz.height);
    } else {
      // fallback
      ctx.fillStyle = "#ff3b3b";
      ctx.fillRect(hz.x, hzY, hz.width, hz.height);
    }
  }

  // mailbox checkpoints, honoring each one's mb.y override. Renders
  // mailboxup.png until the checkpoint is reached, then swaps to
  // mailboxdown.png to show that stage has been cleared.
  for (const mb of world.mailboxes) {
    const mbTop = mb.y !== undefined ? mb.y : world.def.groundY - mb.height;

    if (mb.activated) {
      // soft glow behind an already-activated checkpoint
      ctx.fillStyle = "rgba(90, 210, 120, 0.35)";
      ctx.fillRect(mb.x - 10, mbTop - 10, mb.width + 20, mb.height + 20);
    }

    const mailboxImg = mb.activated ? mailboxDownImg : mailboxUpImg;
    const mailboxReady = mb.activated ? mailboxDownLoaded : mailboxUpLoaded;

    if (mailboxReady) {
      ctx.drawImage(mailboxImg, mb.x, mbTop, mb.width, mb.height);
    } else {
      // flat-color fallback if the art hasn't loaded yet / failed to load
      ctx.fillStyle = "#9c6b2a";
      ctx.fillRect(mb.x - 6, mbTop - 6, mb.width + 12, mb.height + 6);
      ctx.fillStyle = "#c9c9c9";
      ctx.fillRect(mb.x, mbTop, mb.width, mb.height);
    }
  }

  // player
  if (player.alive || deathFlashTimer > 0) {
    drawPlayer();
  }

  ctx.restore();
}

function drawPlayer() {
  // Level 5's blink mechanic now drives the last stage's hazard boxes
  // (see draw()'s hazard loop), not the player — the player always
  // renders normally.
  const x = player.x;
  const y = player.y;
  const w = player.w;
  const h = player.h;

  // fallback while loading (no sprite yet)
  if (!spriteLoaded) {
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, w, h);
    return;
  }

  // --------------------------------------------------------
  // ANIMATION
  // --------------------------------------------------------
  const row = player.facing === -1 ? 0 : 1;

  // Animate only while a direction key is actually held down. Using vx
  // here would keep the walk-cycle running on Level 3 while the player
  // slides to a stop from friction after letting go of the key.
  const isMoving = player.grounded && (keys.left || keys.right);

  const col = isMoving
    ? Math.floor((gameTime / SPRITE_FRAME_DURATION) % SPRITE_COLS)
    : 0;

  const sx = col * SPRITE_FRAME_W;
  const sy = row * SPRITE_FRAME_H;

  // --------------------------------------------------------
  // SCALE + FOOT LOCK (THIS FIXES FLOATING FEET)
  // --------------------------------------------------------
  const SPRITE_SCALE = 0.4; // adjust to taste

  const drawW = SPRITE_FRAME_W * SPRITE_SCALE;
  const drawH = SPRITE_FRAME_H * SPRITE_SCALE;

  const drawX = x + w / 2 - drawW / 2;
  const drawY = y + h - drawH;

  ctx.drawImage(
    spriteSheet,
    sx,
    sy,
    SPRITE_FRAME_W,
    SPRITE_FRAME_H,
    drawX,
    drawY,
    drawW,
    drawH,
  );
}

// ------------------------------------------------------------
// Main loop
// ------------------------------------------------------------

function frame(timestamp) {
  if (lastTime === null) lastTime = timestamp;
  let dt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;
  dt = Math.min(dt, 1 / 30); // clamp huge gaps (tab switch etc)

  const levelSelectOpen =
    typeof levelSelectEl !== "undefined" &&
    levelSelectEl &&
    levelSelectEl.root.style.display !== "none";

  if (!overlay.classList.contains("hidden") || levelSelectOpen) {
    // paused while overlay (level intro / end screen) or the level-select
    // grid is up
    requestAnimationFrame(frame);
    return;
  }

  gameTime += dt;
  if (deathFlashTimer > 0) deathFlashTimer -= dt;

  update(dt);
  draw();

  requestAnimationFrame(frame);
}

preloadAllAssets().then(() => {
  loadWorld();
  showStartOverlay();
  requestAnimationFrame(frame);
});
