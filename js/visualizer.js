/* NEÓN — visualizador de audio sobre canvas 2D. */
(function () {
  'use strict';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  class Visualizer {
    constructor(canvas, engine) {
      this.canvas = canvas;
      this.g = canvas.getContext('2d');
      this.engine = engine;
      this.mode = 'bars';
      this.bars = 72;
      this.smooth = new Float32Array(this.bars);
      this.peak = new Float32Array(this.bars);
      this.particles = [];
      this.running = false;
      this.onFrame = null;
      this.w = 0;
      this.h = 0;
      this.freq = null;
      this.time = null;

      this._frame = this._frame.bind(this);
      this.resize = this.resize.bind(this);
      window.addEventListener('resize', this.resize);
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = rect.width;
      this.h = rect.height;
      this.canvas.width = Math.round(rect.width * dpr);
      this.canvas.height = Math.round(rect.height * dpr);
      this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.g.fillStyle = '#05060c';
      this.g.fillRect(0, 0, this.w, this.h);
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.resize();
      requestAnimationFrame(this._frame);
    }

    stop() {
      this.running = false;
    }

    setMode(mode) {
      this.mode = mode;
      this.particles.length = 0;
    }

    _frame() {
      if (!this.running) return;
      requestAnimationFrame(this._frame);

      if (!this.w || !this.h) {
        this.resize();
        return;
      }

      const g = this.g;
      const eng = this.engine;
      const analyser = eng.ready ? eng.analyser : null;

      if (analyser) {
        if (!this.freq || this.freq.length !== analyser.frequencyBinCount) {
          this.freq = new Uint8Array(analyser.frequencyBinCount);
          this.time = new Uint8Array(analyser.fftSize);
        }
        analyser.getByteFrequencyData(this.freq);
        analyser.getByteTimeDomainData(this.time);
      }

      /* estela: no se limpia del todo, se oscurece */
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(5, 6, 12, 0.30)';
      g.fillRect(0, 0, this.w, this.h);

      let level = 0;
      let bass = 0;

      if (analyser) {
        let sum = 0;
        for (let i = 0; i < this.time.length; i += 4) {
          const v = (this.time[i] - 128) / 128;
          sum += v * v;
        }
        level = Math.sqrt(sum / (this.time.length / 4));

        const bins = this.freq.length;
        const nyq = eng.ctx.sampleRate / 2;
        const low = 25;
        const ratio = nyq / low;

        for (let i = 0; i < this.bars; i++) {
          const f0 = low * Math.pow(ratio, i / this.bars);
          const f1 = low * Math.pow(ratio, (i + 1) / this.bars);
          const b0 = clamp(Math.floor((f0 / nyq) * bins), 0, bins - 1);
          const b1 = clamp(Math.ceil((f1 / nyq) * bins), b0 + 1, bins);

          let acc = 0;
          for (let b = b0; b < b1; b++) acc += this.freq[b];
          const v = acc / (b1 - b0) / 255;

          this.smooth[i] = Math.max(v, this.smooth[i] * 0.86);
          this.peak[i] = Math.max(this.smooth[i], (this.peak[i] || 0) - 0.004);
          if (i < 6) bass += this.smooth[i] / 6;
        }
      } else {
        const t = performance.now() / 1000;
        for (let i = 0; i < this.bars; i++) {
          this.smooth[i] = 0.05 + 0.03 * Math.sin(t * 1.2 + i * 0.35);
          this.peak[i] = this.smooth[i];
        }
        bass = 0.05;
      }

      if (this.mode === 'bars') this.drawBars(bass);
      else this.drawRadial(bass);

      if (analyser) this.drawWave();

      if (typeof this.onFrame === 'function') this.onFrame({ level: level, bass: bass });
    }

    drawBars(bass) {
      const g = this.g;
      const w = this.w;
      const h = this.h;
      const bw = w / this.bars;
      const baseY = h - 18;
      const span = h * 0.72;

      g.globalCompositeOperation = 'lighter';

      for (let i = 0; i < this.bars; i++) {
        const v = Math.pow(this.smooth[i], 1.35);
        const bh = Math.max(2, v * span);
        const x = i * bw + bw * 0.18;
        const bwid = Math.max(2, bw * 0.64);
        const hue = 168 + (i / this.bars) * 130;

        const grad = g.createLinearGradient(0, baseY - bh, 0, baseY);
        grad.addColorStop(0, 'hsla(' + hue + ', 100%, 72%, 0.95)');
        grad.addColorStop(1, 'hsla(' + (hue + 24) + ', 95%, 45%, 0.22)');

        g.fillStyle = grad;
        g.shadowColor = 'hsla(' + hue + ', 100%, 60%, 0.8)';
        g.shadowBlur = 14;
        g.fillRect(x, baseY - bh, bwid, bh);

        const py = baseY - Math.max(2, Math.pow(this.peak[i], 1.35) * span);
        g.shadowBlur = 0;
        g.fillStyle = 'hsla(' + hue + ', 100%, 84%, 0.85)';
        g.fillRect(x, py - 2, bwid, 2);
      }

      g.shadowBlur = 0;
      g.globalCompositeOperation = 'source-over';

      g.strokeStyle = 'rgba(120, 200, 255, 0.16)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, baseY + 6);
      g.lineTo(w, baseY + 6);
      g.stroke();

      this.updateParticles(bass);
    }

    drawRadial(bass) {
      const g = this.g;
      const w = this.w;
      const h = this.h;
      const cx = w / 2;
      const cy = h / 2;
      const min = Math.min(w, h);
      const radius = min * 0.16 + bass * min * 0.08;

      g.globalCompositeOperation = 'lighter';

      for (let i = 0; i < this.bars; i++) {
        const a = (i / this.bars) * Math.PI * 2 - Math.PI / 2;
        const len = 6 + Math.pow(this.smooth[i], 1.25) * min * 0.42;
        const hue = 168 + (i / this.bars) * 130;

        g.strokeStyle = 'hsla(' + hue + ', 100%, 66%, 0.8)';
        g.lineWidth = 2.2;
        g.shadowColor = 'hsla(' + hue + ', 100%, 60%, 0.9)';
        g.shadowBlur = 12;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
        g.lineTo(cx + Math.cos(a) * (radius + len), cy + Math.sin(a) * (radius + len));
        g.stroke();
      }

      g.shadowBlur = 0;
      g.globalCompositeOperation = 'source-over';

      const core = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, radius));
      core.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
      core.addColorStop(0.45, 'rgba(53, 240, 200, 0.22)');
      core.addColorStop(1, 'rgba(53, 240, 200, 0)');
      g.fillStyle = core;
      g.beginPath();
      g.arc(cx, cy, Math.max(1, radius), 0, Math.PI * 2);
      g.fill();

      this.updateParticles(bass, cx, cy);
    }

    updateParticles(bass, cx, cy) {
      const g = this.g;
      const w = this.w;
      const h = this.h;

      if (bass > 0.28 && this.particles.length < 220) {
        const count = Math.min(6, Math.max(1, Math.round(bass * 10)));
        for (let i = 0; i < count; i++) {
          this.particles.push({
            x: cx === undefined ? Math.random() * w : cx,
            y: cy === undefined ? h - 20 : cy,
            vx: (Math.random() - 0.5) * 1.6,
            vy: -(0.4 + Math.random() * 1.8) - bass * 2,
            life: 1,
            hue: 165 + Math.random() * 140,
            size: 1 + Math.random() * 2.4
          });
        }
      }

      g.globalCompositeOperation = 'lighter';
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.004;
        p.life -= 0.008;

        if (p.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }

        g.fillStyle = 'hsla(' + p.hue + ', 100%, 70%, ' + (p.life * 0.7).toFixed(3) + ')';
        g.beginPath();
        g.arc(p.x, p.y, Math.max(0.2, p.size * p.life), 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    }

    drawWave() {
      const g = this.g;
      const time = this.time;
      if (!time) return;

      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = 'rgba(160, 220, 255, 0.45)';
      g.lineWidth = 1.4;
      g.shadowColor = 'rgba(120, 200, 255, 0.8)';
      g.shadowBlur = 10;
      g.beginPath();

      for (let i = 0; i < time.length; i += 2) {
        const x = (i / time.length) * this.w;
        const y = this.h * 0.5 + ((time[i] - 128) / 128) * this.h * 0.22;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }

      g.stroke();
      g.shadowBlur = 0;
      g.globalCompositeOperation = 'source-over';
    }
  }

  window.Visualizer = Visualizer;
})();
