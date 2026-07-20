// Procedural sound effects via Web Audio — no audio files needed.
// The AudioContext can only start after a user gesture, so unlock() is
// called from input handlers and everything no-ops until then.

class AudioSystem {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.enabled = true;
    }

    unlock() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            this.ctx = new AC();
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.3;
            this.master.connect(this.ctx.destination);
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    setEnabled(on) {
        this.enabled = on;
    }

    get ready() {
        return this.enabled && this.ctx && this.ctx.state === 'running';
    }

    // ---- building blocks -------------------------------------------------

    tone({ type = 'square', from = 440, to = from, duration = 0.1, volume = 0.5, delay = 0 }) {
        if (!this.ready) return;
        const t0 = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(from, t0);
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + duration);
        gain.gain.setValueAtTime(volume, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(t0);
        osc.stop(t0 + duration + 0.02);
    }

    noise({ duration = 0.2, volume = 0.4, filterFrom = 2000, filterTo = 200, delay = 0 }) {
        if (!this.ready) return;
        const t0 = this.ctx.currentTime + delay;
        const samples = Math.ceil(this.ctx.sampleRate * duration);
        const buffer = this.ctx.createBuffer(1, samples, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < samples; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(filterFrom, t0);
        filter.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), t0 + duration);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(volume, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.master);
        src.start(t0);
    }

    arpeggio(freqs, noteDur = 0.09, type = 'triangle', volume = 0.4) {
        freqs.forEach((f, i) => {
            this.tone({ type, from: f, to: f, duration: noteDur * 1.4, volume, delay: i * noteDur });
        });
    }

    // ---- game events ------------------------------------------------------

    shoot() {
        this.tone({ type: 'square', from: 520, to: 190, duration: 0.09, volume: 0.25 });
    }

    runeShoot(element) {
        switch (element) {
            case 'fire':
                this.noise({ duration: 0.22, volume: 0.35, filterFrom: 3000, filterTo: 300 });
                this.tone({ type: 'sawtooth', from: 300, to: 90, duration: 0.2, volume: 0.2 });
                break;
            case 'ice':
                this.tone({ type: 'sine', from: 1400, to: 700, duration: 0.14, volume: 0.3 });
                this.tone({ type: 'sine', from: 2100, to: 1050, duration: 0.14, volume: 0.15, delay: 0.02 });
                break;
            case 'earth':
                this.tone({ type: 'sine', from: 130, to: 45, duration: 0.28, volume: 0.5 });
                this.noise({ duration: 0.15, volume: 0.2, filterFrom: 500, filterTo: 100 });
                break;
            case 'lightning':
                this.noise({ duration: 0.12, volume: 0.4, filterFrom: 8000, filterTo: 2000 });
                this.tone({ type: 'sawtooth', from: 1800, to: 300, duration: 0.1, volume: 0.25 });
                break;
            case 'triple':
                this.tone({ type: 'square', from: 620, to: 240, duration: 0.08, volume: 0.2 });
                this.tone({ type: 'square', from: 620, to: 240, duration: 0.08, volume: 0.2, delay: 0.04 });
                this.tone({ type: 'square', from: 620, to: 240, duration: 0.08, volume: 0.2, delay: 0.08 });
                break;
            default:
                this.shoot();
        }
    }

    bounce() {
        this.tone({ type: 'triangle', from: 900, to: 500, duration: 0.04, volume: 0.12 });
    }

    hit() {
        this.noise({ duration: 0.14, volume: 0.35, filterFrom: 1800, filterTo: 250 });
        this.tone({ type: 'sine', from: 250, to: 90, duration: 0.15, volume: 0.35 });
    }

    pickup() {
        this.arpeggio([523, 784], 0.07, 'triangle', 0.35);
    }

    shieldUp() {
        this.arpeggio([392, 523, 659], 0.06, 'sine', 0.3);
    }

    shieldBreak() {
        this.tone({ type: 'sine', from: 1600, to: 400, duration: 0.2, volume: 0.3 });
        this.noise({ duration: 0.15, volume: 0.2, filterFrom: 5000, filterTo: 800 });
    }

    stun() {
        this.tone({ type: 'sawtooth', from: 120, to: 110, duration: 0.25, volume: 0.25 });
    }

    death() {
        this.noise({ duration: 0.5, volume: 0.5, filterFrom: 2500, filterTo: 60 });
        this.tone({ type: 'sine', from: 200, to: 40, duration: 0.5, volume: 0.45 });
    }

    roundWin() {
        this.arpeggio([523, 659, 784], 0.1, 'triangle', 0.35);
    }

    matchWin() {
        this.arpeggio([392, 523, 659, 784, 1046], 0.12, 'triangle', 0.4);
    }

    uiClick() {
        this.tone({ type: 'square', from: 700, to: 500, duration: 0.04, volume: 0.15 });
    }

    // Per-class signature cast, dispatched on a successful ability.
    signature(classKey) {
        switch (classKey) {
            case 'arcanist': // Blink: fast rising sine sweep
                this.tone({ type: 'sine', from: 500, to: 1400, duration: 0.16, volume: 0.28 });
                break;
            case 'pyromancer': // Flame Burst: noise whoosh + saw drop
                this.noise({ duration: 0.3, volume: 0.4, filterFrom: 3200, filterTo: 250 });
                this.tone({ type: 'sawtooth', from: 340, to: 70, duration: 0.28, volume: 0.25 });
                break;
            case 'cryomancer': // Frost Ring: two descending high sines
                this.tone({ type: 'sine', from: 1800, to: 900, duration: 0.24, volume: 0.28 });
                this.tone({ type: 'sine', from: 2400, to: 1200, duration: 0.24, volume: 0.16, delay: 0.05 });
                break;
            case 'stonecaller': // Breach: low sine drop + rumble noise
                this.tone({ type: 'sine', from: 90, to: 35, duration: 0.32, volume: 0.5 });
                this.noise({ duration: 0.28, volume: 0.32, filterFrom: 700, filterTo: 90 });
                break;
            case 'stormcaller': // Zap Dash: fast rising saw zap
                this.tone({ type: 'sawtooth', from: 300, to: 1600, duration: 0.14, volume: 0.28 });
                break;
            default:
                this.uiClick();
        }
    }

    // Played when an ability fails (e.g. no wall to breach / nowhere to blink).
    fizzle() {
        this.tone({ type: 'square', from: 200, to: 150, duration: 0.09, volume: 0.12 });
    }
}

export const audio = new AudioSystem();
