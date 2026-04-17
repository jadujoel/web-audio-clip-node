export interface KickSchedulerOptions {
	audioContext: AudioContext;
	sidechain: AudioNode;
	destination: AudioNode;
	tempo: number;
	audible: boolean;
}

export class KickScheduler {
	private readonly scheduleAheadTime = 0.1;
	private readonly lookaheadInterval = 25;

	private audioContext: AudioContext;
	private sidechain: AudioNode;
	private destination: AudioNode;
	private nextNoteTime = 0;
	private timerId: ReturnType<typeof setTimeout> | null = null;
	private pausedAt: number | null = null;
	private _tempo: number;
	private audibleGain: GainNode;
	private _isPlaying = false;

	constructor(options: KickSchedulerOptions) {
		this.audioContext = options.audioContext;
		this.sidechain = options.sidechain;
		this.destination = options.destination;
		this._tempo = options.tempo;
		this.audibleGain = new GainNode(options.audioContext, {
			gain: options.audible ? 0.6 : 0,
		});
		this.audibleGain.connect(options.destination);
	}

	get isPlaying(): boolean {
		return this._isPlaying;
	}

	set tempo(bpm: number) {
		this._tempo = bpm;
	}

	set audible(value: boolean) {
		this.audibleGain.gain.value = value ? 0.6 : 0;
	}

	start(startTime?: number): void {
		if (this._isPlaying) return;
		this.nextNoteTime = startTime ?? this.audioContext.currentTime;
		this._isPlaying = true;
		this.pausedAt = null;
		this.schedule();
	}

	stop(): void {
		this.clearTimer();
		this._isPlaying = false;
		this.pausedAt = null;
	}

	pause(): void {
		if (!this._isPlaying) return;
		this.pausedAt = this.audioContext.currentTime;
		this.clearTimer();
	}

	resume(): void {
		if (this.pausedAt == null) return;
		const elapsed = this.audioContext.currentTime - this.pausedAt;
		this.nextNoteTime += elapsed;
		this.pausedAt = null;
		this.schedule();
	}

	dispose(): void {
		this.stop();
		try {
			this.audibleGain.disconnect();
		} catch {
			/* already disconnected */
		}
	}

	private schedule(): void {
		this.clearTimer();
		this.scheduleLookahead();
		this.timerId = setTimeout(() => this.schedule(), this.lookaheadInterval);
	}

	private scheduleLookahead(): void {
		const deadline = this.audioContext.currentTime + this.scheduleAheadTime;
		while (this.nextNoteTime < deadline) {
			this.scheduleKick(this.nextNoteTime);
			this.nextNoteTime += 60 / this._tempo;
		}
	}

	private scheduleKick(time: number): void {
		const ctx = this.audioContext;
		const osc = new OscillatorNode(ctx, { type: "sine", frequency: 150 });
		const oscGain = new GainNode(ctx, { gain: 1 });

		osc.frequency.setValueAtTime(150, time);
		osc.frequency.exponentialRampToValueAtTime(40, time + 0.07);

		oscGain.gain.setValueAtTime(1, time);
		oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

		osc.connect(oscGain);
		oscGain.connect(this.sidechain);
		oscGain.connect(this.audibleGain);

		osc.start(time);
		osc.stop(time + 0.15);
	}

	private clearTimer(): void {
		if (this.timerId != null) {
			clearTimeout(this.timerId);
			this.timerId = null;
		}
	}
}
