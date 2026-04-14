import { memo, useCallback, useId } from "react";
import { SAMPLE_RATE } from "../controls/controlDefs";
import { SnappableSlider } from "./SnappableSlider";

export interface PlayheadSliderProps {
	/** Current playhead position in samples. */
	value: number;
	/** Audio duration in seconds (null when no audio loaded). */
	audioDuration: number | null;
	/** Decoded seekable progress in samples for streaming mode. */
	seekableSamples?: number | null;
	/** Byte-level stream progress [0, 1] for unknown-duration streams. */
	streamProgress?: number;
	/** Whether playback is active (started/paused). */
	disabled?: boolean;
	/** Called when the user seeks to a new position (value in samples). */
	onChange: (samplePosition: number) => void;
}

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function PlayheadSliderInner({
	value,
	audioDuration,
	seekableSamples = null,
	streamProgress = 0,
	disabled = false,
	onChange,
}: PlayheadSliderProps) {
	const labelId = useId();
	const maxSamples = audioDuration != null ? audioDuration * SAMPLE_RATE : 0;
	const currentSeconds = value / SAMPLE_RATE;
	const durationSeconds = audioDuration ?? 0;
	const bufferedRatio =
		maxSamples > 0 && seekableSamples != null
			? Math.min(1, Math.max(0, seekableSamples / maxSamples))
			: Math.min(1, Math.max(0, streamProgress));

	const handleChange = useCallback(
		(v: number) => {
			onChange(Math.floor(v));
		},
		[onChange],
	);

	return (
		<div className="playhead-slider">
			<span className="playhead-label" id={labelId}>
				Playhead
			</span>
			<div className="playhead-slider-track-wrapper">
				<div
					className="playhead-buffer-track"
					aria-hidden="true"
					data-testid="playhead-buffer-track"
				>
					<div
						className="playhead-buffer-pending"
						data-testid="playhead-buffer-pending"
					/>
					<div
						className="playhead-buffer-fill"
						data-testid="playhead-buffer-fill"
						style={{ width: `${bufferedRatio * 100}%` }}
					/>
				</div>
				<SnappableSlider
					min={0}
					max={maxSamples}
					value={value}
					disabled={disabled || maxSamples === 0}
					labelId={labelId}
					valueText={formatTime(currentSeconds)}
					onChange={handleChange}
				/>
			</div>
			<span className="playhead-time">
				{formatTime(currentSeconds)} / {formatTime(durationSeconds)}
			</span>
		</div>
	);
}

export const PlayheadSlider = memo(PlayheadSliderInner);
