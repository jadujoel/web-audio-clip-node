import type { ClipNodeState } from "../audio/types";

interface TransportButtonsProps {
	nodeState: ClipNodeState;
	onStart: () => void;
	onStop: () => void;
	onPause: () => void;
	onResume: () => void;
	onDispose: () => void;
	onLog: () => void;
	onLoadSound: () => void;
}

export function TransportButtons({
	nodeState,
	onStart,
	onStop,
	onPause,
	onResume,
	onDispose,
	onLog,
	onLoadSound,
}: TransportButtonsProps) {
	const cantStop =
		nodeState === "initial" ||
		nodeState === "disposed" ||
		nodeState === "ended";

	return (
		<section id="buttons">
			<button
				type="button"
				onClick={onStart}
				disabled={nodeState === "started"}
				aria-disabled={nodeState === "started"}
			>
				Start
			</button>
			<button
				type="button"
				onClick={onStop}
				disabled={cantStop}
				aria-disabled={cantStop}
			>
				Stop
			</button>
			<button
				type="button"
				onClick={onPause}
				disabled={nodeState !== "started"}
				aria-disabled={nodeState !== "started"}
			>
				Pause
			</button>
			<button
				type="button"
				onClick={onResume}
				disabled={nodeState !== "paused"}
				aria-disabled={nodeState !== "paused"}
			>
				Resume
			</button>
			<button type="button" onClick={onDispose}>
				Dispose
			</button>
			<button type="button" onClick={onLog}>
				Log State
			</button>
			<button type="button" onClick={onLoadSound}>
				Load Sound
			</button>
		</section>
	);
}
