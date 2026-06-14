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

  function allScrapedCustomRows() {
    return (SCRAPED_CUSTOM || LAB_PUBLIC_CUSTOM || []).filter((row) => row && row.earliest_green != null);
  }

  function scrapedSummary() {
    if (typeof SCRAPED_META !== "undefined" && SCRAPED_META) {
      return {
        custom: SCRAPED_META.custom_builds || 0,
        goto: SCRAPED_META.go_to_rows || 0,
        gated: SCRAPED_META.gated_custom || 0,
        bases: SCRAPED_META.bases || 0,
        releases: SCRAPED_META.releases || 0,
        heights: SCRAPED_META.player_heights || (SCRAPED_PLAYER_HEIGHTS || []).length || 0
      };
    }
    const custom = allScrapedCustomRows().length;
    const goto = (SCRAPED_GO_TO || GO_TO_LAB || []).length;
    const gated = allScrapedCustomRows().filter((r) => r.gated).length;
    const heights = (typeof SCRAPED_PLAYER_HEIGHTS !== "undefined" ? SCRAPED_PLAYER_HEIGHTS : []).length;
    return { custom, goto, gated, bases: 0, releases: 0, heights };
  }

  function parseBlendToNumber(blend, release_1, release_2) {
    if (release_1 === release_2) return 100;
    const s = String(blend || "").replace(/\s/g, "");
    let m = s.match(/^(\d+)\/(\d+)$/);
    if (m) return +m[1];
    m = s.match(/^(\d+)/);
    return m ? +m[1] : 50;
  }

  function parsePercent(str) {
    if (str == null || str === "") return null;
    const n = parseFloat(String(str).replace("%", ""));
    return Number.isNaN(n) ? null : n;
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
    for (const row of allScrapedCustomRows()) {
      if (
        row.base === build.base &&
        row.release_1 === build.release_1 &&
        row.release_2 === build.release_2 &&
        String(row.blend).replace(/\s/g, "") === blend.replace(/\s/g, "")
      ) {
        return { ...row, source: row.source || "scraped-custom" };
      }
    }
    return null;
  }

  function resolveBuildLabRow(build) {
    return matchCustomLabRow(build);
  }

  function computeBuildLabTiming(build, speedIndex, cue) {
    const row = resolveBuildLabRow(build);
    if (!row) return null;
    return applyLabRow(row, speedIndex, cue);
  }

  function updateScrapedBadge() {
    const el = $("scrapedBadge");
    if (!el) return;
    const s = scrapedSummary();
    el.textContent =
      s.custom + " custom · " + s.goto + " go-to · " + s.heights + " heights · " +
      s.bases + " bases · " + s.releases + " releases";
  }

  function timingSourceLabel(source) {
    if (source === "scraped-goto" || source === "lab-moving") return "scraped go-to";
    if (source === "scraped-custom" || source === "scraped-chunk" || source === "lab-custom") return "scraped custom build";
    if (source === "lab-public") return "scraped build";
    return "no scraped row";
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

  function getAllJumpShotNames() {
    return SHOTS
      .filter((s) => s.type === "jump_shot")
      .map((s) => s.name)
      .sort((a, b) => a.localeCompare(b));
  }

  function isShotLocked(name) {
    const req = getJumpShotReq(name);
    if (!req) return true;
    const maxRating = +$("ratingFilter").value;
    if (req.rating != null && req.rating > maxRating) return true;
    return !heightMatches(req.height, $("heightFilter").value);
  }

  function shotOptionLabel(name) {
    const req = getJumpShotReq(name);
    if (!req) return name;
    const star = req.rating != null ? " \u2605" + req.rating : "";
    return name + star + (isShotLocked(name) ? " (locked)" : "");
  }

  function getCreatorShotNames(preferred) {
    const names = new Set(getAllJumpShotNames());
    if (preferred) {
      [preferred.base, preferred.release_1, preferred.release_2].forEach((n) => {
        if (n) names.add(n);
      });
    }
    ["pickBase", "pickR1", "pickR2"].forEach((id) => {
      const el = $(id);
      if (el && el.value) names.add(el.value);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  function currentCreatorPicks() {
    return {
      base: $("pickBase").value,
      release_1: $("pickR1").value,
      release_2: $("pickR2").value
    };
  }

  function fillShotSelect(selectId, names, preferred) {
    const el = $(selectId);
    const prev = preferred || el.value;
    el.innerHTML = "";
    names.forEach((name) => {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = shotOptionLabel(name);
      o.disabled = false;
      el.appendChild(o);
    });
    if (prev && names.includes(prev)) el.value = prev;
    else if (names.length) el.value = names[0];
  }

  function populateCreatorDropdowns(preferred) {
    const names = getCreatorShotNames(preferred);
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

  function labRowToBuild(row) {
    const blend = parseBlendToNumber(row.blend, row.release_1, row.release_2);
    const build = {
      label: row.name || "Tested Build",
      base: row.base,
      release_1: row.release_1,
      release_2: row.release_2,
      blend,
      release_speed: DEFAULT_RELEASE_SPEED_INDEX,
      visual_cue: 0,
      window_ms: row.latest_green - row.earliest_green,
      labRow: row
    };
    build.note = row.gated
      ? "Hidden gated build — real scraped ms (names redacted at source)."
      : row.recommended === "yes"
        ? "Scraped recommended build — real earliest_green / latest_green."
        : "Scraped tested build.";
    return build;
  }

  function findBestCustomBuild() {
    const playerHeight = $("heightFilter").value;
    const playerIn = heightToInches(playerHeight);
    const maxRating = +$("ratingFilter").value;
    const candidates = [];
    for (const row of allScrapedCustomRows()) {
      const hMin = heightToInches(row.min_height);
      const hMax = heightToInches(row.max_height);
      if (playerIn < hMin || playerIn > hMax) continue;
      if (row.rating_req != null && row.rating_req > maxRating) continue;
      const build = labRowToBuild(row);
      if (!buildUnlockable(build, playerHeight, maxRating)) continue;
      candidates.push(build);
    }
    if (!candidates.length) return null;
    return candidates.reduce((best, b) => (b.window_ms > best.window_ms ? b : best));
  }

  function setDefaultBuild() {
    const shots = getUnlockableJumpShots();
    const names = shots.length >= 3
      ? shots.map((s) => s.name)
      : getAllJumpShotNames().slice(0, 3);
    if (names.length < 3) return null;
    const base = names.find((n) => n !== names[0]) || names[0];
    const r2 = names.find((n) => n !== names[0] && n !== base) || names[0];
    return {
      label: "Custom Build",
      base: names[0],
      release_1: base,
      release_2: r2,
      blend: 50,
      release_speed: DEFAULT_RELEASE_SPEED_INDEX,
      visual_cue: 0,
      window_ms: null,
      note: "Pick parts — timing shows only when your blend matches a scraped tested build."
    };
  }

  function blendLabel(build) {
    if (build.release_1 === build.release_2) return "100% " + build.release_1;
    const r2 = 100 - build.blend;
    return build.blend + "% " + build.release_1 + " / " + r2 + "% " + build.release_2;
  }

  function buildMaxRating(build) {
    let max = 0;
    for (const name of buildParts(build)) {
      const req = getJumpShotReq(name);
      if (req && req.rating != null && req.rating > max) max = req.rating;
    }
    return max;
  }

  function buildLabMetrics(labRow, timing) {
    const pgw = timing
      ? timing.windowMs
      : labRow && labRow.latest_green != null && labRow.earliest_green != null
        ? labRow.latest_green - labRow.earliest_green
        : null;
    const make = labRow ? parsePercent(labRow.total_average) : null;
    const early = labRow ? parsePercent(labRow.early_average) : null;
    const speedMs = labRow ? labRow.earliest_green : timing ? timing.earliest_green : null;
    return {
      pgw: { display: pgw != null ? pgw + "ms" : "–", pct: pgw != null ? clamp(Math.round(30 + pgw * 1.1), 0, 100) : null },
      make: { display: make != null ? make.toFixed(1) + "%" : "–", pct: make != null ? clamp(Math.round(make), 0, 100) : null },
      early: { display: early != null ? early.toFixed(1) + "%" : "–", pct: early != null ? clamp(Math.round(early), 0, 100) : null },
      speed: { display: speedMs != null ? speedMs + "ms" : "–", pct: speedMs != null ? clamp(Math.round(120 - (speedMs - 500) * 0.15), 0, 100) : null }
    };
  }

  function applyLabMetrics(labRow, timing) {
    const m = buildLabMetrics(labRow, timing);
    setMetricCard("gradeHeight", m.pgw);
    setMetricCard("gradeImmunity", m.make);
    setMetricCard("gradeStability", m.early);
    setMetricCard("gradeSpeed", m.speed);
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
    populateCreatorDropdowns({
      base: build.base,
      release_1: build.release_1,
      release_2: build.release_2
    });
    if (build.base) $("pickBase").value = build.base;
    if (build.release_1) $("pickR1").value = build.release_1;
    if (build.release_2) $("pickR2").value = build.release_2;
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
    $("recommendGw").textContent = build.window_ms != null ? build.window_ms + "ms PGW" : "No scraped PGW";
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
      sub.className = "detail-sub timing-source" + (source && source !== "no scraped row" ? " is-lab" : " is-missing");
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

  function setMetricCard(cardId, data) {
    const card = $(cardId);
    if (!card) return;
    const display = typeof data === "object" ? data.display : data;
    const pct = typeof data === "object" ? data.pct : null;
    const letterEl = card.querySelector(".grade-letter");
    if (letterEl) {
      letterEl.textContent = display != null ? display : "–";
      letterEl.className = "grade-letter grade-value";
    }
    const pctEl = card.querySelector(".grade-pct");
    if (pctEl) pctEl.textContent = pct != null ? "" : "";
    const bar = card.querySelector(".grade-bar-fill");
    if (bar) {
      bar.style.width = pct != null ? pct + "%" : "0%";
      bar.className = "grade-bar-fill" + (pct != null ? " fill-live" : "");
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

  function matchGoToLab(name, opts) {
    const options = opts || { turbo: false, hand: "Main" };
    const n = name.toLowerCase();
    const last = n.split(/\s+/).pop();
    for (const row of (SCRAPED_GO_TO || GO_TO_LAB || [])) {
      if (row.turbo !== options.turbo || row.hand !== options.hand) continue;
      const key = row.jumper.toLowerCase();
      if (n.includes(key) || last === key) return row;
    }
    return null;
  }

  function computeGoToTiming(name, rating, speedIndex, cue) {
    const lab = matchGoToLab(name);
    if (!lab) return null;
    const add = speedAddMs(speedIndex);
    const early = lab.early_ms + add;
    const late = lab.late_ms + add;
    const releaseMs = early - cueOffsetMs(cue);
    const windowMs = lab.window_ms != null ? lab.window_ms : lab.late_ms - lab.early_ms;
    const cycleMs = Math.max(late + 140, 900);
    return {
      releaseMs,
      windowMs,
      cycleMs,
      edges: { early, late },
      source: "scraped-goto",
      labJumper: lab.jumper,
      earliest_green: lab.early_ms
    };
  }

  function applyShotLabMetrics(timing) {
    if (!timing) {
      clearGrades();
      return;
    }
    setMetricCard("gradeHeight", { display: timing.windowMs + "ms", pct: clamp(Math.round(30 + timing.windowMs * 1.1), 0, 100) });
    setMetricCard("gradeImmunity", { display: "–", pct: null });
    setMetricCard("gradeStability", { display: "–", pct: null });
    setMetricCard("gradeSpeed", {
      display: timing.earliest_green != null ? timing.earliest_green + "ms" : "–",
      pct: timing.earliest_green != null ? clamp(Math.round(120 - (timing.earliest_green - 500) * 0.15), 0, 100) : null
    });
  }

  function clearGrades() {
    ["gradeHeight", "gradeImmunity", "gradeStability", "gradeSpeed"].forEach((id) => {
      setMetricCard(id, { display: "–", pct: null });
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
    if (!getJumpShotReq(name)) {
      showToast(name + " is not a jump shot animation");
      return;
    }
    populateCreatorDropdowns(currentCreatorPicks());
    if (part.value === "base") $("pickBase").value = name;
    else if (part.value === "r1") $("pickR1").value = name;
    else $("pickR2").value = name;
    onCreatorChange();
    const lockHint = isShotLocked(name) ? " (locked for your build)" : "";
    showToast("Set " + name + " as " + assignPartLabel(part.value) + lockHint);
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
    if (!getAllJumpShotNames().length) {
      selectedBuild = null;
      updateHeroDisplay(null);
      clearGrades();
      render();
      setResult("No jump shot data loaded.", "info");
      return;
    }
    selectedBuild = readBuildFromUI();
    selectedBuild.label = "Custom Build";
    selected = null;
    updateHeroDisplay(selectedBuild);
    render();
    computeTiming();
    setResult("Hit Start when you have scraped timing for this blend.", "info");
  }

  function onProfileChange() {
    recommendedBuild = findBestCustomBuild();
    const picks = currentCreatorPicks();
    const hasShots = populateCreatorDropdowns(picks);
    if (!hasShots) {
      selectedBuild = null;
      updateHeroDisplay(null);
      clearGrades();
      render();
      setResult("No jump shot data loaded.", "info");
      return;
    }
    $("pickBase").value = picks.base && getCreatorShotNames(picks).includes(picks.base) ? picks.base : $("pickBase").value;
    $("pickR1").value = picks.release_1 && getCreatorShotNames(picks).includes(picks.release_1) ? picks.release_1 : $("pickR1").value;
    $("pickR2").value = picks.release_2 && getCreatorShotNames(picks).includes(picks.release_2) ? picks.release_2 : $("pickR2").value;
    selectedBuild = readBuildFromUI();
    selectedBuild.label = "Custom Build";
    updateHeroDisplay(selectedBuild);
    computeTiming();
    render();
  }

  function applyBestBuild() {
    recommendedBuild = findBestCustomBuild();
    if (!recommendedBuild) {
      const fallback = setDefaultBuild();
      const hasShots = populateCreatorDropdowns();
      if (!hasShots) {
        selectedBuild = null;
        updateHeroDisplay(null);
        clearGrades();
        render();
        setResult("Adjust height or 3PT rating.", "info");
        return;
      }
      selectedBuild = fallback;
      syncControlsFromBuild(selectedBuild);
      selected = null;
      updateHeroDisplay(selectedBuild);
      render();
      computeTiming();
      setResult("No scraped build fits your height/3PT yet — pick parts manually.", "info");
      return;
    }
    selectedBuild = { ...recommendedBuild };
    syncControlsFromBuild(selectedBuild);
    selected = null;
    updateHeroDisplay(selectedBuild);
    render();
    computeTiming();
    setResult("Loaded best scraped build — tweak parts or hit Start.", "info");
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

  function showMissingTiming(note) {
    clearTimingDisplay();
    $("timingNote").textContent = note || "No scraped timing row for this selection.";
    model = null;
  }

  function computeTiming() {
    const speed = getReleaseSpeed();
    const cue = getCue();

    if (selectedBuild) {
      const speedIndex = selectedBuild.release_speed;
      const lab = buildLabTiming(selectedBuild, speedIndex, cue);

      if (!lab) {
        showMissingTiming("No scraped test for this exact blend — try Load best tested or browse scraped builds.");
        clearGrades();
        return;
      }

      selectedBuild.window_ms = lab.windowMs;
      $("recommendGw").textContent = lab.windowMs + "ms PGW";
      updateTimingDisplay(lab.releaseMs, lab.windowMs, lab.cycleMs, { early: lab.early, late: lab.late }, lab.source);
      $("timingNote").textContent = cue.note + " · Set Point = earliest_green − 70ms at " + RELEASE_SPEEDS[speedIndex].label + ".";

      applyLabMetrics(matchCustomLabRow(selectedBuild), lab);

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
    }

    if (!timing) {
      showMissingTiming(
        isGoTo
          ? "No scraped go-to row for this animation style."
          : "No scraped per-animation timing — only go-to and exact custom builds have ms data."
      );
      clearGrades();
      return;
    }

    updateTimingDisplay(
      timing.releaseMs,
      timing.windowMs,
      timing.cycleMs || TIMING_2K26.cycleMs,
      timing.edges,
      timing.source
    );
    $("timingNote").textContent = isGoTo
      ? cue.note + " · Scraped go-to (Turbo off, main hand)."
      : cue.note;

    applyShotLabMetrics(timing);

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

  function renderScrapedGoTo() {
    const ul = $("scrapedGoTo");
    if (!ul) return;
    ul.innerHTML = "";
    const rows = (SCRAPED_GO_TO || GO_TO_LAB || []).filter((r) => r.early_ms != null);
    rows.forEach((row) => {
      const li = document.createElement("li");
      li.className = "scraped-row";
      const hand = row.hand || "Main";
      const turbo = row.turbo ? "turbo" : "no turbo";
      li.innerHTML =
        `<span class="nm">${row.jumper} · ${hand} · ${turbo}</span>` +
        `<span class="rq">${row.window_ms}ms PGW</span>` +
        `<span class="tg">${row.early_ms}–${row.late_ms}</span>`;
      ul.appendChild(li);
    });
  }

  function renderScrapedBuilds() {
    const ul = $("scrapedBuilds");
    if (!ul) return;
    ul.innerHTML = "";
    const rows = allScrapedCustomRows().sort((a, b) => (b.latest_green - b.earliest_green) - (a.latest_green - a.earliest_green));
    rows.forEach((row) => {
      const pgw = row.latest_green - row.earliest_green;
      const li = document.createElement("li");
      li.className = "scraped-row" + (row.gated ? " is-gated" : "");
      const label = row.gated
        ? (row.name || "hidden") + " [gated]"
        : row.base + " / " + row.release_1 + " / " + row.release_2;
      li.innerHTML =
        `<span class="nm">${label}</span>` +
        `<span class="rq">${pgw}ms PGW</span>` +
        `<span class="tg">${row.recommended === "yes" ? "rec" : "tested"}</span>`;
      li.addEventListener("click", () => {
        const build = labRowToBuild(row);
        selectedBuild = build;
        syncControlsFromBuild(build);
        selected = null;
        updateHeroDisplay(build);
        render();
        computeTiming();
        showToast("Loaded " + (row.name || "scraped build"));
      });
      ul.appendChild(li);
    });
  }

  populateCreatorDropdowns();
  const initial = setDefaultBuild();
  if (initial) {
    syncControlsFromBuild(initial);
    selectedBuild = readBuildFromUI();
    updateHeroDisplay(selectedBuild);
    computeTiming();
  }
  updateScrapedBadge();
  renderScrapedBuilds();
  renderScrapedGoTo();
  clearGrades();
  render();
})();