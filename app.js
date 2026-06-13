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

  function metaGreenWindow(name) {
    const row = GREEN_WINDOW_META[name];
    return row ? row.window_ms : null;
  }

  function estimateGreenWindow(rating, speedFactor) {
    const sweet = 56 - Math.abs(rating - 65) * 0.35;
    return clamp(Math.round(sweet - speedFactor * 0.2), 38, 52);
  }

  function getGreenWindowMs(shot, speedFactor, cue) {
    const meta = metaGreenWindow(shot.name);
    if (meta != null) return meta;

    if (shot.type === "go_to") {
      const lab = matchGoToLab(shot.name);
      if (lab) return lab.window_ms;
      const rating = shot.rating != null ? shot.rating : 70;
      const jump = computeJumpTiming(rating, speedFactor, cue, shot.name);
      return clamp(Math.round(jump.windowMs * GO_TO_ESTIMATE.window_scale), 10, 40);
    }

    const rating = shot.rating != null ? shot.rating : 70;
    const typeScale = TYPE_TIMING[shot.type] || 1;
    const jump = computeJumpTiming(rating, speedFactor, cue, shot.name);
    return clamp(Math.round(jump.windowMs * typeScale), 18, 72);
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
    const window_ms = computeBuildBaseWindowMs({ base, release_1, release_2, blend });
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
      $("heroRelease").textContent = "–";
      $("heroWindow").textContent = "–";
      $("heroCue").textContent = "–";
      $("timingNote").textContent = "Adjust height or 3PT to unlock animations.";
      updatePartRatings(null);
      return;
    }
    hero.classList.remove("is-empty");
    const speed = RELEASE_SPEEDS[build.release_speed];
    const cue = VISUAL_CUES[build.visual_cue];
    $("recommendName").textContent = customBuildLabel(build);
    $("recommendGw").textContent = build.window_ms + "ms window";
    $("recommendNote").textContent = buildCustomNote(build);
    $("selRating").textContent = buildMaxRating(build);
    $("selHeight").textContent = $("heightFilter").value;
    $("blendVal").textContent = build.blend + "%";
    $("blendHint").textContent = blendLabel(build);
    $("heroCue").textContent = cue.name;
    $("timingNote").textContent = cue.note + " Speed: " + speed.label + ".";
    updatePartRatings(build);
  }

  function buildReleaseMs(build, speedFactor, cue) {
    const parts = [
      [build.base, 0.42],
      [build.release_1, 0.33 * (build.blend / 100)],
      [build.release_2, 0.33 * ((100 - build.blend) / 100)]
    ];
    let total = 0;
    let weight = 0;
    for (const [name, wt] of parts) {
      if (!wt) continue;
      const req = getJumpShotReq(name);
      const rating = req && req.rating != null ? req.rating : 70;
      total += computeJumpTiming(rating, speedFactor, cue, name).releaseMs * wt;
      weight += wt;
    }
    return Math.round(total / (weight || 1));
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

  function computeJumpTiming(rating, speedFactor, cue, shotName) {
    const baseMs = 720 - (rating - 38) * 2.2;
    const releaseMs = Math.round(baseMs * (130 - speedFactor) / 100 * (1 + cue.offset));
    const meta = shotName ? metaGreenWindow(shotName) : null;
    const windowMs = meta != null
      ? clamp(Math.round(meta - (speedFactor - 50) * 0.25), 32, 72)
      : estimateGreenWindow(rating, speedFactor);
    return { releaseMs, windowMs };
  }

  function computeGoToTiming(name, rating, speedFactor, cue) {
    const lab = matchGoToLab(name);
    const speedShift = Math.round((50 - speedFactor) * 2.4);
    const cueShift = Math.round(cue.offset * 90);

    if (lab) {
      const releaseMs = clamp(lab.release_ms + speedShift + cueShift, 520, 1100);
      const windowMs = clamp(lab.window_ms + Math.round(speedShift * 0.15), 8, 45);
      const gatherMs = clamp(Math.round(lab.early_ms * 0.72), 380, 780);
      const cycleMs = clamp(lab.late_ms + 140, 900, 1200);
      return {
        releaseMs,
        windowMs,
        gatherMs,
        cycleMs,
        source: "lab",
        labJumper: lab.jumper
      };
    }

    const jump = computeJumpTiming(rating, speedFactor, cue, name);
    const releaseMs = clamp(
      Math.round(jump.releaseMs * GO_TO_ESTIMATE.ratio + GO_TO_ESTIMATE.gather_ms + cueShift),
      600,
      1050
    );
    const windowMs = clamp(Math.round(jump.windowMs * GO_TO_ESTIMATE.window_scale), 10, 40);
    const gatherMs = clamp(Math.round(releaseMs * 0.48), 360, 720);
    const cycleMs = clamp(releaseMs + 280, 950, 1150);
    return { releaseMs, windowMs, gatherMs, cycleMs, source: "estimate" };
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
      selectedBuild.window_ms = computeBuildBaseWindowMs(selectedBuild);
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

  function computeTiming() {
    const speed = getReleaseSpeed();
    const cue = getCue();

    if (selectedBuild) {
      const releaseMs = buildReleaseMs(selectedBuild, speed.factor, cue);
      const refFactor = RELEASE_SPEEDS[selectedBuild.release_speed].factor;
      const windowMs = clamp(
        Math.round(selectedBuild.window_ms - (speed.factor - refFactor) * 0.25),
        32,
        72
      );
      const cycleMs = 1000;

      $("gPoint").textContent = releaseMs + "ms";
      $("gWindow").textContent = windowMs + "ms";
      $("heroRelease").textContent = releaseMs + "ms";
      $("heroWindow").textContent = windowMs + "ms";

      const grades = buildGrades(selectedBuild);
      setGradeCard("gradeHeight", grades.height);
      setGradeCard("gradeImmunity", grades.immunity);
      setGradeCard("gradeStability", grades.stability);
      setGradeCard("gradeSpeed", grades.speed);

      model = { releaseMs, windowMs, cycleMs };
      setupMeterWindow();
      return;
    }

    if (!selected) {
      clearGrades();
      $("heroRelease").textContent = "–";
      $("heroWindow").textContent = "–";
      return;
    }

    const rating = selected.rating != null ? selected.rating : 70;
    const isGoTo = selected.type === "go_to";
    let releaseMs, windowMs, cycleMs;

    if (isGoTo) {
      const go = computeGoToTiming(selected.name, rating, speed.factor, cue);
      releaseMs = go.releaseMs;
      windowMs = go.windowMs;
      cycleMs = go.cycleMs;
    } else {
      const typeScale = TYPE_TIMING[selected.type] || 1;
      const jump = computeJumpTiming(rating, speed.factor, cue, selected.name);
      releaseMs = Math.round(jump.releaseMs * typeScale);
      windowMs = clamp(Math.round(jump.windowMs * typeScale), 18, 140);
      cycleMs = 1000;
    }

    $("gPoint").textContent = releaseMs + "ms";
    $("gWindow").textContent = windowMs + "ms";
    $("heroRelease").textContent = releaseMs + "ms";
    $("heroWindow").textContent = windowMs + "ms";

    const grades = computeGradesForShot(speed.factor, windowMs, rating, selected.type, selected.height);
    setGradeCard("gradeHeight", grades.height);
    setGradeCard("gradeImmunity", grades.immunity);
    setGradeCard("gradeStability", grades.stability);
    setGradeCard("gradeSpeed", grades.speed);

    model = { releaseMs, windowMs, cycleMs };
    setupMeterWindow();
  }

  $("heightFilter").addEventListener("change", onProfileChange);
  $("ratingFilter").addEventListener("input", onProfileChange);
  $("loadBestBtn").addEventListener("click", applyBestBuild);
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
    return model && model.cycleMs ? model.cycleMs : 1000;
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
    $("meterCursor").style.left = (elapsed / cycle * 100) + "%";
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

  clearGrades();
  applyBestBuild();
})();