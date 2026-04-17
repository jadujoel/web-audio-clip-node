import { useCallback, useEffect, useRef, useState } from "react";
import { KickScheduler } from "../audio/kick/KickScheduler";

export interface UseKickSchedulerOptions {
	audioContext: AudioContext | null;
	sidechain: AudioNode | null;
	tempo: number;
	audible: boolean;
}

export interface UseKickSchedulerReturn {
	start: (startTime?: number) => void;
	stop: () => void;
	pause: () => void;
	resume: () => void;
	isPlaying: boolean;
}

export function useKickScheduler({
	audioContext,
	sidechain,
	tempo,
	audible,
}: UseKickSchedulerOptions): UseKickSchedulerReturn {
	const schedulerRef = useRef<KickScheduler | null>(null);
	const tempoRef = useRef(tempo);
	tempoRef.current = tempo;
	const audibleRef = useRef(audible);
	audibleRef.current = audible;
	const [isPlaying, setIsPlaying] = useState(false);

	// Create/destroy scheduler when audioContext or sidechain change
	useEffect(() => {
		if (!audioContext || !sidechain) {
			if (schedulerRef.current) {
				schedulerRef.current.dispose();
				schedulerRef.current = null;
				setIsPlaying(false);
			}
			return;
		}

		const scheduler = new KickScheduler({
			audioContext,
			sidechain,
			destination: audioContext.destination,
			tempo: tempoRef.current,
			audible: audibleRef.current,
		});
		schedulerRef.current = scheduler;

		return () => {
			scheduler.dispose();
			schedulerRef.current = null;
			setIsPlaying(false);
		};
	}, [audioContext, sidechain]);

	// Sync tempo
	useEffect(() => {
		if (schedulerRef.current) {
			schedulerRef.current.tempo = tempo;
		}
	}, [tempo]);

	// Sync audible
	useEffect(() => {
		if (schedulerRef.current) {
			schedulerRef.current.audible = audible;
		}
	}, [audible]);

	const start = useCallback((startTime?: number) => {
		if (schedulerRef.current) {
			schedulerRef.current.start(startTime);
			setIsPlaying(true);
		}
	}, []);

	const stop = useCallback(() => {
		if (schedulerRef.current) {
			schedulerRef.current.stop();
			setIsPlaying(false);
		}
	}, []);

	const pause = useCallback(() => {
		if (schedulerRef.current) {
			schedulerRef.current.pause();
		}
	}, []);

	const resume = useCallback(() => {
		if (schedulerRef.current) {
			schedulerRef.current.resume();
		}
	}, []);

	return { start, stop, pause, resume, isPlaying };
}
