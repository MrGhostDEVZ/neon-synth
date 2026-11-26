/* NEÓN — motor de audio. Web Audio API pura, sin dependencias. */
(function () {
  'use strict';

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const BLACK = [1, 3, 6, 8, 10];

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const noteToFreq = (note) => 440 * Math.pow(2, (note - 69) / 12);
  const noteName = (note) => NOTE_NAMES[((note % 12) + 12) % 12] + (Math.floor(note / 12) - 1);

  /* Curva de saturación suave: y = (1+k)x / (1+k|x|) */
  function driveCurve(amount) {
    const n = 2048;
    const curve = new Float32Array(n);
    const k = amount * 100;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  /* Respuesta al impulso sintética para el convolver (ruido con caída exponencial). */
  function impulse(ctx, seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buffer = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buffer;
  }

  const DEFAULT_PARAMS = {
    wave1: 'sawtooth',
    wave2: 'square',
    osc2Gain: 0.45,
    detune: 9,
    sub: 0.12,
    attack: 0.012,
    decay: 0.3,
    sustain: 0.65,
    release: 0.4,
    cutoff: 2600,
    resonance: 7,
    filterEnv: 2200,
    lfoRate: 4.8,
    lfoFilter: 700,
    lfoPitch: 0,
    drive: 0.18,
    delayTime: 0.3,
    delayFeedback: 0.32,
    delayMix: 0.22,
    reverbSize: 2.4,
    reverbMix: 0.26,
    volume: 0.75
  };

  const PRESETS = {
    'Inicio': {},
    'Pluck neón': {
      wave1: 'sawtooth', wave2: 'triangle', osc2Gain: 0.3, detune: 12, sub: 0.05,
      attack: 0.002, decay: 0.18, sustain: 0.12, release: 0.22,
      cutoff: 3200, resonance: 9, filterEnv: 2600,
      lfoRate: 5.2, lfoFilter: 300, lfoPitch: 0,
      drive: 0.1, delayMix: 0.3, delayFeedback: 0.38, delayTime: 0.22,
      reverbSize: 1.8, reverbMix: 0.2
    },
    'Pad etéreo': {
      wave1: 'triangle', wave2: 'sine', osc2Gain: 0.6, detune: 18, sub: 0.2,
      attack: 0.9, decay: 1.6, sustain: 0.8, release: 2.6,
      cutoff: 1500, resonance: 3, filterEnv: 900,
      lfoRate: 0.35, lfoFilter: 900, lfoPitch: 6,
      drive: 0.05, delayMix: 0.35, delayFeedback: 0.45, delayTime: 0.5,
      reverbSize: 4.5, reverbMix: 0.5
    },
    'Bajo sucio': {
      wave1: 'square', wave2: 'sawtooth', osc2Gain: 0.35, detune: 6, sub: 0.5,
      attack: 0.005, decay: 0.12, sustain: 0.55, release: 0.15,
      cutoff: 900, resonance: 11, filterEnv: 1800,
      lfoRate: 1.2, lfoFilter: 0, lfoPitch: 0,
      drive: 0.55, delayMix: 0.08, delayFeedback: 0.2, delayTime: 0.16,
      reverbSize: 1.2, reverbMix: 0.08
    },
    'Lead brillante': {
      wave1: 'sawtooth', wave2: 'sawtooth', osc2Gain: 0.55, detune: 22, sub: 0,
      attack: 0.01, decay: 0.35, sustain: 0.7, release: 0.3,
      cutoff: 5200, resonance: 6, filterEnv: 2400,
      lfoRate: 5.5, lfoFilter: 400, lfoPitch: 14,
      drive: 0.3, delayMix: 0.28, delayFeedback: 0.4, delayTime: 0.24,
      reverbSize: 2.6, reverbMix: 0.3
    }
  };

  class SynthEngine {
    constructor() {
      this.ctx = null;
      this.ready = false;
      this.voices = [];
      this.maxVoices = 18;
      this.held = new Set();
      this.sustained = new Set();
      this.sustain = false;
      this.bend = 0;
      this.params = Object.assign({}, DEFAULT_PARAMS);
      this.presets = PRESETS;
      this.onVoicesChange = null;
      this.arp = { enabled: false, bpm: 110, mode: 'up', gate: 0.6, index: 0, nextTime: 0, timer: null };
    }

    /* ---------------------------------------------------------------- init */

    async init() {
      if (this.ready) {
        if (this.ctx.state === 'suspended') await this.ctx.resume();
        return this.ctx;
      }

      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('Este navegador no soporta Web Audio API');

      const ctx = new AC();
      this.ctx = ctx;
      const p = this.params;

      this.input = ctx.createGain();
      this.input.gain.value = 0.9;

      this.shaper = ctx.createWaveShaper();
      this.shaper.curve = driveCurve(p.drive);
      this.shaper.oversample = '4x';

      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.knee.value = 18;
      this.comp.ratio.value = 3;
      this.comp.attack.value = 0.005;
      this.comp.release.value = 0.2;

      this.master = ctx.createGain();
      this.master.gain.value = p.volume;

      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.78;

      this.dry = ctx.createGain();
      this.dry.gain.value = 1;

      this.delay = ctx.createDelay(1);
      this.delay.delayTime.value = p.delayTime;
      this.feedback = ctx.createGain();
      this.feedback.gain.value = p.delayFeedback;
      this.delayWet = ctx.createGain();
      this.delayWet.gain.value = p.delayMix;

      this.convolver = ctx.createConvolver();
      this.convolver.buffer = impulse(ctx, p.reverbSize, 2.6);
      this.reverbWet = ctx.createGain();
      this.reverbWet.gain.value = p.reverbMix;

      /* cadena: voces -> saturación -> compresor -> [seco, delay, reverb] -> master -> analyser */
      this.input.connect(this.shaper);
      this.shaper.connect(this.comp);

      this.comp.connect(this.dry);
      this.dry.connect(this.master);

      this.comp.connect(this.delay);
      this.delay.connect(this.feedback);
      this.feedback.connect(this.delay);
      this.delay.connect(this.delayWet);
      this.delayWet.connect(this.master);

      this.comp.connect(this.convolver);
      this.convolver.connect(this.reverbWet);
      this.reverbWet.connect(this.master);

      this.master.connect(this.analyser);
      this.analyser.connect(ctx.destination);

      this.recordDest = ctx.createMediaStreamDestination();
      this.master.connect(this.recordDest);

      /* LFO global: se conecta al parámetro de cada voz nueva */
      this.lfo = ctx.createOscillator();
      this.lfo.type = 'sine';
      this.lfo.frequency.value = p.lfoRate;

      this.lfoFilterGain = ctx.createGain();
      this.lfoFilterGain.gain.value = p.lfoFilter;
      this.lfoPitchGain = ctx.createGain();
      this.lfoPitchGain.gain.value = p.lfoPitch;

      this.lfo.connect(this.lfoFilterGain);
      this.lfo.connect(this.lfoPitchGain);
      this.lfo.start();

      if (ctx.state === 'suspended') await ctx.resume();

      this.ready = true;
      return ctx;
    }

    /* ------------------------------------------------------------- params */

    setParam(key, value) {
      this.params[key] = value;
      if (!this.ready) return;

      const ctx = this.ctx;
      const now = ctx.currentTime;

      switch (key) {
        case 'wave1':
          this.voices.forEach((v) => { v.osc1.type = value; });
          break;
        case 'wave2':
          this.voices.forEach((v) => { v.osc2.type = value; });
          break;
        case 'volume':
          this.master.gain.setTargetAtTime(value, now, 0.02);
          break;
        case 'drive':
          this.shaper.curve = driveCurve(value);
          break;
        case 'delayTime':
          this.delay.delayTime.setTargetAtTime(value, now, 0.05);
          break;
        case 'delayFeedback':
          this.feedback.gain.setTargetAtTime(value, now, 0.05);
          break;
        case 'delayMix':
          this.delayWet.gain.setTargetAtTime(value, now, 0.05);
          break;
        case 'reverbMix':
          this.reverbWet.gain.setTargetAtTime(value, now, 0.05);
          break;
        case 'reverbSize':
          this.convolver.buffer = impulse(ctx, value, 2.6);
          break;
        case 'lfoRate':
          this.lfo.frequency.setTargetAtTime(value, now, 0.02);
          break;
        case 'lfoFilter':
          this.lfoFilterGain.gain.setTargetAtTime(value, now, 0.02);
          break;
        case 'lfoPitch':
          this.lfoPitchGain.gain.setTargetAtTime(value, now, 0.02);
          break;
        case 'cutoff':
        case 'resonance':
          this.voices.forEach((v) => {
            if (v.released) return;
            if (key === 'cutoff') v.filter.frequency.setTargetAtTime(clamp(value, 40, 16000), now, 0.03);
            else v.filter.Q.setTargetAtTime(value, now, 0.03);
          });
          break;
        default:
          break;
      }
    }

    loadPreset(name) {
      const preset = name === 'Inicio' ? {} : (PRESETS[name] || {});
      const next = Object.assign({}, DEFAULT_PARAMS, preset);
      delete next.reverbSetup;
      Object.keys(next).forEach((key) => this.setParam(key, next[key]));
      return this.params;
    }

    /* -------------------------------------------------------------- voces */

    spawn(note, velocity, opts) {
      opts = opts || {};
      const ctx = this.ctx;
      const p = this.params;
      const t = opts.when === undefined ? ctx.currentTime : opts.when;

      const freq = noteToFreq(note + this.bend);
      const peak = Math.max(0.0005, velocity * 0.26);
      const attack = Math.max(0.003, p.attack);
      const decay = Math.max(0.01, p.decay);
      const release = Math.max(0.02, p.release);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = p.resonance;

      const cutBase = clamp(p.cutoff, 40, 16000);
      const cutPeak = clamp(p.cutoff + p.filterEnv, 40, 16000);
      filter.frequency.setValueAtTime(cutPeak, t);
      filter.frequency.exponentialRampToValueAtTime(cutBase, t + decay);

      const gain = ctx.createGain();
      const susLevel = Math.max(0.0005, peak * p.sustain);
      gain.gain.setValueAtTime(0.0005, t);
      gain.gain.linearRampToValueAtTime(peak, t + attack);
      gain.gain.exponentialRampToValueAtTime(susLevel, t + attack + decay);

      const osc1 = ctx.createOscillator();
      osc1.type = p.wave1;
      osc1.frequency.setValueAtTime(freq, t);
      osc1.detune.setValueAtTime(-p.detune, t);

      const osc2 = ctx.createOscillator();
      osc2.type = p.wave2;
      osc2.frequency.setValueAtTime(freq, t);
      osc2.detune.setValueAtTime(p.detune, t);

      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(freq / 2, t);

      const g1 = ctx.createGain();
      g1.gain.value = 1;
      const g2 = ctx.createGain();
      g2.gain.value = p.osc2Gain;
      const g3 = ctx.createGain();
      g3.gain.value = p.sub;

      osc1.connect(g1).connect(filter);
      osc2.connect(g2).connect(filter);
      sub.connect(g3).connect(filter);
      filter.connect(gain);
      gain.connect(this.input);

      /* modulación: LFO global -> parámetros de esta voz */
      try {
        this.lfoFilterGain.connect(filter.frequency);
        this.lfoPitchGain.connect(osc1.detune);
        this.lfoPitchGain.connect(osc2.detune);
      } catch (e) {
        /* el param ya estaba conectado */
      }

      osc1.start(t);
      osc2.start(t);
      sub.start(t);

      const voice = {
        note: note,
        osc1: osc1,
        osc2: osc2,
        sub: sub,
        filter: filter,
        gain: gain,
        extra: [g1, g2, g3],
        released: false,
        arp: !!opts.duration
      };

      /* nota de duración fija (arpegiador): la envolvente se cierra sola */
      if (opts.duration) {
        const off = Math.max(t + attack + decay + 0.01, t + opts.duration);
        gain.gain.setValueAtTime(susLevel, off);
        gain.gain.exponentialRampToValueAtTime(0.0005, off + release);
        const stopAt = off + release + 0.05;
        voice.released = true;
        osc1.stop(stopAt);
        osc2.stop(stopAt);
        sub.stop(stopAt);
      }

      osc1.onended = () => this.dispose(voice);
      return voice;
    }

    noteOn(note, velocity) {
      if (!this.ready) return null;
      const vel = typeof velocity === 'number' ? velocity : 0.9;

      this.held.add(note);
      this.emitVoices();

      /* con arpegiador encendido, la tecla solo alimenta la secuencia */
      if (this.arp.enabled) return null;

      const same = this.voices.find((v) => v.note === note && !v.released && !v.arp);
      if (same) this.release(same, 0.08);

      let active = this.voices.filter((v) => !v.released && !v.arp);
      let guard = 0;
      while (active.length >= this.maxVoices && guard++ < 64) {
        this.release(active[0], 0.05);
        active = this.voices.filter((v) => !v.released && !v.arp);
        if (!active.length) break;
      }

      const voice = this.spawn(note, vel, {});
      this.voices.push(voice);
      this.emitVoices();
      return voice;
    }

    noteOff(note) {
      this.held.delete(note);
      this.sustained.delete(note);
      this.emitVoices();

      if (this.arp.enabled) return;
      if (this.sustain) {
        this.sustained.add(note);
        return;
      }

      const v = this.voices.find((x) => x.note === note && !x.released && !x.arp);
      if (v) this.release(v);
    }

    release(voice, time) {
      if (!voice || voice.released) return;
      voice.released = true;

      const ctx = this.ctx;
      const t = ctx.currentTime;
      const rt = Math.max(0.02, time === undefined ? this.params.release : time);
      const g = voice.gain.gain;

      if (typeof g.cancelAndHoldAtTime === 'function') {
        g.cancelAndHoldAtTime(t);
      } else {
        g.cancelScheduledValues(t);
        g.setValueAtTime(Math.max(g.value, 0.0005), t);
      }
      g.exponentialRampToValueAtTime(0.0005, t + rt);

      const stopAt = t + rt + 0.05;
      [voice.osc1, voice.osc2, voice.sub].forEach((osc) => {
        try { osc.stop(stopAt); } catch (e) { /* ya estaba parado */ }
      });
    }

    dispose(voice) {
      const i = this.voices.indexOf(voice);
      if (i !== -1) this.voices.splice(i, 1);

      const nodes = [voice.osc1, voice.osc2, voice.sub, voice.filter, voice.gain].concat(voice.extra || []);
      nodes.forEach((node) => {
        try { node.disconnect(); } catch (e) { /* sin conexiones */ }
      });

      try { this.lfoFilterGain.disconnect(voice.filter.frequency); } catch (e) { /* nada */ }
      try { this.lfoPitchGain.disconnect(voice.osc1.detune); } catch (e) { /* nada */ }
      try { this.lfoPitchGain.disconnect(voice.osc2.detune); } catch (e) { /* nada */ }

      this.emitVoices();
    }

    emitVoices() {
      if (typeof this.onVoicesChange !== 'function') return;
      const active = this.voices.reduce((n, v) => n + (v.released ? 0 : 1), 0);
      this.onVoicesChange(active, Array.from(this.held));
    }

    setSustain(on) {
      this.sustain = !!on;
      if (this.sustain) return;
      this.sustained.forEach((note) => {
        const v = this.voices.find((x) => x.note === note && !x.released && !x.arp);
        if (v) this.release(v);
      });
      this.sustained.clear();
    }

    allNotesOff() {
      this.held.clear();
      this.sustained.clear();
      this.voices.slice().forEach((v) => {
        if (!v.arp) this.release(v, 0.12);
      });
      this.emitVoices();
    }

    setBend(semitones) {
      this.bend = semitones;
      if (!this.ready) return;
      const now = this.ctx.currentTime;
      this.voices.forEach((v) => {
        if (v.released) return;
        const freq = noteToFreq(v.note + semitones);
        v.osc1.frequency.setTargetAtTime(freq, now, 0.01);
        v.osc2.frequency.setTargetAtTime(freq, now, 0.01);
        v.sub.frequency.setTargetAtTime(freq / 2, now, 0.01);
      });
    }

    /* ---------------------------------------------------------- arpegiador */

    setArpEnabled(on) {
      this.arp.enabled = !!on;
      if (this.arp.enabled) {
        this.startArp();
      } else {
        this.stopArp();
      }
    }

    startArp() {
      if (this.arp.timer || !this.ready) return;
      this.arp.index = 0;
      this.arp.nextTime = this.ctx.currentTime + 0.06;
      this.arp.timer = setInterval(() => this.scheduleArp(), 25);
    }

    stopArp() {
      if (this.arp.timer) {
        clearInterval(this.arp.timer);
        this.arp.timer = null;
      }
    }

    stepDuration() {
      return 60 / this.arp.bpm / 2; /* corcheas */
    }

    arpSequence() {
      const base = Array.from(this.held).sort((a, b) => a - b);
      if (base.length < 2) return base;
      if (this.arp.mode === 'down') return base.slice().reverse();
      if (this.arp.mode === 'updown') {
        return base.concat(base.slice(1, -1).reverse());
      }
      if (this.arp.mode === 'random') {
        return base.slice().sort(() => Math.random() - 0.5);
      }
      return base;
    }

    /* planificador con lookahead: agenda notas en el reloj del audio, no en el del timer */
    scheduleArp() {
      if (!this.ready) return;
      const ctx = this.ctx;
      const ahead = 0.14;
      const dur = this.stepDuration();
      let guard = 0;

      while (this.arp.nextTime < ctx.currentTime + ahead && guard++ < 64) {
        const seq = this.arpSequence();
        if (seq.length) {
          const note = seq[this.arp.index % seq.length];
          const voice = this.spawn(note, 0.85, {
            when: this.arp.nextTime,
            duration: dur * this.arp.gate
          });
          this.voices.push(voice);
        }
        this.arp.index++;
        this.arp.nextTime += dur;
      }
    }

    /* ---------------------------------------------------------------- MIDI */

    async enableMidi() {
      if (!navigator.requestMIDIAccess) {
        throw new Error('Web MIDI no está disponible en este navegador');
      }
      const access = await navigator.requestMIDIAccess();
      const attach = () => {
        access.inputs.forEach((input) => {
          input.onmidimessage = (event) => this.handleMidi(event);
        });
      };
      access.onstatechange = attach;
      attach();
      this.midi = access;
      return access;
    }

    handleMidi(event) {
      const data = event.data;
      const status = data[0] & 0xf0;
      const d1 = data[1];
      const d2 = data[2];

      if (status === 0x90 && d2 > 0) this.noteOn(d1, d2 / 127);
      else if (status === 0x80 || (status === 0x90 && d2 === 0)) this.noteOff(d1);
      else if (status === 0xe0) {
        const value = ((d2 << 7) + d1) / 8192 - 1;
        this.setBend(value * 2);
      }
    }
  }

  window.SynthEngine = SynthEngine;
  window.SynthUtils = { noteName: noteName, noteToFreq: noteToFreq };
})();
