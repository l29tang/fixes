// ============================================================
// LEVEL 1 — five stages/checkpoints (L1-1 through L1-5).
// Levels 2-5 haven't been built yet; see buildWorld() below for how
// this plugs into the 5x5 level-select grid.
// ============================================================
const LEVEL_1_STAGES = [
  {
    title: "Level 1 — Irregular Small Tics",
    intro:
      "Tics can appear suddenly, without warning, anywhere in the body.\n" +
      "One flash. One twitch. You just have to be ready to jump over it.",
    width: 1280,
    groundY: 550,
    spawn: { x: 80, y: 450 },
    door: { x: 1150, width: 56, height: 90 },
    ground: [{ x: 0, width: 1280 }],
    trapGround: [],
    movingPlatforms: [],
    hazards: [],
  },

  {
    title: "Level 2 — Cause-and-Effect Tics",
    intro:
      "From the outside, everything looks calm and ordinary.\n" +
      "But one sudden movement — and the ground gives way beneath you.\n" +
      "Careful what you jump for.",
    width: 1280,
    groundY: 550,
    spawn: { x: 80, y: 450 },
    door: { x: 1150, width: 56, height: 90 },
    ground: [{ x: 0, width: 1280 }],
    blocks: [
      { x: 300, width: 40, height: 80 },
      { x: 680, width: 40, height: 80 },
    ],
    trapGround: [
      { x: 380, width: 120, id: "t1" },
      { x: 760, width: 120, id: "t2" },
    ],
    movingPlatforms: [],
    hazards: [],
  },

  {
    title: "Level 3 — Delayed Tics",
    intro:
      "Sometimes the reaction doesn't come right away.\n" +
      "It builds, it delays, and then — right when you commit — it moves.\n" +
      "Time your jump for when the platform arrives, not when you wish it would.",
    width: 1280,
    groundY: 550,
    spawn: { x: 80, y: 450 },
    door: { x: 1150, width: 56, height: 90 },
    ground: [
      { x: 0, width: 400 },
      { x: 1080, width: 200 },
    ],
    // Purely a visual cue (matches Stage 4's black-pit rendering):
    // `ground` above already has no tile between x:400 and x:1080, so this
    // "prefallen" entry doesn't change collision at all — it just paints
    // a black pit across that same gap so its edges (start and end) read
    // clearly instead of showing empty space.
    trapGround: [{ x: 400, width: 680, id: "l1-3-pit", prefallen: true }],
    movingPlatforms: [
      { x: 480, y: 560, width: 110, range: 260, speed: 90, phase: 0 },
      { x: 760, y: 560, width: 110, range: 220, speed: 110, phase: 1.5 },
    ],
    hazards: [],
  },

  {
    title: "Level 4 — Persistent Tics",
    intro:
      "Some tics don't stop once they start.\n" +
      "They keep going, pulling you along — and if you resist, you fall behind.\n" +
      "Sometimes you have to move with the tic, not against it.",
    width: 1280,
    groundY: 550,
    spawn: { x: 80, y: 450 },
    door: { x: 1150, width: 56, height: 90 },

    ground: [{ x: 0, width: 1280 }],

    trapGround: [{ x: 380, width: 80, id: "gap-seed", prefallen: true }],

    hazards: [],
    movingPlatforms: [],
  },

  {
    title: "Level 5 — Blinking Tics",
    intro:
      "Tics don't always come one at a time.\n" +
      "Sometimes they layer — a movement here, a flash there, the ground shifting beneath you.\n" +
      "Stay focused. Keep moving.",
    width: 1280,
    groundY: 720,
    fallLimit: 720,
    spawn: { x: 40, y: 480 },
    door: { x: 1150, width: 56, height: 90, y: 50 },

    ground: [],
    trapGround: [],

    // Every platform and hazard below sits inside the visible 1280x720
    // viewport (the camera never scrolls in this game), and each step up
    // is within the player's ~128px max jump height.
    movingPlatforms: [
      { x: 0, y: 600, width: 160, range: 0, speed: 0, phase: 0 }, // start
      { x: 260, y: 560, width: 130, range: 160, speed: 80, phase: 0 },
      { x: 560, y: 560, width: 130, range: 160, speed: 80, phase: 1.5 },
      { x: 900, y: 460, width: 150, range: 0, speed: 0, phase: 0 },
      { x: 760, y: 350, width: 140, range: 0, speed: 0, phase: 0 },
      { x: 980, y: 230, width: 140, range: 0, speed: 0, phase: 0 },
      { x: 1100, y: 140, width: 160, range: 0, speed: 0, phase: 0 }, // landing, holds the mailbox
    ],

    // `flash: true` makes these boxes blink on/off (see updateBlink /
    // draw()'s hazard loop in main.js) instead of the player blinking.
    // They still damage the player the entire time, blink or not.
    hazards: [
      { x: 970, width: 79, height: 56, y: 404, flash: true }, // sits on the y:460 platform
      { x: 1045, width: 79, height: 56, y: 174, flash: true }, // sits on the y:230 platform
    ],
  },
];

// ============================================================
// WORLD — merges one level's stages into a single continuous,
// seamlessly-scrolling map.
//
// Each stage's content is shifted rightward by the combined width of
// every stage before it, so stage 2 starts exactly where stage 1 ends,
// and so on. Every stage's original layout (ground, blocks, traps,
// moving platforms, hazards) is preserved untouched relative to its own
// section — only the x-offset changes.
//
// Each stage's `door` becomes a mailbox checkpoint tagged with
// `levelIndex` (which of the 5 *main* levels this belongs to — always 0
// for now, since only Level 1 is built) and `stageIndex` (which of that
// level's 5 checkpoints, 0-based). Reaching stage 4 (the last one) of a
// level sends the player to the Level Select screen; reaching stage 4 of
// the last *main* level (index 4) would end the game — but since only
// level 0 exists so far, that branch is dormant until Levels 2-5 get
// built.
//
// To add Level 2 later: build a LEVEL_2_STAGES array the same shape as
// LEVEL_1_STAGES, and either extend buildWorld to concatenate multiple
// levels into one WORLD, or give each level its own WORLD and swap
// between them. Either way, pass levelIndex: 1 so its mailboxes and
// Level Select row line up automatically.
// ============================================================
function buildWorld(stages, levelIndex = 0) {
  const sections = [];
  const ground = [];
  const trapGround = [];
  const movingPlatforms = [];
  const hazards = [];
  const blocks = [];
  const mailboxes = [];

  let offsetX = 0;

  stages.forEach((def, i) => {
    const startX = offsetX;
    const endX = startX + def.width;

    sections.push({
      index: i, // position within the continuous map (used by getSectionIndexForX)
      levelIndex,
      stageIndex: i,
      title: def.title,
      intro: def.intro,
      startX,
      endX,
      spawn: { x: startX + def.spawn.x, y: def.spawn.y },
      // Preserve each stage's own "how far can you fall before you die"
      // rule (Level 5's tall vertical climb needed a much lower limit
      // than the default).
      fallLimit:
        def.fallLimit !== undefined ? def.fallLimit : def.groundY + 300,
    });

    for (const g of def.ground) {
      ground.push({ x: startX + g.x, width: g.width });
    }
    for (const t of def.trapGround) {
      trapGround.push({ ...t, x: startX + t.x });
    }
    for (const p of def.movingPlatforms) {
      movingPlatforms.push({ ...p, x: startX + p.x });
    }
    for (const hz of def.hazards) {
      hazards.push({ ...hz, x: startX + hz.x });
    }
    for (const b of def.blocks || []) {
      blocks.push({ ...b, x: startX + b.x });
    }

    const d = def.door;
    mailboxes.push({
      x: startX + d.x,
      y: d.y, // undefined => sits on the shared ground line
      width: d.width,
      height: d.height,
      levelIndex,
      stageIndex: i,
      activated: false,
    });

    offsetX = endX;
  });

  return {
    width: offsetX,
    // Shared ground baseline. Only stages 1-4 use flat "ground" collision
    // (all authored at groundY:550); stage 5 places every platform and
    // hazard at an explicit y and never touches this value, so one shared
    // number works fine for the whole map.
    groundY: 550,
    spawn: { x: sections[0].spawn.x, y: sections[0].spawn.y },
    levelIndex,
    // Which main-level indices actually have content right now. The
    // level-select grid uses this to keep unbuilt levels locked even if
    // Progress has technically "unlocked" the first stage of one.
    builtLevelIndices: [levelIndex],
    sections,
    ground,
    trapGround,
    movingPlatforms,
    hazards,
    blocks,
    mailboxes,
  };
}

const WORLD = buildWorld(LEVEL_1_STAGES, 0);
