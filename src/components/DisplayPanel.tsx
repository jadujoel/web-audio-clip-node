import type { ClipNodeState } from "../audio/types";

interface DisplayPanelProps {
	nodeState: ClipNodeState;
	statusMessage: string | null;
	soundName: string | null;
	currentTime: string;
	currentFrame: string;
	timesLooped: string;
	latency: string;
	timeTaken: string;
}

export function DisplayPanel({
	nodeState,
	statusMessage,
	soundName,
	currentTime,
	currentFrame,
	timesLooped,
	latency,
	timeTaken,
}: DisplayPanelProps) {
	return (
		<section id="display">
			{statusMessage && (
				<div className="status-message" role="alert">
					{statusMessage}
				</div>
			)}
			<code>Sound:</code>
			<output>{soundName ?? "none"}</output>
			<code>State:</code>
			<output>{nodeState}</output>
			<code>Time:</code>
			<output>{currentTime}</output>
			<code>Loops:</code>
			<output>{timesLooped}</output>
			<details className="display-details">
				<summary>Debug</summary>
				<div className="display-details__row">
					<code>Frame:</code>
					<output>{currentFrame}</output>
					<code>Latency:</code>
					<output>{latency}</output>
					<code>TimeTaken:</code>
					<output>{timeTaken}</output>
				</div>
			</details>
		</section>
	);
}
