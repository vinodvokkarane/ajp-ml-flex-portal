const state = {
  meta: null,
  mode: "coupon",
  view: "dashboard",
  zoom: { control: 1, visual: 1, insight: 1 },
  latestPattern: null,
  latestInterface: null,
  latestOptimizer: null,
  latestCoupon: null,
  latestDt: null,
};

const $ = (id) => document.getElementById(id);

const fmt = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
};

const setText = (id, text) => {
  const el = $(id);
  if (el) el.textContent = text || "";
};

// Locale-independent number for SVG numeric attributes (fmt() can emit comma decimals).
const svgNum = (value, digits = 2) => Number(value || 0).toFixed(digits);

const MODE_HINTS = {
  coupon:
    "Integrated Zone A + Zone B coupon reliability under accelerated aging, gated by a conformal PASS / MARGINAL / DEFER-TO-INSPECTION decision.",
  dt: "Close the digital-twin loop: reconcile coupon reliability with the upstream process and rank better cure and process recipes.",
  pattern:
    "Printed-trace surrogate: line geometry, thickness, resistance, and quality with a calibrated process-anomaly breakdown.",
  interface:
    "Blind validation on a held-out X-band CPW (Figure 5) built on the same materials but excluded from model development.",
  optimizer:
    "Active learning: rank the highest-information next coupons and conditions to build the reliability map in far fewer runs.",
};

// Which Model-output blocks are relevant to each mode. The Active-learning
// shortlist and BOND-AI feedback only appear in the Active Learn (optimizer) mode.
const INSIGHT_BLOCKS = ["block-defect", "block-failure", "block-benchmark", "block-optimizer", "block-feedback"];
const INSIGHT_VISIBILITY = {
  pattern: ["block-defect", "block-benchmark"],
  interface: ["block-benchmark"],
  coupon: ["block-failure", "block-benchmark"],
  dt: ["block-feedback", "block-failure", "block-benchmark"],
  optimizer: ["block-optimizer", "block-feedback"],
};

const postJson = async (url, values) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text);
  }
  return response.json();
};

const materialById = (id) => state.meta.material_sets.find((m) => m.set_id === id) || state.meta.material_sets[0];
const patternById = (id) => state.meta.pattern_types.find((p) => p.id === id) || state.meta.pattern_types[0];
const deviceById = (id) => state.meta.device_types.find((d) => d.id === id) || state.meta.device_types[0];
const couponById = (id) => state.meta.coupon_structures.find((c) => c.id === id) || state.meta.coupon_structures[0];
const couponInkById = (id) => state.meta.coupon_inks.find((i) => i.id === id) || state.meta.coupon_inks[0];
const couponsByZone = (zone) => state.meta.coupon_structures.filter((c) => c.zone === zone);

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-button").forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".mode-pane").forEach((pane) => {
    const active = pane.id === `pane-${mode}`;
    pane.classList.toggle("active", active);
    pane.hidden = !active;
  });
  $("specimenTitle").textContent =
    mode === "pattern"
      ? "Characterization descriptors"
      : mode === "interface"
        ? "Blind CPW validation"
        : mode === "coupon"
          ? "Integrated coupon reliability"
          : mode === "dt"
            ? "BOND-AI feedback loop"
            : "Active-learning test ranking";
  // Entering Active Learn surfaces the shortlist and BOND-AI feedback; run once on demand.
  if (mode === "optimizer" && !state.latestOptimizer) {
    runOptimizer().catch(showError);
  }
  renderAll();
}

const ZOOM_PANELS = ["control", "visual", "insight"];
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 1.6;

function applyZoom(panel) {
  const target = document.getElementById(`zoomTarget-${panel}`);
  if (target) target.style.zoom = String(state.zoom[panel]);
  setText(`zoomLevel-${panel}`, `${Math.round(state.zoom[panel] * 100)}%`);
}

function bumpZoom(panel, dir) {
  if (!(panel in state.zoom)) return;
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number((state.zoom[panel] + dir * 0.1).toFixed(2))));
  state.zoom[panel] = next;
  applyZoom(panel);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const dashboard = $("view-dashboard");
  const objectives = $("view-objectives");
  if (dashboard) dashboard.hidden = view !== "dashboard";
  if (objectives) objectives.hidden = view !== "objectives";
  document.body.classList.toggle("objectives-active", view === "objectives");
}

function populateControls() {
  const materialSelect = $("materialSet");
  materialSelect.innerHTML = state.meta.material_sets
    .map((m) => `<option value="${m.set_id}">${m.stack}</option>`)
    .join("");

  $("patternType").innerHTML = state.meta.pattern_types.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
  $("deviceType").innerHTML = state.meta.device_types.map((d) => `<option value="${d.id}">${d.label}</option>`).join("");
  const zoneAOptions = couponsByZone("interface").map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
  const zoneBOptions = couponsByZone("bonding").map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
  $("zoneAStructure").innerHTML = zoneAOptions;
  $("zoneBStructure").innerHTML = zoneBOptions;
  $("dtZoneAStructure").innerHTML = zoneAOptions;
  $("dtZoneBStructure").innerHTML = zoneBOptions;
  $("couponInk").innerHTML = state.meta.coupon_inks.map((i) => `<option value="${i.id}">${i.label}</option>`).join("");
  $("testMethod").innerHTML = state.meta.coupon_test_methods.map((m) => `<option value="${m.id}">${m.label}</option>`).join("");

  const defaults = state.meta.defaults.pattern;
  materialSelect.value = defaults.material_set;
  $("patternType").value = defaults.pattern_type;
  $("nominalWidth").value = defaults.nominal_width_um;
  $("atomizerVoltage").value = defaults.atomizer_voltage_v;
  $("carrierFlow").value = defaults.carrier_flow_sccm;
  $("sheathFlow").value = defaults.sheath_flow_sccm;
  $("printSpeed").value = defaults.print_speed_mm_s;
  $("depositionRate").value = defaults.deposition_rate_ug_s;
  $("mistSpread").value = 6;
  $("clogNarrowing").value = 4;
  $("blobCount").value = defaults.blob_count;

  const idef = state.meta.defaults.interface;
  $("deviceType").value = idef.device_type;
  $("deviceWidth").value = idef.nominal_width_um;
  $("deviceGap").value = idef.nominal_gap_um;
  $("traceLength").value = idef.trace_length_mm;
  $("candidateCount").value = 700;

  const cdef = state.meta.defaults.coupon;
  $("analysisZone").value = cdef.coupon_zone;
  $("dtAnalysisZone").value = cdef.coupon_zone;
  $("zoneAStructure").value = couponsByZone("interface")[0]?.id || "";
  $("zoneBStructure").value = cdef.coupon_zone === "bonding" ? cdef.coupon_structure : couponsByZone("bonding")[0]?.id || "";
  $("dtZoneAStructure").value = $("zoneAStructure").value;
  $("dtZoneBStructure").value = $("zoneBStructure").value;
  $("couponInk").value = cdef.ink_family;
  $("testMethod").value = cdef.test_method;
  $("agingTemp").value = cdef.aging_temp_c;
  $("agingHours").value = cdef.aging_hours;
  $("thermalCycles").value = cdef.thermal_cycles;
  $("strainPct").value = cdef.strain_pct;
  $("voidFraction").value = cdef.ct_void_fraction_pct;
  $("dtCandidateCount").value = 600;

  syncLabels();
  renderMaterialStack();
}

function activeCouponId(prefix = "") {
  const zoneControl = prefix === "dt" ? $("dtAnalysisZone") : $("analysisZone");
  const zone = zoneControl.value;
  if (zone === "bonding") return prefix === "dt" ? $("dtZoneBStructure").value : $("zoneBStructure").value;
  return prefix === "dt" ? $("dtZoneAStructure").value : $("zoneAStructure").value;
}

function syncCouponSelectors(sourcePrefix = "") {
  if (sourcePrefix === "dt") {
    $("analysisZone").value = $("dtAnalysisZone").value;
    $("zoneAStructure").value = $("dtZoneAStructure").value;
    $("zoneBStructure").value = $("dtZoneBStructure").value;
  } else {
    $("dtAnalysisZone").value = $("analysisZone").value;
    $("dtZoneAStructure").value = $("zoneAStructure").value;
    $("dtZoneBStructure").value = $("zoneBStructure").value;
  }
}

function syncLabels() {
  $("widthOut").textContent = `${fmt($("nominalWidth").value, 0)} um`;
  $("atomizerOut").textContent = `${fmt($("atomizerVoltage").value, 1)} V`;
  $("carrierOut").textContent = `${fmt($("carrierFlow").value, 1)} sccm`;
  $("sheathOut").textContent = `${fmt($("sheathFlow").value, 1)} sccm`;
  $("speedOut").textContent = `${fmt($("printSpeed").value, 1)} mm/s`;
  $("depositionOut").textContent = `${fmt($("depositionRate").value, 1)} ug/s`;
  $("spreadOut").textContent = `${fmt($("mistSpread").value, 0)}%`;
  $("clogOut").textContent = `${fmt($("clogNarrowing").value, 0)}%`;
  $("blobOut").textContent = `${fmt($("blobCount").value, 0)}`;
  $("deviceWidthOut").textContent = `${fmt($("deviceWidth").value, 0)} um`;
  $("deviceGapOut").textContent = `${fmt($("deviceGap").value, 0)} um`;
  $("traceLengthOut").textContent = `${fmt($("traceLength").value, 1)} mm`;
  $("candidateOut").textContent = `${fmt($("candidateCount").value, 0)}`;
  $("agingTempOut").textContent = `${fmt($("agingTemp").value, 0)} C`;
  $("agingHoursOut").textContent = `${fmt($("agingHours").value, 0)} h`;
  $("thermalCyclesOut").textContent = `${fmt($("thermalCycles").value, 0)}`;
  $("strainOut").textContent = `${fmt($("strainPct").value, 2)}%`;
  $("voidOut").textContent = `${fmt($("voidFraction").value, 1)}%`;
  $("dtCandidateOut").textContent = `${fmt($("dtCandidateCount").value, 0)}`;

  // Mirror each slider's formatted value (with units) into aria-valuetext for screen readers.
  const sliderPairs = [
    ["nominalWidth", "widthOut"], ["atomizerVoltage", "atomizerOut"], ["carrierFlow", "carrierOut"],
    ["sheathFlow", "sheathOut"], ["printSpeed", "speedOut"], ["depositionRate", "depositionOut"],
    ["mistSpread", "spreadOut"], ["clogNarrowing", "clogOut"], ["blobCount", "blobOut"],
    ["deviceWidth", "deviceWidthOut"], ["deviceGap", "deviceGapOut"], ["traceLength", "traceLengthOut"],
    ["candidateCount", "candidateOut"], ["agingTemp", "agingTempOut"], ["agingHours", "agingHoursOut"],
    ["thermalCycles", "thermalCyclesOut"], ["strainPct", "strainOut"], ["voidFraction", "voidOut"],
    ["dtCandidateCount", "dtCandidateOut"],
  ];
  sliderPairs.forEach(([input, out]) => {
    const el = $(input);
    const label = $(out);
    if (el && label) el.setAttribute("aria-valuetext", label.textContent);
  });
}

function renderMaterialStack() {
  const material = materialById($("materialSet").value);
  const colors = ["#0b7285", "#b85032", "#2d7d46"];
  $("materialStack").innerHTML = `
    <span class="swatch" style="background:${colors[0]}"></span>
    <span class="stack-line"><strong>${material.ink}</strong>Coupon ink</span>
    <span class="swatch" style="background:${colors[1]}"></span>
    <span class="stack-line"><strong>${material.substrate}</strong>Common substrate</span>
    <span class="swatch" style="background:${colors[2]}"></span>
    <span class="stack-line"><strong>${fmt(material.conductivity_s_m / 1e6, 2)} MS/m</strong>Nominal conductivity</span>
  `;
}

function applyPatternDefaults() {
  const pattern = patternById($("patternType").value);
  $("nominalWidth").value = pattern.nominal_width_um;
  syncLabels();
}

function applyDeviceDefaults() {
  const device = deviceById($("deviceType").value);
  $("deviceWidth").value = device.nominal_width_um;
  $("deviceGap").value = device.nominal_gap_um;
  $("traceLength").value = device.trace_length_mm;
  syncLabels();
}

function buildPatternPayload() {
  const material = materialById($("materialSet").value);
  const pattern = patternById($("patternType").value);
  const width = Number($("nominalWidth").value);
  const spread = Number($("mistSpread").value) / 100;
  const clog = Number($("clogNarrowing").value) / 100;
  const blobs = Number($("blobCount").value);
  const ideal = width * 1.12;
  return {
    material_set: material.set_id,
    pattern_type: pattern.id,
    nominal_width_um: width,
    nominal_pitch_um: pattern.nominal_pitch_um,
    nominal_thickness_um: pattern.nominal_thickness_um,
    path_length_mm: pattern.path_length_mm,
    print_speed_mm_s: Number($("printSpeed").value),
    atomizer_voltage_v: Number($("atomizerVoltage").value),
    carrier_flow_sccm: Number($("carrierFlow").value),
    sheath_flow_sccm: Number($("sheathFlow").value),
    deposition_rate_ug_s: Number($("depositionRate").value),
    substrate_temp_c: 55,
    standoff_mm: 3.2,
    humidity_pct: 34,
    d_ideal_um: ideal,
    d_min_um: ideal * (1 - clog),
    d_max_um: ideal * (1 + spread),
    blob_count: blobs,
    blob_area_ratio: blobs * 0.006 + clog * 0.035,
    boundary_angle_deg: spread * 9 - clog * 6,
    edge_roughness_um: 2.4 + spread * 15 + clog * 18 + blobs * 1.35,
    camera_noise: 0.02 + blobs * 0.006,
    cure_energy_j_cm2: 1.4,
  };
}

function buildInterfacePayload() {
  const material = materialById($("materialSet").value);
  const device = deviceById($("deviceType").value);
  const width = Number($("deviceWidth").value);
  const pattern = state.latestPattern;
  let quality = 91;
  let thickness = 3.4;
  let overspray = Number($("mistSpread").value) / 100;
  let clog = Number($("clogNarrowing").value) / 100;
  let rough = 5.5;
  let lineWidth = width;

  if (pattern) {
    const ratio = pattern.prediction.line_width_um / pattern.input.nominal_width_um;
    lineWidth = width * ratio;
    quality = pattern.prediction.quality_score;
    thickness = pattern.prediction.thickness_um;
    overspray = pattern.derived.overspray_ratio;
    clog = pattern.derived.clog_ratio;
    rough = pattern.input.edge_roughness_um;
  }
  const traceLength = Number($("traceLength").value);
  const area = Math.max((lineWidth * 1e-6) * (thickness * 1e-6), 1e-12);
  const resistance = (traceLength * 1e-3) / (area * material.conductivity_s_m) * (1 + rough / 105);

  return {
    material_set: material.set_id,
    device_type: device.id,
    nominal_width_um: width,
    nominal_gap_um: Number($("deviceGap").value),
    trace_length_mm: traceLength,
    substrate_thickness_mm: device.substrate_thickness_mm,
    dielectric_constant: material.dielectric_constant,
    line_width_um: lineWidth,
    thickness_um: thickness,
    resistance_ohm: resistance,
    quality_score: quality,
    overspray_ratio: overspray,
    clog_ratio: clog,
    edge_roughness_um: rough,
    print_speed_mm_s: Number($("printSpeed").value),
    deposition_rate_ug_s: Number($("depositionRate").value),
    atomizer_voltage_v: Number($("atomizerVoltage").value),
    carrier_flow_sccm: Number($("carrierFlow").value),
    sheath_flow_sccm: Number($("sheathFlow").value),
  };
}

function couponBasePayload() {
  const coupon = couponById(activeCouponId(state.mode === "dt" ? "dt" : ""));
  const latestPattern = state.latestPattern;
  const widthRatio = latestPattern ? latestPattern.prediction.line_width_um / latestPattern.input.nominal_width_um : 1;
  const rough = latestPattern ? latestPattern.input.edge_roughness_um : 5.8;
  const thickness = latestPattern ? latestPattern.prediction.thickness_um : 3.2;
  const lineWidth = coupon.nominal_width_um * widthRatio;
  const conductivity = couponInkById($("couponInk").value).nominal_conductivity_s_m;
  const resistance = (coupon.path_length_mm * 1e-3) / Math.max((lineWidth * 1e-6) * (thickness * 1e-6) * conductivity, 1e-12);
  const agingTemp = Number($("agingTemp").value);
  return {
    coupon_structure: coupon.id,
    ink_family: $("couponInk").value,
    test_method: $("testMethod").value,
    nominal_width_um: coupon.nominal_width_um,
    path_length_mm: coupon.path_length_mm,
    overlap_area_mm2: coupon.overlap_area_mm2,
    bond_area_mm2: coupon.bond_area_mm2,
    print_speed_mm_s: Number($("printSpeed").value),
    atomizer_voltage_v: Number($("atomizerVoltage").value),
    carrier_flow_sccm: Number($("carrierFlow").value),
    sheath_flow_sccm: Number($("sheathFlow").value),
    substrate_temp_c: 55,
    cure_peak_temp_c: $("couponInk").value === "high_temp_500c" ? 430 : 210,
    cure_time_min: 45,
    aging_temp_c: agingTemp,
    aging_hours: Number($("agingHours").value),
    cycle_low_temp_c: -40,
    cycle_high_temp_c: agingTemp >= 500 ? 500 : 125,
    thermal_cycles: Number($("thermalCycles").value),
    bend_radius_mm: Math.max(3, 18 / Math.max(Number($("strainPct").value), 0.1)),
    strain_pct: Number($("strainPct").value),
    strain_cycles: Number($("thermalCycles").value) * 4,
    ct_void_fraction_pct: Number($("voidFraction").value),
    oxidation_index: Math.min(0.95, Math.max(0.04, (agingTemp - 25) / 760 + Number($("agingHours").value) / 2800)),
    edge_roughness_um: rough,
    alignment_error_um: 18 + Number($("voidFraction").value) * 1.2,
    line_width_um: lineWidth,
    thickness_um: thickness,
    initial_resistance_ohm: resistance,
  };
}

async function runPattern() {
  const result = await postJson("/api/predict/pattern", buildPatternPayload());
  state.latestPattern = result;
  await runInterface(false);
  renderAll();
}

async function runInterface(shouldRender = true) {
  const result = await postJson("/api/predict/interface", buildInterfacePayload());
  state.latestInterface = result;
  if (shouldRender) renderAll();
}

async function runOptimizer() {
  const payload = couponBasePayload();
  payload.candidates = Number($("candidateCount").value);
  state.latestDt = await postJson("/api/digital-twin/feedback", payload);
  state.latestCoupon = state.latestDt.baseline;
  state.latestOptimizer = { top: state.latestDt.next_experiments || [] };
  renderAll();
}

async function runCoupon(shouldRender = true) {
  state.latestCoupon = await postJson("/api/predict/coupon", couponBasePayload());
  if (shouldRender) renderAll();
}

async function runDt() {
  const payload = couponBasePayload();
  payload.candidates = Number($("dtCandidateCount").value);
  state.latestDt = await postJson("/api/digital-twin/feedback", payload);
  state.latestCoupon = state.latestDt.baseline;
  renderAll();
}

function metricCard(label, value, sub = "") {
  return `<div class="metric-card"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ""}</div>`;
}

function renderMetrics() {
  if ((state.mode === "coupon" || state.mode === "dt" || state.mode === "optimizer") && state.latestCoupon) {
    const p = state.latestCoupon.prediction;
    const d = state.latestCoupon.derived;
    $("primaryMetrics").innerHTML = [
      metricCard("Reliability", `${fmt(p.reliability_score, 1)}`, intervalText(state.latestCoupon, "reliability_score")),
      metricCard("Decision", state.latestCoupon.qualification_decision.replaceAll("_", " "), `${fmt(d.decision_confidence_pct, 0)}% confidence`),
      metricCard("RUL estimate", `${fmt(d.remaining_useful_life_hours, 0)} h`, `state index ${fmt(d.degradation_state_index, 1)}`),
      metricCard("Shear strength", `${fmt(p.post_aging_shear_mpa, 1)} MPa`, intervalText(state.latestCoupon, "post_aging_shear_mpa")),
    ].join("");
    return;
  }

  if (state.mode === "interface" && state.latestInterface) {
    const p = state.latestInterface.prediction;
    $("primaryMetrics").innerHTML = [
      metricCard("Resonance", `${fmt(p.resonance_frequency_ghz, 2)} GHz`, intervalText(state.latestInterface, "resonance_frequency_ghz")),
      metricCard("Return loss", `${fmt(p.return_loss_db, 1)} dB`, intervalText(state.latestInterface, "return_loss_db")),
      metricCard("Insertion loss", `${fmt(p.insertion_loss_db, 2)} dB`, intervalText(state.latestInterface, "insertion_loss_db")),
      metricCard("Yield probability", `${fmt(p.yield_probability * 100, 1)}%`, intervalText(state.latestInterface, "yield_probability")),
    ].join("");
    return;
  }

  const r = state.latestPattern;
  if (!r) {
    $("primaryMetrics").innerHTML = [
      metricCard("Line width", "pending"),
      metricCard("Thickness", "pending"),
      metricCard("Resistance", "pending"),
      metricCard("Quality", "pending"),
    ].join("");
    return;
  }
  const p = r.prediction;
  $("primaryMetrics").innerHTML = [
    metricCard("Line width", `${fmt(p.line_width_um, 1)} um`, intervalText(r, "line_width_um")),
    metricCard("Thickness", `${fmt(p.thickness_um, 2)} um`, intervalText(r, "thickness_um")),
    metricCard("Resistance", `${fmt(p.resistance_ohm, 2)} ohm`, intervalText(r, "resistance_ohm")),
    metricCard("Quality", `${fmt(p.quality_score, 1)}`, intervalText(r, "quality_score")),
  ].join("");
}

function intervalText(result, key) {
  const interval = result.intervals?.[key];
  if (!interval) return "";
  return `q90 ${fmt(interval.low, key.includes("yield") ? 2 : 1)} to ${fmt(interval.high, key.includes("yield") ? 2 : 1)}`;
}

function renderDecisionState() {
  if ((state.mode === "coupon" || state.mode === "dt" || state.mode === "optimizer") && state.latestCoupon) {
    const c = state.latestCoupon;
    const p = c.prediction;
    const d = c.derived;
    const reasons = (c.decision_reasons || []).map((reason) => `<small>${reason}</small>`).join("");
    $("decisionState").innerHTML = `
      <div class="state-row highlight"><span>Qualification decision</span><strong>${c.qualification_decision.replaceAll("_", " ")}</strong>${reasons}</div>
      <div class="state-row"><span>Structure family</span><strong>${c.input.coupon_structure.replaceAll("_", " ")}</strong></div>
      <div class="state-row"><span>Dominant mechanism</span><strong>${c.failure_mode.replaceAll("_", " ")}</strong></div>
      <div class="state-row"><span>RUL / degradation</span><strong>${fmt(d.remaining_useful_life_hours, 0)} h / ${fmt(d.degradation_state_index, 1)}</strong></div>
      <div class="state-row"><span>Sheet / contact drift</span><strong>${fmt(p.sheet_resistance_drift_pct, 1)}% / ${fmt(p.contact_resistance_drift_pct, 1)}%</strong></div>
    `;
    return;
  }

  const pattern = state.latestPattern;
  const iface = state.latestInterface;
  if (!pattern) {
    $("decisionState").innerHTML = `<div class="state-row"><span>Status</span><strong>Awaiting run</strong></div>`;
    return;
  }
  const defect = pattern.defect_class.replace("_", " ");
  const lineError = pattern.derived.line_width_error_pct;
  const quality = pattern.prediction.quality_score;
  const yieldText = iface ? `${fmt(iface.prediction.yield_probability * 100, 1)}%` : "pending";
  $("decisionState").innerHTML = `
    <div class="state-row"><span>Dominant defect state</span><strong>${defect}</strong></div>
    <div class="state-row"><span>Width deviation</span><strong>${fmt(lineError, 1)}%</strong></div>
    <div class="state-row"><span>Trace quality</span><strong>${fmt(quality, 1)} / 100</strong></div>
    <div class="state-row"><span>CPW validation yield</span><strong>${yieldText}</strong></div>
  `;
}

function renderDefectBars() {
  const probs = state.latestPattern?.defect_probabilities;
  if (!probs) {
    $("defectBars").innerHTML = "";
    return;
  }
  const rows = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  $("defectBars").innerHTML = rows
    .map(([label, value]) => {
      const pct = Math.round(value * 100);
      const warn = label !== "nominal" && pct > 12 ? "warn" : "";
      const name = label.replace("_", " ");
      return `
        <div class="bar-row">
          <span class="bar-label" title="${name}">${name}</span>
          <span class="bar-track"><span class="bar-fill ${warn}" style="width:${pct}%"></span></span>
          <span class="bar-value">${pct}%</span>
        </div>
      `;
    })
    .join("");
}

function renderFailureBars() {
  const probs = state.latestCoupon?.failure_probabilities;
  if (!probs) {
    $("failureBars").innerHTML = "";
    return;
  }
  const rows = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  $("failureBars").innerHTML = rows
    .map(([label, value]) => {
      const pct = Math.round(value * 100);
      const warn = label !== "pass" && pct > 14 ? "warn" : "";
      const name = label.replace("_", " ");
      return `
        <div class="bar-row">
          <span class="bar-label" title="${name}">${name}</span>
          <span class="bar-track"><span class="bar-fill ${warn}" style="width:${pct}%"></span></span>
          <span class="bar-value">${pct}%</span>
        </div>
      `;
    })
    .join("");
}

function renderBenchmarks() {
  const metrics = state.meta.metrics;
  if (!metrics?.benchmarks) {
    $("benchmarkBars").innerHTML = "";
    return;
  }
  const source = state.mode === "interface"
    ? (metrics.benchmarks.cpw_validation || metrics.benchmarks["interface_" + "rf"])
    : ["coupon", "dt", "optimizer"].includes(state.mode)
      ? metrics.benchmarks.coupon_reliability
      : metrics.benchmarks.pattern_trace;
  const entries = Object.entries(source).sort((a, b) => b[1].r2_mean - a[1].r2_mean);
  $("benchmarkBars").innerHTML = entries
    .map(([name, item]) => {
      const width = Math.max(4, Math.min(100, item.r2_mean * 100));
      return `
        <div class="bar-row">
          <span class="bar-label" title="${name}">${name}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
          <span class="bar-value">${fmt(item.r2_mean, 2)}</span>
        </div>
      `;
    })
    .join("");
}

function renderOptimizer() {
  const opt = state.latestOptimizer;
  if (!opt || !opt.top?.length) {
    $("optimizerList").innerHTML = "";
    return;
  }
  $("optimizerList").innerHTML = opt.top
    .map((item, index) => {
      if (item.condition) {
        const c = item.condition;
        return `
          <div class="optimizer-item">
            <strong>#${index + 1} - ${item.predicted_decision.replaceAll("_", " ")} - ${item.top_failure_mode.replaceAll("_", " ")}</strong>
            <span>${item.coupon_structure.replaceAll("_", " ")}, ${item.ink_family.replaceAll("_", " ")}, ${fmt(c.aging_temp_c, 0)} C for ${fmt(c.aging_hours, 0)} h, ${fmt(c.thermal_cycles, 0)} cycles, void ${fmt(c.ct_void_fraction_pct, 1)}%</span>
          </div>
        `;
      }
      const s = item.settings;
      const p = item.prediction;
      return `
        <div class="optimizer-item">
          <strong>#${index + 1} - score ${fmt(item.score, 1)} - nominal ${fmt(item.nominal_probability * 100, 0)}%</strong>
          <span>${fmt(s.atomizer_voltage_v, 1)} V atomizer, ${fmt(s.carrier_flow_sccm, 1)} / ${fmt(s.sheath_flow_sccm, 1)} sccm flow, ${fmt(s.print_speed_mm_s, 1)} mm/s, ${fmt(p.line_width_um, 1)} um line</span>
        </div>
      `;
    })
    .join("");
}

function renderDtFeedback() {
  const dt = state.latestDt;
  if (!dt) {
    $("dtFeedback").innerHTML = "";
    return;
  }
  const actions = dt.actions.map((a) => `<div class="optimizer-item"><strong>Action</strong><span>${a}</span></div>`).join("");
  const recipes = dt.top
    .slice(0, 3)
    .map((item, index) => {
      const s = item.settings;
      return `
        <div class="optimizer-item">
          <strong>#${index + 1} - ${item.qualification_decision.replaceAll("_", " ")} - reliability +${fmt(item.improvement.reliability_score, 1)}</strong>
          <span>${fmt(s.atomizer_voltage_v, 1)} V, ${fmt(s.carrier_flow_sccm, 1)} / ${fmt(s.sheath_flow_sccm, 1)} sccm, cure ${fmt(s.cure_peak_temp_c, 0)} C for ${fmt(s.cure_time_min, 0)} min, void target ${fmt(s.ct_void_fraction_pct, 1)}%</span>
        </div>
      `;
    })
    .join("");
  const experiments = (dt.next_experiments || [])
    .slice(0, 3)
    .map((item) => {
      const c = item.condition;
      return `
        <div class="optimizer-item">
          <strong>Next test ${item.rank} - ${item.predicted_decision.replaceAll("_", " ")}</strong>
          <span>${item.coupon_structure.replaceAll("_", " ")} at ${fmt(c.aging_temp_c, 0)} C, ${fmt(c.thermal_cycles, 0)} cycles, strain ${fmt(c.strain_pct, 2)}%, ${item.why}</span>
        </div>
      `;
    })
    .join("");
  $("dtFeedback").innerHTML = actions + recipes + experiments;
}

function renderSpecimen() {
  const svg = $("specimenSvg");
  const material = materialById($("materialSet").value);
  const activePattern = state.latestPattern;
  const activeInterface = state.latestInterface;
  const spread = activePattern?.derived.overspray_ratio ?? Number($("mistSpread").value) / 100;
  const clog = activePattern?.derived.clog_ratio ?? Number($("clogNarrowing").value) / 100;
  const rough = activePattern?.input.edge_roughness_um ?? 4;
  const color = material.set_id === "ani_alumina" ? "#c8a13a" : "#62686a";
  const glow = Math.min(22, 4 + spread * 30 + rough * 0.25);

  let label = "synthetic printed specimen";
  if (state.mode === "interface") {
    svg.innerHTML = cpwSvg(color, glow, activeInterface);
    const p = activeInterface?.prediction;
    label = p
      ? `Blind X-band CPW validation schematic. Resonance ${fmt(p.resonance_frequency_ghz, 2)} gigahertz, insertion loss ${fmt(p.insertion_loss_db, 2)} decibels, return loss ${fmt(p.return_loss_db, 1)} decibels.`
      : "Blind X-band CPW validation schematic.";
  } else if (state.mode === "coupon" || state.mode === "dt" || state.mode === "optimizer") {
    svg.innerHTML = couponSvg();
    const p = state.latestCoupon?.prediction;
    label = p
      ? `Integrated Zone A and Zone B coupon schematic. Reliability score ${fmt(p.reliability_score, 1)} of 100.`
      : "Integrated Zone A and Zone B coupon schematic.";
  } else {
    const pattern = $("patternType").value;
    if (pattern === "dogbone") svg.innerHTML = dogboneSvg(color, glow, clog);
    else if (pattern === "meander") svg.innerHTML = meanderSvg(color, glow, clog);
    else svg.innerHTML = padSvg(color, glow, spread);
    const p = activePattern?.prediction;
    label = p
      ? `Printed trace schematic. Line width ${fmt(p.line_width_um, 1)} micrometres, quality ${fmt(p.quality_score, 0)} of 100.`
      : "Printed trace schematic.";
  }
  svg.setAttribute("aria-label", label);
}

function couponSvg() {
  const coupon = couponById(activeCouponId(state.mode === "dt" ? "dt" : ""));
  const ink = $("couponInk").value === "high_temp_500c" ? "#c8a13a" : "#62686a";
  const baseline = "#62686a";
  const p = state.latestCoupon?.prediction;
  const score = p ? fmt(p.reliability_score, 1) : "pending";
  const stress = Math.min(1, Number($("agingTemp").value) / 500 + Number($("voidFraction").value) / 30);
  return `
    <defs>
      <linearGradient id="alumina" x1="0" x2="1">
        <stop offset="0" stop-color="#fafafa"/>
        <stop offset="1" stop-color="#eef4e8"/>
      </linearGradient>
      <filter id="stress"><feGaussianBlur stdDeviation="${svgNum(2 + stress * 6, 1)}"/></filter>
    </defs>
    <rect x="28" y="36" width="704" height="340" rx="8" fill="url(#alumina)" stroke="#20333a" stroke-width="2"/>
    <line x1="380" y1="52" x2="380" y2="360" stroke="#8da1a6" stroke-width="2" stroke-dasharray="8 8"/>
    <text x="70" y="76" fill="#1256a0" font-size="17" font-weight="800">Zone A interface structures</text>
    <text x="440" y="76" fill="#267237" font-size="17" font-weight="800">Zone B bonding structures</text>
    <path d="M80 128h160M80 154h160M80 180h160" stroke="${baseline}" stroke-width="8" stroke-linecap="square"/>
    <path d="M80 222h160M80 250h160M80 278h160" stroke="#c8a13a" stroke-width="8" stroke-linecap="square"/>
    <path d="M270 122c68 0 68 32 0 32s-68 32 0 32s68 32 0 32s-68 32 0 32s68 32 0 32" fill="none" stroke="${ink}" stroke-width="10" stroke-linecap="round"/>
    <rect x="318" y="122" width="26" height="26" fill="${baseline}"/><rect x="318" y="172" width="26" height="26" fill="${ink}"/>
    <rect x="318" y="222" width="26" height="26" fill="${baseline}"/><rect x="318" y="272" width="26" height="26" fill="${ink}"/>
    <path d="M420 132h134M420 188h134M420 244h134" stroke="${ink}" stroke-width="9"/>
    <rect x="404" y="118" width="28" height="28" fill="${baseline}"/><rect x="552" y="118" width="28" height="28" fill="${baseline}"/>
    <rect x="404" y="230" width="28" height="28" fill="${ink}"/><rect x="552" y="230" width="28" height="28" fill="${ink}"/>
    <rect x="610" y="114" width="64" height="64" fill="${baseline}"/><rect x="628" y="132" width="28" height="28" fill="${ink}"/>
    <path d="M604 246h54v-24h38v74h-38v-24h-54z" fill="${ink}"/>
    <rect x="52" y="54" width="24" height="24" fill="#6b6f70"/><rect x="684" y="54" width="24" height="24" fill="#6b6f70"/>
    <rect x="52" y="332" width="24" height="24" fill="#6b6f70"/><rect x="684" y="332" width="24" height="24" fill="#6b6f70"/>
    <circle cx="380" cy="54" r="9" fill="none" stroke="#111" stroke-width="2"/><circle cx="380" cy="358" r="9" fill="none" stroke="#111" stroke-width="2"/>
    <rect x="76" y="90" width="615" height="226" fill="#d66b42" opacity="${svgNum(stress * 0.08, 2)}" filter="url(#stress)"/>
    <text x="54" y="396" fill="#20333a" font-size="17" font-weight="800">${coupon.label} - reliability ${score}</text>
  `;
}

function defs(glow) {
  return `
    <defs>
      <filter id="mist"><feGaussianBlur stdDeviation="${svgNum(glow, 1)}"/></filter>
      <linearGradient id="substrate" x1="0" x2="1">
        <stop offset="0" stop-color="#f8ddcc"/>
        <stop offset="1" stop-color="#f6efe3"/>
      </linearGradient>
    </defs>
    <rect x="30" y="36" width="700" height="340" rx="8" fill="url(#substrate)" stroke="#1c5563" stroke-width="3"/>
  `;
}

function padSvg(color, glow, spread) {
  return `
    ${defs(glow)}
    <rect x="172" y="92" width="230" height="230" fill="${color}" opacity="0.18" filter="url(#mist)"/>
    <rect x="186" y="106" width="202" height="202" fill="${color}"/>
    <path d="M490 130h118M490 180h118M490 230h118M490 280h118" stroke="${color}" stroke-width="${16 + spread * 20}" stroke-linecap="round"/>
    <path d="M204 320h166" stroke="#24383a" stroke-width="4" opacity="0.28"/>
    <text x="54" y="70" fill="#0b5f6d" font-size="18" font-weight="700">square pad array</text>
  `;
}

function dogboneSvg(color, glow, clog) {
  const neck = Math.max(22, 54 - clog * 70);
  return `
    ${defs(glow)}
    <path d="M122 158h122v${104}H122zM244 190h116v${neck}H244zM360 158h124v104H360z" fill="${color}" opacity="0.20" filter="url(#mist)"/>
    <path d="M132 168h102v84H132zM234 ${210 - neck / 2}h136v${neck}H234zM370 168h104v84H370z" fill="${color}"/>
    <path d="M535 120c50 28 50 72 0 100s-50 72 0 100" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" opacity="0.74"/>
    <text x="54" y="70" fill="#0b5f6d" font-size="18" font-weight="700">dogbone resistance coupon</text>
  `;
}

function meanderSvg(color, glow, clog) {
  const width = Math.max(8, 17 - clog * 15);
  let path = "M168 116";
  for (let i = 0; i < 7; i += 1) {
    const x = 168 + i * 68;
    const y1 = i % 2 === 0 ? 116 : 296;
    const y2 = i % 2 === 0 ? 296 : 116;
    path += ` L${x} ${y1} Q${x + 34} ${y1} ${x + 34} ${(y1 + y2) / 2} T${x + 68} ${y2}`;
  }
  return `
    ${defs(glow)}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="${width + 24}" opacity="0.16" stroke-linecap="round" filter="url(#mist)"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>
    <rect x="102" y="92" width="46" height="46" fill="${color}"/>
    <rect x="602" y="274" width="46" height="46" fill="${color}"/>
    <text x="54" y="70" fill="#0b5f6d" font-size="18" font-weight="700">meander line pitch coupon</text>
  `;
}

function cpwSvg(color, glow, iface) {
  // Faithful rendition of Figure 5: blind-validation X-band coplanar waveguide.
  // a) top view (ground-signal-ground with GSG RF probes and alignment fiducials)
  // b) cross-section (G S G traces on the alumina substrate).
  const il = iface ? `${fmt(iface.prediction.insertion_loss_db, 2)} dB` : "pending";
  const rl = iface ? `${fmt(iface.prediction.return_loss_db, 1)} dB` : "pending";
  const f0 = iface ? `${fmt(iface.prediction.resonance_frequency_ghz, 2)} GHz` : "pending";
  const yld = iface ? iface.prediction.yield_probability : 1;
  const fid = "#c79a3b";
  // Light degradation cue: low predicted yield darkens/cracks the traces.
  const wear = Math.max(0, Math.min(1, (0.72 - yld) / 0.5));
  const crackOpacity = svgNum(wear * 0.85, 2);
  return `
    <defs>
      <linearGradient id="cpwGold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#e2c062"/>
        <stop offset="0.5" stop-color="#c79a3b"/>
        <stop offset="1" stop-color="#a67d27"/>
      </linearGradient>
      <linearGradient id="cpwSub" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#edeff1"/>
        <stop offset="1" stop-color="#d2d5d8"/>
      </linearGradient>
      <linearGradient id="cpwProbe" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#e2e5e7"/>
        <stop offset="1" stop-color="#c1c5c8"/>
      </linearGradient>
      <marker id="cpwArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 1 L9 5 L0 9 z" fill="#1d2526"/>
      </marker>
    </defs>

    <!-- Panel a) top view -->
    <text x="18" y="34" fill="#1d2526" font-size="16" font-weight="800">a)</text>
    <rect x="44" y="64" width="404" height="320" rx="14" fill="#f5efde" stroke="#cdbf97" stroke-width="2"/>

    <!-- alignment fiducials at the four corners -->
    <rect x="60" y="80" width="26" height="26" rx="3" fill="${fid}"/>
    <rect x="406" y="80" width="26" height="26" rx="3" fill="${fid}"/>
    <rect x="60" y="332" width="26" height="26" rx="3" fill="${fid}"/>
    <rect x="406" y="332" width="26" height="26" rx="3" fill="${fid}"/>

    <!-- conductors: top ground, signal line, bottom ground -->
    <rect x="100" y="126" width="292" height="44" rx="3" fill="url(#cpwGold)"/>
    <rect x="100" y="200" width="292" height="20" rx="3" fill="url(#cpwGold)"/>
    <rect x="100" y="246" width="292" height="58" rx="3" fill="url(#cpwGold)"/>
    <g stroke="#5a3f12" stroke-width="2" opacity="${crackOpacity}">
      <path d="M170 246l14 18M250 304l-12 -20M320 246l16 22"/>
    </g>

    <!-- labels with vertical dashed leader arrows -->
    <text x="140" y="48" fill="#1d2526" font-size="9.5" font-weight="700" text-anchor="middle">Ground Plane (G)</text>
    <line x1="140" y1="54" x2="140" y2="124" stroke="#1d2526" stroke-width="1.2" stroke-dasharray="4 4" marker-end="url(#cpwArrow)"/>
    <text x="246" y="48" fill="#1d2526" font-size="9.5" font-weight="700" text-anchor="middle">Signal Line (S)</text>
    <line x1="246" y1="54" x2="246" y2="198" stroke="#1d2526" stroke-width="1.2" stroke-dasharray="4 4" marker-end="url(#cpwArrow)"/>
    <text x="356" y="48" fill="#1d2526" font-size="9.5" font-weight="700" text-anchor="middle">Ground Plane (G)</text>
    <line x1="356" y1="54" x2="356" y2="124" stroke="#1d2526" stroke-width="1.2" stroke-dasharray="4 4" marker-end="url(#cpwArrow)"/>

    <!-- RF probes (GSG) straddling the signal line on both sides -->
    <g>
      <ellipse cx="14" cy="210" rx="12" ry="17" fill="${fid}"/>
      <rect x="18" y="182" width="44" height="56" rx="6" fill="url(#cpwProbe)" stroke="#a9adb0" stroke-width="1.5"/>
      <rect x="36" y="186" width="10" height="48" rx="2" fill="#b6babd"/>
      <rect x="62" y="206" width="42" height="8" rx="2" fill="url(#cpwGold)"/>
      <text x="40" y="172" fill="#6a6f72" font-size="10" font-weight="700" text-anchor="middle">RF Probe</text>
      <text x="40" y="182" fill="#9097a0" font-size="8.5" text-anchor="middle">(GSG)</text>
    </g>
    <g>
      <ellipse cx="478" cy="210" rx="12" ry="17" fill="${fid}"/>
      <rect x="430" y="182" width="44" height="56" rx="6" fill="url(#cpwProbe)" stroke="#a9adb0" stroke-width="1.5"/>
      <rect x="446" y="186" width="10" height="48" rx="2" fill="#b6babd"/>
      <rect x="388" y="206" width="42" height="8" rx="2" fill="url(#cpwGold)"/>
      <text x="452" y="172" fill="#6a6f72" font-size="10" font-weight="700" text-anchor="middle">RF Probe</text>
      <text x="452" y="182" fill="#9097a0" font-size="8.5" text-anchor="middle">(GSG)</text>
    </g>

    <!-- alignment fiducials caption with span arrow reaching the bottom fiducials -->
    <line x1="73" y1="363" x2="419" y2="363" stroke="#1d2526" stroke-width="1.6" marker-start="url(#cpwArrow)" marker-end="url(#cpwArrow)"/>
    <rect x="188" y="354" width="116" height="18" fill="#f5efde"/>
    <text x="246" y="368" fill="#1d2526" font-size="11.5" font-weight="700" text-anchor="middle">Alignment Fiducials</text>

    <!-- Panel b) cross-section -->
    <text x="466" y="34" fill="#1d2526" font-size="16" font-weight="800">b)</text>
    <rect x="494" y="64" width="254" height="276" rx="14" fill="#ffffff" stroke="#d9dfda" stroke-width="2"/>
    <text x="621" y="108" fill="#1256a0" font-size="15" font-weight="800" text-anchor="middle">Cross-Section (Side View)</text>

    <!-- G S G dimension arrows -->
    <text x="551" y="156" fill="#1d2526" font-size="15" font-weight="800" text-anchor="middle">G</text>
    <line x1="518" y1="172" x2="584" y2="172" stroke="#1d2526" stroke-width="1.6" marker-start="url(#cpwArrow)" marker-end="url(#cpwArrow)"/>
    <text x="621" y="156" fill="#1d2526" font-size="15" font-weight="800" text-anchor="middle">S</text>
    <line x1="601" y1="172" x2="641" y2="172" stroke="#1d2526" stroke-width="1.6" marker-start="url(#cpwArrow)" marker-end="url(#cpwArrow)"/>
    <text x="691" y="156" fill="#1d2526" font-size="15" font-weight="800" text-anchor="middle">G</text>
    <line x1="658" y1="172" x2="724" y2="172" stroke="#1d2526" stroke-width="1.6" marker-start="url(#cpwArrow)" marker-end="url(#cpwArrow)"/>

    <!-- traces sitting on the alumina substrate -->
    <rect x="518" y="186" width="66" height="13" rx="2" fill="url(#cpwGold)"/>
    <rect x="601" y="186" width="40" height="13" rx="2" fill="url(#cpwGold)"/>
    <rect x="658" y="186" width="66" height="13" rx="2" fill="url(#cpwGold)"/>
    <rect x="506" y="199" width="236" height="78" rx="4" fill="url(#cpwSub)" stroke="#a9adb0" stroke-width="1.5"/>
    <text x="621" y="244" fill="#3a4042" font-size="14" font-weight="700" text-anchor="middle">Alumina Substrate</text>

    <!-- live blind-validation readout -->
    <text x="621" y="312" fill="#0b5f6d" font-size="12" font-weight="700" text-anchor="middle">Blind X-band CPW (held out)</text>
    <text x="621" y="330" fill="#5b6764" font-size="11" text-anchor="middle">f0 ${f0} · S21 ${il} · S11 ${rl}</text>
  `;
}

function renderDatasetBadge() {
  const rows = state.meta.metrics?.synthetic_rows;
  $("datasetBadge").textContent = rows ? `${rows.total.toLocaleString()} synthetic rows` : "artifact missing";
}

function renderModeHint() {
  setText("modeHint", MODE_HINTS[state.mode] || "");
}

function renderInsightVisibility() {
  const visible = new Set(INSIGHT_VISIBILITY[state.mode] || INSIGHT_BLOCKS);
  INSIGHT_BLOCKS.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !visible.has(id);
  });
}

function renderMethodology() {
  const m = state.meta;
  if (!m) return;
  const project = m.project || {};
  setText("hypothesis", project.hypothesis ? `Working hypothesis: ${project.hypothesis}` : "");
  setText("honestyNote", project.honesty_note || "");

  $("methodPipeline").innerHTML = (m.pipeline_stages || [])
    .map(
      (stage, index) => `
        <div class="pipeline-step">
          <span class="step-index">${index + 1}</span>
          <strong>${stage.stage}</strong>
          <span>${stage.detail}</span>
        </div>
      `,
    )
    .join("");

  $("innovationList").innerHTML = (m.innovations || [])
    .map((item) => `<li><strong>${item.title}</strong><span>${item.detail}</span></li>`)
    .join("");

  $("regimeList").innerHTML = (m.temperature_regimes || [])
    .map(
      (regime) => `
        <div class="regime-item">
          <div class="regime-top"><strong>${regime.regime}</strong><span class="regime-range">${regime.range}</span></div>
          <span>${regime.inks} &middot; ${regime.objective}</span>
        </div>
      `,
    )
    .join("");

  const targetBody = document.querySelector("#targetTable tbody");
  if (targetBody) {
    targetBody.innerHTML = (m.performance_targets || [])
      .map(
        (target) =>
          `<tr><td>${target.parameter}</td><td>${target.benchmark}</td><td><strong>${target.target}</strong></td></tr>`,
      )
      .join("");
  }

  $("standardList").innerHTML = (m.standards || []).map((standard) => `<li>${standard}</li>`).join("");

  $("referenceList").innerHTML = (m.references || [])
    .map((ref) => `<li><strong>${ref.authors} (${ref.year}).</strong> ${ref.title}. <em>${ref.venue}</em>.</li>`)
    .join("");

  $("siteFooter").innerHTML = `
    <div class="footer-lead"><strong>${project.name || "BOND-AI"}</strong> &mdash; ${project.subtitle || ""}</div>
    <div class="footer-meta">
      <span>${project.topic || ""}</span>
      <span>${project.lead || ""}</span>
      <span>${project.duration || ""}</span>
    </div>
    <div class="footer-partners">${(project.partners || []).map((partner) => `<span>${partner}</span>`).join("")}</div>
  `;
}

function renderAll() {
  if (!state.meta) return;
  syncLabels();
  renderModeHint();
  renderMaterialStack();
  renderDatasetBadge();
  renderSpecimen();
  renderMetrics();
  renderDecisionState();
  renderDefectBars();
  renderFailureBars();
  renderBenchmarks();
  renderOptimizer();
  renderDtFeedback();
  renderInsightVisibility();
}

function bindEvents() {
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  document.querySelectorAll(".zoom-btn").forEach((button) => {
    button.addEventListener("click", () => bumpZoom(button.dataset.zoom, Number(button.dataset.dir)));
  });
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  const toggle = document.querySelector(".mode-toggle");
  toggle.addEventListener("keydown", (event) => {
    const navKeys = ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!navKeys.includes(event.key)) return;
    event.preventDefault();
    const buttons = [...toggle.querySelectorAll(".mode-button")];
    const current = buttons.findIndex((b) => b.dataset.mode === state.mode);
    let next = current < 0 ? 0 : current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % buttons.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    setMode(buttons[next].dataset.mode);
    buttons[next].focus();
  });
  document.querySelectorAll("input, select").forEach((input) => {
    input.addEventListener("input", () => {
      syncLabels();
      renderSpecimen();
    });
  });
  $("materialSet").addEventListener("change", renderMaterialStack);
  $("patternType").addEventListener("change", applyPatternDefaults);
  $("deviceType").addEventListener("change", applyDeviceDefaults);
  ["analysisZone", "zoneAStructure", "zoneBStructure"].forEach((id) => {
    $(id).addEventListener("change", () => {
      syncCouponSelectors("");
      renderSpecimen();
    });
  });
  ["dtAnalysisZone", "dtZoneAStructure", "dtZoneBStructure"].forEach((id) => {
    $(id).addEventListener("change", () => {
      syncCouponSelectors("dt");
      renderSpecimen();
    });
  });
  $("runPattern").addEventListener("click", () => runPattern().catch(showError));
  $("runInterface").addEventListener("click", () => runInterface().catch(showError));
  $("runOptimizer").addEventListener("click", () => runOptimizer().catch(showError));
  $("runCoupon").addEventListener("click", () => runCoupon().catch(showError));
  $("runDt").addEventListener("click", () => runDt().catch(showError));
}

function showError(error) {
  console.error(error);
  $("decisionState").innerHTML = `<div class="state-row"><span>Error</span><strong>${String(error.message || error).slice(0, 220)}</strong></div>`;
}

async function boot() {
  const health = await fetch("/api/health").then((r) => r.json());
  $("healthDot").classList.toggle("ok", Boolean(health.ok));
  $("healthText").textContent = health.ok ? "Models loaded" : "Training artifacts missing";
  state.meta = await fetch("/api/metadata").then((r) => r.json());
  populateControls();
  renderMethodology();
  bindEvents();
  ZOOM_PANELS.forEach(applyZoom);
  setView("dashboard");
  await runPattern();
  await runCoupon(false);
  renderAll();
}

boot().catch(showError);
