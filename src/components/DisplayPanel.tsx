import type { ClipNodeState } from "../audio/types";

interface DisplayPanelProps {
	nodeState: ClipNodeState;
	statusMessage: string | null;
	currentTime: string;
	currentFrame: string;
	timesLooped: string;
	latency: string;
	timeTaken: string;
}

export function DisplayPanel({
	nodeState,
	statusMessage,
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
			<code>State:</code>
			<output>{nodeState}</output>
			<br />
			<code>CurrentTime:</code>
			<output>{currentTime}</output>
			<code>CurrentFrame:</code>
			<output>{currentFrame}</output>
			<code>TimesLooped:</code>
			<output>{timesLooped}</output>
			<br />
			<code>Latency:</code>
			<output>{latency}</output>
			<code>TimeTaken:</code>
			<output>{timeTaken}</output>
		</section>
	);
}
