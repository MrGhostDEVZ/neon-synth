/* NEÓN — interfaz, teclado, presets, MIDI y grabación. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const engine = new window.SynthEngine();
  const viz = new window.Visualizer($('viz'), engine);

  const WAVES = ['sine', 'triangle', 'sawtooth', 'square'];
  const WAVE_LABELS = { sine: 'Seno', triangle: 'Triángulo', sawtooth: 'Sierra', square: 'Cuadrada' };
  const ARP_MODES = ['up', 'down', 'updown', 'random'];
  const ARP_LABELS = { up: 'Ascendente', down: 'Descendente', updown: 'Sube y baja', random: 'Aleatorio' };
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const BLACK = [1, 3, 6, 8, 10];

  const noteLabel = (note) => NOTE_NAMES[((note % 12) + 12) % 12] + (Math.floor(note / 12) - 1);
  const isBlack = (note) => BLACK.indexOf(((note % 12) + 12) % 12) !== -1;

  /* ----------------------------------------------------------- definición UI */

  const SECTIONS = [
    {
      title: 'Osciladores',
      controls: [
        { key: 'wave1', type: 'select', label: 'Onda 1', options: WAVES, labels: WAVE_LABELS },
        { key: 'wave2', type: 'select', label: 'Onda 2', options: WAVES, labels: WAVE_LABELS },
        { key: 'osc2Gain', type: 'range', label: 'Mezcla de la 2', min: 0, max: 1, step: 0.01, decimals: 2 },
        { key: 'detune', type: 'range', label: 'Detune', min: 0, max: 50, step: 1, unit: ' ¢' },
        { key: 'sub', type: 'range', label: 'Sub (octava abajo)', min: 0, max: 1, step: 0.01, decimals: 2 }
      ]
    },
    {
      title: 'Envolvente',
      controls: [
        { key: 'attack', type: 'range', label: 'Ataque', min: 0.003, max: 2, step: 0.001, unit: ' s', decimals: 3 },
        { key: 'decay', type: 'range', label: 'Decaimiento', min: 0.01, max: 2, step: 0.01, unit: ' s', decimals: 2 },
        { key: 'sustain', type: 'range', label: 'Sostén', min: 0, max: 1, step: 0.01, decimals: 2 },
        { key: 'release', type: 'range', label: 'Liberación', min: 0.02, max: 4, step: 0.01, unit: ' s', decimals: 2 }
      ]
    },
    {
      title: 'Filtro',
      controls: [
        { key: 'cutoff', type: 'range', label: 'Corte', min: 80, max: 12000, step: 10, unit: ' Hz' },
        { key: 'resonance', type: 'range', label: 'Resonancia', min: 0.1, max: 24, step: 0.1, decimals: 1 },
        { key: 'filterEnv', type: 'range', label: 'Envolvente de corte', min: 0, max: 8000, step: 50, unit: ' Hz' }
      ]
    },
    {
      title: 'LFO',
      controls: [
        { key: 'lfoRate', type: 'range', label: 'Velocidad', min: 0.05, max: 20, step: 0.05, unit: ' Hz', decimals: 2 },
        { key: 'lfoFilter', type: 'range', label: '→ Filtro', min: 0, max: 4000, step: 10, unit: ' Hz' },
        { key: 'lfoPitch', type: 'range', label: '→ Tono', min: 0, max: 60, step: 1, unit: ' ¢' }
      ]
    },
    {
      title: 'Efectos',
      controls: [
        { key: 'drive', type: 'range', label: 'Saturación', min: 0, max: 1, step: 0.01, decimals: 2 },
        { key: 'delayTime', type: 'range', label: 'Delay', min: 0.02, max: 0.9, step: 0.01, unit: ' s', decimals: 2 },
        { key: 'delayFeedback', type: 'range', label: 'Retroalimentación', min: 0, max: 0.85, step: 0.01, decimals: 2 },
        { key: 'delayMix', type: 'range', label: 'Mezcla delay', min: 0, max: 0.8, step: 0.01, decimals: 2 },
        { key: 'reverbSize', type: 'range', label: 'Tamaño reverb', min: 0.4, max: 6, step: 0.1, unit: ' s', decimals: 1 },
        { key: 'reverbMix', type: 'range', label: 'Mezcla reverb', min: 0, max: 0.9, step: 0.01, decimals: 2 }
      ]
    },
    {
      title: 'Arpegiador',
      controls: [
        {
          type: 'range', label: 'Tempo', min: 40, max: 200, step: 1, unit: ' bpm',
          get: () => engine.arp.bpm,
          apply: (v) => { engine.arp.bpm = v; }
        },
        {
          type: 'select', label: 'Patrón', options: ARP_MODES, labels: ARP_LABELS,
          get: () => engine.arp.mode,
          apply: (v) => { engine.arp.mode = v; engine.arp.index = 0; }
        },
        {
          type: 'range', label: 'Puerta', min: 0.1, max: 1, step: 0.01, decimals: 2,
          get: () => engine.arp.gate,
          apply: (v) => { engine.arp.gate = v; }
        }
      ]
    },
    {
      title: 'Salida',
      controls: [
        { key: 'volume', type: 'range', label: 'Volumen', min: 0, max: 1, step: 0.01, decimals: 2 }
      ]
    }
  ];

  const refs = [];

  /* ------------------------------------------------------------- utilidades */

  function formatValue(ctrl, value) {
    const decimals = ctrl.decimals || 0;
    const num = decimals > 0 ? Number(value).toFixed(decimals) : String(Math.round(Number(value)));
    return num + (ctrl.unit || '');
  }

  function valueOf(ctrl) {
    if (ctrl.get) return ctrl.get();
    return engine.params[ctrl.key];
  }

  function applyControl(ctrl, value) {
    if (ctrl.apply) {
      ctrl.apply(value);
      return;
    }
    engine.setParam(ctrl.key, value);
  }

  /* ------------------------------------------------------------ construcción */

  function buildControl(ctrl) {
    const row = document.createElement('div');
    row.className = 'control';

    const label = document.createElement('label');
    label.className = 'control-label';
    const name = document.createElement('span');
    name.textContent = ctrl.label;
    label.appendChild(name);

    if (ctrl.type === 'range') {
      const out = document.createElement('output');
      label.appendChild(out);
      row.appendChild(label);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(ctrl.min);
      input.max = String(ctrl.max);
      input.step = String(ctrl.step);

      const initial = Number(valueOf(ctrl));
      input.value = String(initial);
      out.textContent = formatValue(ctrl, initial);

      input.addEventListener('input', () => {
        const value = Number(input.value);
        out.textContent = formatValue(ctrl, value);
        applyControl(ctrl, value);
      });

      row.appendChild(input);
      refs.push({ ctrl: ctrl, input: input, out: out });
      return row;
    }

    row.appendChild(label);

    const select = document.createElement('select');
    ctrl.options.forEach((option) => {
      const opt = document.createElement('option');
      opt.value = option;
      opt.textContent = (ctrl.labels && ctrl.labels[option]) || option;
      select.appendChild(opt);
    });
    select.value = String(valueOf(ctrl));
    select.addEventListener('change', () => applyControl(ctrl, select.value));

    row.appendChild(select);
    refs.push({ ctrl: ctrl, input: select });
    return row;
  }

  function buildPanel() {
    const wrap = $('sections');
    wrap.innerHTML = '';

    SECTIONS.forEach((section) => {
      const card = document.createElement('section');
      card.className = 'card';

      const title = document.createElement('h2');
      title.textContent = section.title;
      card.appendChild(title);

      const body = document.createElement('div');
      body.className = 'card-body';
      section.controls.forEach((ctrl) => body.appendChild(buildControl(ctrl)));
      card.appendChild(body);

      wrap.appendChild(card);
    });
  }

  function refreshControls() {
    refs.forEach((ref) => {
      const value = String(valueOf(ref.ctrl));
      ref.input.value = value;
      if (ref.out) ref.out.textContent = formatValue(ref.ctrl, Number(value));
    });
  }

  /* ---------------------------------------------------------------- presets */

  function buildPresets() {
    const row = $('preset-row');
    row.innerHTML = '';

    Object.keys(engine.presets).forEach((name, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = name;
      if (i === 0) chip.classList.add('active');

      chip.addEventListener('click', () => {
        row.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        engine.loadPreset(name);
        refreshControls();
      });

      row.appendChild(chip);
    });
  }

  /* ---------------------------------------------------------------- teclado */

  let octave = 3;
  const active = new Set();
  const pointerNotes = new Map();
  const pressed = new Map();

  const startNote = () => (octave + 1) * 12;

  function paintKeys() {
    const keys = $('keyboard').querySelectorAll('.key');
    for (let i = 0; i < keys.length; i++) {
      const note = Number(keys[i].dataset.note);
      keys[i].classList.toggle('active', active.has(note));
    }
  }

  function updateHud() {
    const notes = Array.from(active).sort((a, b) => a - b);
    $('hud-note').textContent = notes.length ? notes.slice(-4).map(noteLabel).join(' ') : '—';
  }

  function buildKeyboard() {
    const kb = $('keyboard');
    kb.innerHTML = '';

    const start = startNote();
    const total = 25;
    const whites = [];
    const blacks = [];

    for (let i = 0; i < total; i++) {
      const note = start + i;
      if (isBlack(note)) blacks.push(note);
      else whites.push(note);
    }

    const whiteWidth = 100 / whites.length;

    whites.forEach((note) => {
      const key = document.createElement('div');
      key.className = 'key white';
      key.dataset.note = String(note);
      key.style.width = whiteWidth + '%';

      if (((note % 12) + 12) % 12 === 0) {
        const label = document.createElement('span');
        label.className = 'key-label';
        label.textContent = noteLabel(note);
        key.appendChild(label);
      }

      kb.appendChild(key);
    });

    blacks.forEach((note) => {
      const ratio = whiteWidth / 100;
      let whitesBefore = 0;
      for (let n = start; n < note; n++) if (!isBlack(n)) whitesBefore++;

      const key = document.createElement('div');
      key.className = 'key black';
      key.dataset.note = String(note);
      key.style.left = whitesBefore * ratio * 100 + '%';
      key.style.width = whiteWidth * 0.62 + '%';
      kb.appendChild(key);
    });

    paintKeys();
  }

  function press(note, velocity) {
    if (!engine.ready) {
      $('status').textContent = 'pulsa “Encender audio” primero';
      return;
    }
    engine.noteOn(note, velocity);
    active.add(note);
    paintKeys();
    updateHud();
  }

  function lift(note) {
    engine.noteOff(note);
    active.delete(note);
    paintKeys();
    updateHud();
  }

  function panic() {
    engine.allNotesOff();
    pointerNotes.clear();
    pressed.clear();
    active.clear();
    paintKeys();
    updateHud();
  }

  function shiftOctave(delta) {
    const next = clamp(octave + delta, 1, 6);
    if (next === octave) return;
    octave = next;
    $('octave-label').textContent = String(octave);
    panic();
    buildKeyboard();
  }

  /* puntero */
  const kbEl = $('keyboard');

  kbEl.addEventListener('pointerdown', (event) => {
    const key = event.target.closest('.key');
    if (!key) return;
    event.preventDefault();
    const note = Number(key.dataset.note);
    pointerNotes.set(event.pointerId, note);
    press(note, 0.92);
  });

  function pointerRelease(event) {
    const note = pointerNotes.get(event.pointerId);
    if (note === undefined) return;
    pointerNotes.delete(event.pointerId);
    lift(note);
  }

  window.addEventListener('pointerup', pointerRelease);
  window.addEventListener('pointercancel', pointerRelease);

  /* teclado de la computadora */
  const KEY_MAP = {
    z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
    ',': 12, l: 13, '.': 14, ';': 15, '/': 16,
    q: 12, '2': 13, w: 14, '3': 15, e: 16, r: 17, '5': 18, t: 19, '6': 20,
    y: 21, '7': 22, u: 23, i: 24, '9': 25, o: 26, '0': 27, p: 28
  };

  window.addEventListener('keydown', (event) => {
    const tag = event.target && event.target.tagName ? event.target.tagName : '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (event.key === 'ArrowLeft') { event.preventDefault(); shiftOctave(-1); return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); shiftOctave(1); return; }
    if (event.key === 'Escape') { panic(); return; }
    if (event.key === ' ') { event.preventDefault(); toggleArp(); return; }

    const key = event.key.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(KEY_MAP, key)) return;
    if (event.repeat) return;

    event.preventDefault();
    const note = startNote() + KEY_MAP[key];
    pressed.set(key, note);
    press(note, 0.88);
  });

  window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (!pressed.has(key)) return;
    const note = pressed.get(key);
    pressed.delete(key);
    lift(note);
  });

  /* ------------------------------------------------------------- controles */

  let sustainOn = false;

  $('btn-sustain').addEventListener('click', () => {
    sustainOn = !sustainOn;
    engine.setSustain(sustainOn);
    $('btn-sustain').setAttribute('aria-pressed', String(sustainOn));
    $('btn-sustain').classList.toggle('on', sustainOn);
  });

  function toggleArp() {
    const on = !engine.arp.enabled;
    engine.setArpEnabled(on);
    $('btn-arp').setAttribute('aria-pressed', String(on));
    $('btn-arp').classList.toggle('on', on);
  }

  $('btn-arp').addEventListener('click', toggleArp);

  $('btn-viz').addEventListener('click', () => {
    const next = viz.mode === 'bars' ? 'radial' : 'bars';
    viz.setMode(next);
    $('btn-viz').textContent = next === 'bars' ? 'Radial' : 'Barras';
  });

  $('btn-panic').addEventListener('click', panic);
  $('btn-oct-down').addEventListener('click', () => shiftOctave(-1));
  $('btn-oct-up').addEventListener('click', () => shiftOctave(1));

  /* --------------------------------------------------------------- audio on */

  $('btn-power').addEventListener('click', async () => {
    try {
      await engine.init();
      engine.setSustain(sustainOn);
      viz.start();
      $('btn-power').textContent = 'Audio listo';
      $('btn-power').disabled = true;
      $('btn-record').disabled = !('MediaRecorder' in window);
      $('status').textContent = 'audio activo · ' + Math.round(engine.ctx.sampleRate / 1000) + ' kHz · ' +
        engine.voices.length + ' voces';
    } catch (error) {
      $('status').textContent = 'no se pudo iniciar el audio: ' + error.message;
    }
  });

  /* ------------------------------------------------------------------- MIDI */

  $('btn-midi').addEventListener('click', async () => {
    try {
      await engine.enableMidi();
      $('btn-midi').classList.add('on');
      $('btn-midi').textContent = 'MIDI ✓';
      $('status').textContent = 'MIDI conectado';
    } catch (error) {
      $('status').textContent = 'MIDI: ' + error.message;
    }
  });

  /* -------------------------------------------------------------- grabación */

  let recorder = null;
  let chunks = [];

  $('btn-record').addEventListener('click', () => {
    if (!engine.ready) return;

    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      return;
    }

    const mime = 'audio/webm;codecs=opus';
    const options = window.MediaRecorder && MediaRecorder.isTypeSupported(mime) ? { mimeType: mime } : undefined;

    chunks = [];
    recorder = new MediaRecorder(engine.recordDest.stream, options);

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'neon-' + Date.now() + '.webm';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      $('btn-record').textContent = '● Grabar';
      $('btn-record').classList.remove('recording');
    };

    recorder.start();
    $('btn-record').textContent = '■ Parar';
    $('btn-record').classList.add('recording');
  });

  /* ---------------------------------------------------------- medidor / HUD */

  viz.onFrame = ({ level }) => {
    $('meter-bar').style.transform = 'scaleX(' + clamp(level * 4, 0, 1).toFixed(3) + ')';
  };

  engine.onVoicesChange = (count) => {
    $('hud-voices').textContent = count + (count === 1 ? ' voz' : ' voces');
  };

  /* ------------------------------------------------------------------ arranque */

  buildPanel();
  buildPresets();
  buildKeyboard();
  refreshControls();
  updateHud();
  viz.start();
})();
