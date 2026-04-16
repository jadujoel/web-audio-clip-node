import { memo, type NamedExoticComponent } from "react";
import type { ClipNodeState } from "../audio/clip/types";

export interface TransportButtonsProps {
	nodeState: ClipNodeState;
	onStart: () => void;
	onStop: () => void;
	onPause: () => void;
	onResume: () => void;
	onDispose: () => void;
	onLog: () => void;
	onLoadSound: () => void;
}

export function TransportButtonsInner({
	nodeState,
	onStart,
	onStop,
	onPause,
	onResume,
	onDispose,
	onLog,
	onLoadSound,
}: TransportButtonsProps): React.JSX.Element {
	const cantStop =
		nodeState === "initial" ||
		nodeState === "disposed" ||
		nodeState === "ended";

	return (
		<section id="buttons">
			<div className="btn-group-primary">
				<button type="button" onClick={onLoadSound}>
					Load Sound
				</button>
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
					disabled={nodeState !== "started" && nodeState !== "resumed"}
					aria-disabled={nodeState !== "started" && nodeState !== "resumed"}
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
			</div>
			<div className="btn-group-secondary">
				<button type="button" className="btn-secondary" onClick={onLog}>
					Log State
				</button>
				<button type="button" className="btn-secondary" onClick={onDispose}>
					Dispose
				</button>
			</div>
		</section>
	);
}

export const TransportButtons: NamedExoticComponent<TransportButtonsProps> =
	memo(TransportButtonsInner);
