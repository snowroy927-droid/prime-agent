export type SfxId = "launch" | "approve" | "reject" | "fill" | "combo" | "loss" | "fever";

type AudioContextConstructor = typeof AudioContext;

// Chiptune effects synthesized with WebAudio; no audio files. Muted until the owner turns sound on,
// and the AudioContext is only created then (browsers require a user gesture).
export class Sfx {
	private ctx: AudioContext | null = null;
	private muted = true;
	private comboStep = 0;

	setMuted(muted: boolean): void {
		this.muted = muted;
		if (muted) return;
		if (!this.ctx) {
			const Ctor: AudioContextConstructor | undefined =
				window.AudioContext ??
				(window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
			if (!Ctor) return;
			this.ctx = new Ctor();
		}
		void this.ctx.resume();
	}

	play(id: SfxId): void {
		if (this.muted || !this.ctx) return;
		switch (id) {
			case "launch":
				this.tone(880, 0.07);
				this.tone(1320, 0.08, "square", 0.04, 0.06);
				break;
			case "approve":
				this.tone(660, 0.08);
				this.tone(990, 0.12, "square", 0.05, 0.08);
				break;
			case "reject":
				this.tone(110, 0.25, "sawtooth", 0.05);
				break;
			case "fill":
				this.tone(988, 0.08, "square", 0.05);
				this.tone(1319, 0.2, "square", 0.05, 0.08);
				break;
			case "combo": {
				// Each combo arpeggio climbs a little higher, resetting after the FEVER run.
				this.comboStep = Math.min(this.comboStep + 1, 6);
				const lift = 1 + this.comboStep * 0.06;
				this.arpeggio([523, 659, 784, 1047], lift, 0.09, 0.045, 0.06);
				break;
			}
			case "loss":
				this.comboStep = 0;
				this.noise(0.25);
				this.tone(140, 0.4, "triangle", 0.07, 0.05);
				break;
			case "fever":
				this.arpeggio([523, 659, 784, 1047, 1319, 1568], 1.2, 0.08, 0.04, 0.05);
				break;
		}
	}

	private arpeggio(notes: readonly number[], lift: number, duration: number, volume: number, spacing: number): void {
		notes.forEach((note, i) => {
			this.tone(note * lift, duration, "square", volume, i * spacing);
		});
	}

	private tone(frequency: number, duration: number, type: OscillatorType = "square", volume = 0.05, delay = 0): void {
		const ctx = this.ctx;
		if (!ctx) return;
		const start = ctx.currentTime + delay;
		const oscillator = ctx.createOscillator();
		const gain = ctx.createGain();
		oscillator.type = type;
		oscillator.frequency.setValueAtTime(frequency, start);
		gain.gain.setValueAtTime(volume, start);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
		oscillator.connect(gain).connect(ctx.destination);
		oscillator.start(start);
		oscillator.stop(start + duration + 0.02);
	}

	private noise(duration: number, volume = 0.06): void {
		const ctx = this.ctx;
		if (!ctx) return;
		const length = Math.floor(ctx.sampleRate * duration);
		const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
		const channel = buffer.getChannelData(0);
		for (let i = 0; i < length; i++) channel[i] = (Math.random() * 2 - 1) * (1 - i / length);
		const source = ctx.createBufferSource();
		const gain = ctx.createGain();
		gain.gain.value = volume;
		source.buffer = buffer;
		source.connect(gain).connect(ctx.destination);
		source.start();
	}
}
