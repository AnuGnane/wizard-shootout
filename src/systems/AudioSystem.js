// Procedural sound effects via Web Audio — no audio files needed.
// The AudioContext can only start after a user gesture, so unlock() is
// called from input handlers and everything no-ops until then.

// ---- Phase 6e: procedural chiptune music -----------------------------
//
// A tiny look-ahead scheduler drives a 2-bar (8 beat) i-VI-III-VII minor
// progression in A minor: a bass note per beat plus an arpeggiated melody
// over it. Everything is scheduled with the same short-envelope
// osc+gain-node pattern as tone()/noise() below, just routed through a
// dedicated `musicGain` bus (instead of straight to master) so the whole
// mix can be ducked under SFX and gated by mute/music-toggle independent
// of the sound-effect code paths.
const MUSIC_BPM = { 0: 84, 1: 112, 2: 132 }; // calm / combat / match point

// i (Am) - VI (F) - III (C) - VII (G), each held for 2 beats (8 beats total).
const MUSIC_PROGRESSION = [
    { bass: 110.00, tones: [220.00, 261.63, 329.63] }, // i:   A2 | A3 C4 E4
    { bass: 87.31, tones: [174.61, 220.00, 261.63] },  // VI:  F2 | F3 A3 C4
    { bass: 65.41, tones: [261.63, 329.63, 392.00] },  // III: C2 | C4 E4 G4
    { bass: 98.00, tones: [196.00, 246.94, 293.66] },  // VII: G2 | G3 B3 D4
];

class AudioSystem {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.enabled = true;

        // ---- music state ----
        this.musicGain = null;
        this.musicEnabled = true;
        this._musicOn = false;          // intent: should the loop be running
        this._musicIntensity = 0;       // 0 calm, 1 combat, 2 match point
        this._musicVol = 0.15;          // bus target gain — sits under SFX
        this._musicTimerId = null;      // setInterval id for the scheduler
        this._musicStartCount = 0;      // dev/test aid: bumps only when a NEW interval is created
        this._nextNoteTime = 0;         // ctx.currentTime of the next unscheduled beat
        this._musicChordIndex = 0;
        this._musicBeatInChord = 0;
    }

    unlock() {
        if (!this.ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            this.ctx = new AC();
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.3;
            this.master.connect(this.ctx.destination);

            this.musicGain = this.ctx.createGain();
            this.musicGain.gain.value = 0;
            this.musicGain.connect(this.master);
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        // startMusic() may have been called before the context existed (the
        // intent is remembered via _musicOn); now that ctx/musicGain are
        // live, actually spin up the scheduler.
        if (this._musicOn) {
            this._ensureScheduler();
        }
    }

    setEnabled(on) {
        this.enabled = on;
        this._applyMusicGate();
    }

    get ready() {
        return this.enabled && this.ctx && this.ctx.state === 'running';
    }

    // ---- music public API --------------------------------------------

    // Store the music on/off preference and immediately re-gate musicGain.
    setMusicEnabled(on) {
        this.musicEnabled = on;
        this._applyMusicGate();
    }

    // Idempotent: calling this while already running is a no-op, so it can
    // safely be called from every gesture handler without stacking a second
    // scheduler/interval or restarting the loop's position.
    startMusic() {
        if (this._musicOn) return;
        this._musicOn = true;
        this._ensureScheduler();
    }

    stopMusic() {
        this._musicOn = false;
        if (this._musicTimerId) {
            clearInterval(this._musicTimerId);
            this._musicTimerId = null;
        }
        this._applyMusicGate();
    }

    // 0 calm (menu), 1 combat (default in a round), 2 match point. Purely
    // changes which layers _scheduleBeat emits going forward — it never
    // touches the interval/scheduler, so it can't restart or stack the loop.
    setMusicIntensity(level) {
        this._musicIntensity = Math.max(0, Math.min(2, level));
    }

    // ---- music internals ----------------------------------------------

    // Lazily (re)starts the look-ahead interval. Safe to call redundantly —
    // it only creates a NEW interval when one isn't already running, and it
    // no-ops entirely if the AudioContext doesn't exist yet (unlock() calls
    // this again once it does).
    _ensureScheduler() {
        if (!this.ctx || this._musicTimerId) return;
        this._nextNoteTime = this.ctx.currentTime + 0.05;
        this._musicChordIndex = 0;
        this._musicBeatInChord = 0;
        this._musicStartCount++;
        this._musicTimerId = setInterval(() => this._scheduleMusicTick(), 120);
        // Run one tick immediately so the first notes/gain ramp don't wait
        // for the first interval fire (~120ms of silence otherwise).
        this._scheduleMusicTick();
    }

    // Sets musicGain toward its gated target. This is the ONLY place that
    // decides whether music is audible: enabled (master mute), musicEnabled
    // (the settings toggle) and _musicOn (loop running) must all be true.
    // Called eagerly from setEnabled/setMusicEnabled/stopMusic for a snappy
    // response, and every scheduler tick so the gate stays correct even if
    // nothing else touches it.
    _applyMusicGate() {
        if (!this.ctx || !this.musicGain) return;
        const now = this.ctx.currentTime;
        const audible = this.enabled && this.musicEnabled && this._musicOn;
        const target = audible ? this._musicVol : 0;
        this.musicGain.gain.cancelScheduledValues(now);
        this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
        this.musicGain.gain.setTargetAtTime(target, now, 0.08);
    }

    // Classic Web Audio look-ahead scheduler tick: schedule any beat whose
    // time falls within the next ~200ms window, tracking _nextNoteTime so
    // notes never overlap/duplicate and nothing is scheduled twice.
    _scheduleMusicTick() {
        if (!this.ctx) return;
        this._applyMusicGate();

        const now = this.ctx.currentTime;
        const audible = this.enabled && this.musicEnabled && this._musicOn;
        if (!audible) {
            // Keep the beat clock aligned to wall-time while silent. Otherwise
            // _nextNoteTime freezes during a long mute and, on resume, the loop
            // below would fire every missed beat at once (all past-due, so they
            // play instantly) — an audible chord-stack blip on every unmute.
            if (this._nextNoteTime < now) this._nextNoteTime = now;
            return;
        }

        const lookahead = 0.2;
        while (this._nextNoteTime < now + lookahead) {
            this._scheduleBeat(this._nextNoteTime);
            const bpm = MUSIC_BPM[this._musicIntensity] ?? MUSIC_BPM[1];
            this._nextNoteTime += 60 / bpm;
        }
    }

    // Emits one beat's worth of notes at absolute ctx time t0: a bass note,
    // an arpeggiated melody subdivision, and (at match point) a hi-hat-style
    // noise layer. Advances the chord progression every 2 beats.
    _scheduleBeat(t0) {
        const intensity = this._musicIntensity;
        const bpm = MUSIC_BPM[intensity] ?? MUSIC_BPM[1];
        const beatDur = 60 / bpm;
        const chord = MUSIC_PROGRESSION[this._musicChordIndex];

        const bassVol = intensity === 0 ? 0.20 : (intensity === 2 ? 0.30 : 0.26);
        this._musicTone({ type: 'triangle', freq: chord.bass, duration: beatDur * 0.9, volume: bassVol, time: t0 });

        // Calm is sparser (2 notes/beat); combat and match point are busier (4/beat).
        const subdivisions = intensity === 0 ? 2 : 4;
        const noteDur = beatDur / subdivisions;
        const octave = intensity === 2 ? 2 : 1; // match point arps an octave higher
        const melodyVol = intensity === 2 ? 0.22 : 0.17;
        for (let i = 0; i < subdivisions; i++) {
            const tone = chord.tones[i % chord.tones.length];
            this._musicTone({
                type: 'square',
                freq: tone * octave,
                duration: noteDur * 0.85,
                volume: melodyVol,
                time: t0 + i * noteDur,
            });
        }

        // Match point: fast hi-hat-like noise ticks layered on top.
        if (intensity === 2) {
            const hatCount = subdivisions * 2;
            const hatDur = beatDur / hatCount;
            for (let i = 0; i < hatCount; i++) {
                this._musicNoise({ duration: hatDur * 0.5, volume: 0.09, time: t0 + i * hatDur });
            }
        }

        this._musicBeatInChord++;
        if (this._musicBeatInChord >= 2) {
            this._musicBeatInChord = 0;
            this._musicChordIndex = (this._musicChordIndex + 1) % MUSIC_PROGRESSION.length;
        }
    }

    // Short constant-pitch plucked tone, routed to musicGain (not master).
    // Mirrors tone()'s envelope style but takes an absolute start time since
    // the scheduler works in absolute ctx.currentTime, not "delay from now".
    _musicTone({ type = 'triangle', freq = 220, duration = 0.2, volume = 0.2, time }) {
        if (!this.ctx || !this.musicGain) return;
        const t0 = time;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t0);
        gain.gain.setValueAtTime(volume, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
        osc.connect(gain);
        gain.connect(this.musicGain);
        osc.start(t0);
        osc.stop(t0 + duration + 0.02);
    }

    // Filtered noise burst (hi-hat layer), routed to musicGain.
    _musicNoise({ duration = 0.05, volume = 0.1, time }) {
        if (!this.ctx || !this.musicGain) return;
        const t0 = time;
        const samples = Math.max(1, Math.ceil(this.ctx.sampleRate * duration));
        const buffer = this.ctx.createBuffer(1, samples, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < samples; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(6000, t0);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(volume, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.musicGain);
        src.start(t0);
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

    // Soft hiss when fire melts a frost tile into steam.
    steam() {
        this.noise({ duration: 0.4, volume: 0.16, filterFrom: 5000, filterTo: 1400 });
    }

    // Short rising fanfare announcing the Orb Surge.
    surge() {
        this.arpeggio([440, 660, 880], 0.09, 'square', 0.3);
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
