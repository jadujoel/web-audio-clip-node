import type { ClipNode } from "./ClipNode";
import type { StreamingClipNode } from "./StreamingClipNode";

export interface MediaSessionOptions {
	title?: string;
	artist?: string;
	album?: string;
	artwork?: MediaImage[];
}

type AnyClipNode = ClipNode | StreamingClipNode;

function isStreamingNode(node: AnyClipNode): node is StreamingClipNode {
	return "onmetadata" in node;
}

/**
 * Bridges a ClipNode or StreamingClipNode to `navigator.mediaSession`,
 * enabling OS-level media controls (lock screen, notification center, browser media overlay).
 *
 * Returns an unbind function that removes all handlers and restores previous state.
 */
export function bindMediaSession(
	node: AnyClipNode,
	options?: MediaSessionOptions,
): () => void {
	if (typeof navigator === "undefined" || !navigator.mediaSession) {
		return () => {};
	}

	const session = navigator.mediaSession;

	// --- Metadata ---
	session.metadata = new MediaMetadata({
		title: options?.title ?? "Unknown",
		...(options?.artist !== undefined && { artist: options.artist }),
		...(options?.album !== undefined && { album: options.album }),
		...(options?.artwork !== undefined && { artwork: options.artwork }),
	});

	// --- Action handlers ---
	const actions: MediaSessionAction[] = [
		"play",
		"pause",
		"stop",
		"seekbackward",
		"seekforward",
		"seekto",
	];

	session.setActionHandler("play", () => node.resume());
	session.setActionHandler("pause", () => node.pause());
	session.setActionHandler("stop", () => node.stop());
	session.setActionHandler("seekbackward", (details) => {
		const offset = details.seekOffset ?? 10;
		node.currentTime = Math.max(0, node.currentTime - offset);
	});
	session.setActionHandler("seekforward", (details) => {
		const offset = details.seekOffset ?? 10;
		node.currentTime = Math.min(node.duration, node.currentTime + offset);
	});
	session.setActionHandler("seekto", (details) => {
		if (details.seekTime != null) {
			node.currentTime = details.seekTime;
		}
	});

	// --- Playback state updates ---
	function updatePositionState() {
		const dur = node.duration;
		if (dur <= 0 || !Number.isFinite(dur)) return;
		try {
			session.setPositionState({
				duration: dur,
				playbackRate: node.playbackRate.value,
				position: Math.max(0, Math.min(node.currentTime, dur)),
			});
		} catch {
			// setPositionState can throw if values are invalid
		}
	}

	const handleStateChange = (e: {
		readonly type: "statechange";
		readonly state: import("./types").ClipNodeState;
	}) => {
		switch (e.state) {
			case "started":
			case "resumed":
				session.playbackState = "playing";
				break;
			case "paused":
				session.playbackState = "paused";
				break;
			case "stopped":
			case "ended":
			case "disposed":
				session.playbackState = "none";
				break;
		}
		updatePositionState();
	};
	node.events.addEventListener("statechange", handleStateChange);

	const handleTimeUpdate = () => {
		updatePositionState();
	};
	node.events.addEventListener("timeupdate", handleTimeUpdate);

	// --- Auto-metadata from streaming node ---
	let handleMetadata:
		| ((e: {
				readonly type: "metadata";
				readonly metadata: import("./types").AudioMetadata;
		  }) => void)
		| undefined;
	if (isStreamingNode(node)) {
		handleMetadata = (e) => {
			session.metadata = new MediaMetadata({
				title: e.metadata.title ?? options?.title ?? "Unknown",
				...(() => {
					const v = e.metadata.artist ?? options?.artist;
					return v !== undefined ? { artist: v } : {};
				})(),
				...(() => {
					const v = e.metadata.album ?? options?.album;
					return v !== undefined ? { album: v } : {};
				})(),
				...(options?.artwork !== undefined && { artwork: options.artwork }),
			});
		};
		node.streamEvents.addEventListener("metadata", handleMetadata);
	}

	// --- Unbind ---
	return () => {
		for (const action of actions) {
			session.setActionHandler(action, null);
		}
		session.playbackState = "none";
		session.metadata = null;
		node.events.removeEventListener("statechange", handleStateChange);
		node.events.removeEventListener("timeupdate", handleTimeUpdate);
		if (isStreamingNode(node) && handleMetadata) {
			node.streamEvents.removeEventListener("metadata", handleMetadata);
		}
	};
}
