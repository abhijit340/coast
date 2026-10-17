// Coast FIRE v2: page wiring. The math lives in calc.js (window.CoastFire); this
// file builds the input fields, keeps number boxes and sliders in sync, writes the
// results, draws the SVG charts, and remembers the inputs in this browser
// (localStorage only). Numbers go into a link only when the user asks for one.
"use strict";

const CF = window.CoastFire;
const UI = window.CoastUI; // summary lines and saved open/closed state (ui.js)
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
let result = null, gridRes = null, bridgeRes = null, houseRes = null;
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
  // Buying a home (SPEC 11)
  buyAge: { label: "Buy at age", unit: "yrs", mode: "numeric" },
  price: { label: "Home price", pre: true, hint: "What the home would cost if you bought it today; appreciation starts when you buy." },
  downPct: { label: "Down payment", unit: "% of price", hint: "At least 3%. Under 20% adds PMI until the loan is scheduled to reach 78% of the price." },
  mortRate: { label: "Mortgage rate", unit: "%/yr", hint: "Fixed for the whole loan, before inflation. Freddie Mac's 30-year average was 7.40% in mid-October 2026." },
  rent: { label: "Rent today", pre: true, unit: "/mo", hint: "The rent for a home like the one you'd buy. Your retirement spending above already includes today's rent." },
  pmi: { label: "Mortgage insurance (PMI)", unit: "%/yr", hint: "Mortgage insurance, as a share of the loan, only while the down payment is under 20%. Ends when the loan is scheduled to reach 78% of the price (you can ask at 80%)." },
  closePct: { label: "Closing costs", unit: "% of price", hint: "Paid when you buy: lender fees, title, recording and transfer taxes, prepaid items. Often 2–5% of the loan." },
  sellPct: { label: "Selling costs", unit: "% of value", hint: "Agents and closing costs if you sold at retirement. Used only for net worth; the home never counts toward your FIRE number." },
  propTax: { label: "Property tax", unit: "%/yr", hint: "Each year, as a share of the home's value. The US effective rate was about 0.9% in 2025." },
  insure: { label: "Home insurance", pre: true, unit: "/yr", hint: "Per year, in today's dollars. The default is the 2022 national average; premiums have risen since." },
  maint: { label: "Maintenance", unit: "%/yr", hint: "Each year, as a share of the home's value. Real repairs come in lumps, not 1% a year." },
  apprec: { label: "Home price growth above inflation", unit: "%/yr", mode: "text", hint: "How fast the home's value grows after you buy, after inflation." },
  rentGrowth: { label: "Rent growth above inflation", unit: "%/yr", mode: "text", hint: "How fast that rent grows after inflation. 0% means it keeps pace with prices." },
};
const metaOf = (key) => META[key] || META[key.slice(0, -1)];
const partnerOf = (key) => (/[AB]$/.test(key) && !META[key] ? key.slice(-1) : null);
const LIMIT_TEXT = { k401: "$24,500 limit", roth: "$7,500 limit" };
const NUM_KEYS = CF.KEYS.filter((k) => !CF.FIELDS[k].bool && !CF.FIELDS[k].choice);
// Hints that stay on screen: ones holding a button, and the coast-age out-of-range warning.
// The rest show while the number box has focus, or after a tap on the field's (i).
const KEEP_HINT = new Set(["sepShare", "basis", "coastAgeA", "coastAgeB"]);

function fieldHTML(key) {
  const m = metaOf(key), f = CF.FIELDS[key], p = partnerOf(key);
  const aria = (p ? `Partner ${p}: ` : "") + m.label;
  return `<div class="field" data-key="${key}">
    <div class="field-top"><span class="lab"><label for="f-${key}">${esc(m.label)}</label><button type="button" class="info" id="i-${key}" aria-expanded="false" aria-controls="h-${key}" aria-label="${esc("About " + aria)}" hidden>i</button></span>
      <span class="box">${m.pre ? '<span class="unit pre">$</span>' : ""}<input id="f-${key}" inputmode="${m.mode || "decimal"}" autocomplete="off" aria-describedby="n-${key} h-${key}"${p ? ` aria-label="${esc(aria)}"` : ""}>${m.unit ? `<span class="unit">${esc(m.unit)}</span>` : ""}</span></div>
    <p class="note" id="n-${key}" aria-live="polite"></p>
    <div class="slider"><input type="range" id="s-${key}" aria-label="${esc(aria)}">${f.limit ? '<span class="limit-tick" aria-hidden="true"></span>' : ""}</div>
    ${f.limit ? `<div class="range" aria-hidden="true"><span>$0</span><span class="lim" id="lim-${key}">${LIMIT_TEXT[f.limit] || ""}</span></div>` : ""}
    <p class="hint${KEEP_HINT.has(key) ? " keep" : ""}" id="h-${key}">${m.hint ? esc(m.hint) : ""}</p>
  </div>`;
}

function partnerHTML(p) {
  const other = p === "A" ? "B" : "A";
  // Shown: name, salary and one total line. The accounts and the coast plan sit in a closed row.
  return `<header class="p-head">
      <span class="badge${p === "B" ? " b" : ""}" aria-hidden="true">${p}</span>
      <h3 class="grow" id="p${p}-t">Partner ${p}</h3>
      ${p === "B" ? `<button type="button" class="icon-btn quiet" id="remove-B" aria-label="Remove Partner B" title="Remove Partner B">${ICON.x}</button>` : ""}
    </header>
    ${fieldHTML("sal" + p)}
    <p class="partner-foot"><span id="foot-l-${p}">Saving</span> <b id="foot-${p}"></b> <span class="partner-sub" id="sub-${p}"></span></p>
    <details class="dis" id="d-partner${p}">
      <summary class="sum stack"><span class="sum-t" id="sv-partner${p}-t">401(k), Roth &amp; coasting</span><span class="sum-v" id="sv-partner${p}"></span></summary>
      <div class="dis-body">
        ${["k", "emp", "roth"].map((k) => fieldHTML(k + p)).join("")}
        <div class="toggle-row">
          <div class="grow"><span class="tlabel" id="coast-l-${p}">Coast from an age</span><p class="fine" id="coast-h-${p}">Stop or cut ${p}'s saving at an age while ${other === "B" ? "B" : "A"}'s plan stays as set.</p></div>
          <button type="button" class="switch" id="sw-coast-${p}" role="switch" aria-checked="false" aria-labelledby="coast-l-${p} p${p}-t" aria-describedby="coast-h-${p}"><i></i></button>
        </div>
        <div class="coast-sub" id="coast-sub-${p}" hidden>${fieldHTML("coastAge" + p)}${fieldHTML("after" + p)}</div>
      </div>
    </details>`;
}

function buildInputs() {
  $("hh-fields").innerHTML = ["age", "retAge", "assets", "spend"].map(fieldHTML).join("");
  $("draw-fields").innerHTML = fieldHTML("draw");
  $("assume-fields").innerHTML = ["nominal", "inflation", "swr"].map(fieldHTML).join("");
  $("card-A").innerHTML = partnerHTML("A");
  $("card-B").innerHTML = partnerHTML("B");
  $("hsa-fields").innerHTML = fieldHTML("hsa");
  $("bridge").innerHTML = `
    <div class="teaser" id="br-teaser"></div>
    <div id="br-full" hidden>
      <div class="card-head"><div class="grow"><h2 id="br-title" class="visually-hidden">Early-access bridge</h2><p class="fine">Money you can reach each year until 59½</p></div></div>
      <div id="br-fields">${["preShare", "sepShare", "sepRate", "basis", "taxable", "lead"].map(fieldHTML).join("")}</div>
      <div id="br-out"></div>
    </div>`;
  $("house-fields").innerHTML = ["buyAge", "price", "downPct"].map(fieldHTML).join("");
  $("house-rate-fields").innerHTML = fieldHTML("mortRate");
  $("house-rent-fields").innerHTML = fieldHTML("rent");
  $("house-cost-fields").innerHTML = ["closePct", "sellPct", "propTax", "insure", "maint", "pmi", "apprec", "rentGrowth"].map(fieldHTML).join("");
  for (const id of ["hh-fields", "assume-fields", "draw-fields", "hsa-fields", "br-fields", "house-fields", "house-cost-fields"]) $(id).querySelector(".field").classList.add("first");
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
  if (f.money) return m.unit === "/yr" ? " dollars a year" : m.unit === "/mo" ? " dollars a month" : " dollars";
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
  // A note, not an error: buying after retirement isn't compared (nothing to project).
  const soft = key === "buyAge" && values.houseOn && values.buyAge >= values.retAge && values.retAge > values.age ? `Buy before ${values.retAge} to compare`
    : key === "pmi" && values.downPct >= 20 ? "Not needed at 20% down" : "";
  if (key === "pmi") field.classList.toggle("na", values.downPct >= 20);
  $("n-" + key).textContent = n.err || ageMsg || n.adj || soft;
  field.classList.toggle("invalid", bad);
  if (bad) box.setAttribute("aria-invalid", "true"); else box.removeAttribute("aria-invalid");
  // An error inside a closed section opens it (and every section around it).
  if (bad) for (let d = field.closest("details"); d; d = d.parentElement.closest("details")) setOpen(d, true);
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
  // Buying a home: the switch, where the down payment comes from, and the term.
  $("sw-house").addEventListener("click", () => { values.houseOn = values.houseOn ? 0 : 1; userChanged(); });
  $("seg-down-inv").addEventListener("click", () => { values.downFrom = 1; userChanged(); });
  $("seg-down-cash").addEventListener("click", () => { values.downFrom = 0; userChanged(); });
  $("seg-term-15").addEventListener("click", () => { values.term = 15; userChanged(); });
  $("seg-term-30").addEventListener("click", () => { values.term = 30; userChanged(); });
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
  $("d-nudge").hidden = !st.nudge;
  if (st.nudge) {
    const line = UI.nudgeLine(res);
    $("nudge-line").textContent = line;
    $("nudge-sr").textContent = UI.spoken(line) + " Details.";
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
  $("sv-kpis").textContent = UI.kpiSummary(res);

  if (badAges) {
    // Nothing below means anything with a negative horizon.
    for (const k of ["fire", "coast", "ret", "cross", "never"]) { $("k-" + k).textContent = "—"; $("k-" + k + "-n").textContent = "Fix the ages first"; }
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

  // Never coast: keep every partner's full saving, past the chosen retirement age if needed.
  const nc = res.neverCoast;
  const keepWords = `Saving about ${kRound(nc.yearly)}/yr${two() ? " together" : ""}, never coasting`;
  if (nc.age === null) {
    $("k-never").textContent = `Not by ${nc.top}`;
    $("k-never-n").innerHTML = `${keepWords}, you don't reach ${cmp(res.fire)} by ${nc.top}.`;
  } else if (nc.age <= v.age) {
    $("k-never").textContent = "Now";
    $("k-never-n").innerHTML = `You already have your ${cmp(res.fire)} FIRE number, so you could retire today.`;
  } else {
    const d = nc.wholeAge - R;
    const cmpR = d === 0 ? `<span class="delta up">${ICON.check}right at your chosen ${R}</span>`
      : d < 0 ? `<span class="delta up">${ICON.up}${-d} yr${d === -1 ? "" : "s"} before your chosen ${R}</span>`
      : `<span class="delta down">${ICON.down}${d} yr${d === 1 ? "" : "s"} after your chosen ${R}</span>`;
    $("k-never").textContent = `About ${nc.wholeAge}`;
    $("k-never-n").innerHTML = `${keepWords}, ${nc.age >= nc.wholeAge ? `you reach ${cmp(res.fire)} at ${nc.wholeAge}, so you could retire then` : `you pass ${cmp(res.fire)} during age ${nc.wholeAge - 1}, so you could retire at about ${nc.wholeAge}`}.<span class="delta-line">${cmpR}</span>`;
  }

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
  const as = UI.assumeSummary(v);
  $("assume-vals").textContent = as.text;
  $("assume-vals").setAttribute("aria-label", as.label);
  $("sv-draw").textContent = UI.drawSummary(res);
  $("sv-hsa").textContent = UI.hsaSummary(v);
  $("h-retAge").textContent = v.retAge < 59.5 ? "Before 59½: see the early-access bridge below." : "Set it below 59½ to plan an early-access bridge.";
  $("h-nominal").textContent = `Before inflation. Real return: ${(res.r * 100).toFixed(2)}% a year.`;
  $("h-inflation").textContent = "Everything is shown in today's dollars.";
  const first = res.firstCoast;
  $("h-draw").textContent = "Barista FIRE: taken from the portfolio each year " +
    (Number.isFinite(first) && first < v.retAge ? `from ${Math.max(first, v.age)} (the first coast age) to ${v.retAge}.` : "from the first coast age to retirement. Set a coast age to use it.");

  // One-person mode speaks to "you"; Partner A/B only when there are two.
  $("pA-t").textContent = v.two ? "Partner A" : "You";
  $("card-A").querySelector(".p-head .badge").hidden = !v.two;
  for (const p of ["A", "B"]) {
    const b = CF.partnerBase(v, p), sal = v["sal" + p];
    const solo = !v.two && p === "A";
    const whose = solo ? "your" : `${p}'s`;
    // One total line under the salary: "Saving $X/yr · Y% of pay".
    $("foot-" + p).textContent = `${money(b.total)}/yr`;
    $("sub-" + p).textContent = sal > 0 ? `· ${pct1(b.total / sal)} of pay` : "";
    $("sv-partner" + p).textContent = UI.partnerSummary(v, p);
    $("sv-partner" + p + "-t").textContent = solo ? "Your 401(k), Roth & coasting" : `${p}'s 401(k), Roth & coasting`;
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
    const kept = UI.afterCoast(v, p);
    $("h-after" + p).textContent = `Share of ${whose} ${money(b.total)}/yr that continues after coasting, employer money included` +
      (on && kept > 0.5 ? ` = ${money(kept)}/yr after coasting.` : ".");
    $("foot-l-" + p).textContent = "Saving";
  }
  for (const k of NUM_KEYS) showNote(k);
}

// The (i) next to a label shows only when that field has a hint that is hidden by default.
function syncInfo() {
  for (const k of NUM_KEYS) {
    const h = $("h-" + k), b = $("i-" + k);
    const none = h.classList.contains("keep") || !h.textContent.trim();
    b.hidden = none;
    if (none && h.closest(".field").classList.contains("show-hint")) {
      h.closest(".field").classList.remove("show-hint");
      b.setAttribute("aria-expanded", "false");
    }
  }
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
  // One short line: the real return. How it's derived is in the chart's label and the Returns row.
  $("chart-sub").textContent = `${(res.r * 100).toFixed(2)}% real return · today's dollars`;
  if (empty) { svg.innerHTML = ""; geo = null; $("readout").textContent = ""; return; }

  const pts = res.points, n = pts.length - 1;
  // Never coast: the x-axis runs past retirement when full-pace saving gets there later.
  const xEnd = chartEnd(res);
  const nc = res.neverCoast, ncPts = nc.points.filter((p) => p.age <= xEnd);
  let yMax = res.fire;
  for (const p of pts) yMax = Math.max(yMax, p.balance, p.coastLine, p.noContrib);
  for (const p of ncPts) yMax = Math.max(yMax, p.balance);
  // Buying a home (when on): the buying portfolio from the purchase age to R, and its FIRE number.
  const hb = buyShown(res);
  const buyPts = hb ? hb.points : null, bi = hb ? hb.b - v.age : 0;
  if (hb) { for (const p of buyPts) yMax = Math.max(yMax, p.balance); yMax = Math.max(yMax, hb.fire.own); }
  if (!(yMax > 0)) yMax = 1;
  const yStep = niceStep(yMax * 1.1 / 4);
  const yTop = Math.ceil(yMax * 1.1 / yStep) * yStep;
  const ticks = [];
  for (let t = 0; t <= yTop + yStep / 2; t += yStep) ticks.push(t);
  const L = Math.max(...ticks.map((t) => textW(CF.fmtCompact(t)))) + 8, Rm = 10, T = 12, B = 22;
  const span = Math.max(1, xEnd - v.age);
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
  for (let a = Math.ceil(v.age / xStep) * xStep; a <= xEnd; a += xStep) ages.add(a);
  const firstTick = `age ${v.age}`, firstW = textW(firstTick) + 10;
  const extended = xEnd > v.retAge;
  // Extended axis: always tick the never-coast age, so the crossing has a label under it.
  const ncTick = extended && nc.wholeAge !== null && nc.wholeAge <= xEnd ? nc.wholeAge : null;
  if (ncTick !== null) ages.add(ncTick);
  const kept = (a) => a === v.age || a === v.retAge || a === ncTick;
  for (const a of [...ages].sort((p, q) => p - q)) {
    if (!kept(a) && (x(a) - x(v.age) < firstW || Math.abs(x(v.retAge) - x(a)) < 22 ||
      (ncTick !== null && Math.abs(x(ncTick) - x(a)) < 22) || x(xEnd) - x(a) < 8)) continue;
    const anchor = a === v.age ? "start" : x(a) > W - Rm - 12 ? "end" : "middle";
    s += `<text class="tick${a === v.retAge && extended ? " tick-ret" : ""}" x="${x(a).toFixed(1)}" y="${H - B + 14}" text-anchor="${anchor}">${a === v.age ? firstTick : a}</text>`;
  }
  // Past retirement the chart shows only the never-coast line; a hairline marks the chosen age.
  if (extended) s += `<line class="ret-line" x1="${x(v.retAge).toFixed(1)}" x2="${x(v.retAge).toFixed(1)}" y1="${T}" y2="${H - B}"/>`;
  // Lines (no wash under the projection, so the shaded band means only "coasting").
  s += `<path class="l-stop" d="${line("noContrib")}"/>`;
  s += `<path class="l-coast" d="${line("coastLine")}"/>`;
  // Keep saving, never coast: drawn from where it leaves the plan (at retirement when nobody coasts).
  let ncFrom = ncPts.findIndex((p, k) => k > n || Math.abs(p.balance - pts[k].balance) > 0.5);
  ncFrom = ncFrom < 0 ? ncPts.length : Math.max(0, ncFrom - 1);
  const keepPts = ncPts.slice(ncFrom);
  if (keepPts.length > 1) s += `<path class="l-keep" d="${keepPts.map((p, i) => `${i ? "L" : "M"}${x(p.age).toFixed(1)} ${y(p.balance).toFixed(1)}`).join("")}"/>`;
  if (hb) {
    // From the purchase: the drop at b as a vertical step, then the buying portfolio to R.
    let d = `M${x(hb.b).toFixed(1)} ${y(buyPts[bi].balance).toFixed(1)}`;
    if (buyPts[bi].post !== undefined) d += `V${y(buyPts[bi].post).toFixed(1)}`;
    for (let k = bi + 1; k <= n; k++) d += `L${x(buyPts[k].age).toFixed(1)} ${y(buyPts[k].balance).toFixed(1)}`;
    s += `<path class="l-buy" d="${d}"/>`;
  }
  s += `<path class="l-proj" d="${line("balance")}"/>`;
  // FIRE number reference line, labelled directly.
  const fy = y(res.fire);
  s += `<line class="fire-line" x1="${L}" x2="${W - Rm}" y1="${fy.toFixed(1)}" y2="${fy.toFixed(1)}"/>`;
  // Labels are laid out together: each takes the first candidate spot that overlaps
  // no label placed before it (and, for the inline line labels, no line).
  const placed = [];
  const plotW = W - L - Rm;
  const lineKeys = ["balance", "coastLine", "noContrib", "keep"].concat(hb ? ["buy"] : []);
  const lineY = (key, px) => {
    if (key === "buy" && !buyPts) return -1e9; // the buying line is off
    const vals = key === "keep" ? ncPts.map((p) => p.balance)
      : key === "buy" ? buyPts.map((p) => (p.post !== undefined ? p.post : p.balance)) : pts.map((p) => p[key]);
    const last = vals.length - 1, a = Math.max(0, (px - L) / plotW * span);
    if (a > last + 1e-9) return -1e9; // that line has ended
    if (key === "keep" && a < ncFrom) return -1e9; // not drawn there
    if (key === "buy" && a < bi) return -1e9;
    if (last < 1) return y(vals[0]);
    const i = Math.min(last - 1, Math.floor(a)), f = a - i;
    return y(vals[i] * (1 - f) + vals[i + 1] * f);
  };
  const boxOf = (tx, ty, text, px, anchor, lines = 1) => {
    const w = textW(text, px), x0 = anchor === "end" ? tx - w : anchor === "middle" ? tx - w / 2 : tx;
    return { x0, x1: x0 + w, y0: ty - px * 0.8, y1: ty + px * 0.25 + (lines - 1) * (px + 1) };
  };
  const overlaps = (a, b) => a.x0 < b.x1 + 2 && b.x0 < a.x1 + 2 && a.y0 < b.y1 + 1 && b.y0 < a.y1 + 1;
  const crossesLine = (b, keys) => {
    if (fy > b.y0 - 1 && fy < b.y1 + 1) return true;
    // Every 4px plus both edges, so a steep line clipping a corner is still caught.
    const x0 = Math.max(L, b.x0), x1 = Math.min(W - Rm, b.x1);
    for (let px = x0; px <= x1 + 3.999; px += 4) {
      const qx = Math.min(px, x1);
      for (const k of keys) { const ly = lineY(k, qx); if (ly > b.y0 - 1 && ly < b.y1 + 1) return true; }
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
  // Placed clear of the never-coast line where it can be (it branches off the plan before R).
  const endCands = [endY, endY - 13, ey + 15, endY + 13, ey - 21].filter((yy, i, a) => a.indexOf(yy) === i && yy <= H - B - 3)
    .map((yy) => ({ box: boxOf(ex - 6, yy, endText, 11, "end"),
      svg: `<text class="end-label halo" x="${(ex - 6).toFixed(1)}" y="${yy.toFixed(1)}" text-anchor="end">${endText}</text>` }));
  const endPick = endCands.find((k) => fits(k.box, ["keep", "balance", "buy"])) || endCands.find((k) => fits(k.box, ["keep", "balance"])) ||
    endCands.find((k) => fits(k.box, ["keep"])) || endCands[0];
  placed.push(endPick.box);
  endSvg += endPick.svg;
  // Where saving at full pace (never coasting) first reaches the FIRE number.
  // Already at FIRE today: no dot or label (the tile says "Now"), since the balance sits above the line.
  if (nc.age !== null && nc.age > v.age && nc.age <= xEnd) {
    const kx = x(nc.age), right0 = kx < (L + W) / 2;
    s += `<circle class="dot-keep" cx="${kx.toFixed(1)}" cy="${fy.toFixed(1)}" r="5"/>`;
    const c = [];
    // The full wording first; on a narrow chart, the short "retire at N" (the legend names the line).
    // Last, the short one set a little further out, clear of a steep line through the dot.
    for (const [text, gap] of [[`Keep saving → retire at ${nc.wholeAge}`, 8], [`retire at ${nc.wholeAge}`, 8], [`retire at ${nc.wholeAge}`, 30]]) {
      for (const yy of [fy - 9, fy + 16, fy - 22, fy + 29, fy - 35, fy + 42]) for (const right of [right0, !right0]) {
        const tx = right ? kx + gap : kx - gap, anchor = right ? "start" : "end";
        c.push({ box: boxOf(tx, yy, text, 11, anchor), svg: `<text class="ann halo" x="${tx.toFixed(1)}" y="${yy.toFixed(1)}" text-anchor="${anchor}">${text}</text>` });
      }
    }
    // Clear of the projection and the never-coast line if possible; else the first spot.
    if (!place(c, lineKeys) && !place(c, ["balance", "keep"])) { c[0].must = true; place(c); }
  }
  // Buying: a square at the post-purchase point, "buy at b", and the buyer's FIRE number as a tick
  // at the end of the buy line (x = R). Either label is dropped, never forced over other marks:
  // the legend entry then carries it.
  let buyFireInKey = false;
  if (hb) {
    const q = buyPts[bi], qx = x(hb.b), qy = y(q.post !== undefined ? q.post : q.balance);
    s += `<rect class="buy-mark" x="${(qx - 3.5).toFixed(1)}" y="${(qy - 3.5).toFixed(1)}" width="7" height="7"/>`;
    placed.push({ x0: qx - 4, x1: qx + 4, y0: qy - 4, y1: qy + 4 });
    const text = `buy at ${hb.b}`, c = [];
    // Next to the square first; then higher up, clear of the lines bunched near $0, with a leader.
    for (const yy of [qy - 7, qy + 15]) for (const right of [true, false]) {
      const tx = right ? qx + 7 : qx - 7, anchor = right ? "start" : "end";
      c.push({ box: boxOf(tx, yy, text, 11, anchor), svg: `<text class="ann buy-t halo" x="${tx.toFixed(1)}" y="${yy.toFixed(1)}" text-anchor="${anchor}">${text}</text>` });
    }
    for (const up of [24, 38, 52, 66]) for (const right of [true, false]) {
      const yy = qy - up, tx = right ? qx + 3 : qx - 3, anchor = right ? "start" : "end";
      c.push({ box: boxOf(tx, yy, text, 11, anchor),
        svg: `<line class="buy-leader" x1="${qx.toFixed(1)}" x2="${qx.toFixed(1)}" y1="${(qy - 5).toFixed(1)}" y2="${(yy + 3).toFixed(1)}"/>` +
          `<text class="ann buy-t halo" x="${tx.toFixed(1)}" y="${yy.toFixed(1)}" text-anchor="${anchor}">${text}</text>` });
    }
    place(c, lineKeys) || place(c, ["buy", "balance"]);
    const foy = y(hb.fire.own), rx = x(v.retAge);
    if (Math.abs(foy - fy) > 8) {
      s += `<line class="fire-own" x1="${(rx - 7).toFixed(1)}" x2="${(rx + 7).toFixed(1)}" y1="${foy.toFixed(1)}" y2="${foy.toFixed(1)}"/>`;
      placed.push({ x0: rx - 7, x1: rx + 7, y0: foy - 1, y1: foy + 1 });
      const ft = `FIRE if you buy ${cmp(hb.fire.own)}`, fc = [];
      // Just inside the retirement line, then left by the axis (like "FIRE number"), then right of the tick.
      for (const [tx, anchor] of [[rx - 10, "end"], [L + 4, "start"], [rx + 10, "start"]]) for (const yy of [foy - 4, foy + 12]) {
        fc.push({ box: boxOf(tx, yy, ft, 10, anchor),
          svg: `<text class="ref-label buy-t halo" x="${tx.toFixed(1)}" y="${yy.toFixed(1)}" text-anchor="${anchor}">${ft}</text>` });
      }
      buyFireInKey = !place(fc, lineKeys);
    }
  }
  if ($("buy-key")) $("buy-key").textContent = hb ? `Buy a home at ${hb.b} (portfolio, not the house)${buyFireInKey ? ` · FIRE if you buy ${cmp(hb.fire.own)}` : ""}` : "Buy a home (portfolio, not the house)";
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
    if (!place(c, ["keep", "balance"]) && !place(c, ["keep"])) { c[0].must = true; place(c); }
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
    place(c, lineKeys) || place(c); // no room: the dot stays, and the "Meets the coast line" tile gives the age
  }
  s += endSvg;
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
        const lx = Math.max(L + 4, Math.min(x(v.age + n * frac), x(v.retAge) - 60 - w));
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
  geo = { x, y, W, H, T, B, L, Rm, span, last: xEnd - v.age, ncPts, buyPts, bi };
  $("keep-key").textContent = keepKeyText(res);
  svg.setAttribute("aria-label", `Chart from age ${v.age} to ${xEnd}, in today's dollars at a ${(res.r * 100).toFixed(2)}% real return (${v.nominal.toFixed(1)}% return, ${v.inflation.toFixed(1)}% inflation). Your plan reaches ${cmp(res.balanceAtRet)} at ${v.retAge} against a FIRE number of ${cmp(res.fire)}. ${neverCoastWords(res)}${hb ? ` Buying a home at ${hb.b}, the portfolio (the home not included) reaches ${cmp(hb.atRet.buyPortfolio)} at ${v.retAge}, against a FIRE number of ${cmp(hb.fire.own)} if you buy.` : ""} ${$("headline").textContent} Use the left and right arrow keys to step through ages, Home and End to jump, Escape to clear.`);
  showHover(hover === null ? null : Math.min(hover, geo.last));
}

// The last age on the chart: retirement, or later when saving at full pace (never
// coasting) first reaches the FIRE number after it (plus room for its label), up to 100.
function chartEnd(res) {
  const v = res.inputs, nc = res.neverCoast;
  if (nc.wholeAge === null || nc.wholeAge <= v.retAge) return v.retAge;
  return Math.max(v.retAge, Math.min(nc.top, nc.wholeAge + 2));
}

// The buying line is drawn only when the comparison is on and modeled.
function buyShown(res) {
  const h = houseRes;
  return h && h.applies && !h.warnings.includes("tooLarge") && !res.warnings.includes("retAgeNotAfterAge") ? h : null;
}

const planCoastsBy = (res) => Number.isFinite(res.firstCoast) && res.firstCoast < res.inputs.retAge;
function keepKeyText(res) {
  return planCoastsBy(res) ? "Keep saving, never coast" : `Keep saving, never coast (same as your plan to ${res.inputs.retAge})`;
}

// One sentence on the never-coast age (chart label for screen readers).
function neverCoastWords(res) {
  const nc = res.neverCoast, v = res.inputs;
  if (nc.age === null) return `Saving at full pace and never coasting doesn't reach the FIRE number by ${nc.top}.`;
  if (nc.age <= v.age) return "You're already at the FIRE number today.";
  return `Saving at full pace and never coasting, you could retire at about ${nc.wholeAge}.`;
}

// At rest (nobody dragging or stepping) the row is quiet: the age and the two values, no gap,
// since the chip and the chart's own labels already say how far off the plan is.
function readoutHTML(age, p, k, rest, q) {
  let s = `<b>Age ${age}</b>`;
  if (p) {
    const diff = p.balance - p.coastLine;
    s += `<span><i class="key k-proj"></i>Projected ${cmp(p.balance)}</span>` +
      `<span><i class="key k-coast"></i>Coast line ${cmp(p.coastLine)}</span>`;
    // The gap is the plan's distance to the coast line: keep it next to those two, before "Keep saving".
    if (!rest) s += `<span class="gap ${diff >= 0 ? "up" : "down"}">plan ${cmp(Math.abs(diff))} ${diff >= 0 ? "above" : "below"} coast line</span>`;
    if (k && Math.abs(k.balance - p.balance) > 0.5) s += `<span><i class="key k-keep"></i>Keep saving ${cmp(k.balance)}</span>`;
    // The buying portfolio, where it differs from the plan (at rest too: its value at R).
    const qb = q ? (q.post !== undefined ? q.post : q.balance) : null;
    if (q && Math.abs(qb - p.balance) > 0.5) s += `<span><i class="key k-buy"></i>Buying ${cmp(qb)}</span>`;
  } else if (k) {
    const d = k.balance - result.fire, ok = d >= -0.5;
    s += `<span><i class="key k-keep"></i>Keep saving ${cmp(k.balance)}</span><span class="past">still working past ${result.inputs.retAge}</span>` +
      `<span class="gap ${ok ? "up" : "down"}">${cmp(Math.abs(d))} ${ok ? "over" : "under"} FIRE</span>`;
  }
  return s;
}

function showHover(i) {
  if (!geo || !result) return;
  hover = i;
  const pts = result.points, n = pts.length - 1;
  const idx = i === null ? n : i, age = result.inputs.age + idx;
  const p = pts[idx], k = geo.ncPts[idx], q = geo.buyPts && idx >= geo.bi ? geo.buyPts[idx] : null;
  $("readout").innerHTML = readoutHTML(age, p, k, i === null, q);
  $("readout").classList.toggle("rest", i === null);
  const g = $("hover");
  if (!g) return;
  if (i === null) { g.innerHTML = ""; return; }
  const px = geo.x(age);
  let dots = "";
  if (k && (!p || Math.abs(k.balance - p.balance) > 0.5)) dots += `<circle class="dot-keep" cx="${px}" cy="${geo.y(k.balance)}" r="4"/>`;
  if (q && p) { const qb = q.post !== undefined ? q.post : q.balance; if (Math.abs(qb - p.balance) > 0.5) dots += `<circle class="dot-buy" cx="${px}" cy="${geo.y(qb)}" r="4"/>`; }
  if (p) dots += `<circle class="dot-coast" cx="${px}" cy="${geo.y(p.coastLine)}" r="4"/><circle class="dot-proj" cx="${px}" cy="${geo.y(p.balance)}" r="4"/>`;
  g.innerHTML = `<line class="xhair" x1="${px}" x2="${px}" y1="${geo.T}" y2="${geo.H - geo.B}"/>` + dots;
}

function hoverAtPointer(e) {
  if (!geo) return;
  const r = $("chart-svg").getBoundingClientRect();
  const sx = (e.clientX - r.left) * (geo.W / r.width);
  const age = result.inputs.age + (sx - geo.L) / (geo.W - geo.L - geo.Rm) * geo.span;
  showHover(Math.max(0, Math.min(geo.last, Math.round(age - result.inputs.age))));
}

function wireChart() {
  const svg = $("chart-svg");
  // The readout is announced for keyboard moves only; dragging would flood a screen reader.
  const live = (on) => $("readout").setAttribute("aria-live", on ? "polite" : "off");
  svg.addEventListener("pointermove", (e) => { live(false); hoverAtPointer(e); });
  // The drag hint goes away after the first use, and stays away on this device.
  let hintSeen = store.get(UI.HINT_KEY) === "1";
  $("chart-hint").hidden = hintSeen;
  const seen = () => {
    if (hintSeen) return;
    hintSeen = true;
    $("chart-hint").hidden = true;
    store.set(UI.HINT_KEY, "1");
  };
  svg.addEventListener("pointerdown", (e) => { seen(); live(false); hoverAtPointer(e); });
  svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") showHover(null); });
  svg.addEventListener("blur", () => showHover(null));
  svg.addEventListener("keydown", (e) => {
    if (!geo) return;
    const last = geo.last;
    let i = hover === null ? -1 : hover;
    if (e.key === "ArrowRight") i = Math.min(last, i + 1);
    else if (e.key === "ArrowLeft") i = i < 0 ? 0 : Math.max(0, i - 1);
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = last;
    else if (e.key === "Escape") { showHover(null); return; }
    else return;
    seen();
    e.preventDefault();
    live(true);
    showHover(i);
  });
  $("table-toggle").addEventListener("click", () => {
    const t = $("path-table"), open = t.hidden;
    t.hidden = !open;
    $("path-note").hidden = !open;
    $("table-toggle").setAttribute("aria-expanded", String(open));
    $("table-toggle").textContent = open ? "Hide the table" : "Show as a table";
    if (open) renderPathTable(result);
  });
  let raf = 0;
  const redraw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => result && drawAllCharts()); };
  // Only a change of width redraws: opening or closing a section changes #deeper's height, not its width.
  const widths = new Map();
  const onResize = (entries) => {
    let changed = false;
    for (const en of entries) {
      const w = Math.round(en.contentRect.width);
      if (widths.get(en.target) !== w) { widths.set(en.target, w); changed = true; }
    }
    if (changed) redraw();
  };
  if (window.ResizeObserver) { const ro = new ResizeObserver(onResize); ro.observe($("chart")); ro.observe($("deeper")); }
  else window.addEventListener("resize", redraw);
  // Legend: three keys shown; the keys for the other lines (already drawn) behind "Other lines".
  $("legend-more").addEventListener("click", () => setLegendOpen($("legend-x").hidden, true));
}

function setLegendOpen(open, save) {
  $("legend-x").hidden = !open;
  $("legend-more").setAttribute("aria-expanded", String(open));
  $("legend-more").textContent = open ? "Hide key" : "Other lines";
  if (save) saveOpen("legend-x", open);
}

function renderPathTable(res) {
  if ($("path-table").hidden) return;
  const v = res.inputs, end = chartEnd(res), nc = res.neverCoast, hb = buyShown(res);
  // Phones: compact amounts so all six columns fit without a sideways scroll.
  const narrow = window.matchMedia("(max-width: 480px)").matches;
  const m = narrow ? cmp : money;
  const rows = [];
  for (let a = v.age; a <= end; a++) {
    const p = res.points[a - v.age], k = nc.points[a - v.age];
    const keep = k ? m(k.balance) + (nc.wholeAge === a ? " ✓" : "") : "—";
    // Buying (when on): the portfolio if you buy (after closing at the purchase age) and the home's equity.
    const q = hb && p ? hb.points[a - v.age] : null;
    const buy = !hb ? "" : q ? `<td>${m(q.post !== undefined ? q.post : q.balance)}</td><td>${a >= hb.b ? m(q.equity) : "—"}</td>` : "<td>—</td><td>—</td>";
    rows.push(p
      ? `<tr><td>${p.age}</td><td>${m(p.balance)}</td><td>${m(p.coastLine)}</td><td>${p.contrib || p.draw ? m(p.contrib - p.draw) : "—"}</td><td>${m(p.noContrib)}</td><td>${keep}</td>${buy}</tr>`
      : `<tr class="past-row"><td>${a}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${keep}</td>${buy}</tr>`);
  }
  const buyHead = hb ? `<th scope="col">Buying</th><th scope="col">Home<br>equity</th>` : "";
  $("path-table").innerHTML = `<table class="data${hb ? " with-buy" : ""}"><caption class="visually-hidden">Projection by age, today's dollars. The last column keeps saving at full pace and never coasts, working past ${v.retAge} if needed; a check mark is the first age it reaches the FIRE number.${hb ? ` Buying: the portfolio if you buy at ${hb.b}, the home not included; home equity is its value less the loan, before selling costs.` : ""}</caption><thead><tr><th scope="col">Age</th><th scope="col">Projected</th><th scope="col">Coast line</th><th scope="col">Added<br>that year</th><th scope="col">Stop<br>today</th><th scope="col">Never<br>coast</th>${buyHead}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  // The note sits above the scroll box, so it is read before the rows, not after all of them.
  $("path-note").textContent = `Never coast: ${kRound(nc.yearly)}/yr every year, no coast ages or Barista draw${end > v.retAge ? `, working past ${v.retAge}` : ""}. ✓ = first age at the FIRE number.` +
    (hb ? ` Buying: the portfolio if you buy at ${hb.b} (after closing), the home not in it; home equity = value − loan, before selling costs.` : "");
  // On a phone the two buying columns replace "Stop today" (the chart and its key still show it).
  if (hb) $("path-note").insertAdjacentHTML("beforeend", `<span class="narrow-only"> Stop today is hidden here to make room.</span>`);
}

// ---------- contributions: stacked bars per partner ----------

function renderContrib(res) {
  const v = res.inputs, svg = $("bars-svg");
  $("sv-contrib").textContent = UI.contribSummary(res);
  if (!shown($("d-contrib"))) return; // drawn when opened (a closed section measures 0 wide)
  const W = Math.max(260, svg.parentElement.clientWidth);
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
  $("sv-ec").textContent = UI.ecSummary(res);
  $("sv-spark").textContent = UI.sparkSummary(res);
  $("d-spark").hidden = bad;
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
  if (!shown($("d-spark"))) return; // drawn when opened
  const W = Math.max(240, svg.parentElement.clientWidth), H = 92, T = 16, B = 16, Lp = 4, Rp = 4;
  let lo = Math.min(res.fire, ...sw.map((p) => p.balance)), hi = Math.max(res.fire, ...sw.map((p) => p.balance));
  const pad = (hi - lo) * 0.08 || hi * 0.05 || 1;
  lo -= pad; hi += pad;
  // The axis is zoomed to the data, so say where it starts instead of drawing a "$0" baseline.
  if (lo > 0) $("spark-title").innerHTML = `${esc(sparkTitle)} <span class="axis-note">· scale starts at ${cmp(lo)}, not $0</span>`;
  const x = (a) => Lp + (a - v.age) / (R - v.age) * (W - Lp - Rp);
  const y = (b) => T + (1 - (b - lo) / (hi - lo)) * (H - T - B);
  let s = "";
  const firstOk = sw.find((p) => p.balance >= res.fire * (1 - 1e-6));
  if (firstOk) s += `<rect class="ok-zone" aria-hidden="true" x="${x(firstOk.age).toFixed(1)}" y="${T - 6}" width="${(x(R) - x(firstOk.age)).toFixed(1)}" height="${H - T - B + 6}"/>`;
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
  $("sv-heat").textContent = UI.heatSummary(res, g);
  if (!shown($("d-heat"))) return; // built when opened
  const badAges = res.warnings.includes("retAgeNotAfterAge");
  $("d-heatkey").hidden = badAges;
  if (badAges) { $("heat").innerHTML = ""; $("heat-note").textContent = ""; $("heat-scale").hidden = true; return; }
  $("heat-scale").hidden = false;
  const R = v.retAge, both = v.two ? "both " : "";
  const curCol = g.cols.findIndex((w) => Math.abs(w - v.swr) < 1e-9);
  const pctTxt = (x) => (+x).toFixed(1) + "%";
  let none = 0;
  const body = g.cells.map((row, i) => `<tr><th scope="row"${i === 2 ? ' class="cur-h"' : ""}>${pctTxt(g.rows[i])}<span class="u">return</span></th>` + row.map((c, j) => {
    const isCur = i === 2 && j === curCol, cur = isCur ? " cur" : "";
    const head = `${pctTxt(c.nominal)} return, ${pctTxt(c.swr)} withdrawal rate${isCur ? " (your inputs)" : ""}`;
    const you = isCur ? `<span class="you" aria-hidden="true">your inputs</span>` : "";
    if (c.age === null) {
      none++;
      const p = Math.min(99, Math.floor(c.pctOfFire * 100));
      return `<td class="none${cur}" tabindex="0" title="${head}: not by ${R}; saving the whole way reaches ${p}% of the FIRE number" aria-label="${head}: can't stop saving and still retire at ${R}; saving the whole way reaches ${p}% of the FIRE number"><span class="n">${p}%</span>${you}</td>`;
    }
    const label = c.age <= v.age ? "Now" : c.age;
    const yrs = `${c.years} year${c.years === 1 ? "" : "s"} coasting`;
    return `<td class="${heatClass(c.years)}${cur}" tabindex="0" title="${head}: ${both}stop saving at ${label} (${yrs})" aria-label="${head}: ${both}stop saving at ${label}, ${yrs}"><span class="n">${label}</span>${you}</td>`;
  }).join("") + "</tr>").join("");
  const all = none === 25;
  // When no cell can make it, the years ramp means nothing; say what the grid shows instead.
  $("heat-ramp").hidden = all;
  $("ramp-t").textContent = `Shade = years coasting before ${R}`;
  $("none-key-t").textContent = `Hatched = can't reach your FIRE number by ${R}, even saving the whole way. The % is how much of it you'd have.`;
  const lead = all ? `<p class="heat-all">None of these reach ${cmp(res.fire)} by ${R}, even saving the whole way.</p>` : "";
  // One plain sentence on what a cell's number means, shown as the table's caption.
  const meaning = all
    ? `Each cell is the share of your ${cmp(res.fire)} FIRE number you'd have at ${R}, saving the whole way.`
    : `Each number is the earliest age you could ${both}stop saving and still reach your FIRE number by ${R} (“Now” = today).`;
  $("heat").innerHTML = `${lead}<table class="heat"><caption>${meaning}</caption>
    <thead>
      <tr><th scope="col" rowspan="2" class="ax-row">Investment return, before inflation&nbsp;↓</th><th scope="colgroup" colspan="${g.cols.length}" class="ax-col">Safe withdrawal rate&nbsp;→</th></tr>
      <tr>${g.cols.map((w, j) => `<th scope="col"${j === curCol ? ' class="cur-h"' : ""}>${pctTxt(w)}<span class="u">SWR</span></th>`).join("")}</tr>
    </thead><tbody>${body}</tbody></table>`;
  const notes = [];
  if (curCol < 0) notes.push(`Your ${v.swr.toFixed(1)}% withdrawal rate falls between the columns, so no cell is marked “your inputs”; the middle row is your ${v.nominal.toFixed(1)}% return.`);
  $("heat-note").textContent = notes.join(" ");
}

// ---------- early-access bridge ----------

function renderBridge(res, br) {
  const v = res.inputs;
  const teaser = $("br-teaser"), full = $("br-full");
  // The row's own line, plus (before 59½) a chip and a teaser sentence shown above it.
  const bs = UI.bridgeSummary(res, br);
  $("sv-bridge-t").textContent = bs.title;
  $("sv-bridge").textContent = bs.value;
  $("br-peek").hidden = !bs.chip;
  $("br-hero").hidden = !bs.chip;
  if (bs.chip) {
    const chip = (id) => `<span class="chip ${bs.chip.kind}" id="${id}">${ICON[bs.chip.kind === "bad" ? "alert" : "check"]}${esc(bs.chip.text)}</span>`;
    $("br-peek-chip").outerHTML = chip("br-peek-chip");
    $("br-peek-t").textContent = bs.teaser;
    // The same status in the answer card, so an early retirement age shows it next to the result.
    $("br-hero-chip").outerHTML = chip("br-hero-chip");
  }
  $("bridge").setAttribute("aria-labelledby", br.applies ? "br-title" : "br-teaser-t");
  if (!br.applies) {
    full.hidden = true;
    teaser.hidden = false;
    if (br.reason === "badAges") { teaser.innerHTML = `<h2 id="br-teaser-t" class="visually-hidden">Retiring before 59½?</h2><p>Fix the ages above first.</p>`; return; }
    const tryAge = v.age < 55 ? 55 : null;
    teaser.innerHTML = br.reason === "tooYoung"
      ? `<h2 id="br-teaser-t" class="visually-hidden">Retiring before 59½?</h2><p>The 72(t) life-expectancy table here covers starting ages 30 to 60, so the bridge isn't drawn for retiring at ${v.retAge}.</p>`
      : `<h2 id="br-teaser-t" class="visually-hidden">Retiring before 59½?</h2><p>401(k) and IRA money usually costs a 10% penalty before 59½. Set a retirement age under 59½ to plan a bridge with fixed 72(t) payments and a Roth conversion ladder, year by year.</p>${tryAge ? `<div class="actions"><button type="button" class="btn ghost sm" data-act="try55">Try retiring at ${tryAge}</button></div>` : ""}`;
    return;
  }
  teaser.hidden = true;
  full.hidden = false;
  const gaps = br.gapYears.length;
  // No chip in the body: the one above the row (and in the answer card) already says it.
  // Live hints on the bridge inputs.
  $("h-preShare").textContent = `401(k)s and traditional IRAs as a share of the ${cmp(br.portfolio)} portfolio at ${v.retAge}: ${cmp(br.preTax)}.`;
  $("h-sepShare").innerHTML = `72(t) IRA ${cmp(br.pot72)} · ladder IRA ${cmp(br.potLadder)}. Separate IRAs, so no dollar counts twice. <button type="button" class="linkish" data-act="size72">Size 72(t) to cover spending (${br.shareToCover}%)</button>`;
  const est = CF.rothBasisEstimate(values);
  $("h-basis").innerHTML = `What you've put into Roth IRAs (not growth); you can take it out at any age. Your Roth inputs add about ${cmp(est)} by ${v.retAge}.` +
    (est > 0 ? ` <button type="button" class="linkish" data-act="basis">Use ${cmp(est)}</button>` : "");
  if (!shown($("d-bridge"))) return; // the timeline and bars are drawn when opened

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

// ---------- buying a home (SPEC 11) ----------
// Off by default: the row reads "Buying a home · off" and nothing else on the page changes.
// On: the verdict and a renting-vs-buying list first, then the inputs, then three nested rows.

const fiWords = (fi, top) => (fi.age === null ? `Not by ${top}` : fi.age.toFixed(1));
const yrsWord = (d) => { const t = Math.abs(d).toFixed(1); return t + (t === "1.0" ? " yr" : " yrs"); };
// In sentences: whole years ("about 14 years"), not "13.6 yrs".
const yearsProse = (d) => { const n = Math.round(Math.abs(d)); return n === 0 ? "less than a year" : n === 1 ? "1 year" : `${n} years`; };
// A delta line under the buying value: icon + words, never colour alone. The arrow follows the
// number (`rose`: more, later); the colour says whether that is good for buying (`good`).
function deltaHTML(good, words, rose) { return `<span class="delta ${good ? "up" : "down"}">${rose ? ICON.up : ICON.down}${esc(words)}</span>`; }
const sameHTML = () => `<span class="delta same">${ICON.check}same</span>`;

function renderHouse(res, h) {
  const v = res.inputs, R = v.retAge, on = !!v.houseOn;
  $("sv-house").textContent = UI.houseSummary(res, h);
  setSwitch("sw-house", on);
  $("house-hint").textContent = on ? "On: the chart adds a “Buy a home” line. Everything else stays the renting plan." : "Off: nothing on the page changes.";
  $("house-on").hidden = !on; // hidden, not cleared
  $("buy-key-li").hidden = !(h && h.applies);
  if (!on) return;
  $("seg-down-inv").setAttribute("aria-pressed", v.downFrom ? "true" : "false");
  $("seg-down-cash").setAttribute("aria-pressed", v.downFrom ? "false" : "true");
  $("seg-term-15").setAttribute("aria-pressed", v.term === 15 ? "true" : "false");
  $("seg-term-30").setAttribute("aria-pressed", v.term === 15 ? "false" : "true");
  $("sv-house-costs").textContent = UI.houseCostsSummary(v);
  const b = Math.max(v.buyAge, v.age);
  $("h-buyAge").textContent = (v.buyAge <= v.age ? "Buying today. " : "") + "Already own your home? This section models a purchase, not a home you have.";
  $("down-hint").textContent = v.downFrom
    ? (R < 59.5 || b < 59.5
      ? `Comes out of the portfolio at ${b} and stops compounding. Taking it from a 401(k) or IRA before 59½ usually costs tax and a 10% penalty (IRAs allow up to $10,000 once for a first home); not modeled.`
      : `Comes out of the portfolio at ${b} and stops compounding.`)
    : "Cash saved outside the portfolio. For fairness, the renter keeps the same cash invested (net worth only).";

  const out = $("house-out");
  if (!h.applies) {
    const why = { badAges: "Fix the ages first.", buyAfterRet: `Pick a buy age before ${R}: after retirement there's no projection to compare.`, noPrice: "Add a home price to compare." }[h.reason] || "";
    out.innerHTML = `<p class="house-verdict muted">${esc(why)}</p>`;
    $("d-house-how").hidden = true;
    $("sv-house-be").textContent = "—";
    $("house-be").innerHTML = `<p class="fine">${esc(why)}</p>`;
    return;
  }
  if (h.warnings.includes("tooLarge")) {
    out.innerHTML = `<p class="house-verdict muted">Too large to show.</p>`;
    $("d-house-how").hidden = true;
    return;
  }
  const top = res.neverCoast.top, A = h.atRet, fr = h.fi.rent.age, fb = h.fi.buy.age;

  // The verdict, in the same terms as the row's summary (whole years in a sentence).
  let verdict;
  if (h.cashShort > 0) {
    const have = res.points[b - v.age].balance;
    verdict = `<b>Not enough cash at ${b}.</b> You'd have ${cmp(have)} invested, ${cmp(h.cashShort)} short of the ${cmp(h.cash)} needed at closing. The buying line assumes the portfolio is emptied.`;
  } else if (fr !== null && fb !== null) {
    const d = fb - fr;
    verdict = Math.abs(d) < 0.05
      ? `Buying at ${b}, you'd reach financial independence at <b>about the same age</b> as renting (${Math.round(fb)}).`
      : `Buying at ${b}, you'd reach financial independence about <b>${yearsProse(d)} ${d > 0 ? "later" : "earlier"}</b> than renting (${Math.round(fb)} instead of ${Math.round(fr)}).`;
  } else {
    const n = A.buyNW - A.rentNW;
    verdict = `Buying at ${b} leaves you <b>${cmp(Math.abs(n))} ${n < 0 ? "less" : "more"}</b> at ${R} than renting, the home counted after selling costs.`;
  }

  // Renting | Buying, each row with a delta in words under the buying value.
  const ageCell = (a) => (a === null ? `Not by ${R}` : a <= v.age ? "Now" : String(a));
  const ageDelta = (ra, ba) => {
    if (ra === null && ba === null) return "";
    if (ba === null) return deltaHTML(false, "never, renting does", true);
    if (ra === null) return deltaHTML(true, "renting never does", false);
    const d = ba - ra;
    return d === 0 ? sameHTML() : deltaHTML(d < 0, `${Math.abs(d)} yr${Math.abs(d) === 1 ? "" : "s"} ${d > 0 ? "later" : "earlier"}`, d > 0);
  };
  const moneyDelta = (rv, bv) => {
    const d = bv - rv;
    return Math.abs(d) < 0.5 ? sameHTML() : deltaHTML(d > 0, `${cmp(Math.abs(d))} ${d > 0 ? "more" : "less"}`, d > 0);
  };
  const f = h.first;
  const tableOf = (rows, caption) => `<table class="hcmp"><caption class="visually-hidden">${caption}</caption>
    <thead><tr><td></td><th scope="col">Renting</th><th scope="col">Buying at ${b}</th></tr></thead>
    <tbody>${rows.map(([label, rv, bv, d, note]) => `<tr><th scope="row">${esc(label)}${note ? `<small>${esc(note)}</small>` : ""}</th><td>${rv}</td><td>${bv}${d ? `<small>${d}</small>` : ""}</td></tr>`).join("")}</tbody></table>`;
  // The essentials, above the inputs.
  const rows = [
    ["Housing a month at first", `${money(f.rent)}`, `${money(f.total)}`,
      Math.abs(f.diff) < 0.5 ? sameHTML() : deltaHTML(f.diff < 0, `${money(Math.abs(f.diff))} ${f.diff > 0 ? "more" : "less"}`, f.diff > 0)],
    ["Cash at closing", "—", money(h.cash), `<small>${money(h.down)} down + ${money(h.closing)} closing</small>`],
    ["Financially independent at", fiWords(h.fi.rent, top), fiWords(h.fi.buy, top),
      fr === null && fb === null ? "" : fb === null ? deltaHTML(false, "never, renting does", true) : fr === null ? deltaHTML(true, "renting never does", false)
        : Math.abs(fb - fr) < 0.05 ? sameHTML() : deltaHTML(fb < fr, `${yrsWord(fb - fr)} ${fb > fr ? "later" : "earlier"}`, fb > fr),
      "saving at full pace, never coasting"],
    [`Net worth at ${R}`, cmp(A.rentNW), cmp(A.buyNW), moneyDelta(A.rentNW, A.buyNW), "home counted after selling costs"],
  ];
  const below = [];
  if (Math.abs(v.rentGrowth) > 1e-9) below.push(`Renting here includes rent growth of ${v.rentGrowth.toFixed(1)}%/yr, so its FIRE number (${cmp(h.fire.rent)}) and FI age differ from the main plan's (${cmp(res.fire)}).`);
  if (h.cashShort > 0 && A.shortDebt > 0.5) below.push(`Buying net worth counts the ${cmp(h.cashShort)} you'd be short as a debt growing at your return (${cmp(A.shortDebt)} at ${R}); so do the breakevens.`);
  let afford = "";
  if (h.cashShort > 0) {
    afford = h.afford !== null
      ? `<p class="house-afford">Renting, you'd have the ${cmp(h.cash)} by ${h.afford}. <button type="button" class="btn ghost sm" data-act="buyAt">Buy at ${h.afford}</button></p>`
      : `<p class="house-afford">Renting, you wouldn't have the ${cmp(h.cash)} before ${R}; try a lower price, a smaller down payment or a separate cash fund.</p>`;
  }
  out.innerHTML = `<p class="house-verdict">${verdict}</p>${afford}${tableOf(rows, `Renting compared with buying at ${b}, today's dollars`)}` +
    below.map((n) => `<p class="fine house-below">${n}</p>`).join("");

  // "How this is worked out": the rest of the comparison and the notes, collapsed.
  const more = [
    ["Meets the coast line", ageCell(h.cross.rent), ageCell(h.cross.buy), ageDelta(h.cross.rent, h.cross.buy)],
    [`Earliest you could ${v.two ? "both " : ""}coast`, ageCell(h.earliest.rent.age), ageCell(h.earliest.buy.age), ageDelta(h.earliest.rent.age, h.earliest.buy.age)],
    [`Portfolio at ${R}`, cmp(A.rentPortfolio), cmp(A.buyPortfolio), moneyDelta(A.rentPortfolio, A.buyPortfolio)],
    [`FIRE number`, cmp(h.fire.rent), cmp(h.fire.own), ""],
  ];
  const notes = [];
  const parts = [`P&I ${money(f.pi)}`, `tax ${money(f.tax)}`, `insurance ${money(f.ins)}`, `upkeep ${money(f.maint)}`];
  if (f.pmi > 0.5) parts.push(`PMI ${money(f.pmi)}${h.pmiEnds !== null ? ` (ends at ${h.pmiEnds})` : ""}`);
  notes.push(`Owning at first: ${parts.join(" · ")} a month. The payment is fixed in dollars, so it shrinks with inflation.`);
  const before = Math.max(0, R - b), all = h.yearsCostMore === before;
  notes.push(h.yearsCostMore
    ? `Owning costs more than renting ${all ? `every year until ${R}` : `in ${h.yearsCostMore} of the ${before} years until ${R}`}; the extra comes out of your saving${all ? "" : ", and once owning is cheaper the difference is saved"}.`
    : `Owning costs less than renting every year until ${R}; the difference is added to your saving.`);
  if (h.yearsShort) notes.push(`In ${h.yearsShort} of those years owning costs more than you were saving; the ${cmp(h.totalDeficit)} gap is assumed to come out of your pay, not your portfolio.`);
  notes.push(`At ${R} the home is worth ${cmp(A.value)}${A.loanLeft > 0.5 ? ` with ${cmp(A.loanLeft)} left on the loan` : ", paid off"}; after ${(v.sellPct).toFixed(1)}% selling costs that's ${cmp(A.homeNet)} in net worth, never in the FIRE portfolio.`);
  if (A.credited > 0.5) notes.push(`Renting, the ${cmp(h.cash)} cash fund stays invested: ${cmp(A.credited)} at ${R}, counted in net worth.`);
  notes.push(`FIRE number if you buy: rent replaced by tax, insurance and upkeep${h.fire.mortLeft > 0.5 ? `, plus ${cmp(h.fire.mortLeft)} for the mortgage payments still due at ${R}` : ""}. Your ${money(v.spend)}/yr retirement spending is taken to include today's ${money(v.rent)}/mo rent.`);
  if (R < 59.5) notes.push(`Buying, your portfolio at ${R} is ${cmp(A.buyPortfolio)} (renting ${cmp(A.rentPortfolio)}); the bridge uses the renting plan.`);
  $("d-house-how").hidden = false;
  $("sv-house-how").textContent = UI.houseHowSummary(h, R);
  $("house-how").innerHTML = tableOf(more, `More of renting compared with buying at ${b}, today's dollars`) +
    `<div class="house-notes">${notes.map((n) => `<p>${n}</p>`).join("")}</div>`;
  showNote("pmi");

  // Breakeven.
  $("sv-house-be").textContent = UI.breakevenSummary(h);
  const g = h.breakeven.growth, i = h.breakeven.rate;
  const gText = g.value !== null
    ? `Net worth at ${R} ties if home prices grow <b>${g.value.toFixed(1)}%/yr</b> above inflation (you entered ${v.apprec.toFixed(1)}%). Faster growth favors buying.`
    : g.side === "buy" ? "Buying stays ahead on net worth even if home prices fall 10%/yr after inflation."
      : "Renting stays ahead on net worth even if home prices grow 10%/yr above inflation.";
  const iText = i.value !== null
    ? `With everything else as entered, it ties at a <b>${i.value.toFixed(2)}%</b> mortgage rate (you entered ${v.mortRate.toFixed(2)}%).`
    : i.side === "buy" ? "Buying stays ahead even at a 20% mortgage rate." : "Renting stays ahead even at a 0% mortgage rate.";
  $("house-be").innerHTML = `<p class="house-be-p">${gText}</p><p class="house-be-p">${iText}</p><p class="fine">Breakevens compare net worth at ${R} only, the home after selling costs; the FI ages above can tell a different story.</p>`;
}

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
// The bridge note in the answer card: the reader asked for it, so opening it is remembered.
$("br-hero-go").addEventListener("click", () => {
  const d = $("d-bridge");
  d.open = true;
  d.querySelector(":scope > summary").focus({ preventScroll: true });
  ($("br-peek").hidden ? d : $("br-peek")).scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
});

// ---------- collapsed sections ----------
// Native <details>. Which ones are open is remembered on this device (UI.UI_KEY), apart from
// the numbers: reset, Undo and shared links never change it.

let uiOpen = {};
function saveOpen(id, open) {
  uiOpen = UI.withOpen(uiOpen, id, open);
  store.set(UI.UI_KEY, JSON.stringify(uiOpen));
}
// Open, and every section around it open too (a closed section's contents measure 0 wide).
function shown(el) {
  for (let d = el.closest("details"); d; d = d.parentElement.closest("details")) if (!d.open) return false;
  return true;
}
function applyUiState() {
  const raw = store.get(UI.UI_KEY);
  uiOpen = UI.parseOpen(raw);
  // Wide screens: the numbers start open (there's room for them) until the reader closes them.
  // Each section falls back to its own default unless the reader has opened or closed it.
  const wide = !!(window.matchMedia && window.matchMedia("(min-width: 860px)").matches);
  const dflt = { "d-kpis": wide };
  for (const d of document.querySelectorAll("details[id]")) setOpen(d, UI.isOpenIn(uiOpen, d.id, dflt[d.id]));
  setLegendOpen(UI.isOpenIn(uiOpen, "legend-x", false), false);
}
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.id) return;
  // Only the reader's own opens and closes are remembered, not the page's.
  if (autoToggle.has(d.id)) autoToggle.delete(d.id);
  else if (uiOpen[d.id] !== d.open) saveOpen(d.id, d.open);
  if (d.open) {
    // Content opens below its summary; nothing is scrolled. Draw what was skipped while closed,
    // right away (the toggle event already runs after the section is open and laid out).
    if (result) { renderContrib(result); renderEarliest(result); renderBridge(result, bridgeRes); renderHeat(result, gridRes); syncInfo(); }
  } else {
    // Closing a long section can leave its summary above the screen: bring it back, no further.
    const sum = d.querySelector(":scope > summary");
    if (sum && sum.getBoundingClientRect().top < 0) sum.scrollIntoView({ block: "nearest", behavior: reduceMotion.matches ? "auto" : "smooth" });
  }
}, true);

// Opened or closed by the page, not the reader: the next toggle event isn't saved.
const autoToggle = new Set();
function setOpen(d, open) {
  if (d.open === !!open) return;
  if (d.id) autoToggle.add(d.id);
  d.open = !!open;
}

// A button that changes a field in a closed section (Apply, Size 72(t), Use basis, Try 55):
// open that section only if it is the button's own or comes after it on the page, so nothing
// above the reader moves; otherwise flash its summary row.
function revealFields(btn, keys) {
  for (const k of keys) {
    const el = $("f-" + k);
    if (!el) continue;
    for (let d = el.closest("details"); d; d = d.parentElement.closest("details")) {
      if (d.open) continue;
      if (d.contains(btn) || (btn.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING)) setOpen(d, true);
      else flashRow(d);
    }
  }
}
function flashRow(d) {
  const sum = d.querySelector(":scope > summary");
  if (!sum) return;
  sum.classList.remove("flash");
  void sum.offsetWidth; // restart the animation
  sum.classList.add("flash");
  setTimeout(() => sum.classList.remove("flash"), 1500);
}

// The (i) buttons: show or hide that field's hint.
document.addEventListener("click", (e) => {
  const b = e.target.closest("button.info");
  if (!b) return;
  const f = b.closest(".field"), on = !f.classList.contains("show-hint");
  f.classList.toggle("show-hint", on);
  b.setAttribute("aria-expanded", String(on));
});

// ---------- update ----------

function drawAllCharts() {
  drawChart();
  renderContrib(result);
  renderEarliest(result);
  renderBridge(result, bridgeRes);
  syncInfo();
}

function update() {
  values = CF.sanitize(values).values;
  result = CF.project(values);
  gridRes = CF.grid(values);
  bridgeRes = CF.bridge(values, result);
  houseRes = CF.house(values, result);
  renderHero(result);
  renderInputs(result);
  renderHouse(result, houseRes);
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
  if (t.dataset.apply) {
    const ps = t.dataset.apply === "both" ? (values.two ? ["A", "B"] : ["A"]) : [t.dataset.apply];
    revealFields(t, ps.map((p) => "coastAge" + p));
    applyCoast(t.dataset.apply);
    return;
  }
  const act = t.dataset.act;
  revealFields(t, [{ basis: "basis", size72: "sepShare", try55: "retAge", buyAt: "buyAge" }[act]].filter(Boolean));
  const before = { ...values };
  const undo = () => toastButton("Undo", () => { values = before; showAll(); update(); toast(); });
  if (act === "basis") { values.basis = Math.round(CF.rothBasisEstimate(values) / 1000) * 1000; showAll(); userChanged(); toast("Roth basis set from your Roth inputs. ", undo()); }
  else if (act === "size72") { values.sepShare = bridgeRes.shareToCover; showAll(); userChanged(); toast(`72(t) share set to ${values.sepShare}%. `, undo()); }
  else if (act === "try55") { values.retAge = 55; showAll(); userChanged(); toast("Retirement age set to 55. ", undo()); }
  else if (act === "buyAt" && houseRes && houseRes.afford !== null) { values.buyAge = houseRes.afford; showAll(); userChanged(); toast(`Buying at ${values.buyAge}. `, undo()); }
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
applyUiState(); // before the first update, so closed sections skip their drawing
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
