// Coast FIRE v2: page wiring. The math lives in calc.js (window.CoastFire); this
// file builds the input fields, keeps number boxes and sliders in sync, writes the
// results, draws the SVG charts, and remembers the inputs in this browser
// (localStorage only). Numbers go into a link only when the user asks for one.
"use strict";

const CF = window.CoastFire;
const STORE_KEY = "coastfire.v2";
const OLD_KEY = "coastfire.inputs"; // v1

// localStorage can throw (private mode, blocked storage); the page works without it.
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
  del: (k) => { try { localStorage.removeItem(k); } catch (e) {} },
};
const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (x) => CF.fmtMoney(x);
const cmp = (x) => CF.fmtCompact(x, 2);
const kRound = (x) => CF.fmtCompact(Math.round(x / 1000) * 1000); // "$23K"
const pct1 = (x) => (Math.round(x * 1000) / 10).toFixed(1) + "%";
const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
const coarse = window.matchMedia ? window.matchMedia("(pointer: coarse)") : { matches: false };

let values = { ...CF.DEFAULTS };
let result = null, gridRes = null, bridgeRes = null;
let hover = null;            // index into result.points the crosshair sits on, or null
let viewingShared = false;   // showing a shared link's numbers; not saved until edited or kept
const notes = {};            // per field: { err, adj }

// ---------- icons (inline, stroke = currentColor) ----------
const ICON = {
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  alert: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5 14 13H2Z"/><path d="M8 6.5v3M8 11.2v.1"/></svg>',
  boat: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 10.5h12l-2 3H4z"/><path d="M8 2.5v8M8 3l4 6H8"/></svg>',
  clock: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/></svg>',
  up: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 9.5v-7M3 5.5l3-3 3 3"/></svg>',
  down: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.5v7M3 6.5l3 3 3-3"/></svg>',
  warnBig: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 22 20H2Z"/><path d="M12 10v4M12 17h.01"/></svg>',
  okBig: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

// ---------- field definitions ----------
// Partner fields are written once per partner ("kA", "kB"); META holds the shared part.
const META = {
  age: { label: "Current age", unit: "yrs", mode: "numeric" },
  retAge: { label: "Retirement age", unit: "yrs", mode: "numeric" },
  assets: { label: "Invested now", pre: true, hint: "All retirement money for the household: 401(k)s, IRAs, HSA, brokerage. Not the emergency fund." },
  spend: { label: "Spending in retirement", pre: true, unit: "/yr", hint: "Per year once retired, in today's dollars." },
  draw: { label: "Draw while coasting", pre: true, unit: "/yr" },
  nominal: { label: "Return before inflation", unit: "%/yr", mode: "text" },
  inflation: { label: "Inflation", unit: "%/yr", mode: "text" },
  swr: { label: "Safe withdrawal rate", unit: "%", hint: "The share of the portfolio taken in the first year of retirement. 4% is the classic rule of thumb." },
  hsa: { label: "HSA contributions", pre: true, unit: "/yr" },
  sal: { label: "Annual salary", pre: true, unit: "/yr" },
  k: { label: "401(k) you put in", pre: true, unit: "/yr" },
  emp: { label: "Employer adds", unit: "% of pay" },
  roth: { label: "Roth IRA", pre: true, unit: "/yr" },
  coastAge: { label: "Coast from age", unit: "yrs", mode: "numeric" },
  after: { label: "Keep saving after coasting", unit: "% of before", mode: "numeric" },
  preShare: { label: "Share that is pre-tax", unit: "%", mode: "numeric" },
  sepShare: { label: "Pre-tax set aside for 72(t)", unit: "%", mode: "numeric" },
  sepRate: { label: "72(t) interest rate", unit: "%", hint: "Notice 2022-6 allows up to the greater of 5% or 120% of the federal mid-term rate." },
  basis: { label: "Roth contributions (basis)", pre: true },
  taxable: { label: "Taxable + cash", pre: true, hint: "Brokerage and savings you can spend at any age." },
  lead: { label: "Start conversions early", unit: "yrs before", mode: "numeric", hint: "Converting while still working lets the first rungs ripen sooner (taxed at your working-years rate)." },
};
const metaOf = (key) => META[key] || META[key.slice(0, -1)];
const partnerOf = (key) => (/[AB]$/.test(key) && !META[key] ? key.slice(-1) : null);
const LIMIT_TEXT = { k401: "$24,500 limit", roth: "$7,500 limit" };
const NUM_KEYS = CF.KEYS.filter((k) => !CF.FIELDS[k].bool);

function fieldHTML(key) {
  const m = metaOf(key), f = CF.FIELDS[key], p = partnerOf(key);
  const aria = (p ? `Partner ${p}: ` : "") + m.label;
  return `<div class="field" data-key="${key}">
    <div class="field-top"><label for="f-${key}">${esc(m.label)}</label>
      <span class="box">${m.pre ? '<span class="unit pre">$</span>' : ""}<input id="f-${key}" inputmode="${m.mode || "decimal"}" autocomplete="off" aria-describedby="n-${key} h-${key}"${p ? ` aria-label="${esc(aria)}"` : ""}>${m.unit ? `<span class="unit">${esc(m.unit)}</span>` : ""}</span></div>
    <p class="note" id="n-${key}" aria-live="polite"></p>
    <div class="slider"><input type="range" id="s-${key}" aria-label="${esc(aria)}">${f.limit ? '<span class="limit-tick" aria-hidden="true"></span>' : ""}</div>
    ${f.limit ? `<div class="range" aria-hidden="true"><span>$0</span><span class="lim" id="lim-${key}">${LIMIT_TEXT[f.limit] || ""}</span></div>` : ""}
    <p class="hint" id="h-${key}">${m.hint ? esc(m.hint) : ""}</p>
  </div>`;
}

function partnerHTML(p) {
  const other = p === "A" ? "B" : "A";
  return `<header class="card-head">
      <span class="badge${p === "B" ? " b" : ""}" aria-hidden="true">${p}</span>
      <div class="grow"><h3 id="p${p}-t">Partner ${p}</h3><p class="partner-sub" id="sub-${p}"></p></div>
      ${p === "B" ? `<button type="button" class="icon-btn" id="remove-B" aria-label="Remove Partner B" title="Remove Partner B">${ICON.x}</button>` : ""}
    </header>
    ${["sal", "k", "emp", "roth"].map((k) => fieldHTML(k + p)).join("")}
    <div class="toggle-row">
      <div class="grow"><span class="tlabel" id="coast-l-${p}">Coast from an age</span><p class="fine" id="coast-h-${p}">Stop or cut ${p}'s saving at an age while ${other === "B" ? "B" : "A"}'s plan stays as set.</p></div>
      <button type="button" class="switch" id="sw-coast-${p}" role="switch" aria-checked="false" aria-labelledby="coast-l-${p} p${p}-t" aria-describedby="coast-h-${p}"><i></i></button>
    </div>
    <div class="coast-sub" id="coast-sub-${p}" hidden>${fieldHTML("coastAge" + p)}${fieldHTML("after" + p)}</div>
    <div class="partner-foot"><span id="foot-l-${p}">From Partner ${p}</span><b id="foot-${p}"></b></div>`;
}

function buildInputs() {
  $("hh-fields").innerHTML = ["age", "retAge", "assets", "spend", "draw"].map(fieldHTML).join("");
  $("assume-fields").innerHTML = ["nominal", "inflation", "swr"].map(fieldHTML).join("");
  $("card-A").innerHTML = partnerHTML("A");
  $("card-B").innerHTML = partnerHTML("B");
  $("hsa-fields").innerHTML = fieldHTML("hsa");
  $("bridge").innerHTML = `
    <div class="teaser" id="br-teaser"></div>
    <div id="br-full" hidden>
      <div class="card-head"><div class="grow"><h2 id="br-title">Early-access bridge</h2><p class="fine">Money you can reach each year until 59½</p></div><span class="chip" id="br-chip"></span></div>
      <div id="br-fields">${["preShare", "sepShare", "sepRate", "basis", "taxable", "lead"].map(fieldHTML).join("")}</div>
      <div id="br-out"></div>
    </div>`;
  $("hh-fields").querySelector(".field").classList.add("first");
  $("assume-fields").querySelector(".field").classList.add("first");
  $("hsa-fields").querySelector(".field").classList.add("first");
  $("br-fields").querySelector(".field").classList.add("first");
}

// ---------- loading and saving ----------

function loadSaved() {
  let saved = null;
  try { saved = JSON.parse(store.get(STORE_KEY) || "null"); } catch (e) { saved = null; }
  if (!saved) {
    // Carry over a v1 scenario's household numbers once, then forget the old key.
    let old = null;
    try { old = JSON.parse(store.get(OLD_KEY) || "null"); } catch (e) { old = null; }
    if (old && typeof old === "object") {
      saved = {};
      for (const k of ["age", "retAge", "assets", "spend", "nominal", "inflation", "swr"]) if (k in old) saved[k] = old[k];
    }
    store.del(OLD_KEY);
  }
  return CF.sanitize(saved && typeof saved === "object" ? saved : {}, CF.DEFAULTS).values;
}

function sharedFromHash() {
  const h = CF.decodeHash(location.hash);
  return Object.keys(h).length ? CF.sanitize({ ...CF.DEFAULTS, ...h }).values : null;
}
const isDefaults = (v) => CF.KEYS.every((k) => v[k] === CF.DEFAULTS[k]);

function clearHash() {
  if (!location.hash) return;
  try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
}
function setViewingShared(on) {
  viewingShared = on;
  $("shared-banner").hidden = !on;
  if (!on) clearHash();
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  if (viewingShared) return; // someone else's numbers: don't replace this person's own
  saveTimer = setTimeout(() => {
    if (isDefaults(values)) store.del(STORE_KEY);
    else store.set(STORE_KEY, JSON.stringify(values));
  }, 250);
}

// ---------- toast (status messages, Undo, copy box) ----------

let toastTimer = 0;
function toast(...parts) {
  const t = $("toast");
  clearTimeout(toastTimer);
  t.textContent = "";
  if (!parts.length) { t.hidden = true; syncPeek(); return; }
  const msg = document.createElement("span");
  msg.className = "grow";
  let keep = false;
  for (const p of parts) {
    if (typeof p === "string") msg.append(p);
    else { if (p.tagName === "INPUT") keep = true; t.append(p); }
  }
  t.prepend(msg);
  t.hidden = false;
  syncPeek();
  if (!keep) toastTimer = setTimeout(() => toast(), 9000);
}
function toastButton(text, onClick) {
  const b = document.createElement("button");
  b.type = "button"; b.textContent = text;
  b.addEventListener("click", () => { onClick(); });
  return b;
}

// Something the user typed or dragged: a shared scenario becomes theirs.
function userChanged() {
  if (viewingShared) setViewingShared(false);
  update();
}

// ---------- inputs ----------

function fieldText(key, v) {
  const f = CF.FIELDS[key];
  if (f.money) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (f.int) return String(v);
  const t = +v.toFixed(2);
  return f.step < 1 && Number.isInteger(t) ? t.toFixed(1) : String(t); // "5.0", like "4.3"
}
function withUnit(key, v) {
  const f = CF.FIELDS[key];
  if (f.money) return "$" + fieldText(key, v);
  if (f.int) return fieldText(key, v);
  return fieldText(key, v) + "%";
}
function unitWords(key) {
  const f = CF.FIELDS[key], m = metaOf(key);
  if (f.int) return m.unit === "yrs" ? " years" : " years";
  if (f.money) return m.unit === "/yr" ? " dollars a year" : " dollars";
  return " percent";
}
const sliderTop = (key) => (key === "hsa" ? CF.hsaLimit(values) : undefined);

function setSlider(key, keepPos) {
  const s = $("s-" + key), f = CF.FIELDS[key];
  if (!s) return;
  const hi = sliderTop(key);
  if (!keepPos) s.value = CF.valueToSlider(key, values[key], hi);
  const p = f.curve ? s.value / CF.SLIDER_STEPS * 100 : (s.value - f.sMin) / (f.sMax - f.sMin) * 100;
  s.style.setProperty("--fill", p + "%");
  s.setAttribute("aria-valuetext", fieldText(key, values[key]) + unitWords(key));
}

// Why a typed number isn't used as typed (clamped or rounded), or "" when it is.
function adjustedNote(key, typed, used) {
  if (typed === used) return "";
  const f = CF.FIELDS[key];
  if (f.limit && typed > used) return `Over the ${CF.LIMITS.year} limit · using ${withUnit(key, used)}`;
  if (typed < f.min) return `Using ${withUnit(key, used)} (the minimum)`;
  if (typed > f.max) return `Using ${withUnit(key, used)} (the maximum)`;
  if (f.int) return `Using ${withUnit(key, used)} (whole years)`;
  return `Using ${withUnit(key, used)}`;
}

function showNote(key) {
  const n = notes[key] || { err: "", adj: "" }, box = $("f-" + key);
  if (!box) return;
  const field = box.closest(".field");
  const ageMsg = key === "retAge" && values.retAge <= values.age ? `Must be after your current age (${values.age})` : "";
  const bad = !!n.err || !!ageMsg;
  $("n-" + key).textContent = n.err || ageMsg || n.adj;
  field.classList.toggle("invalid", bad);
  if (bad) box.setAttribute("aria-invalid", "true"); else box.removeAttribute("aria-invalid");
  if (bad && field.closest("details")) field.closest("details").open = true;
}

function showAll() {
  for (const k of NUM_KEYS) {
    $("f-" + k).value = fieldText(k, values[k]);
    notes[k] = { err: "", adj: "" };
    setSlider(k);
  }
}

// Keep the HSA within the coverage limit; say so when it had to move.
function clampHsa() {
  const lim = CF.hsaLimit(values);
  if (values.hsa > lim) {
    values.hsa = lim;
    $("f-hsa").value = fieldText("hsa", lim);
    notes.hsa = { err: "", adj: `Over the ${CF.LIMITS.year} limit · using ${withUnit("hsa", lim)}` };
  } else {
    notes.hsa = { err: "", adj: "" }; // the limit went up: an old "using $X" note is stale
  }
  setSlider("hsa");
  showNote("hsa");
}

function wireField(key) {
  const f = CF.FIELDS[key], box = $("f-" + key), slider = $("s-" + key);
  if (f.curve) { slider.min = 0; slider.max = CF.SLIDER_STEPS; slider.step = 1; }
  else { slider.min = f.sMin; slider.max = f.sMax; slider.step = f.step; }
  notes[key] = { err: "", adj: "" };

  box.addEventListener("input", () => {
    const raw = box.value;
    if (raw.trim() === "") { notes[key] = { err: "", adj: "" }; showNote(key); return; } // mid-retype
    const c = CF.cleanField(key, raw, values[key]);
    if (!c.ok) {
      notes[key] = { err: `Enter a number, e.g. ${fieldText(key, CF.DEFAULTS[key])}`, adj: "" };
      showNote(key);
      return;
    }
    let used = c.value;
    if (key === "hsa") used = Math.min(used, CF.hsaLimit(values));
    notes[key] = { err: "", adj: adjustedNote(key, CF.parseNumber(raw), used) };
    values[key] = used;
    setSlider(key);
    userChanged();
  });
  box.addEventListener("blur", () => {
    box.value = fieldText(key, values[key]);
    notes[key] = { err: "", adj: "" };
    showNote(key);
  });
  box.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const step = f.step * (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
    let v = CF.cleanField(key, +(values[key] + step).toFixed(4)).value;
    if (key === "hsa") v = Math.min(v, CF.hsaLimit(values));
    values[key] = v;
    box.value = fieldText(key, v);
    notes[key] = { err: "", adj: "" };
    setSlider(key);
    userChanged();
  });
  slider.addEventListener("input", () => {
    values[key] = CF.sliderToValue(key, slider.value, sliderTop(key));
    box.value = fieldText(key, values[key]);
    notes[key] = { err: "", adj: "" };
    setSlider(key, true);
    userChanged();
  });
}

function setSwitch(id, on) { $(id).setAttribute("aria-checked", on ? "true" : "false"); }

function wireSwitches() {
  $("sw-two").addEventListener("click", () => { values.two = values.two ? 0 : 1; clampHsa(); userChanged(); });
  $("remove-B").addEventListener("click", () => {
    values.two = 0; clampHsa(); userChanged();
    $("sw-two").focus();
    toast("Partner B removed. ", toastButton("Undo", () => { values.two = 1; showAll(); update(); toast(); }));
  });
  for (const p of ["A", "B"]) {
    $("sw-coast-" + p).addEventListener("click", () => { values["coastOn" + p] = values["coastOn" + p] ? 0 : 1; userChanged(); });
  }
  const seg = (fam) => { values.hsaFamily = fam ? 1 : 0; clampHsa(); userChanged(); };
  $("seg-family").addEventListener("click", () => seg(true));
  $("seg-self").addEventListener("click", () => seg(false));
}

// ---------- results: words ----------

const two = () => !!values.two;
function planDesc(res) {
  const v = res.inputs, parts = [];
  for (const p of v.two ? ["A", "B"] : ["A"]) {
    const pl = res.plan[p];
    if (pl.on && pl.age < v.retAge) {
      const who = v.two ? p : "you";
      parts.push(`${who} coast${v.two ? "s" : ""} at ${Math.max(pl.age, v.age)}${pl.after > 0 ? ` keeping ${Math.round(pl.after * 100)}%` : ""}`);
    }
  }
  if (!parts.length) return `saving to ${v.retAge}`;
  let s = parts.join(", ");
  if (v.draw > 0) s += `, drawing ${kRound(v.draw)}/yr`;
  return s;
}

function chipHTML(kind, icon, text) { return `<span class="chip ${kind}">${ICON[icon]}${esc(text)}</span>`; }

function heroState(res) {
  const v = res.inputs, R = v.retAge, e = res.earliest.both, both = two() ? "both " : "";
  const together = two() ? " together" : "";
  if (res.warnings.includes("retAgeNotAfterAge")) {
    return { chip: ["bad", "alert", "Check ages"], big: "—", cap: "", head: "Retirement age must be after your current age." };
  }
  if (e.age !== null && e.age <= v.age) {
    const draw = v.draw > 0 ? `, even drawing ${money(v.draw)}/yr` : "";
    if (e.after > 0.5) {
      // Solved "now", but only because each partner keeps their after-coasting share:
      // the money alone doesn't get there, so never say "no more saving".
      const share = two() ? "your after-coasting shares" : "your after-coasting share";
      return {
        chip: ["good", "check", "Cut back now"], big: "Now", words: true, cap: `you could ${both}cut to ${share} today`,
        head: `Keep adding <strong>${money(e.after)}/yr</strong> (${share}) and growth takes you to your <strong>${cmp(res.fire)}</strong> FIRE number by ${R}${draw}.`,
      };
    }
    return {
      chip: ["good", "boat", "Coasting now"], big: "Now", words: true, cap: `you could ${both}stop saving today`,
      head: `Your <strong>${cmp(v.assets)}</strong> already grows into your <strong>${cmp(res.fire)}</strong> FIRE number by ${R}${draw}, with no more saving.`,
    };
  }
  if (e.age !== null) {
    const planOk = res.surplus >= -0.5;
    const o = {};
    for (const p of two() ? ["A", "B"] : ["A"]) o[p] = { on: true, age: e.age };
    const afterSum = CF.contribAt(v, CF.planOf(v, o), e.age).total;
    const then = afterSum > 0.5 ? `then <strong>${money(afterSum)}/yr</strong> after that. That` : "After that, growth alone";
    const draw = v.draw > 0 ? `, even drawing ${money(v.draw)}/yr from ${e.age}` : "";
    const planNote = planOk ? "" : ` Your plan as entered (${planDesc(res)}) ends <strong>${cmp(-res.surplus)} short</strong>.`;
    if (e.age >= R) {
      return {
        chip: ["warn", "clock", `Not before ${R}`], big: String(R), cap: "keep saving right up to retirement",
        head: `Keep adding <strong>${money(res.start.total)}/yr</strong>${together} right up to ${R}. That just reaches your <strong>${cmp(res.fire)}</strong> FIRE number.${planNote}`,
      };
    }
    return {
      chip: planOk ? ["good", "check", "On track"] : ["warn", "alert", `Plan ${cmp(-res.surplus)} short`],
      big: String(e.age), cap: `earliest age you can ${both}stop saving`,
      head: `Keep adding <strong>${money(res.start.total)}/yr</strong>${together} until ${e.age}${afterSum > 0.5 ? "," : "."} ${then} takes you to your <strong>${cmp(res.fire)}</strong> FIRE number by ${R}${draw}.${planNote}`,
    };
  }
  const short = res.fire - res.fullBalance;
  // With a coast age on, the tile and the bottom bar show the plan as entered, so name
  // this chip's scenario (saving the whole way) to keep the two shortfalls apart.
  const planCoasts = Number.isFinite(res.firstCoast) && res.firstCoast < R;
  return {
    chip: ["bad", "alert", planCoasts ? `${cmp(short)} short saving to ${R}` : `${cmp(short)} short`], big: `Not by ${R}`, words: true, cap: "saving the whole way isn't enough yet",
    head: `Not quite on course yet. At <strong>${kRound(res.start.total)}/yr</strong>${Number.isFinite(res.firstCoast) && res.firstCoast < R ? " saving the whole way," : ""} you reach <strong>${cmp(res.fullBalance)}</strong> by ${R}, short of <strong>${cmp(res.fire)}</strong>.`,
    nudge: true,
  };
}

function renderHero(res) {
  const v = res.inputs, st = heroState(res), R = v.retAge;
  $("chip").outerHTML = `<span id="chip" class="chip ${st.chip[0]}">${ICON[st.chip[1]]}${esc(st.chip[2])}</span>`;
  $("hero-age").textContent = st.big;
  $("hero-age").classList.toggle("words", !!st.words);
  $("hero-age").parentElement.classList.toggle("stack", !!st.words);
  $("hero-cap").textContent = st.cap;
  $("headline").innerHTML = st.head;

  const nudge = $("nudge");
  nudge.hidden = !st.nudge;
  if (st.nudge) {
    const together = two() ? " together" : "";
    const items = [`save about <b>${kRound(res.requiredAnnual)}/yr</b>${together} (now ${kRound(res.start.total)})`];
    items.push(res.retireLater ? `retire at <b>${res.retireLater}</b> instead of ${R}` : "retire later");
    items.push(`spend about <b>${kRound(res.spendWithin)}/yr</b> in retirement (now ${kRound(v.spend)})`);
    nudge.innerHTML = `<b>To get there by ${R}, any one of these would do it:</b><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
  }

  // Ring: share of today's coast number already invested.
  const badAges = res.warnings.includes("retAgeNotAfterAge");
  const p = badAges ? NaN : res.coastNow > 0 ? v.assets / res.coastNow : 1;
  const txt = !Number.isFinite(p) ? "—" : p >= 9.995 ? "999%+" : Math.round(p * 100) + "%";
  const pc = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
  $("ring-fill").setAttribute("stroke-dasharray", `${(pc * 188.5).toFixed(1)} 188.5`);
  $("ring-fill").style.visibility = pc > 0 ? "" : "hidden"; // a 0-length round cap draws a stray dot
  $("ring-num").textContent = txt;
  $("ring").setAttribute("aria-label", badAges ? "Progress not shown until the ages are fixed" : `${txt} of today's Coast FIRE number`);

  if (badAges) {
    // Nothing below means anything with a negative horizon.
    for (const k of ["fire", "coast", "ret", "cross"]) { $("k-" + k).textContent = "—"; $("k-" + k + "-n").textContent = "Fix the ages first"; }
    $("k-ret-l").textContent = "At retirement, your plan";
    $("k-ret-tile").classList.remove("bad", "good");
    $("warn").hidden = true;
    return;
  }

  // KPI tiles, each with a line on its own maths.
  $("k-fire").textContent = cmp(res.fire);
  $("k-fire-n").textContent = `${money(v.spend)} ÷ ${v.swr.toFixed(1)}%`;
  $("k-coast").textContent = cmp(res.coastNow);
  $("k-coast-n").textContent = `needed now to coast to ${R} · you have ${cmp(v.assets)}`;
  $("k-ret-l").textContent = `At ${R}, your plan`;
  $("k-ret").textContent = cmp(res.balanceAtRet);
  const s = res.surplus, ok = s >= -0.5;
  const planCoasts = Number.isFinite(res.firstCoast) && res.firstCoast < R;
  $("k-ret-n").innerHTML = `<span class="delta ${ok ? "up" : "down"}">${ok ? ICON.up : ICON.down}${cmp(Math.abs(s))} ${ok ? "surplus" : "short"}</span> · ${planCoasts ? "plan as entered: " : ""}${esc(planDesc(res))}`;
  $("k-ret-tile").classList.toggle("bad", !ok);
  $("k-ret-tile").classList.toggle("good", ok);
  const c = res.crossAge;
  $("k-cross").textContent = c === null ? `Not by ${R}` : c <= v.age ? "Now" : String(c);
  $("k-cross-n").textContent = c === null ? "your plan stays below the coast line"
    : (res.earliest.both.age !== null && c !== res.earliest.both.age ? `your plan; the solved stop age is ${res.earliest.both.age}` : "first age your plan is at or above it");

  const warn = [];
  if (res.warnings.includes("negativeRealReturn")) warn.push("Your return is below inflation, so your money loses value over time.");
  if (res.warnings.includes("tooLarge")) warn.push("Some of these numbers are too large to show.");
  $("warn").textContent = warn.join(" ");
  $("warn").hidden = !warn.length;
}

// ---------- inputs: live hints, subtitles, totals ----------

function renderInputs(res) {
  const v = res.inputs;
  setSwitch("sw-two", v.two);
  $("card-B").hidden = !v.two;
  $("two-hint").textContent = v.two ? "Turn off for a one-person plan." : "On to add Partner B.";
  $("seg-family").setAttribute("aria-pressed", v.hsaFamily ? "true" : "false");
  $("seg-self").setAttribute("aria-pressed", v.hsaFamily ? "false" : "true");
  $("seg-self").querySelector("small").textContent = v.two ? "$4,400 each" : "$4,400 limit";
  $("lim-hsa").textContent = v.hsaFamily ? "$8,750 limit" : v.two ? "$8,800 limit (2 × $4,400)" : "$4,400 limit";
  $("h-hsa").textContent = v.hsaFamily
    ? (v.two ? "Family coverage: one shared account and one limit. It keeps going until the last partner coasts."
      : "Family coverage: one account and one limit. It keeps going until you coast.")
    : v.two ? "Self-only coverage: an account each with its own limit, split evenly here; each half follows its partner." : "Self-only coverage.";
  $("assume-vals").textContent = `${v.nominal.toFixed(1)}% · ${v.inflation.toFixed(1)}% · ${v.swr.toFixed(1)}%`;
  $("assume-vals").setAttribute("aria-label", `return ${v.nominal.toFixed(1)}%, inflation ${v.inflation.toFixed(1)}%, withdrawal ${v.swr.toFixed(1)}%`);
  $("h-retAge").textContent = v.retAge < 59.5 ? "Before 59½: see the early-access bridge below." : "Set it below 59½ to plan an early-access bridge.";
  $("h-nominal").textContent = `Before inflation. Real return: ${(res.r * 100).toFixed(2)}% a year.`;
  $("h-inflation").textContent = "Everything is shown in today's dollars.";
  const first = res.firstCoast;
  $("h-draw").textContent = "Barista FIRE: taken from the portfolio each year " +
    (Number.isFinite(first) && first < v.retAge ? `from ${Math.max(first, v.age)} (the first coast age) to ${v.retAge}.` : "from the first coast age to retirement. Set a coast age to use it.");

  // One-person mode speaks to "you"; Partner A/B only when there are two.
  $("pA-t").textContent = v.two ? "Partner A" : "You";
  $("card-A").querySelector(".card-head .badge").hidden = !v.two;
  $("hm-sub").textContent = `Earliest age you could ${v.two ? "both " : ""}stop · outlined = your inputs`;
  for (const p of ["A", "B"]) {
    const b = CF.partnerBase(v, p), sal = v["sal" + p];
    const solo = !v.two && p === "A";
    const whose = solo ? "your" : `${p}'s`;
    $("sub-" + p).textContent = `Saving ${money(b.total)}/yr` + (sal > 0 ? ` · ${pct1(b.total / sal)} of pay` : "");
    $("h-k" + p).textContent = (sal > 0 ? `${pct1(v["k" + p] / sal)} of salary. ` : "") + "Age 50+ can add $8,000 ($11,250 at 60–63); not modeled.";
    $("h-emp" + p).textContent = `= ${money(b.employer)}/yr. Match plus any other employer money.`;
    $("h-roth" + p).textContent = "Income limits and the 50+ catch-up aren't modeled.";
    const on = !!v["coastOn" + p];
    setSwitch("sw-coast-" + p, on);
    $("coast-sub-" + p).hidden = !on;
    const ca = v["coastAge" + p];
    $("coast-h-" + p).textContent = on ? `On: ${solo ? "you cut" : p + " cuts"} saving from ${Math.max(ca, v.age)}.` : `Stop or cut ${whose} saving at an age.`;
    $("h-coastAge" + p).textContent = ca <= v.age ? "At or before your current age: coasting from today."
      : ca >= v.retAge ? `At or after retirement (${v.retAge}): no effect.` : "";
    $("h-after" + p).textContent = `Share of ${whose} ${money(b.total)}/yr that continues after coasting, employer money included.`;
    const afterAmt = b.total * v["after" + p] / 100;
    $("foot-" + p).textContent = `${money(b.total)}/yr`;
    const from = solo ? "From you" : `From Partner ${p}`;
    $("foot-l-" + p).textContent = on && ca < v.retAge ? `${from}, then ${money(afterAmt)}/yr from ${Math.max(ca, v.age)}` : from;
  }
  for (const k of NUM_KEYS) showNote(k);
}

// ---------- main chart ----------

let geo = null;
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
const textW = (s, px = 10) => String(s).length * px * 0.6;

function zoneInfo(res) {
  const v = res.inputs, e = res.earliest.both;
  if (Number.isFinite(res.firstCoast) && res.firstCoast < v.retAge) {
    const a = Math.max(res.firstCoast, v.age);
    return { start: a, label: ["coasting", `from ${a}`], key: "Coasting" };
  }
  if (e.age !== null && e.age < v.retAge) return { start: Math.max(e.age, v.age), label: ["could coast", `from ${Math.max(e.age, v.age)}`], key: "Could coast" };
  return null;
}

function drawChart() {
  const svg = $("chart-svg"), box = $("chart"), res = result;
  const W = Math.max(260, box.clientWidth), H = Math.max(180, box.clientHeight);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const v = res.inputs;
  const empty = res.warnings.includes("retAgeNotAfterAge") || res.warnings.includes("tooLarge");
  $("chart-empty").hidden = !empty;
  $("chart-empty").textContent = res.warnings.includes("tooLarge") ? "Too large to show." : "Retirement age must be after your current age.";
  $("chart-title").textContent = res.warnings.includes("retAgeNotAfterAge") ? "Your path" : `Your path to ${v.retAge}`;
  $("chart-sub").textContent = `Today's dollars · ${v.nominal.toFixed(1)}% return, ${v.inflation.toFixed(1)}% inflation = ${(res.r * 100).toFixed(2)}% real`;
  if (empty) { svg.innerHTML = ""; geo = null; $("readout").textContent = ""; return; }

  const pts = res.points, n = pts.length - 1;
  let yMax = res.fire;
  for (const p of pts) yMax = Math.max(yMax, p.balance, p.coastLine, p.noContrib);
  if (!(yMax > 0)) yMax = 1;
  const yStep = niceStep(yMax * 1.1 / 4);
  const yTop = Math.ceil(yMax * 1.1 / yStep) * yStep;
  const ticks = [];
  for (let t = 0; t <= yTop + yStep / 2; t += yStep) ticks.push(t);
  const L = Math.max(...ticks.map((t) => textW(CF.fmtCompact(t)))) + 8, Rm = 10, T = 12, B = 22;
  const span = Math.max(1, v.retAge - v.age);
  const x = (age) => L + (age - v.age) / span * (W - L - Rm);
  const y = (val) => T + (1 - val / yTop) * (H - T - B);
  const line = (key) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.age).toFixed(1)} ${y(p[key]).toFixed(1)}`).join("");
  let s = "";

  const zone = zoneInfo(res);
  $("zone-key").textContent = zone ? zone.key : "Could coast";
  $("zone-key").parentElement.hidden = !zone; // no band drawn, no legend entry
  if (zone) {
    const zx = x(zone.start), zw = x(v.retAge) - zx;
    s += `<rect class="coast-zone" x="${zx.toFixed(1)}" y="${T}" width="${Math.max(0, zw).toFixed(1)}" height="${H - T - B}"/>`;
  }
  for (const t of ticks) {
    s += `<line class="${t === 0 ? "base" : "grid"}" x1="${L}" x2="${W - Rm}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`;
    s += `<text class="tick" x="${L - 6}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${t === 0 ? "0" : CF.fmtCompact(t)}</text>`;
  }
  let xStep = span > 40 ? 10 : span > 12 ? 5 : span > 5 ? 2 : 1;
  if (W < 360 && span > 60) xStep = 20;
  const ages = new Set([v.age, v.retAge]);
  for (let a = Math.ceil(v.age / xStep) * xStep; a <= v.retAge; a += xStep) ages.add(a);
  const firstTick = `age ${v.age}`, firstW = textW(firstTick) + 10;
  for (const a of [...ages].sort((p, q) => p - q)) {
    if (a !== v.age && a !== v.retAge && (x(a) - x(v.age) < firstW || x(v.retAge) - x(a) < 22)) continue;
    s += `<text class="tick" x="${x(a).toFixed(1)}" y="${H - B + 14}" text-anchor="${a === v.age ? "start" : a === v.retAge ? "end" : "middle"}">${a === v.age ? firstTick : a}</text>`;
  }
  // Lines (no wash under the projection, so the shaded band means only "coasting").
  s += `<path class="l-stop" d="${line("noContrib")}"/>`;
  s += `<path class="l-coast" d="${line("coastLine")}"/>`;
  s += `<path class="l-proj" d="${line("balance")}"/>`;
  // FIRE number reference line, labelled directly.
  const fy = y(res.fire);
  s += `<line class="fire-line" x1="${L}" x2="${W - Rm}" y1="${fy.toFixed(1)}" y2="${fy.toFixed(1)}"/>`;
  // Labels are laid out together: each takes the first candidate spot that overlaps
  // no label placed before it (and, for the inline line labels, no line).
  const placed = [];
  const plotW = W - L - Rm;
  const lineY = (key, px) => {
    if (n < 1) return y(pts[0][key]);
    const a = Math.max(0, Math.min(n, (px - L) / plotW * span)), i = Math.min(n - 1, Math.floor(a)), f = a - i;
    return y(pts[i][key] * (1 - f) + pts[i + 1][key] * f);
  };
  const boxOf = (tx, ty, text, px, anchor, lines = 1) => {
    const w = textW(text, px), x0 = anchor === "end" ? tx - w : anchor === "middle" ? tx - w / 2 : tx;
    return { x0, x1: x0 + w, y0: ty - px * 0.8, y1: ty + px * 0.25 + (lines - 1) * (px + 1) };
  };
  const overlaps = (a, b) => a.x0 < b.x1 + 2 && b.x0 < a.x1 + 2 && a.y0 < b.y1 + 1 && b.y0 < a.y1 + 1;
  const crossesLine = (b, keys) => {
    if (fy > b.y0 - 1 && fy < b.y1 + 1) return true;
    for (let px = Math.max(L, b.x0); px <= Math.min(W - Rm, b.x1); px += 4) {
      for (const k of keys) { const ly = lineY(k, px); if (ly > b.y0 - 1 && ly < b.y1 + 1) return true; }
    }
    return false;
  };
  const fits = (b, keys) => b.x0 >= 0 && b.x1 <= W && b.y0 >= 0 && b.y1 <= H - B + 2 &&
    !placed.some((p) => overlaps(p, b)) && !(keys && crossesLine(b, keys));
  const place = (cands, keys) => {
    const c = cands.find((k) => fits(k.box, keys)) || (cands[0].must ? cands[0] : null);
    if (c) { placed.push(c.box); s += c.svg; }
    return c;
  };
  const fireText = `FIRE number ${cmp(res.fire)}`;
  placed.push(boxOf(L + 4, fy - 5, fireText, 10, "start"));
  s += `<text class="ref-label halo" x="${L + 4}" y="${(fy - 5).toFixed(1)}">${fireText}</text>`;
  // End of the projection, labelled directly; the shortfall bracketed at the right edge.
  const ex = x(v.retAge), ey = y(res.balanceAtRet);
  const shortBy = res.fire - res.balanceAtRet;
  let endSvg = `<circle class="dot-proj" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4"/>`;
  const endText = cmp(res.balanceAtRet);
  let endY = ey - 8;
  if (shortBy > 0.5 && fy < ey - 3) {
    const bx = ex + 5, shortText = `Short ${cmp(shortBy)}`;
    endSvg += `<path class="short-br" d="M${bx - 3} ${fy.toFixed(1)}H${bx}V${ey.toFixed(1)}H${bx - 3}"/>`;
    endSvg += `<text class="short-t halo" x="${(ex - 6).toFixed(1)}" y="${(fy + 13).toFixed(1)}" text-anchor="end">${shortText}</text>`;
    placed.push(boxOf(ex - 6, fy + 13, shortText, 11, "end"));
    endY = ey - fy > 36 ? ey - 8 : Math.min(H - B - 3, ey + 15);
  }
  endSvg += `<text class="end-label halo" x="${(ex - 6).toFixed(1)}" y="${endY.toFixed(1)}" text-anchor="end">${endText}</text>`;
  placed.push(boxOf(ex - 6, endY, endText, 11, "end"));
  // Partner coast points: a pin on the baseline and a label, on alternating sides.
  const pins = [];
  for (const p of v.two ? ["A", "B"] : ["A"]) {
    const pl = res.plan[p];
    if (pl.on && pl.age < v.retAge) pins.push({ p, age: Math.max(pl.age, v.age) });
  }
  if (pins.length === 2 && pins[0].age === pins[1].age) pins.splice(0, 2, { p: "AB", age: pins[0].age });
  pins.sort((a, b) => a.age - b.age);
  const by = y(0);
  for (const pin of pins) {
    const px = x(pin.age), letters = pin.p === "AB" ? ["A", "B"] : [pin.p];
    placed.push({ x0: px - 0.5, x1: px + 0.5, y0: y(pts[pin.age - v.age].balance) + 4, y1: by - 7 }); // the pin's stem
    letters.forEach((l, j) => {
      const bx = px + (letters.length === 2 ? (j ? 8 : -8) : 0);
      placed.push({ x0: bx - 8, x1: bx + 8, y0: by - 8, y1: by + 8 });
    });
  }
  pins.forEach((pin, i) => {
    const px = x(pin.age), py = y(pts[pin.age - v.age].balance);
    s += `<line class="pin-line" x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${(py + 4).toFixed(1)}" y2="${by - 7}"/>`;
    const letters = pin.p === "AB" ? ["A", "B"] : [pin.p];
    letters.forEach((l, j) => {
      const bx = px + (letters.length === 2 ? (j ? 8 : -8) : 0);
      s += l === "A" ? `<circle class="pin-a" cx="${bx.toFixed(1)}" cy="${by}" r="7"/>` : `<rect class="pin-a" x="${(bx - 7).toFixed(1)}" y="${by - 7}" width="14" height="14" rx="3"/>`;
      s += `<text class="pin-t" x="${bx.toFixed(1)}" y="${by + 3}" text-anchor="middle">${l}</text>`;
    });
    const label = pin.p === "AB" ? `both coast ${pin.age}` : `${v.two ? pin.p : "you"} coast${v.two ? "s" : ""} ${pin.age}`;
    const lw = textW(label, 11);
    const ly = Math.min(by - 14, py + 18 + i * 13);
    const cand = (left, yy) => ({ box: boxOf(left ? px - 5 : px + 5, yy, label, 11, left ? "end" : "start"),
      svg: `<text class="ann halo" x="${(left ? px - 5 : px + 5).toFixed(1)}" y="${yy.toFixed(1)}" text-anchor="${left ? "end" : "start"}">${label}</text>` });
    const prefLeft = i % 2 === 0 ? px - L > lw + 8 : px > W - Rm - lw - 8;
    const c = [cand(prefLeft, ly), cand(!prefLeft, ly), cand(prefLeft, ly - 13), cand(!prefLeft, ly - 13), cand(prefLeft, ly - 26), cand(!prefLeft, ly - 26)];
    c[0].must = true;
    place(c);
  });
  // Where the plan meets the coast line.
  if (res.crossAge !== null && !pins.some((p) => p.age === res.crossAge)) {
    const cp = pts[res.crossAge - v.age], cx = x(cp.age), cy = y(cp.balance);
    s += `<circle class="dot-proj" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5"/>`;
    const text = res.crossAge <= v.age ? "coasting now" : `meets coast line ${res.crossAge}`;
    const pref = cx < (L + W) / 2;
    const c = [];
    for (const yy of [cy - 9, cy + 16, cy - 22]) for (const right of [pref, !pref]) {
      const tx = right ? cx + 8 : cx - 8, anchor = right ? "start" : "end";
      c.push({ box: boxOf(tx, yy, text, 11, anchor), svg: `<text class="ann halo" x="${tx.toFixed(1)}" y="${yy.toFixed(1)}" text-anchor="${anchor}">${text}</text>` });
    }
    place(c); // no room: the dot stays, and the "Meets the coast line" tile gives the age
  }
  s += endSvg;
  const lineKeys = ["balance", "coastLine", "noContrib"];
  // The coasting band's label: bottom of the band, else its top, else just the word.
  if (zone) {
    const zx = x(zone.start), zw = x(v.retAge) - zx, cx = zx + zw / 2, rx = zx + zw - 3;
    const one = zone.label.join(" ");
    const text1 = (tx, ty, t, anchor) => ({ box: boxOf(tx, ty, t, 10, anchor),
      svg: `<text class="zone-label halo" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}">${t}</text>` });
    const c = [];
    if (zw > textW(one, 10) + 8) c.push(text1(cx, H - B - 6, one, "middle"), text1(cx, T + 12, one, "middle"));
    c.push({ box: boxOf(rx, H - B - 18, zone.label[0], 10, "end", 2),
      svg: `<text class="zone-label halo" x="${rx.toFixed(1)}" y="${H - B - 18}" text-anchor="end"><tspan>${zone.label[0]}</tspan><tspan x="${rx.toFixed(1)}" dy="11">${zone.label[1]}</tspan></text>` });
    // The pins already give the age, so the word alone is enough as a last resort.
    for (const ty of [T + 12, T + 26, H - B - 6]) c.push(text1(rx, ty, zone.label[0], "end"));
    place(c, lineKeys) || place(c);
  }
  // "If you stop today", inline on its own line; shortened and moved until it fits.
  let stopInLegend = n >= 1;
  if (n >= 4) {
    const cands = [];
    for (const text of [`if you stop today: ${cmp(res.noContribAtRet)} at ${v.retAge}`, `stop today: ${cmp(res.noContribAtRet)}`]) {
      const w = textW(text, 10);
      for (const frac of [0.3, 0.15, 0.45, 0.05]) {
        const lx = Math.max(L + 4, Math.min(x(v.age + span * frac), W - Rm - 60 - w));
        const ly = lineY("noContrib", lx);
        for (const yy of [ly - 6, ly + 12]) {
          cands.push({ box: boxOf(lx, yy, text, 10, "start"), svg: `<text class="end-label muted halo" x="${lx.toFixed(1)}" y="${yy.toFixed(1)}">${text}</text>` });
        }
      }
    }
    // When no spot is clear of the other lines, the value goes in the legend entry instead.
    stopInLegend = !place(cands, lineKeys);
  }
  $("stop-key").textContent = stopInLegend ? `If you stop today (${cmp(res.noContribAtRet)} at ${v.retAge})` : "If you stop today";
  // The coast line, labelled at the left where it is furthest from the FIRE line.
  const cly = y(pts[0].coastLine);
  place([cly - 6, cly + 13].map((yy) => ({ box: boxOf(L + 4, yy, "coast line", 10, "start"),
    svg: `<text class="ref-label coast-label halo" x="${L + 4}" y="${yy.toFixed(1)}">coast line</text>` })), lineKeys);
  s += `<g id="hover"></g>`;
  svg.innerHTML = s;
  geo = { x, y, W, H, T, B, L, Rm, span };
  svg.setAttribute("aria-label", `Chart from age ${v.age} to ${v.retAge}. Your plan reaches ${cmp(res.balanceAtRet)} against a FIRE number of ${cmp(res.fire)}. ${$("headline").textContent}`);
  showHover(hover === null ? null : Math.min(hover, n));
}

function readoutHTML(p) {
  const diff = p.balance - p.coastLine;
  return `<b>Age ${p.age}</b><span><i class="key k-proj"></i>Projected ${cmp(p.balance)}</span>` +
    `<span><i class="key k-coast"></i>Coast line ${cmp(p.coastLine)}</span>` +
    `<span class="gap ${diff >= 0 ? "up" : "down"}">${cmp(Math.abs(diff))} ${diff >= 0 ? "above" : "below"}</span>`;
}

function showHover(i) {
  if (!geo || !result) return;
  hover = i;
  const pts = result.points;
  const p = pts[i === null ? pts.length - 1 : i];
  $("readout").innerHTML = readoutHTML(p);
  const g = $("hover");
  if (!g) return;
  if (i === null) { g.innerHTML = ""; return; }
  const px = geo.x(p.age);
  g.innerHTML = `<line class="xhair" x1="${px}" x2="${px}" y1="${geo.T}" y2="${geo.H - geo.B}"/>` +
    `<circle class="dot-coast" cx="${px}" cy="${geo.y(p.coastLine)}" r="4"/><circle class="dot-proj" cx="${px}" cy="${geo.y(p.balance)}" r="4"/>`;
}

function hoverAtPointer(e) {
  if (!geo) return;
  const r = $("chart-svg").getBoundingClientRect();
  const sx = (e.clientX - r.left) * (geo.W / r.width);
  const age = result.inputs.age + (sx - geo.L) / (geo.W - geo.L - geo.Rm) * geo.span;
  showHover(Math.max(0, Math.min(result.points.length - 1, Math.round(age - result.inputs.age))));
}

function wireChart() {
  const svg = $("chart-svg");
  // The readout is announced for keyboard moves only; dragging would flood a screen reader.
  const live = (on) => $("readout").setAttribute("aria-live", on ? "polite" : "off");
  svg.addEventListener("pointermove", (e) => { live(false); hoverAtPointer(e); });
  svg.addEventListener("pointerdown", (e) => { live(false); hoverAtPointer(e); });
  svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") showHover(null); });
  svg.addEventListener("blur", () => showHover(null));
  svg.addEventListener("keydown", (e) => {
    if (!geo) return;
    const last = result.points.length - 1;
    let i = hover === null ? -1 : hover;
    if (e.key === "ArrowRight") i = Math.min(last, i + 1);
    else if (e.key === "ArrowLeft") i = i < 0 ? 0 : Math.max(0, i - 1);
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = last;
    else if (e.key === "Escape") { showHover(null); return; }
    else return;
    e.preventDefault();
    live(true);
    showHover(i);
  });
  $("table-toggle").addEventListener("click", () => {
    const t = $("path-table"), open = t.hidden;
    t.hidden = !open;
    $("table-toggle").setAttribute("aria-expanded", String(open));
    $("table-toggle").textContent = open ? "Hide the table" : "Show as a table";
    if (open) renderPathTable(result);
  });
  let raf = 0;
  const redraw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => result && drawAllCharts()); };
  if (window.ResizeObserver) new ResizeObserver(redraw).observe($("chart"));
  else window.addEventListener("resize", redraw);
}

function renderPathTable(res) {
  if ($("path-table").hidden) return;
  const rows = res.points.map((p) => `<tr><td>${p.age}</td><td>${money(p.balance)}</td><td>${money(p.coastLine)}</td><td>${p.contrib || p.draw ? money(p.contrib - p.draw) : "—"}</td><td>${money(p.noContrib)}</td></tr>`).join("");
  $("path-table").innerHTML = `<table class="data"><caption class="visually-hidden">Projection by age, today's dollars</caption><thead><tr><th scope="col">Age</th><th scope="col">Projected</th><th scope="col">Coast line</th><th scope="col">Added that year</th><th scope="col">Stop today</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------- contributions: stacked bars per partner ----------

function renderContrib(res) {
  const v = res.inputs, svg = $("bars-svg");
  const W = Math.max(260, svg.parentElement.clientWidth - 28);
  const rows = [];
  for (const p of v.two ? ["A", "B"] : ["A"]) {
    const b = res.base[p];
    rows.push({ label: v.two ? `Partner ${p}` : "You", segs: [[b.k401, "c1", "401(k)"], [b.employer, "c2", "Employer"], [b.roth, "c3", "Roth IRA"]], total: b.total });
  }
  // Family coverage with two people is one shared account; self-only is one account each.
  const hsaLabel = !v.two ? "HSA" : v.hsaFamily ? "HSA (shared)" : "HSAs (A + B)";
  rows.push({ label: hsaLabel, segs: [[v.hsa, "c4", "HSA"]], total: v.hsa });
  const max = Math.max(1, ...rows.map((r) => r.total));
  const step = niceStep(max / 2.5);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const x0 = 82, x1 = W - 54, pitch = 28, bh = 18;
  const sx = (val) => val / top * (x1 - x0);
  const H = rows.length * pitch + 22;
  let s = "";
  for (let t = step; t <= top + 1e-6; t += step) s += `<line class="grid" x1="${(x0 + sx(t)).toFixed(1)}" x2="${(x0 + sx(t)).toFixed(1)}" y1="0" y2="${rows.length * pitch - 6}"/>`;
  rows.forEach((r, i) => {
    const y0 = i * pitch + 2;
    s += `<text class="lab" x="0" y="${y0 + 13}">${r.label}</text>`;
    let xx = x0;
    const segs = r.segs.filter((sg) => sg[0] > 0);
    segs.forEach((sg, j) => {
      const w = sx(sg[0]), last = j === segs.length - 1;
      const draw = Math.max(0.5, last ? w : w - 2);
      const title = `<title>${sg[2]}: ${money(sg[0])}/yr</title>`;
      if (last && draw > 4) s += `<path class="${sg[1]}" d="M${xx.toFixed(1)} ${y0}h${(draw - 4).toFixed(1)}a4 4 0 0 1 4 4v${bh - 8}a4 4 0 0 1-4 4h-${(draw - 4).toFixed(1)}z">${title}</path>`;
      else s += `<rect class="${sg[1]}" x="${xx.toFixed(1)}" y="${y0}" width="${draw.toFixed(1)}" height="${bh}">${title}</rect>`;
      xx += w;
    });
    s += `<text class="val" x="${(x0 + sx(r.total) + 6).toFixed(1)}" y="${y0 + 13}">${money(r.total)}</text>`;
  });
  const by = rows.length * pitch - 6;
  s += `<line class="base" x1="${x0}" x2="${x0}" y1="0" y2="${by}"/>`;
  for (let t = 0; t <= top + 1e-6; t += step) s += `<text class="tick" x="${(x0 + sx(t)).toFixed(1)}" y="${by + 14}" text-anchor="middle">${t === 0 ? "0" : CF.fmtCompact(t)}</text>`;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = s;
  svg.setAttribute("aria-label", "Yearly contributions before coasting: " + rows.map((r) => `${r.label} ${money(r.total)}`).join(", "));
  $("ct-total").textContent = money(res.start.total) + "/yr";
  $("ct-sub").textContent = `${money(res.start.total / 12)}/mo · until ${v.retAge}, or ${v.two ? "each partner's" : "your"} coast age`;
  const after = [];
  for (const p of v.two ? ["A", "B"] : ["A"]) {
    const pl = res.plan[p];
    if (pl.on && pl.age < v.retAge) after.push(`${v.two ? p : "You"}: ${money(res.base[p].total * pl.after)}/yr from ${Math.max(pl.age, v.age)} (${Math.round(pl.after * 100)}% of before)`);
  }
  // A switch that is on but set at or after retirement has no effect; say that, not "none set".
  const late = (v.two ? ["A", "B"] : ["A"]).filter((p) => res.plan[p].on && res.plan[p].age >= v.retAge);
  const everyone = v.two ? "everyone saves" : "you save";
  const lateTxt = late.map((p) => `${v.two ? p + "'s" : "Your"} coast age (${res.plan[p].age})`).join(" and ");
  $("ct-after").textContent = after.length ? "After coasting: " + after.join(" · ") + "." + (late.length ? ` ${lateTxt} is at or after retirement, so has no effect.` : "")
    : late.length ? `${lateTxt} ${late.length > 1 ? "are" : "is"} at or after retirement, so ${everyone} until ${v.retAge}.`
    : `No coast ages set: ${everyone} until retirement. Use the Apply ${v.two ? "buttons" : "button"} below to try one.`;
}

// ---------- earliest coast ages + sparkline ----------

function renderEarliest(res) {
  const v = res.inputs, R = v.retAge, list = $("ec-list"), E = res.earliest;
  $("ec-sub").textContent = `Stop saving at this age and still reach ${cmp(res.fire)} by ${R}`;
  const rows = [];
  if (v.two) {
    rows.push({ who: "both", title: "Both stop together", sub: v.hsaFamily ? "The shared HSA stops too" : "Both HSAs stop too", badges: ["A", "B"] });
    rows.push({ who: "A", title: "Only A stops", sub: "B keeps their plan as set", badges: ["A"] });
    rows.push({ who: "B", title: "Only B stops", sub: "A keeps their plan as set", badges: ["B"] });
  } else {
    rows.push({ who: "both", title: "Stop saving", sub: "", badges: [] });
  }
  const bad = res.warnings.includes("retAgeNotAfterAge");
  $("spark-title").hidden = bad;
  if (bad) {
    // SPEC 6: no solver rows while the ages are invalid.
    $("ec-sub").textContent = "";
    list.innerHTML = `<li class="ec-empty">Set a retirement age after your current age.</li>`;
    $("spark-svg").innerHTML = "";
    return;
  }
  list.innerHTML = rows.map((r) => {
    const e = r.who === "both" ? E.both : E[r.who];
    const badges = r.badges.map((b) => `<span class="badge sm${b === "B" ? " b" : ""}" aria-hidden="true">${b}</span>`).join("");
    let res2, why = "";
    if (!e) { res2 = `<span class="np">—</span>`; }
    else if (e.age === null) {
      res2 = `<span class="np">${ICON.alert}Not possible</span>`;
      why = r.who === "both" ? `Even saving to ${R}, you'd reach ${cmp(e.best)} of ${cmp(res.fire)}.`
        : `Even if ${r.who} saves to ${R}, with ${r.who === "A" ? "B" : "A"}'s plan you'd reach ${cmp(e.best)} of ${cmp(res.fire)}.`;
    } else {
      const yrs = e.years;
      res2 = `<span class="age">${e.age <= v.age ? "Now" : e.age}</span><span class="yrs">${yrs === 0 ? "save to the end" : `${yrs} yr${yrs === 1 ? "" : "s"} coasting`}</span>`;
    }
    const can = e && e.age !== null && e.age < R;
    // Apply only next to a solved age; otherwise the result spans the row.
    return `<li class="${[r.who === "both" ? "lead" : "", can ? "" : "nobtn"].filter(Boolean).join(" ")}"><span class="who">${badges}<span>${r.title}</span>${r.sub ? `<small>· ${r.sub}</small>` : ""}</span>
      <span class="res">${res2}</span>
      ${can ? `<button type="button" class="btn ghost sm" data-apply="${r.who}" aria-label="Apply: ${esc(r.title)} at ${e.age}">Apply</button>` : ""}
      ${why ? `<span class="why">${why}</span>` : ""}</li>`;
  }).join("");

  // Sparkline: balance at retirement by the age you both stop. Y zoomed to the data.
  const svg = $("spark-svg"), sw = res.sweep;
  const sparkTitle = `Balance at ${R} by the age you ${v.two ? "both " : ""}stop`;
  $("spark-title").textContent = sparkTitle;
  if (sw.length < 2) { svg.innerHTML = ""; return; }
  const W = Math.max(240, svg.parentElement.clientWidth - 28), H = 92, T = 16, B = 16, Lp = 4, Rp = 4;
  let lo = Math.min(res.fire, ...sw.map((p) => p.balance)), hi = Math.max(res.fire, ...sw.map((p) => p.balance));
  const pad = (hi - lo) * 0.08 || hi * 0.05 || 1;
  lo -= pad; hi += pad;
  // The axis is zoomed to the data, so say where it starts instead of drawing a "$0" baseline.
  if (lo > 0) $("spark-title").innerHTML = `${esc(sparkTitle)} <span class="axis-note">· scale starts at ${cmp(lo)}, not $0</span>`;
  const x = (a) => Lp + (a - v.age) / (R - v.age) * (W - Lp - Rp);
  const y = (b) => T + (1 - (b - lo) / (hi - lo)) * (H - T - B);
  let s = "";
  const firstOk = sw.find((p) => p.balance >= res.fire * (1 - 1e-6));
  if (firstOk) s += `<rect class="ok-zone" aria-hidden="true" x=""${x(firstOk.age).toFixed(1)}" y="${T - 6}" width="${(x(R) - x(firstOk.age)).toFixed(1)}" height="${H - T - B + 6}"/>`;
  s += `<line class="fire-line" x1="${Lp}" x2="${W - Rp}" y1="${y(res.fire).toFixed(1)}" y2="${y(res.fire).toFixed(1)}"/>`;
  if (lo <= 0) s += `<line class="base" x1="${Lp}" x2="${W - Rp}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>`;
  s += `<path class="l-spark" d="${sw.map((p, i) => `${i ? "L" : "M"}${x(p.age).toFixed(1)} ${y(p.balance).toFixed(1)}`).join("")}"/>`;
  const fyLab = y(res.fire) - 4 < 10 ? y(res.fire) + 11 : y(res.fire) - 4;
  s += `<text class="ref-label halo" x="${Lp + 2}" y="${fyLab.toFixed(1)}">FIRE ${cmp(res.fire)}</text>`;
  s += `<text class="tick" x="${Lp}" y="${H - 3}">stop at ${v.age}</text><text class="tick" x="${W - Rp}" y="${H - 3}" text-anchor="end">stop at ${R}</text>`;
  if (firstOk) {
    const fx = x(firstOk.age), fy = y(firstOk.balance);
    s += `<circle class="dot-proj" cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="4"/>`;
    s += `<text class="end-label halo" x="${fx.toFixed(1)}" y="${(fy - 7).toFixed(1)}" text-anchor="${fx > W - 40 ? "end" : "middle"}">${cmp(firstOk.balance)} at ${firstOk.age}</text>`;
    if (fx - x(v.age) > 50 && x(R) - fx > 52) s += `<text class="tick" x="${fx.toFixed(1)}" y="${H - 3}" text-anchor="middle">${firstOk.age}</text>`;
  } else {
    const last = sw[sw.length - 1];
    const ly = y(last.balance) - 8 > y(res.fire) + 12 ? y(last.balance) - 8 : y(last.balance) + 14;
    s += `<circle class="dot-proj" cx="${x(R).toFixed(1)}" cy="${y(last.balance).toFixed(1)}" r="4"/>`;
    s += `<text class="end-label halo" x="${(W - Rp - 6).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="end">${cmp(last.balance)} saving to ${R}</text>`;
  }
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = s;
  svg.setAttribute("aria-label", firstOk
    ? `Balance at ${R} by the age you stop. Stopping at ${firstOk.age} or later reaches the FIRE number.`
    : `Balance at ${R} by the age you stop. No stop age reaches the FIRE number; saving to ${R} gives ${cmp(sw[sw.length - 1].balance)}.`);
}

function applyCoast(who) {
  const e = who === "both" ? result.earliest.both : result.earliest[who];
  if (!e || e.age === null) return;
  const before = { ...values };
  const ps = who === "both" ? (values.two ? ["A", "B"] : ["A"]) : [who];
  for (const p of ps) { values["coastOn" + p] = 1; values["coastAge" + p] = Math.max(e.age, values.age); }
  showAll();
  userChanged();
  const who2 = who === "both" ? (values.two ? "A and B coast" : "You coast") : `${who} coasts`;
  toast(`Applied: ${who2} from ${e.age}. `, toastButton("Undo", () => { values = before; showAll(); update(); toast("Back to your previous plan."); }));
}

// ---------- heatmap: return x withdrawal rate ----------

function heatClass(years) { return years <= 0 ? "h1" : years <= 4 ? "h2" : years <= 9 ? "h3" : years <= 14 ? "h4" : "h5"; }

function renderHeat(res, g) {
  const v = res.inputs;
  if (res.warnings.includes("retAgeNotAfterAge")) { $("heat").innerHTML = ""; $("heat-note").textContent = ""; $("heat-scale").hidden = true; return; }
  $("heat-scale").hidden = false;
  const curCol = g.cols.findIndex((w) => Math.abs(w - v.swr) < 1e-9);
  let none = 0;
  const body = g.cells.map((row, i) => `<tr><th scope="row">${+g.rows[i].toFixed(2)}%</th>` + row.map((c, j) => {
    const cur = i === 2 && j === curCol ? " cur" : "";
    const head = `${+c.nominal.toFixed(2)}% return, ${c.swr}% withdrawal`;
    if (c.age === null) {
      none++;
      const p = Math.min(99, Math.floor(c.pctOfFire * 100));
      return `<td class="none${cur}" tabindex="0" title="${head}: not by ${v.retAge}; saving the whole way reaches ${p}% of the FIRE number" aria-label="${head}: not by ${v.retAge}, ${p}% of FIRE reached">${p}%</td>`;
    }
    const label = c.age <= v.age ? "Now" : c.age;
    return `<td class="${heatClass(c.years)}${cur}" tabindex="0" title="${head}: both coast at ${label} (${c.years} years coasting)" aria-label="${head}: coast at ${label}, ${c.years} years coasting">${label}</td>`;
  }).join("") + "</tr>").join("");
  const all = none === 25;
  // When no cell can make it, the years ramp means nothing; say what the grid shows instead.
  $("heat-ramp").hidden = all;
  const lead = all ? `<p class="heat-all">None of these reach ${cmp(res.fire)} by ${v.retAge}, even saving the whole way. Each cell shows the share of the FIRE number reached.</p>` : "";
  $("heat").innerHTML = `${lead}<p class="heat-axes">Rows: return before inflation · Columns: safe withdrawal rate${all ? "" : " · Number = age you could stop; shade = years coasting"}</p><table class="heat"><caption class="visually-hidden">Earliest age you could ${v.two ? "both " : ""}stop saving, by nominal return (rows) and withdrawal rate (columns)</caption>
    <thead><tr><td></td>${g.cols.map((w) => `<th scope="col">${w}%</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
  const notes = [];
  if (none && !all) notes.push(`Hatched cells can't reach the FIRE number by ${v.retAge}; the % is how much of it saving the whole way would reach.`);
  if (curCol < 0) notes.push(`Your ${v.swr.toFixed(1)}% withdrawal rate falls between the columns, so no cell is outlined.`);
  $("heat-note").textContent = notes.join(" ");
}

// ---------- early-access bridge ----------

function renderBridge(res, br) {
  const v = res.inputs;
  const teaser = $("br-teaser"), full = $("br-full");
  $("bridge").setAttribute("aria-labelledby", br.applies ? "br-title" : "br-teaser-t");
  if (!br.applies) {
    full.hidden = true;
    teaser.hidden = false;
    if (br.reason === "badAges") { teaser.innerHTML = `<h2 id="br-teaser-t">Retiring before 59½?</h2><p>Fix the ages above first.</p>`; return; }
    const tryAge = v.age < 55 ? 55 : null;
    teaser.innerHTML = br.reason === "tooYoung"
      ? `<h2 id="br-teaser-t">Retiring before 59½?</h2><p>The 72(t) life-expectancy table here covers starting ages 30 to 60, so the bridge isn't drawn for retiring at ${v.retAge}.</p>`
      : `<h2 id="br-teaser-t">Retiring before 59½?</h2><p>401(k) and IRA money usually costs a 10% penalty before 59½. Set a retirement age under 59½ to plan a bridge with fixed 72(t) payments and a Roth conversion ladder, year by year.</p>${tryAge ? `<div class="actions"><button type="button" class="btn ghost sm" data-act="try55">Try retiring at ${tryAge}</button></div>` : ""}`;
    return;
  }
  teaser.hidden = true;
  full.hidden = false;
  const gaps = br.gapYears.length;
  $("br-chip").outerHTML = gaps
    ? `<span class="chip bad" id="br-chip">${ICON.alert}${gaps} short year${gaps === 1 ? "" : "s"}</span>`
    : `<span class="chip good" id="br-chip">${ICON.check}No gaps</span>`;
  // Live hints on the bridge inputs.
  $("h-preShare").textContent = `401(k)s and traditional IRAs as a share of the ${cmp(br.portfolio)} portfolio at ${v.retAge}: ${cmp(br.preTax)}.`;
  $("h-sepShare").innerHTML = `72(t) IRA ${cmp(br.pot72)} · ladder IRA ${cmp(br.potLadder)}. Separate IRAs, so no dollar counts twice. <button type="button" class="linkish" data-act="size72">Size 72(t) to cover spending (${br.shareToCover}%)</button>`;
  const est = CF.rothBasisEstimate(values);
  $("h-basis").innerHTML = `What you've put into Roth IRAs (not growth); you can take it out at any age. Your Roth inputs add about ${cmp(est)} by ${v.retAge}.` +
    (est > 0 ? ` <button type="button" class="linkish" data-act="basis">Use ${cmp(est)}</button>` : "");

  const R = v.retAge, lockTo = br.lockEnd, endAge = 59.5;
  const lockTxt = lockTo === 59.5 ? "59½" : String(lockTo);
  const ys = br.years;
  const pos = (a) => ((Math.min(a, endAge) - R) / (endAge - R) * 100).toFixed(2) + "%";
  const ladderAt = br.firstLadderAge;
  const convFrom = R - v.lead;
  // The wait segment only gets words when they fit; otherwise they live in the aria-label.
  const barW = Math.max(100, (full.clientWidth || 300) - 46);
  const waitPx = ladderAt && ladderAt > R ? (ladderAt - R) / (endAge - R) * barW : 0;
  const waitText = [v.lead > 0 ? `convert from ${convFrom} · 5-yr wait` : "convert · 5-yr wait", "5-yr wait"]
    .find((t) => waitPx >= textW(t, 10) + 16) || "";
  let ladderLane;
  if (!ladderAt) ladderLane = `<span class="open wait" style="left:0;right:0">convert · first rung ripens after 59½</span>`;
  else if (ladderAt <= R) ladderLane = `<span class="open" style="left:0;right:0">usable from ${R} (converted from ${convFrom})</span>`;
  else ladderLane = `<span class="open wait" style="left:0;width:calc(${pos(ladderAt)} - 2px)">${waitText}</span><span class="open" style="left:${pos(ladderAt)};right:0">usable</span>`;
  const lanes = `<div class="lanes" role="img" aria-label="Access timeline from ${R} to 59½: 72(t) payments locked until ${lockTxt}; ladder ${ladderAt ? `converted from ${convFrom}, 5-year wait, usable from ${ladderAt}` : "conversions not usable before 59½"}.">
      <div class="lane"><span>72(t)</span><div class="bar"><span class="lock" style="left:0;right:0">same payment, locked to ${lockTxt}</span></div></div>
      <div class="lane"><span>Ladder</span><div class="bar">${ladderLane}</div></div>
      <div class="lane"><span></span><div class="ages"><span style="left:0">${R}</span>${ladderAt && ladderAt - R >= 1.5 && endAge - ladderAt >= 1.5 ? `<span style="left:${pos(ladderAt)};transform:translateX(-50%)">${ladderAt}</span>` : ""}<span style="right:0">59½</span></div></div>
    </div>`;

  // Year-by-year bars, one row per year: 72(t) -> taxable -> Roth basis -> ladder -> short.
  const W = Math.max(260, full.clientWidth || 300), x0 = 46, pitch = 24, bh = 16;
  const maxNeed = Math.max(1, ...ys.map((y) => y.need));
  const x1 = W - 58;
  const sx = (val) => val / maxNeed * (x1 - x0);
  const step = niceStep(maxNeed / 2.5);
  const H = ys.length * pitch + 20;
  let s = `<defs><pattern id="gaphatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" class="gap-bg"/><line x1="0" y1="0" x2="0" y2="5" class="gap-line"/></pattern></defs>`;
  for (let t = step; t <= maxNeed + 1e-6; t += step) s += `<line class="grid" x1="${(x0 + sx(t)).toFixed(1)}" x2="${(x0 + sx(t)).toFixed(1)}" y1="0" y2="${ys.length * pitch - 4}"/>`;
  ys.forEach((yr, i) => {
    const y0 = i * pitch + 2;
    s += `<text class="lab" x="0" y="${y0 + 12}">${yr.frac < 1 ? `${yr.age}–59½` : yr.age}</text>`;
    const segs = [[yr.use72, "b72", "72(t)"], [yr.taxable, "btax", "Taxable"], [yr.basis, "bbasis", "Roth basis"], [yr.ladder, "bladder", "Roth ladder"], [yr.short, "bgap", "Short"]].filter((sg) => sg[0] > 0.5);
    let xx = x0;
    segs.forEach((sg, j) => {
      const w = sx(sg[0]), last = j === segs.length - 1, d = Math.max(0.5, last ? w : w - 2);
      const title = `<title>${yr.age}: ${sg[2]} ${money(sg[0])}</title>`;
      // Square at the baseline, rounded only at the data end (as the contribution bars).
      if (last && d > 3) s += `<path class="${sg[1]}" d="M${xx.toFixed(1)} ${y0}h${(d - 3).toFixed(1)}a3 3 0 0 1 3 3v${bh - 6}a3 3 0 0 1-3 3h-${(d - 3).toFixed(1)}z">${title}</path>`;
      else s += `<rect class="${sg[1]}" x="${xx.toFixed(1)}" y="${y0}" width="${d.toFixed(1)}" height="${bh}">${title}</rect>`;
      xx += w;
    });
    const nx = x0 + sx(yr.need);
    s += `<line class="spend-line" x1="${nx.toFixed(1)}" x2="${nx.toFixed(1)}" y1="${y0 - 2}" y2="${y0 + bh + 2}"/>`;
    if (yr.short) s += `<text class="gap-amt" x="${(nx + 4).toFixed(1)}" y="${y0 + 12}">⚠ −${CF.fmtCompact(yr.short)}</text>`;
  });
  const by = ys.length * pitch - 4;
  s += `<line class="base" x1="${x0}" x2="${x0}" y1="0" y2="${by}"/>`;
  for (let t = 0; t <= maxNeed + 1e-6; t += step) s += `<text class="tick" x="${(x0 + sx(t)).toFixed(1)}" y="${by + 14}" text-anchor="middle">${t === 0 ? "0" : CF.fmtCompact(t)}</text>`;

  // Gap list in words, with remedies.
  let call;
  if (gaps) {
    const span = gaps === 1 ? `at ${br.gapYears[0]}` : `across ages ${br.gapYears[0]}–${br.gapYears[gaps - 1]}`;
    const beforeLadder = ladderAt === null || br.gapYears[0] < ladderAt;
    const until = ladderAt ? `the first ladder rung is usable at ${ladderAt}` : "any ladder rung ripens";
    const early = br.gapYears.filter((a) => ladderAt === null || a < ladderAt);
    const earlySpan = early.length > 1 ? `ages ${early[0]}–${early[early.length - 1]}` : `age ${early[0]}`;
    const est = CF.rothBasisEstimate(values);
    const reason = !beforeLadder ? "The ladder pot isn't big enough to cover the later years."
      : v.taxable + v.basis > 0 ? `Taxable money and Roth basis run out before ${until}.`
      : `With no taxable savings or Roth basis entered, ${br.pay0 > 0.5 ? "only 72(t) pays toward" : "nothing covers"} ${earlySpan} until ${until}.` +
        (est > 0 ? ` <button type="button" class="linkish" data-act="basis">Use ${cmp(est)} Roth basis (estimate)</button>` : "");
    const items = ys.filter((y) => y.short).map((y) => `<li>Age ${y.frac < 1 ? `${y.age}–59½` : y.age}: need ${money(y.need)}, can reach ${money(y.need - y.short)}, <b>short ${money(y.short)}</b></li>`).join("");
    const fixes = [];
    if (v.lead < 5 && beforeLadder) fixes.push(`start conversions ${Math.min(5, v.lead + gaps)} years before retiring`);
    fixes.push(`keep about ${cmp(br.totalShort)} more in taxable savings or cash`);
    if (br.shareToCover > v.sepShare) fixes.push(`set aside more pre-tax for 72(t) (try ${br.shareToCover}%)`);
    call = `<div class="callout bad" role="note">${ICON.warnBig}<div><p><b>Short ${cmp(br.totalShort)} ${span}.</b> ${reason}</p><ul>${items}</ul><p style="margin-top:6px">To close it: ${fixes.join(", or ")}.</p></div></div>`;
  } else {
    call = `<div class="callout good" role="note">${ICON.okBig}<p><b>Every year to 59½ is covered.</b> 72(t) pays ${money(br.pay0)} in the first year; the rest comes from ${[v.taxable > 0 ? "taxable savings" : "", v.basis > 0 ? "Roth basis" : "", br.conversions.length ? "ladder rungs" : ""].filter(Boolean).join(", ") || "72(t) alone"}.</p></div>`;
  }
  const warns = [];
  if (br.warnings.includes("lockPast59")) warns.push(`Starting at ${R}, the 5-year minimum keeps 72(t) payments locked until ${lockTxt}, past 59½.`);
  if (br.warnings.includes("rateOverCap")) warns.push(`A ${(br.rate * 100).toFixed(1)}% 72(t) rate is above 5%. Notice 2022-6 allows it only if 120% of the federal mid-term rate was higher in either of the two months before the first payment; otherwise the IRS can treat the payments as non-qualifying and the 10% penalty comes back on all of them. Check the current rate, or use 5%.`);
  if (br.warnings.includes("accessibleOverNonPreTax")) warns.push(`Taxable plus Roth basis (${cmp(v.taxable + v.basis)}) is more than the non-pre-tax part of the portfolio (${cmp(br.portfolio - br.preTax)}). Check the pre-tax share.`);

  const table = `<table class="data"><caption class="visually-hidden">Bridge by year, today's dollars</caption><thead><tr><th scope="col">Age</th><th scope="col">Need</th><th scope="col">72(t)</th><th scope="col">Taxable</th><th scope="col">Basis</th><th scope="col">Ladder</th><th scope="col">Short</th></tr></thead><tbody>` +
    ys.map((y) => `<tr class="${y.short ? "gap-row" : ""}"><td>${y.frac < 1 ? `${y.age}–59½` : y.age}</td><td>${kRoundOrDash(y.need)}</td><td>${kRoundOrDash(y.use72)}</td><td>${kRoundOrDash(y.taxable)}</td><td>${kRoundOrDash(y.basis)}</td><td>${kRoundOrDash(y.ladder)}</td><td class="short">${y.short ? "−" + CF.fmtCompact(y.short) : "—"}</td></tr>`).join("") +
    `</tbody></table>` + (br.conversions.length ? `<p class="fine" style="margin-top:6px">Conversions: ${br.conversions.map((c) => `${money(c.amount)} at ${c.age} (usable ${c.usableAge})`).join(" · ")}. Converted amounts are sized up for 5 years of inflation.</p>` : "") +
    `<p class="fine" style="margin-top:6px">72(t) is shown in today's dollars, so its fixed payment shrinks with inflation.</p>`;

  $("br-out").innerHTML = `
    <dl class="mini">
      <div class="kpi"><dt>72(t) payment</dt><dd>${money(br.pay0)}/yr</dd><dd class="kpi-note">first year, today's dollars. Fixed at ${money(br.payNominal)} a year in future dollars · on ${cmp(br.pot72)} · life expectancy ${br.le.toFixed(1)} at ${R} · ${(br.rate * 100).toFixed(1)}%</dd></div>
      <div class="kpi"><dt>Locked in until</dt><dd>${lockTxt}</dd><dd class="kpi-note">${lockTo === 59.5 ? `${(59.5 - R).toFixed(1)} yrs, longer than the 5-yr minimum` : "the 5-year minimum runs past 59½"}</dd></div>
    </dl>
    ${lanes}
    <ul class="legend" aria-hidden="true"><li><i class="sq b72"></i>72(t)</li><li><i class="sq btax"></i>Taxable</li><li><i class="sq bbasis"></i>Roth basis</li><li><i class="sq bladder"></i>Roth ladder</li><li><i class="sq bgap"></i>Short</li><li><i class="key" style="border-top:0;border-left:1.5px solid var(--ink);height:12px;width:0"></i>Spending</li></ul>
    <svg class="bridge-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Money you can reach each year from ${R} to 59½ against spending of ${money(v.spend)}. ${gaps ? `Short in ${gaps} year${gaps === 1 ? "" : "s"}, ${cmp(br.totalShort)} in all.` : "No gaps."}">${s}</svg>
    ${call}
    ${warns.map((w) => `<p class="warn">${w}</p>`).join("")}
    <details class="more"><summary>Year-by-year table</summary>${table}</details>
    <details class="more"><summary>Read this before relying on it</summary>
      <ul class="caveats">
        <li>72(t) is rigid: the same payment every year until the later of 5 years or 59½. Change it, add to that IRA or take extra, and the 10% penalty comes back on every payment so far, plus interest.</li>
        <li>Roth conversions are taxed as income in the year you convert. Each one waits 5 years before you can take it out without the penalty.</li>
        <li>Keep the 72(t) IRA and the ladder IRA separate. Taxes on 72(t) payments and conversions aren't modeled; this is a rough plan, not tax advice.</li>
      </ul>
      <p class="fine" style="margin-top:6px"><a href="https://www.irs.gov/retirement-plans/substantially-equal-periodic-payments" rel="noopener">IRS: Substantially equal periodic payments</a> · <a href="https://www.kitces.com/blog/rule-72t-sepp-calculate-payments-rmd-avoid-penalty-tax-early-ira-withdrawals-notice-2022-6/" rel="noopener">Kitces: how Notice 2022-6 changes 72(t) planning</a></p>
    </details>`;
}
const kRoundOrDash = (x) => (x > 0.5 ? CF.fmtCompact(x) : "—");

// ---------- bottom bar ----------

function renderPeek(res) {
  const v = res.inputs, e = res.earliest.both, R = v.retAge;
  const p = res.coastNow > 0 ? Math.min(1, v.assets / res.coastNow) : 1;
  let lead;
  if (res.warnings.includes("retAgeNotAfterAge")) lead = "Check your ages";
  else if (e.age !== null && e.age <= v.age) lead = e.after > 0.5 ? "<b>Cut back now</b>" : "<b>Coasting now</b>";
  else if (e.age !== null) lead = `${v.two ? "Both coast" : "Coast"} at <b>${e.age}</b>`;
  else lead = `<b>Not by ${R}</b>`;
  const s = res.surplus;
  // Status as icon + word, as everywhere else: "▲ $X over" / "▼ $X short".
  const tail = res.warnings.includes("retAgeNotAfterAge") ? "" :
    ` · At ${R} ${cmp(res.balanceAtRet)} <span class="pk-delta ${s >= -0.5 ? "up" : "down"}">${s >= -0.5 ? "▲" : "▼"} ${cmp(Math.abs(s))} ${s >= -0.5 ? "over" : "short"}</span>`;
  const bad = res.warnings.includes("retAgeNotAfterAge");
  $("peek").innerHTML = `<svg class="mring" viewBox="0 0 28 28" aria-hidden="true"><circle class="mr-track" cx="14" cy="14" r="11"/>${!bad && p > 0 ? `<circle class="mr-fill" cx="14" cy="14" r="11" stroke-dasharray="${(p * 69.1).toFixed(1)} 69.1" stroke-linecap="${p < 0.08 ? "butt" : "round"}" transform="rotate(-90 14 14)"/>` : ""}<text x="14" y="17.5" text-anchor="middle" class="mr-num">${bad ? "—" : Math.round(p * 100)}</text></svg><span class="txt">${lead}${tail}</span><span class="go">Result ↑</span>`;
}

let heroVisible = true;
function syncPeek() { $("peek").hidden = heroVisible || !$("toast").hidden; }
if (window.IntersectionObserver) {
  new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; syncPeek(); }).observe($("results"));
}
$("peek").addEventListener("click", () => {
  $("results").scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
});

// ---------- update ----------

function drawAllCharts() {
  drawChart();
  renderContrib(result);
  renderEarliest(result);
  renderBridge(result, bridgeRes);
}

function update() {
  values = CF.sanitize(values).values;
  result = CF.project(values);
  gridRes = CF.grid(values);
  bridgeRes = CF.bridge(values, result);
  renderHero(result);
  renderInputs(result);
  drawAllCharts();
  renderHeat(result, gridRes);
  renderPathTable(result);
  renderPeek(result);
  scheduleSave();
}

// ---------- buttons ----------

function doReset() {
  const before = { ...values };
  values = { ...CF.DEFAULTS };
  if (viewingShared) setViewingShared(false);
  showAll();
  update(); // saves the defaults, which erases the stored numbers
  toast("Reset to US typical numbers. ", toastButton("Undo", () => { values = before; showAll(); update(); toast("Your numbers are back."); }));
}
$("reset").addEventListener("click", doReset);
$("reset-top").addEventListener("click", doReset);

async function doShare() {
  const url = location.href.split("#")[0] + "#" + CF.encodeHash(values);
  const warning = "Anyone who opens it sees these numbers, so share it only if you mean to.";
  if (coarse.matches && navigator.share) {
    try { await navigator.share({ title: document.title, url }); toast("Link shared. " + warning); return; }
    catch (e) { if (e && e.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied. " + warning);
  } catch (e) {
    // No clipboard (http, some in-app browsers, permission denied): a box to copy from.
    const box = document.createElement("input");
    box.type = "text"; box.readOnly = true; box.value = url; box.className = "copy-box";
    box.setAttribute("aria-label", "Link to this scenario");
    box.addEventListener("focus", () => box.select());
    toast("Copy this link. " + warning, box, toastButton("Close", () => toast()));
    box.focus();
  }
}
$("share").addEventListener("click", doShare);
$("share-top").addEventListener("click", doShare);

// Buttons inside rendered content (Apply, Use estimate, Size 72(t), Try 55).
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-apply],[data-act]");
  if (!t || t.disabled) return;
  if (t.dataset.apply) { applyCoast(t.dataset.apply); return; }
  const act = t.dataset.act;
  const before = { ...values };
  const undo = () => toastButton("Undo", () => { values = before; showAll(); update(); toast(); });
  if (act === "basis") { values.basis = Math.round(CF.rothBasisEstimate(values) / 1000) * 1000; showAll(); userChanged(); toast("Roth basis set from your Roth inputs. ", undo()); }
  else if (act === "size72") { values.sepShare = bridgeRes.shareToCover; showAll(); userChanged(); toast(`72(t) share set to ${values.sepShare}%. `, undo()); }
  else if (act === "try55") { values.retAge = 55; showAll(); userChanged(); toast("Retirement age set to 55. ", undo()); }
});

$("shared-keep").addEventListener("click", () => { setViewingShared(false); update(); toast("Kept. These are now your saved numbers."); });
$("shared-back").addEventListener("click", () => { setViewingShared(false); values = loadSaved(); showAll(); update(); toast(); });
window.addEventListener("hashchange", () => {
  const shared = sharedFromHash();
  if (!shared) return;
  values = shared;
  setViewingShared(true);
  showAll();
  update();
});

// ---------- start ----------

buildInputs();
const initialShared = sharedFromHash();
values = initialShared || loadSaved();
for (const k of NUM_KEYS) wireField(k);
wireSwitches();
wireChart();
setViewingShared(!!initialShared); // also drops a leftover hash that held no numbers
showAll();
update();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  // A new version takes over open pages at once; say so rather than silently mixing old and new files.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) toast("A new version of this page is ready. ", toastButton("Reload", () => location.reload()));
  });
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
