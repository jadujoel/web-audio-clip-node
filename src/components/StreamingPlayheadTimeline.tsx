import { memo, useCallback, useId } from "react";
import { SAMPLE_RATE } from "../controls/controlDefs";
import { SnappableSlider } from "./SnappableSlider";
import { buildStreamingPlayheadModel } from "./streamingPlayheadMath";

export interface StreamingPlayheadTimelineProps {
	/** Current playhead position in samples. */
	value: number;
	/** Audio duration in seconds (null while unknown). */
	audioDuration: number | null;
	/** Decoded seekable progress in samples. */
	seekableSamples: number | null;
	/** Byte-level stream progress [0, 1] fallback while duration is unknown. */
	streamProgress: number;
	/** Whether seeking interaction is disabled. */
	disabled?: boolean;
	/** Called when the user seeks to a new position (value in samples). */
	onChange: (samplePosition: number) => void;
}

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function StreamingPlayheadTimelineInner({
	value,
	audioDuration,
	seekableSamples,
	streamProgress,
	disabled = false,
	onChange,
}: StreamingPlayheadTimelineProps) {
	const labelId = useId();
	const currentSeconds = value / SAMPLE_RATE;
	const durationSeconds = audioDuration ?? 0;
	const { maxSamples, decodedRatio, decodedPercent } =
		buildStreamingPlayheadModel({
			value,
			audioDuration,
			seekableSamples,
			streamProgress,
		});

	const handleChange = useCallback(
		(v: number) => {
			onChange(Math.floor(v));
		},
		[onChange],
	);

	return (
		<div
			className="playhead-slider streaming-playhead-timeline"
			data-testid="streaming-playhead-track"
			data-decoded-percent={decodedPercent}
			style={
				{
					"--streaming-decoded": `${decodedRatio * 100}%`,
				} as React.CSSProperties
			}
		>
			<span className="playhead-label" id={labelId}>
				Playhead
			</span>
			<div className="playhead-slider-track-wrapper">
				<SnappableSlider
					min={0}
					max={maxSamples}
					value={value}
					disabled={disabled || maxSamples === 0}
					labelId={labelId}
					valueText={`${formatTime(currentSeconds)} (decoded ${decodedPercent}%)`}
					onChange={handleChange}
				/>
			</div>
			<span className="playhead-time">
				{formatTime(currentSeconds)} / {formatTime(durationSeconds)}
			</span>
		</div>
	);
}

export const StreamingPlayheadTimeline = memo(StreamingPlayheadTimelineInner);
