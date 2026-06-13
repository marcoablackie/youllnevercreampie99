/* NBA 2K26 Jumpshot Creator - LOGIC */
(function () {
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const types = Array.from(new Set(SHOTS.map((s) => s.type)));
  types.forEach((t) => {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = TYPE_LABELS[t] || t;
    $("typeFilter").appendChild(o);
  });
  $("typeFilter").value = "jump_shot";
  for (let ft = 5 * 12 + 7, cap = 7 * 12 + 4; ft <= cap; ft++) {
    const h = Math.floor(ft / 12) + "'" + (ft % 12);
    const o = document.createElement("option");
    o.value = h;
    o.textContent = h;
    if (h === "6'5") o.selected = true;
    $("heightFilter").appendChild(o);
  }

  RELEASE_SPEEDS.forEach((s, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = s.label;
    $("pickSpeed").appendChild(o);
  });
  VISUAL_CUES.forEach((c, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = c.name;
    $("pickCue").appendChild(o);
  });
  $("pickSpeed").value = DEFAULT_RELEASE_SPEED_INDEX;
  $("pickCue").value = 0;

  const GRADE_STEPS = [
    [95, "A+"], [88, "A"], [82, "A-"], [76, "B+"], [70, "B"], [64, "B-"],
    [58, "C+"], [52, "C"], [46, "C-"], [40, "D+"], [34, "D"], [0, "F"]
  ];

  function scoreToGrade(score) {
    for (const [min, letter] of GRADE_STEPS) {
      if (score >= min) return letter;
    }
    return "F";
  }

  function gradeClass(letter) {
    if (letter === "–") return "grade-dash";
    return "grade-" + letter.toLowerCase().replace("+", "-plus").replace("-", "-minus");
  }

  function fillClass(letter) {
    if (letter === "–") return "";
    return "fill-" + letter.toLowerCase().replace("+", "-plus").replace("-", "-minus");
  }

  function heightToInches(str) {
    const m = str.replace("\u2019", "'").match(/(\d+)'(\d+)/);
    return m ? +m[1] * 12 + +m[2] : 0;
  }

  function parseHeightRange(h) {
    const s = h.toLowerCase().replace(/\u2019/g, "'");
    let m = s.match(/between\s+(\d+'\d+)\s+and\s+(\d+'\d+)/);
    if (m) return { min: heightToInches(m[1]), max: heightToInches(m[2]) };
    m = s.match(/under\s+(\d+'\d+)/);
    if (m) return { min: 0, max: heightToInches(m[1]) - 1 };
    m = s.match(/(\d+'\d+)\s+or\s+higher/);
    if (m) return { min: heightToInches(m[1]), max: 120 };
    return { min: 0, max: 120 };
  }

  function heightMatches(shotHeight, playerHeight) {
    if (!playerHeight) return true;
    const playerIn = heightToInches(playerHeight);
    const shot = parseHeightRange(shotHeight);
    return playerIn >= shot.min && playerIn <= shot.max;
  }

  let labCache = null;

  function loadLabCache() {
    if (labCache) return labCache;
    try {
      const raw = localStorage.getItem(LAB_CACHE_KEY);
      if (raw) labCache = JSON.parse(raw);
    } catch {
      labCache = null;
    }
    if (!labCache) {
      labCache = {
        bases: { ...LAB_PART_TIMINGS.bases },
        releases: { ...LAB_PART_TIMINGS.releases },
        custom: [...(LAB_PART_TIMINGS.custom || [])]
      };
    }
    return labCache;
  }

  function saveLabCache(cache) {
    labCache = cache;
    localStorage.setItem(LAB_CACHE_KEY, JSON.stringify(cache));
    updateLabSyncStatus();
  }

  function labHasData() {
    const c = loadLabCache();
    return !!(Object.keys(c.bases || {}).length || Object.keys(c.releases || {}).length || (c.custom || []).length);
  }

  function cueOffsetMs(cue) {
    return LAB_CUE_OFFSET_MS[cue.labKey] ?? 0;
  }

  function speedAddMs(speedIndex) {
    return LAB_SPEED_ADD_MS[speedIndex] ?? 0;
  }

  function applyLabRow(row, speedIndex, cue) {
    const eg = +row.earliest_green;
    const lg = +(row.latest_green != null ? row.latest_green : eg + 49);
    if (!eg || Number.isNaN(eg)) return null;
    const add = speedAddMs(speedIndex);
    const early = eg + add;
    const late = lg + add;
    const releaseMs = eg + add - cueOffsetMs(cue);
    const windowMs = lg - eg;
    const cycleMs = Math.max(late + 80, TIMING_2K26.cycleMs);
    return {
      releaseMs,
      windowMs,
      early,
      late,
      cycleMs,
      source: row.source || "lab",
      earliest_green: eg,
      latest_green: lg
    };
  }

  function normalizeBlend(build) {
    if (build.release_1 === build.release_2) return "100";
    return build.blend + "/" + (100 - build.blend);
  }

  function matchCustomLabRow(build) {
    const blend = normalizeBlend(build);
    for (const row of loadLabCache().custom || []) {
      if (
        row.base === build.base &&
        row.release_1 === build.release_1 &&
        row.release_2 === build.release_2 &&
        String(row.blend).replace(/\s/g, "") === blend.replace(/\s/g, "")
      ) {
        return { ...row, source: "lab-custom" };
      }
    }
    return null;
  }

  function lookupPartLab(name, kind) {
    const cache = loadLabCache();
    const map = kind === "base" ? cache.bases : cache.releases;
    return map && map[name] ? map[name] : null;
  }

  function blendLabParts(build) {
    const b = lookupPartLab(build.base, "base");
    const r1 = lookupPartLab(build.release_1, "release");
    const r2 = lookupPartLab(build.release_2, "release");
    if (!b || !r1 || !r2) return null;
    const t = build.blend / 100;
    const u = 1 - t;
    const eg = Math.round(b.earliest_green * 0.42 + r1.earliest_green * 0.33 * t + r2.earliest_green * 0.33 * u);
    const lgB = b.latest_green != null ? b.latest_green : b.earliest_green + 49;
    const lg1 = r1.latest_green != null ? r1.latest_green : r1.earliest_green + 49;
    const lg2 = r2.latest_green != null ? r2.latest_green : r2.earliest_green + 49;
    const lg = Math.round(lgB * 0.42 + lg1 * 0.33 * t + lg2 * 0.33 * u);
    return { earliest_green: eg, latest_green: lg, source: "lab-parts" };
  }

  function resolveBuildLabRow(build) {
    return matchCustomLabRow(build) || blendLabParts(build);
  }

  function computeBuildLabTiming(build, speedIndex, cue) {
    const row = resolveBuildLabRow(build);
    if (!row) return null;
    return applyLabRow(row, speedIndex, cue);
  }

  async function fetchLabShots(token, year, type) {
    const res = await fetch(LAB_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, year, type })
    });
    if (!res.ok) throw new Error("NBA2KLab API " + res.status);
    const data = await res.json();
    if (data.status === "missing-information") throw new Error("Invalid or missing premium token");
    return data.shots || data.data || [];
  }

  function indexLabShots(shots, kind) {
    const map = {};
    for (const row of shots) {
      if (!row || row.earliest_green == null) continue;
      const key = kind === "base" ? row.base : row.releaseID || row.release_1 || row.name;
      if (key && !String(key).includes("Sign Up") && !String(key).includes("Premium")) {
        map[key] = {
          earliest_green: row.earliest_green,
          latest_green: row.latest_green
        };
      }
    }
    return map;
  }

  async function syncLabData(token) {
    const trimmed = (token || "").trim();
    if (!trimmed) throw new Error("Paste your NBA2KLab Firebase access token");
    const [bases, releases, custom] = await Promise.all([
      fetchLabShots(trimmed, 24, "bases"),
      fetchLabShots(trimmed, 24, "releases"),
      fetchLabShots(trimmed, 26, "custom")
    ]);
    const cache = {
      syncedAt: new Date().toISOString(),
      bases: indexLabShots(bases, "base"),
      releases: indexLabShots(releases, "release"),
      custom: custom.filter((r) => r && r.earliest_green != null && !String(r.base || "").includes("Sign Up"))
    };
    saveLabCache(cache);
    return cache;
  }

  function updateLabSyncStatus() {
    const el = $("labSyncStatus");
    if (!el) return;
    const c = loadLabCache();
    const nB = Object.keys(c.bases || {}).length;
    const nR = Object.keys(c.releases || {}).length;
    const nC = (c.custom || []).length;
    if (!nB && !nR && !nC) {
      el.textContent = "No lab data — paste premium token to load real ms.";
      el.className = "lab-sync-status lab-sync-missing";
      return;
    }
    const when = c.syncedAt ? new Date(c.syncedAt).toLocaleDateString() : "cached";
    el.textContent = "NBA2KLab: " + nB + " bases, " + nR + " releases, " + nC + " custom builds (" + when + ")";
    el.className = "lab-sync-status lab-sync-ok";
  }

  function timingSourceLabel(source) {
    if (source === "lab-moving") return "NBA2KLab moving-jumpers (public)";
    if (source === "lab-custom") return "NBA2KLab tested build";
    if (source === "lab-parts") return "NBA2KLab bases + releases blend";
    if (source === "lab") return "NBA2KLab";
    return "No lab data";
  }

  function getJumpShotReq(name) {
    return SHOTS.find((s) => s.name === name && s.type === "jump_shot") || null;
  }

  function getUnlockableJumpShots() {
    const playerHeight = $("heightFilter").value;
    const maxRating = +$("ratingFilter").value;
    return SHOTS.filter((s) => {
      if (s.type !== "jump_shot") return false;
      if (s.rating != null && s.rating > maxRating) return false;
      return heightMatches(s.height, playerHeight);
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  function fillShotSelect(selectId, names, preferred) {
    const el = $(selectId);
    const prev = preferred || el.value;
    el.innerHTML = "";
    names.forEach((name) => {
      const req = getJumpShotReq(name);
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name + (req && req.rating != null ? " \u2605" + req.rating : "");
      el.appendChild(o);
    });
    if (names.includes(prev)) el.value = prev;
    else if (names.length) el.value = names[0];
  }

  function populateCreatorDropdowns(preferred) {
    const shots = getUnlockableJumpShots();
    const names = shots.map((s) => s.name);
    if (!names.length) return false;
    fillShotSelect("pickBase", names, preferred && preferred.base);
    fillShotSelect("pickR1", names, preferred && preferred.release_1);
    fillShotSelect("pickR2", names, preferred && preferred.release_2);
    return true;
  }

  function buildParts(build) {
    return [build.base, build.release_1, build.release_2];
  }

  function buildUnlockable(build, playerHeight, maxRating) {
    for (const name of buildParts(build)) {
      const req = getJumpShotReq(name);
      if (!req) return false;
      if (req.rating != null && req.rating > maxRating) return false;
      if (!heightMatches(req.height, playerHeight)) return false;
    }
    return true;
  }

  function findBestCustomBuild() {
    const playerHeight = $("heightFilter").value;
    const playerIn = heightToInches(playerHeight);
    const maxRating = +$("ratingFilter").value;
    const candidates = CUSTOM_BUILDS.filter((b) => {
      if (playerIn < b.height_min || playerIn > b.height_max) return false;
      return buildUnlockable(b, playerHeight, maxRating);
    });
    if (!candidates.length) return null;
    return candidates.reduce((best, b) => (b.window_ms > best.window_ms ? b : best));
  }

  function blendLabel(build) {
    if (build.release_1 === build.release_2) return "100% " + build.release_1;
    const r2 = 100 - build.blend;
    return build.blend + "% " + build.release_1 + " / " + r2 + "% " + build.release_2;
  }

  function profileFor(name) {
    return ANIMATION_PROFILES[name] || { release_height: 70, defense_immunity: 72, timing_stability: 74, release_speed: 70, window: 48 };
  }

  function computeBuildStats(build) {
    const b = profileFor(build.base);
    const r1 = profileFor(build.release_1);
    const r2 = profileFor(build.release_2);
    const t = build.blend / 100;
    const u = 1 - t;
    const mix = (key) => Math.round(b[key] * 0.4 + r1[key] * 0.35 * t + r2[key] * 0.35 * u);
    return {
      release_height: mix("release_height"),
      defense_immunity: mix("defense_immunity"),
      timing_stability: mix("timing_stability"),
      release_speed: mix("release_speed")
    };
  }

  function metaGreenWindow(name) {
    const row = GREEN_WINDOW_META[name];
    return row ? row.window_ms : null;
  }

  function computeBuildBaseWindowMs(build) {
    const b = profileFor(build.base);
    const r1 = profileFor(build.release_1);
    const r2 = profileFor(build.release_2);
    const t = build.blend / 100;
    const u = 1 - t;
    let blended = Math.round(b.window * 0.4 + r1.window * 0.35 * t + r2.window * 0.35 * u);
    for (const name of buildParts(build)) {
      const meta = metaGreenWindow(name);
      if (meta != null) blended = Math.max(blended, Math.round(meta * 0.92));
    }
    return clamp(blended, 38, 72);
  }

  function buildMaxRating(build) {
    let max = 0;
    for (const name of buildParts(build)) {
      const req = getJumpShotReq(name);
      if (req && req.rating != null && req.rating > max) max = req.rating;
    }
    return max;
  }

  function buildGrades(build) {
    const s = computeBuildStats(build);
    return {
      height: { letter: scoreToGrade(s.release_height), pct: s.release_height },
      immunity: { letter: scoreToGrade(s.defense_immunity), pct: s.defense_immunity },
      stability: { letter: scoreToGrade(s.timing_stability), pct: s.timing_stability },
      speed: { letter: scoreToGrade(s.release_speed), pct: s.release_speed }
    };
  }

  function customBuildLabel(build) {
    const short = (n) => n.split(" ").pop();
    if (build.label && build.label !== "Custom Build") return build.label;
    return short(build.release_1) + " / " + short(build.base);
  }

  function buildCustomNote(build) {
    const playerHeight = $("heightFilter").value;
    const maxRating = +$("ratingFilter").value;
    if (!buildUnlockable(build, playerHeight, maxRating)) {
      return "Some parts exceed your 3PT rating or height — raise rating or change picks.";
    }
    if (build.note) return build.note;
    return "Copy these values into 2K26 Jumpshot Creator. Req \u2605" + buildMaxRating(build) + ".";
  }

  function readBuildFromUI() {
    const base = $("pickBase").value;
    const release_1 = $("pickR1").value;
    const release_2 = $("pickR2").value;
    const blend = +$("pickBlend").value;
    const release_speed = +$("pickSpeed").value;
    const visual_cue = +$("pickCue").value;
    const lab = computeBuildLabTiming({ base, release_1, release_2, blend }, release_speed, VISUAL_CUES[visual_cue]);
    const window_ms = lab ? lab.windowMs : null;
    return {
      label: "Custom Build",
      base,
      release_1,
      release_2,
      blend,
      release_speed,
      visual_cue,
      window_ms
    };
  }

  function syncControlsFromBuild(build) {
    if (!build) return;
    populateCreatorDropdowns(build);
    $("pickBase").value = build.base;
    $("pickR1").value = build.release_1;
    $("pickR2").value = build.release_2;
    $("pickBlend").value = build.blend;
    $("pickSpeed").value = build.release_speed;
    $("pickCue").value = build.visual_cue;
    $("blendVal").textContent = build.blend + "%";
    $("blendHint").textContent = blendLabel(build);
  }

  function updatePartRatings(build) {
    const set = (id, name) => {
      const req = getJumpShotReq(name);
      $(id).textContent = req && req.rating != null ? "\u2605" + req.rating + " req" : "no req";
    };
    if (!build) {
      ["rateBase", "rateR1", "rateR2"].forEach((id) => { $(id).textContent = "–"; });
      return;
    }
    set("rateBase", build.base);
    set("rateR1", build.release_1);
    set("rateR2", build.release_2);
  }

  function updateHeroDisplay(build) {
    const hero = $("hero");
    if (!build) {
      hero.classList.add("is-empty");
      $("recommendName").textContent = "No build found";
      $("recommendGw").textContent = "–";
      $("recommendNote").textContent = "Raise your 3PT rating or try another height.";
      $("selRating").textContent = "–";
      $("selHeight").textContent = "–";
      $("blendVal").textContent = "–";
      $("blendHint").textContent = "–";
      $("heroCue").textContent = "–";
      $("heroSpeed").textContent = "–";
      clearTimingDisplay();
      $("timingNote").textContent = "Adjust height or 3PT to unlock animations.";
      updatePartRatings(null);
      return;
    }
    hero.classList.remove("is-empty");
    const speed = RELEASE_SPEEDS[build.release_speed];
    const cue = VISUAL_CUES[build.visual_cue];
    $("recommendName").textContent = customBuildLabel(build);
    $("recommendGw").textContent = build.window_ms != null ? build.window_ms + "ms PGW" : "Sync lab for PGW";
    $("recommendNote").textContent = buildCustomNote(build);
    $("selRating").textContent = buildMaxRating(build);
    $("selHeight").textContent = $("heightFilter").value;
    $("blendVal").textContent = build.blend + "%";
    $("blendHint").textContent = blendLabel(build);
    $("heroCue").textContent = cue.name;
    $("heroSpeed").textContent = speed.label;
    $("timingNote").textContent = cue.note;
    updatePartRatings(build);
  }

  function buildLabTiming(build, speedIndex, cue) {
    return computeBuildLabTiming(build, speedIndex, cue);
  }

  function updateTimingDisplay(releaseMs, windowMs, cycleMs, edges, source) {
    const range = cycleMs || TIMING_2K26.cycleMs;
    const early = edges
      ? edges.early
      : Math.max(0, Math.round(releaseMs - windowMs / 2));
    const late = edges
      ? edges.late
      : Math.min(range, Math.round(releaseMs + windowMs / 2));

    $("heroEarly").textContent = early + "ms";
    $("heroRelease").textContent = releaseMs + "ms";
    $("heroLate").textContent = late + "ms";
    $("heroWindow").textContent = windowMs + "ms";
    $("gEarly").textContent = early + "ms";
    $("gPoint").textContent = releaseMs + "ms";
    $("gWindow").textContent = windowMs + "ms";
    $("meterScaleEnd").textContent = range + "ms";
    const tickEnd = $("tlTickEnd");
    if (tickEnd) tickEnd.textContent = range + "ms";

    const zone = $("heroTimelineZone");
    const mark = $("heroTimelineMark");
    if (zone) {
      const wPct = windowMs / range * 100;
      const leftPct = clamp((releaseMs / range - windowMs / range / 2) * 100, 0, 100 - wPct);
      zone.style.left = leftPct + "%";
      zone.style.width = wPct + "%";
    }
    if (mark) mark.style.left = clamp(releaseMs / range * 100, 2, 98) + "%";
    const sub = $("timingSource");
    if (sub) {
      sub.textContent = source ? timingSourceLabel(source) : "—";
      sub.className = "detail-sub timing-source" + (source && source.indexOf("lab") === 0 ? " is-lab" : " is-missing");
    }
  }

  function clearTimingDisplay() {
    ["heroEarly", "heroRelease", "heroLate", "heroWindow", "gEarly", "gPoint", "gWindow"].forEach((id) => {
      $(id).textContent = "–";
    });
    const zone = $("heroTimelineZone");
    const mark = $("heroTimelineMark");
    if (zone) { zone.style.left = "0%"; zone.style.width = "0%"; }
    if (mark) mark.style.left = "0%";
    const sub = $("timingSource");
    if (sub) {
      sub.textContent = "—";
      sub.className = "detail-sub timing-source is-missing";
    }
  }

  function buildCopyText(build) {
    const speed = RELEASE_SPEEDS[build.release_speed];
    const cue = VISUAL_CUES[build.visual_cue];
    return [
      "Lower Base: " + build.base,
      "Upper Release 1: " + build.release_1,
      "Upper Release 2: " + build.release_2,
      "Blending: " + blendLabel(build),
      "Release Speed: " + speed.label,
      "Visual Cue: " + cue.name
    ].join("\n");
  }

  function badgeClass(type) {
    return "badge-type-" + type;
  }

  function setResult(text, state) {
    const el = $("result");
    el.textContent = text;
    el.className = "feedback" + (state ? " is-" + state : "");
  }

  function setGradeCard(cardId, data) {
    const card = $(cardId);
    if (!card) return;
    const letter = typeof data === "object" ? data.letter : data;
    const pct = typeof data === "object" ? data.pct : null;
    const letterEl = card.querySelector(".grade-letter");
    if (letterEl) {
      letterEl.textContent = letter;
      letterEl.className = "grade-letter " + gradeClass(letter);
    }
    const pctEl = card.querySelector(".grade-pct");
    if (pctEl) pctEl.textContent = pct != null ? pct : "–";
    const bar = card.querySelector(".grade-bar-fill");
    if (bar) {
      bar.style.width = pct != null ? pct + "%" : "0%";
      bar.className = "grade-bar-fill " + fillClass(letter);
    }
  }

  function getReleaseSpeed() {
    const index = selectedBuild
      ? selectedBuild.release_speed
      : clamp(+$("pickSpeed").value, 0, RELEASE_SPEEDS.length - 1);
    return { index, ...RELEASE_SPEEDS[index] };
  }

  function getCue() {
    const index = selectedBuild
      ? selectedBuild.visual_cue
      : clamp(+$("pickCue").value, 0, VISUAL_CUES.length - 1);
    return VISUAL_CUES[index];
  }

  function matchGoToLab(name) {
    const n = name.toLowerCase();
    const last = n.split(/\s+/).pop();
    for (const row of GO_TO_LAB) {
      const key = row.jumper.toLowerCase();
      if (n.includes(key) || last === key) return row;
    }
    return null;
  }

  function computeStandingTiming(shot, speedIndex, cue) {
    const part = lookupPartLab(shot.name, "base") || lookupPartLab(shot.name, "release");
    if (part) {
      const t = applyLabRow(part, speedIndex, cue);
      if (t) return { releaseMs: t.releaseMs, windowMs: t.windowMs, source: "lab-parts", edges: { early: t.early, late: t.late }, cycleMs: t.cycleMs };
    }
    return null;
  }

  function computeGoToTiming(name, rating, speedIndex, cue) {
    const lab = matchGoToLab(name);
    if (lab) {
      const add = speedAddMs(speedIndex);
      const early = lab.early_ms + add;
      const late = lab.late_ms + add;
      const releaseMs = early - cueOffsetMs(cue);
      const windowMs = lab.late_ms - lab.early_ms;
      const cycleMs = Math.max(late + 140, 900);
      return {
        releaseMs,
        windowMs,
        cycleMs,
        edges: { early, late },
        source: "lab-moving",
        labJumper: lab.jumper
      };
    }

    const jump = computeStandingTiming({ name, rating, type: "jump_shot" }, speedIndex, cue);
    if (jump) return jump;

    return null;
  }

  function computeGradesForShot(speedFactor, windowMs, rating, type, heightStr) {
    const height = (heightStr || "").toLowerCase();
    let heightScore = 55 + (rating - 38) * 0.35;
    if (height.includes("6'10") || height.includes("or higher") || height.includes("7'4")) heightScore += 12;
    else if (height.includes("6'5")) heightScore += 6;
    if (type === "jump_shot" || type === "go_to") heightScore += 5;
    if (type === "post_fade") heightScore -= 8;
    heightScore = clamp(heightScore, 20, 99);

    let immunityScore = 40 + speedFactor * 0.45 + (rating - 38) * 0.25;
    if (type === "dribble_pullup") immunityScore += 6;
    if (type === "go_to") immunityScore += 3;
    immunityScore = clamp(immunityScore, 20, 99);

    let stabilityScore = 35 + windowMs * 0.45 - speedFactor * 0.28 + (rating - 38) * 0.15;
    stabilityScore = clamp(stabilityScore, 20, 99);

    let speedScore = 30 + speedFactor * 0.68;
    speedScore = clamp(speedScore, 20, 99);

    return {
      height: { letter: scoreToGrade(heightScore), pct: heightScore },
      immunity: { letter: scoreToGrade(immunityScore), pct: immunityScore },
      stability: { letter: scoreToGrade(stabilityScore), pct: stabilityScore },
      speed: { letter: scoreToGrade(speedScore), pct: speedScore }
    };
  }

  function clearGrades() {
    ["gradeHeight", "gradeImmunity", "gradeStability", "gradeSpeed"].forEach((id) => {
      setGradeCard(id, { letter: "–", pct: null });
    });
  }

  let selected = null;
  let selectedBuild = null;
  let recommendedBuild = null;
  let toastTimer = null;

  function showToast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.hidden = false;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => { el.hidden = true; }, 250);
    }, 3200);
  }

  function assignPartLabel(part) {
    if (part === "base") return "Lower Base";
    if (part === "r1") return "Upper Release 1";
    return "Upper Release 2";
  }

  function assignShotToPart(name) {
    const part = document.querySelector('input[name="assignPart"]:checked');
    if (!part) return;
    const shots = getUnlockableJumpShots().map((s) => s.name);
    if (!shots.includes(name)) {
      showToast(name + " is locked for your build");
      return;
    }
    if (part.value === "base") $("pickBase").value = name;
    else if (part.value === "r1") $("pickR1").value = name;
    else $("pickR2").value = name;
    onCreatorChange();
    showToast("Set " + name + " as " + assignPartLabel(part.value));
  }

  function render() {
    const type = $("typeFilter").value;
    const heightPick = $("heightFilter").value;
    const maxRating = +$("ratingFilter").value;
    const q = $("search").value.trim().toLowerCase();
    $("ratingVal").textContent = maxRating;
    $("searchClear").hidden = !q;

    const list = SHOTS.filter((s) => {
      if (type !== "all" && s.type !== type) return false;
      if (s.rating != null && s.rating > maxRating) return false;
      if (!heightMatches(s.height, heightPick)) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));

    $("count").textContent = list.length + " of " + SHOTS.length + " animations";
    const ul = $("results");
    ul.innerHTML = "";

    if (!list.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No animations match your filters. Try raising your 3PT rating or another height.";
      ul.appendChild(li);
      return;
    }

    const buildPartsSet = selectedBuild
      ? new Set(buildParts(selectedBuild))
      : null;

    list.slice(0, 400).forEach((s) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      const inBuild = buildPartsSet && buildPartsSet.has(s.name) && s.type === "jump_shot";
      const isActive = selected && !selectedBuild && selected.name === s.name && selected.type === s.type;
      if (isActive) li.classList.add("active");
      if (inBuild) li.classList.add("best");
      const req = s.rating != null ? "\u2605 " + s.rating : "no req";
      li.innerHTML =
        `<span class="nm">${s.name}${inBuild ? '<span class="best-tag">In build</span>' : ""}</span>` +
        `<span class="tg ${badgeClass(s.type)}">${TYPE_LABELS[s.type]}</span>` +
        `<span class="rq">${req}</span>`;
      li.addEventListener("click", () => select(s, li));
      ul.appendChild(li);
    });

    if (list.length > 400) {
      const li = document.createElement("li");
      li.className = "more";
      li.textContent = "+ " + (list.length - 400) + " more (refine filters)";
      ul.appendChild(li);
    }
  }

  function onCreatorChange() {
    const hasShots = populateCreatorDropdowns(selectedBuild || undefined);
    if (!hasShots) {
      selectedBuild = null;
      updateHeroDisplay(null);
      clearGrades();
      render();
      setResult("No jump shots unlocked for this build.", "info");
      return;
    }
    selectedBuild = readBuildFromUI();
    selected = null;
    updateHeroDisplay(selectedBuild);
    render();
    computeTiming();
    setResult("Hit Start to practice your custom build.", "info");
  }

  function onProfileChange() {
    recommendedBuild = findBestCustomBuild();
    const hasShots = populateCreatorDropdowns(selectedBuild || undefined);
    if (!hasShots) {
      selectedBuild = null;
      updateHeroDisplay(null);
      clearGrades();
      render();
      setResult("Adjust height or 3PT rating.", "info");
      return;
    }
    if (selectedBuild) {
      selectedBuild = readBuildFromUI();
      const lab = computeBuildLabTiming(selectedBuild, selectedBuild.release_speed, VISUAL_CUES[selectedBuild.visual_cue]);
      selectedBuild.window_ms = lab ? lab.windowMs : null;
      updateHeroDisplay(selectedBuild);
      computeTiming();
    }
    render();
  }

  function applyBestBuild() {
    recommendedBuild = findBestCustomBuild();
    if (!recommendedBuild) {
      selectedBuild = null;
      const hasShots = populateCreatorDropdowns();
      if (hasShots) onCreatorChange();
      else {
        updateHeroDisplay(null);
        clearGrades();
        render();
        setResult("Adjust height or 3PT rating.", "info");
      }
      return;
    }
    selectedBuild = { ...recommendedBuild };
    syncControlsFromBuild(selectedBuild);
    selected = null;
    updateHeroDisplay(selectedBuild);
    render();
    computeTiming();
    setResult("Loaded best build — tweak parts or hit Start.", "info");
    showToast("Loaded " + recommendedBuild.label);
  }

  function select(s, li) {
    if (s.type === "jump_shot") {
      assignShotToPart(s.name);
      Array.from($("results").children).forEach((c) => c.classList.remove("active"));
      if (li) li.classList.add("best");
      return;
    }
    selectedBuild = null;
    selected = s;
    Array.from($("results").children).forEach((c) => c.classList.remove("active"));
    if (li) li.classList.add("active");
    computeTiming();
  }

  function showMissingLabTiming(note) {
    clearTimingDisplay();
    $("timingNote").textContent = note || "Sync NBA2KLab premium data for real custom jumper ms.";
    model = null;
  }

  function computeTiming() {
    const speed = getReleaseSpeed();
    const cue = getCue();

    if (selectedBuild) {
      const speedIndex = selectedBuild.release_speed;
      const lab = buildLabTiming(selectedBuild, speedIndex, cue);

      if (!lab) {
        showMissingLabTiming(
          labHasData()
            ? "Missing lab rows for these parts — try a listed meta build or re-sync."
            : "Custom jumper ms are premium-only on NBA2KLab. Paste your token below to load real stats."
        );
        const grades = buildGrades(selectedBuild);
        setGradeCard("gradeHeight", grades.height);
        setGradeCard("gradeImmunity", grades.immunity);
        setGradeCard("gradeStability", grades.stability);
        setGradeCard("gradeSpeed", grades.speed);
        return;
      }

      selectedBuild.window_ms = lab.windowMs;
      $("recommendGw").textContent = lab.windowMs + "ms PGW";
      updateTimingDisplay(lab.releaseMs, lab.windowMs, lab.cycleMs, { early: lab.early, late: lab.late }, lab.source);
      $("timingNote").textContent = cue.note + " · Set Point = earliest_green − 70ms at " + RELEASE_SPEEDS[speedIndex].label + ".";

      const grades = buildGrades(selectedBuild);
      setGradeCard("gradeHeight", grades.height);
      setGradeCard("gradeImmunity", grades.immunity);
      setGradeCard("gradeStability", grades.stability);
      setGradeCard("gradeSpeed", grades.speed);

      model = { releaseMs: lab.releaseMs, windowMs: lab.windowMs, cycleMs: lab.cycleMs };
      setupMeterWindow();
      return;
    }

    if (!selected) {
      clearGrades();
      clearTimingDisplay();
      return;
    }

    const rating = selected.rating != null ? selected.rating : 70;
    const isGoTo = selected.type === "go_to";
    let timing = null;

    if (isGoTo) {
      timing = computeGoToTiming(selected.name, rating, speed.index, cue);
    } else {
      timing = computeStandingTiming(selected, speed.index, cue);
    }

    if (!timing) {
      showMissingLabTiming(
        isGoTo
          ? "No public NBA2KLab row for this go-to animation."
          : "Sync NBA2KLab for per-animation base/release timings."
      );
      const grades = computeGradesForShot(speed.factor, 40, rating, selected.type, selected.height);
      setGradeCard("gradeHeight", grades.height);
      setGradeCard("gradeImmunity", grades.immunity);
      setGradeCard("gradeStability", grades.stability);
      setGradeCard("gradeSpeed", grades.speed);
      return;
    }

    updateTimingDisplay(
      timing.releaseMs,
      timing.windowMs,
      timing.cycleMs || TIMING_2K26.cycleMs,
      timing.edges,
      timing.source
    );
    $("timingNote").textContent = cue.note;

    const grades = computeGradesForShot(speed.factor, timing.windowMs, rating, selected.type, selected.height);
    setGradeCard("gradeHeight", grades.height);
    setGradeCard("gradeImmunity", grades.immunity);
    setGradeCard("gradeStability", grades.stability);
    setGradeCard("gradeSpeed", grades.speed);

    model = { releaseMs: timing.releaseMs, windowMs: timing.windowMs, cycleMs: timing.cycleMs || TIMING_2K26.cycleMs };
    setupMeterWindow();
  }

  $("heightFilter").addEventListener("change", onProfileChange);
  $("ratingFilter").addEventListener("input", onProfileChange);
  $("loadBestBtn").addEventListener("click", applyBestBuild);
  $("copyBuildBtn").addEventListener("click", async () => {
    if (!selectedBuild) {
      showToast("No build to copy");
      return;
    }
    const text = buildCopyText(selectedBuild);
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copied to clipboard");
    } catch {
      showToast("Copy failed — select text manually");
    }
  });
  ["pickBase", "pickR1", "pickR2", "pickSpeed", "pickCue"].forEach((id) => {
    $(id).addEventListener("change", onCreatorChange);
  });
  $("pickBlend").addEventListener("input", () => {
    $("blendVal").textContent = $("pickBlend").value + "%";
    const build = readBuildFromUI();
    $("blendHint").textContent = blendLabel(build);
    onCreatorChange();
  });
  ["typeFilter", "search"].forEach((id) => $(id).addEventListener("input", render));

  $("searchClear").addEventListener("click", () => {
    $("search").value = "";
    render();
    $("search").focus();
  });

  /* ---- Timing Trainer ---- */
  let raf = null, startTime = 0, running = false, model = null;

  function cycleMs() {
    return model && model.cycleMs ? model.cycleMs : TIMING_2K26.cycleMs;
  }

  function setupMeterWindow() {
    if (!model) return;
    const cycle = cycleMs();
    const center = model.releaseMs / cycle;
    const w = model.windowMs / cycle;
    const win = $("meterWindow");
    win.style.left = clamp((center - w / 2) * 100, 0, 100 - w * 100) + "%";
    win.style.width = (w * 100) + "%";
  }

  function loop() {
    const cycle = cycleMs();
    const elapsed = (performance.now() - startTime) % cycle;
    const pct = elapsed / cycle * 100;
    $("meterCursor").style.left = pct + "%";
    const fill = $("meterFill");
    if (fill) fill.style.width = pct + "%";
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (running || !model) {
      if (!model) setResult("Pick build parts first.", "info");
      return;
    }
    running = true;
    startTime = performance.now();
    $("meter").classList.add("running");
    setResult("Releasing\u2026 hit the green.", "info");
    raf = requestAnimationFrame(loop);
  }

  function tap() {
    if (!running || !model) return;
    const cycle = cycleMs();
    const t = (performance.now() - startTime) % cycle;
    const diff = t - model.releaseMs;
    const half = model.windowMs / 2;
    running = false;
    cancelAnimationFrame(raf);
    $("meter").classList.remove("running");
    const fill = $("meterFill");
    if (fill) fill.style.width = "0%";

    if (Math.abs(diff) <= half) {
      setResult("\uD83D\uDFE2 GREEN! (" + (diff >= 0 ? "+" : "") + Math.round(diff) + " ms)", "green");
    } else if (Math.abs(diff) <= half * 2.2) {
      setResult((diff < 0 ? "Early " : "Late ") + Math.round(Math.abs(diff)) + " ms (slight)", "warn");
    } else {
      setResult((diff < 0 ? "Too early " : "Too late ") + Math.round(Math.abs(diff)) + " ms", "bad");
    }
  }

  $("startBtn").addEventListener("click", start);
  $("tapBtn").addEventListener("click", tap);
  $("meter").addEventListener("click", tap);
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      running ? tap() : start();
    }
  });

  $("labSyncBtn").addEventListener("click", async () => {
    const token = ($("labToken") && $("labToken").value) || "";
    const btn = $("labSyncBtn");
    btn.disabled = true;
    btn.textContent = "Syncing…";
    try {
      const cache = await syncLabData(token);
      const n = Object.keys(cache.bases).length + Object.keys(cache.releases).length + cache.custom.length;
      showToast("Loaded " + n + " NBA2KLab timing rows");
      computeTiming();
    } catch (err) {
      showToast(err.message || "Lab sync failed");
    } finally {
      btn.disabled = false;
      btn.textContent = "Sync NBA2KLab";
    }
  });

  updateLabSyncStatus();
  clearGrades();
  applyBestBuild();
})();