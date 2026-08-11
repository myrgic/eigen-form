/* =====================================================================
   src/panel/render.js — renderPanel(store, container, opts?): the
   generated control surface. docs/params-panel-design.md's contract:
   the panel library renders every store the same way, themed entirely
   by CSS custom properties (src/panel/tokens.css + src/panel/panel.css,
   scoped under .ef-panel). This file is the renderer half of the
   store/renderer split — src/params/define.js is pure state with no
   DOM; this file is the only place that ever calls
   document.createElement for a panel. No DOM globals beyond the
   `container` argument and document.createElement (no document.body,
   no querySelectorAll, no globals reached for beyond that).

   renderPanel(store, container, opts) -> { destroy(), refresh() }

   opts.gauges: [{ label, group, read: () => value }] — read-only rows,
   same visual family as knobs, rendered alongside them by group.
   refresh() re-invokes every gauge's read() and updates its readout;
   nothing here polls on its own, a consumer calls refresh() when it
   has something new to show (an animation frame, a run completing).

   Three control classes, per the design doc:
     - Knobs: number/angle (slider + live mono readout, scale-aware via
       store.sliderToValue/valueToSlider), boolean (checkbox), select
       (<select>).
     - Gauges: opts.gauges, read-only, refreshed on demand.
     - Locks: any key with store.locked(key) === true renders display-
       only — its declared value and a lock glyph, no input element at
       all. This is the design doc's rule stated plainly: the panel
       will not render a writable control for a declared value.

   The panel subscribes to the store so every readout (and every
   control's own position/state) stays live for changes made from
   anywhere, not only through this panel's own inputs. destroy()
   unsubscribes and empties the container.
   ===================================================================== */

// Slider fraction resolution: every number/angle knob is backed by a
// <input type="range" min=0 max=1>, however its value maps into real
// units via the store's own scale (linear/log/log-complement) — the
// fine step here is slider granularity, not the parameter's own `step`
// (which only shapes the readout's decimal precision, see
// stepDecimals()).
const SLIDER_STEP = 0.001;

function stepDecimals(step) {
  if (step == null || !isFinite(step) || step <= 0) return null;
  const s = String(step);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

function trimmedNumber(value) {
  return Number(value.toFixed(4)).toString();
}

function unitSuffix(unit) {
  if (!unit) return '';
  return unit === 'deg' ? '°' : unit;
}

function formatKnobValue(def, value) {
  if (def.type === 'boolean') return value ? 'on' : 'off';
  if (def.type === 'select') return String(value);
  if (def.type === 'number' || def.type === 'angle') {
    const decimals = stepDecimals(def.step);
    const body = decimals != null ? value.toFixed(decimals) : trimmedNumber(value);
    return body + unitSuffix(def.unit);
  }
  return String(value);
}

function renderPanel(store, container, opts) {
  opts = opts || {};
  const gauges = Array.isArray(opts.gauges) ? opts.gauges : [];

  container.classList.add('ef-panel');

  // key -> { def, readoutEl, inputEl?, locked }
  const controls = {};
  // [{ gauge, readoutEl }]
  const gaugeEls = [];

  // Ordered groups: Map<groupName, Array<{kind, ...}>>, insertion order
  // = first-appearance order across the schema, then across gauges —
  // "renders groups (small-caps headers)" per schema declaration order,
  // no alphabetizing, no re-sorting.
  const groups = new Map();
  function group(name) {
    if (!groups.has(name)) groups.set(name, []);
    return groups.get(name);
  }

  for (const [key, def] of Object.entries(store.schema)) {
    group(def.group || '').push({ kind: 'param', key });
  }
  for (const gauge of gauges) {
    group(gauge.group || '').push({ kind: 'gauge', gauge });
  }

  function buildLockedRow(key, def) {
    const row = document.createElement('div');
    row.className = 'ef-locked';

    const label = document.createElement('span');
    label.className = 'ef-label';
    label.textContent = def.label || key;

    const valueEl = document.createElement('span');
    valueEl.className = 'ef-lock-value';
    valueEl.textContent = formatKnobValue(def, store.get(key));

    const glyph = document.createElement('span');
    glyph.className = 'ef-lock-glyph';
    glyph.textContent = '\u{1F512}'; // lock glyph — display-only rows never carry a control

    row.appendChild(label);
    row.appendChild(valueEl);
    row.appendChild(glyph);

    controls[key] = { def, readoutEl: valueEl, locked: true };
    return row;
  }

  function buildKnobRow(key, def) {
    const row = document.createElement('div');
    row.className = 'ef-row';

    const head = document.createElement('div');
    head.className = 'ef-row-head';
    const label = document.createElement('span');
    label.className = 'ef-label';
    label.textContent = def.label || key;
    const readout = document.createElement('span');
    readout.className = 'ef-readout';
    readout.textContent = formatKnobValue(def, store.get(key));
    head.appendChild(label);
    head.appendChild(readout);
    row.appendChild(head);

    let inputEl = null;

    if (def.type === 'number' || def.type === 'angle') {
      inputEl = document.createElement('input');
      inputEl.type = 'range';
      inputEl.min = '0';
      inputEl.max = '1';
      inputEl.step = String(SLIDER_STEP);
      inputEl.value = String(store.valueToSlider(key, store.get(key)));
      inputEl.addEventListener('input', () => {
        const t = parseFloat(inputEl.value);
        store.set(key, store.sliderToValue(key, t));
      });
      row.appendChild(inputEl);
    } else if (def.type === 'boolean') {
      const wrap = document.createElement('label');
      wrap.className = 'ef-checkbox-row';
      inputEl = document.createElement('input');
      inputEl.type = 'checkbox';
      inputEl.checked = !!store.get(key);
      inputEl.addEventListener('change', () => {
        store.set(key, inputEl.checked);
      });
      wrap.appendChild(inputEl);
      row.appendChild(wrap);
    } else if (def.type === 'select') {
      inputEl = document.createElement('select');
      for (const opt of def.options) {
        const optionEl = document.createElement('option');
        optionEl.value = opt;
        optionEl.textContent = opt;
        inputEl.appendChild(optionEl);
      }
      inputEl.value = store.get(key);
      inputEl.addEventListener('change', () => {
        store.set(key, inputEl.value);
      });
      row.appendChild(inputEl);
    }

    controls[key] = { def, inputEl, readoutEl: readout, locked: false };
    return row;
  }

  function buildGaugeRow(gauge) {
    const row = document.createElement('div');
    row.className = 'ef-row ef-gauge';

    const head = document.createElement('div');
    head.className = 'ef-row-head';
    const label = document.createElement('span');
    label.className = 'ef-label';
    label.textContent = gauge.label;
    const readout = document.createElement('span');
    readout.className = 'ef-readout';
    readout.textContent = String(gauge.read());
    head.appendChild(label);
    head.appendChild(readout);
    row.appendChild(head);

    gaugeEls.push({ gauge, readoutEl: readout });
    return row;
  }

  for (const [groupName, items] of groups) {
    const grpEl = document.createElement('div');
    grpEl.className = 'grp';
    if (groupName) {
      const hd = document.createElement('div');
      hd.className = 'hd';
      hd.textContent = groupName;
      grpEl.appendChild(hd);
    }
    for (const item of items) {
      if (item.kind === 'param') {
        const def = store.schema[item.key];
        grpEl.appendChild(
          store.locked(item.key) ? buildLockedRow(item.key, def) : buildKnobRow(item.key, def)
        );
      } else {
        grpEl.appendChild(buildGaugeRow(item.gauge));
      }
    }
    container.appendChild(grpEl);
  }

  // Keep every readout (and, for externally-driven changes, every
  // control's own displayed state) live — this panel is not the only
  // possible writer to the store.
  const unsubscribe = store.subscribe((key, value) => {
    const c = controls[key];
    if (!c) return;
    c.readoutEl.textContent = formatKnobValue(c.def, value);
    if (c.locked || !c.inputEl) return;
    if (c.def.type === 'number' || c.def.type === 'angle') {
      c.inputEl.value = String(store.valueToSlider(key, value));
    } else if (c.def.type === 'boolean') {
      c.inputEl.checked = !!value;
    } else if (c.def.type === 'select') {
      c.inputEl.value = value;
    }
  });

  return {
    destroy() {
      unsubscribe();
      container.classList.remove('ef-panel');
      container.innerHTML = '';
    },
    refresh() {
      for (const g of gaugeEls) {
        g.readoutEl.textContent = String(g.gauge.read());
      }
    }
  };
}

export { renderPanel };
export default { renderPanel };
