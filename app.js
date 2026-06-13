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
  $("cue").innerHTML = VISUAL_CUES.map((c, i) => `<option value="${i}">${c.name}</option>`).join("");

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

  function buildParts(build) {
    return [build.base, build.release_1, build.release_2];
  }

  function buildUnlockable(build, playerHeight, maxRating) {
    if (maxRating < build.min_3pt || maxRating > build.max_3pt) return false;
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
    if (build.release_1 === build.release_2) return "100% " + build.release_1.split(" ").pop();
    const r1 = build.blend;
    const r2 = 100 - build.blend;
    return r1 + "% " + build.release_1.split(" ").pop() + " / " + r2 + "% " + build.release_2.split(" ").pop();
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
    const s = build.stats;
    return {
      height: { letter: scoreToGrade(s.release_height), pct: s.release_height },
      immunity: { letter: scoreToGrade(s.defense_immunity), pct: s.defense_immunity },
      stability: { letter: scoreToGrade(s.timing_stability), pct: s.timing_stability },
      speed: { letter: scoreToGrade(s.release_speed), pct: s.release_speed }
    };
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

  function renderBuildUI(build) {
    if (!build) {
      $("recommendName").textContent = "No match";
      $("recommendGw").textContent = "";
      ["recBase", "recR1", "recR2", "recBlend", "recSpeed", "recCue"].forEach((id) => {
        $(id).textContent = "–";
      });
      $("recommendNote").textContent = "Raise your 3PT rating or try another height.";
      return;
    }
    const speed = RELEASE_SPEEDS[build.release_speed];
    const cue = VISUAL_CUES[build.visual_cue];
    $("recommendName").textContent = build.label;
    $("recommendGw").textContent = build.window_ms + " ms green window";
    $("recBase").textContent = build.base;
    $("recR1").textContent = build.release_1;
    $("recR2").textContent = build.release_2;
    $("recBlend").textContent = blendLabel(build);
    $("recSpeed").textContent = speed.label;
    $("recCue").textContent = cue.name;
    $("recommendNote").textContent = build.note;
  }

  function badgeClass(type) {
    return "badge-type-" + type;
  }

  function setResult(text, state) {
    const el = $("result");
    el.textContent = text;
    el.className = "feedback" + (state ? " is-" + state : "");
  }

  function setShotSelected(hasShot) {
    $("shotEmpty").hidden = hasShot;
    $("shotSelected").hidden = !hasShot;
  }

  function setGradeCard(cardId, letter, pct) {
    const card = $(cardId);
    const letterEl = card.querySelector(".grade-letter");
    const fillEl = card.querySelector(".grade-fill");
    letterEl.textContent = letter;
    letterEl.className = "grade-letter " + gradeClass(letter);
    if (fillEl) {
      fillEl.style.width = pct + "%";
      fillEl.className = "grade-fill " + fillClass(letter);
    }
  }

  function getReleaseSpeed() {
    const index = clamp(+$("speed").value, 0, RELEASE_SPEEDS.length - 1);
    return { index, ...RELEASE_SPEEDS[index] };
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
      setGradeCard(id, "–", 0);
    });
    $("speedFill").style.width = "0%";
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

    const buildPartsSet = recommendedBuild
      ? new Set(buildParts(recommendedBuild))
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

  function applyBestBuild() {
    recommendedBuild = findBestCustomBuild();
    selectedBuild = recommendedBuild;
    renderBuildUI(recommendedBuild);

    if (!selectedBuild) {
      selected = null;
      setShotSelected(false);
      clearGrades();
      render();
      return;
    }

    selected = null;
    setShotSelected(true);
    $("selName").textContent = selectedBuild.label;
    $("selTypeBadge").textContent = "Custom Blend";
    $("selTypeBadge").className = "tag badge-type-jump_shot";
    $("selRating").textContent = buildMaxRating(selectedBuild) + " Midrange/3PT";
    $("selHeight").textContent = $("heightFilter").value;
    $("speed").value = selectedBuild.release_speed;
    $("cue").value = selectedBuild.visual_cue;
    render();
    computeTiming();
  }

  function select(s, li) {
    selectedBuild = null;
    selected = s;
    Array.from($("results").children).forEach((c) => c.classList.remove("active"));
    if (li) li.classList.add("active");

    setShotSelected(true);
    $("selName").textContent = s.name;
    const badge = $("selTypeBadge");
    badge.textContent = TYPE_LABELS[s.type];
    badge.className = "tag " + badgeClass(s.type);
    $("selRating").textContent = s.rating != null ? s.rating + " Midrange/3PT" : "None";
    $("selHeight").textContent = s.height;
    computeTiming();
  }

  function updateCueNote() {
    $("cueNote").textContent = VISUAL_CUES[+$("cue").value].note;
  }

  function computeTiming() {
    const speed = getReleaseSpeed();
    const cue = VISUAL_CUES[+$("cue").value];
    $("speedVal").textContent = speed.label;
    $("speed").setAttribute("aria-valuetext", speed.label);
    updateCueNote();

    if (selectedBuild) {
      const releaseMs = buildReleaseMs(selectedBuild, speed.factor, cue);
      const windowMs = clamp(
        Math.round(selectedBuild.window_ms - (speed.factor - RELEASE_SPEEDS[selectedBuild.release_speed].factor) * 0.25),
        32,
        72
      );
      const tempoMs = Math.round(releaseMs * 0.55);
      const tempoWindowMs = clamp(Math.round(windowMs * 1.25), 22, 170);
      const cycleMs = 1000;

      $("tLabel").textContent = "Tempo cue";
      $("timingNote").innerHTML =
        "<strong>Copy this build</strong> into Jumpshot Creator exactly as shown. " + selectedBuild.note;

      $("gPoint").textContent = releaseMs + " ms (" + cue.name + ")";
      $("gWindow").textContent =
        "\u00b1" + Math.round(windowMs / 2) + " ms (" + windowMs + " ms total) \u00b7 " + selectedBuild.window_ms + " ms researched window";
      $("tCue").textContent = tempoMs + " ms before release";
      $("tWindow").textContent = "\u00b1" + Math.round(tempoWindowMs / 2) + " ms (" + tempoWindowMs + " ms total)";

      const place = (el, c, w) => {
        const ww = (w / 800) * 100;
        el.style.left = clamp(((c - w / 2) / 800) * 100, 0, 100 - ww) + "%";
        el.style.width = ww + "%";
      };
      place($("gBar"), releaseMs, windowMs);
      place($("tBar"), tempoMs, tempoWindowMs);

      const grades = buildGrades(selectedBuild);
      setGradeCard("gradeHeight", grades.height.letter, grades.height.pct);
      setGradeCard("gradeImmunity", grades.immunity.letter, grades.immunity.pct);
      setGradeCard("gradeStability", grades.stability.letter, grades.stability.pct);
      setGradeCard("gradeSpeed", grades.speed.letter, grades.speed.pct);
      $("speedFill").style.width = (speed.index / (RELEASE_SPEEDS.length - 1)) * 100 + "%";

      model = { releaseMs, windowMs, cycleMs };
      setupMeterWindow();
      return;
    }

    if (!selected) {
      clearGrades();
      return;
    }

    const rating = selected.rating != null ? selected.rating : 70;
    const isGoTo = selected.type === "go_to";
    let releaseMs, windowMs, tempoMs, tempoWindowMs, cycleMs, timingSource;

    if (isGoTo) {
      const go = computeGoToTiming(selected.name, rating, speed.factor, cue);
      releaseMs = go.releaseMs;
      windowMs = go.windowMs;
      tempoMs = go.gatherMs;
      tempoWindowMs = clamp(Math.round(windowMs * 1.1), 12, 50);
      cycleMs = go.cycleMs;
      timingSource = go.source === "lab"
        ? "NBA2KLab moving-jumper (" + go.labJumper + ")"
        : "estimated (no lab row — scaled from jump shot)";
      $("tLabel").textContent = "Dribble gather";
      $("timingNote").innerHTML =
        "Go-To is RS up with LS neutral — longer dribble-into-shot wind-up. " +
        (go.source === "lab"
          ? "<strong>Lab data:</strong> " + go.labJumper + " profile from NBA2KLab."
          : "<strong>Estimate</strong> — no NBA2KLab row for this player.");
    } else {
      const typeScale = TYPE_TIMING[selected.type] || 1;
      const jump = computeJumpTiming(rating, speed.factor, cue, selected.name);
      releaseMs = Math.round(jump.releaseMs * typeScale);
      windowMs = clamp(Math.round(jump.windowMs * typeScale), 18, 140);
      tempoMs = Math.round(releaseMs * 0.55);
      tempoWindowMs = clamp(Math.round(windowMs * 1.25), 22, 170);
      cycleMs = 1000;
      const meta = GREEN_WINDOW_META[selected.name];
      timingSource = meta
        ? "researched meta (" + meta.note + ")"
        : "estimated from rating + release speed";
      $("tLabel").textContent = "Tempo cue";
      $("timingNote").innerHTML = meta
        ? "<strong>Meta data:</strong> " + meta.note + ". Other values are modeled from unlock rating and release speed."
        : "Green window sized from rating and release speed models. 2K does not publish exact timings — use NBA2KLab for verified lab tests.";
    }

    $("gPoint").textContent = releaseMs + " ms (" + cue.name + ")";
    $("gWindow").textContent = "\u00b1" + Math.round(windowMs / 2) + " ms (" + windowMs + " ms total) \u00b7 " + timingSource;
    $("tCue").textContent = tempoMs + " ms before release";
    $("tWindow").textContent = "\u00b1" + Math.round(tempoWindowMs / 2) + " ms (" + tempoWindowMs + " ms total)";

    const axis = isGoTo ? cycleMs : 800;
    const place = (el, c, w) => {
      const ww = (w / axis) * 100;
      el.style.left = clamp(((c - w / 2) / axis) * 100, 0, 100 - ww) + "%";
      el.style.width = ww + "%";
    };
    place($("gBar"), releaseMs, windowMs);
    place($("tBar"), tempoMs, tempoWindowMs);

    const grades = computeGradesForShot(speed.factor, windowMs, rating, selected.type, selected.height);
    setGradeCard("gradeHeight", grades.height.letter, grades.height.pct);
    setGradeCard("gradeImmunity", grades.immunity.letter, grades.immunity.pct);
    setGradeCard("gradeStability", grades.stability.letter, grades.stability.pct);
    setGradeCard("gradeSpeed", grades.speed.letter, grades.speed.pct);
    $("speedFill").style.width = (speed.index / (RELEASE_SPEEDS.length - 1)) * 100 + "%";

    model = { releaseMs, windowMs, cycleMs };
    setupMeterWindow();
  }

  $("heightFilter").addEventListener("input", applyBestBuild);
  $("ratingFilter").addEventListener("input", applyBestBuild);
  ["typeFilter", "search"].forEach((id) => $(id).addEventListener("input", render));
  ["speed", "cue"].forEach((id) => $(id).addEventListener("input", computeTiming));

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
      if (!model) setResult("Select a shot first.", "info");
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

  setShotSelected(false);
  clearGrades();
  setResult("Select a shot, then press Start.", "info");
  updateCueNote();
  applyBestBuild();
})();