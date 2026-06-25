const state = {
  meta: null,
  mode: "pattern",
  latestPattern: null,
  latestInterface: null,
  latestOptimizer: null,
};

const $ = (id) => document.getElementById(id);

const fmt = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
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

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  document.querySelectorAll(".mode-pane").forEach((pane) => {
    pane.classList.toggle("active", pane.id === `pane-${mode}`);
  });
  $("specimenTitle").textContent =
    mode === "pattern" ? "Pattern model" : mode === "interface" ? "RF interface model" : "Process optimizer";
  renderAll();
}

function populateControls() {
  const materialSelect = $("materialSet");
  materialSelect.innerHTML = state.meta.material_sets
    .map((m) => `<option value="${m.set_id}">${m.label} · ${m.stack}</option>`)
    .join("");

  $("patternType").innerHTML = state.meta.pattern_types.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
  $("deviceType").innerHTML = state.meta.device_types.map((d) => `<option value="${d.id}">${d.label}</option>`).join("");

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

  syncLabels();
  renderMaterialStack();
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
}

function renderMaterialStack() {
  const material = materialById($("materialSet").value);
  const colors = ["#0b7285", "#b85032", "#2d7d46"];
  $("materialStack").innerHTML = `
    <span class="swatch" style="background:${colors[0]}"></span>
    <span class="stack-line"><strong>${material.ink}</strong>Conductive ink</span>
    <span class="swatch" style="background:${colors[1]}"></span>
    <span class="stack-line"><strong>${material.substrate}</strong>Substrate or dielectric stack</span>
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
  const payload = buildPatternPayload();
  payload.candidates = Number($("candidateCount").value);
  state.latestOptimizer = await postJson("/api/optimize", payload);
  renderAll();
}

function metricCard(label, value, sub = "") {
  return `<div class="metric-card"><span>${label}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ""}</div>`;
}

function renderMetrics() {
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
    <div class="state-row"><span>RF yield estimate</span><strong>${yieldText}</strong></div>
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
      return `
        <div class="bar-row">
          <span class="bar-label">${label.replace("_", " ")}</span>
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
  const source = state.mode === "interface" ? metrics.benchmarks.interface_rf : metrics.benchmarks.pattern_trace;
  const entries = Object.entries(source).sort((a, b) => b[1].r2_mean - a[1].r2_mean);
  $("benchmarkBars").innerHTML = entries
    .map(([name, item]) => {
      const width = Math.max(4, Math.min(100, item.r2_mean * 100));
      return `
        <div class="bar-row">
          <span class="bar-label">${name}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
          <span class="bar-value">${fmt(item.r2_mean, 2)}</span>
        </div>
      `;
    })
    .join("");
}

function renderOptimizer() {
  const opt = state.latestOptimizer;
  if (!opt) {
    $("optimizerList").innerHTML = "";
    return;
  }
  $("optimizerList").innerHTML = opt.top
    .map((item, index) => {
      const s = item.settings;
      const p = item.prediction;
      return `
        <div class="optimizer-item">
          <strong>#${index + 1} · score ${fmt(item.score, 1)} · nominal ${fmt(item.nominal_probability * 100, 0)}%</strong>
          <span>${fmt(s.atomizer_voltage_v, 1)} V atomizer, ${fmt(s.carrier_flow_sccm, 1)} / ${fmt(s.sheath_flow_sccm, 1)} sccm flow, ${fmt(s.print_speed_mm_s, 1)} mm/s, ${fmt(p.line_width_um, 1)} um line</span>
        </div>
      `;
    })
    .join("");
}

function renderSpecimen() {
  const svg = $("specimenSvg");
  const material = materialById($("materialSet").value);
  const activePattern = state.latestPattern;
  const activeInterface = state.latestInterface;
  const spread = activePattern?.derived.overspray_ratio ?? Number($("mistSpread").value) / 100;
  const clog = activePattern?.derived.clog_ratio ?? Number($("clogNarrowing").value) / 100;
  const rough = activePattern?.input.edge_roughness_um ?? 4;
  const color = material.ink.includes("Electroninks") ? "#646a6b" : "#747b76";
  const glow = Math.min(22, 4 + spread * 30 + rough * 0.25);

  if (state.mode === "interface") {
    const device = deviceById($("deviceType").value);
    svg.innerHTML = device.id === "cpw" ? cpwSvg(color, glow, activeInterface) : patchSvg(color, glow, activeInterface);
  } else {
    const pattern = $("patternType").value;
    if (pattern === "dogbone") svg.innerHTML = dogboneSvg(color, glow, clog);
    else if (pattern === "meander") svg.innerHTML = meanderSvg(color, glow, clog);
    else svg.innerHTML = padSvg(color, glow, spread);
  }
}

function defs(glow) {
  return `
    <defs>
      <filter id="mist"><feGaussianBlur stdDeviation="${fmt(glow, 1)}"/></filter>
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

function patchSvg(color, glow, iface) {
  const res = iface ? `${fmt(iface.prediction.resonance_frequency_ghz, 2)} GHz` : "pending";
  return `
    ${defs(glow)}
    <path d="M190 102h216v170h-76v92h-64v-92h-76z" fill="${color}" opacity="0.18" filter="url(#mist)"/>
    <path d="M204 116h188v142h-74v92h-38v-92h-76z" fill="${color}"/>
    <path d="M470 146h170M470 208h170M470 270h170" stroke="#29484f" stroke-width="22" opacity="0.22"/>
    <path d="M470 146h170M470 208h170M470 270h170" stroke="${color}" stroke-width="8"/>
    <text x="54" y="70" fill="#0b5f6d" font-size="18" font-weight="700">X-band patch antenna · ${res}</text>
  `;
}

function cpwSvg(color, glow, iface) {
  const loss = iface ? `${fmt(iface.prediction.insertion_loss_db, 2)} dB` : "pending";
  return `
    ${defs(glow)}
    <path d="M120 170h520M120 250h520" stroke="${color}" stroke-width="34" opacity="0.18" filter="url(#mist)"/>
    <path d="M120 170h520M120 250h520" stroke="${color}" stroke-width="16" stroke-linecap="round"/>
    <path d="M120 210h520" stroke="${color}" stroke-width="24" stroke-linecap="round"/>
    <path d="M92 124h44v172H92zM624 124h44v172h-44z" fill="${color}"/>
    <text x="54" y="70" fill="#0b5f6d" font-size="18" font-weight="700">coplanar waveguide · ${loss}</text>
  `;
}

function renderDatasetBadge() {
  const rows = state.meta.metrics?.synthetic_rows;
  $("datasetBadge").textContent = rows ? `${rows.total.toLocaleString()} synthetic rows trained` : "Model artifact missing";
}

function renderAll() {
  if (!state.meta) return;
  syncLabels();
  renderMaterialStack();
  renderDatasetBadge();
  renderSpecimen();
  renderMetrics();
  renderDecisionState();
  renderDefectBars();
  renderBenchmarks();
  renderOptimizer();
}

function bindEvents() {
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
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
  $("runPattern").addEventListener("click", () => runPattern().catch(showError));
  $("runInterface").addEventListener("click", () => runInterface().catch(showError));
  $("runOptimizer").addEventListener("click", () => runOptimizer().catch(showError));
}

function showError(error) {
  $("decisionState").innerHTML = `<div class="state-row"><span>Error</span><strong>${String(error.message || error).slice(0, 220)}</strong></div>`;
}

async function boot() {
  const health = await fetch("/api/health").then((r) => r.json());
  $("healthDot").classList.toggle("ok", Boolean(health.ok));
  $("healthText").textContent = health.ok ? "Models loaded" : "Training artifacts missing";
  state.meta = await fetch("/api/metadata").then((r) => r.json());
  populateControls();
  bindEvents();
  await runPattern();
  await runOptimizer();
  renderAll();
}

boot().catch(showError);
