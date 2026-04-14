import type { ClipNode } from "./ClipNode";
import type { StreamingClipNode } from "./StreamingClipNode";
import type { AudioMetadata } from "./types";

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
		artist: options?.artist,
		album: options?.album,
		artwork: options?.artwork,
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
	const prevOnstatechange = node.onstatechange;
	node.onstatechange = (state) => {
		prevOnstatechange?.(state);
		switch (state) {
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

	// --- Position state updates ---
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

	const prevOntimeupdate = node.ontimeupdate;
	node.ontimeupdate = (ct: number) => {
		prevOntimeupdate?.(ct);
		updatePositionState();
	};

	// --- Auto-metadata from streaming node ---
	let prevOnmetadata: ((meta: AudioMetadata) => void) | undefined;
	if (isStreamingNode(node)) {
		prevOnmetadata = node.onmetadata;
		node.onmetadata = (meta: AudioMetadata) => {
			prevOnmetadata?.(meta);
			session.metadata = new MediaMetadata({
				title: meta.title ?? options?.title ?? "Unknown",
				artist: meta.artist ?? options?.artist,
				album: meta.album ?? options?.album,
				artwork: options?.artwork,
			});
		};
	}

	// --- Unbind ---
	return () => {
		for (const action of actions) {
			session.setActionHandler(action, null);
		}
		session.playbackState = "none";
		session.metadata = null;
		node.onstatechange = prevOnstatechange;
		node.ontimeupdate = prevOntimeupdate;
		if (isStreamingNode(node)) {
			node.onmetadata = prevOnmetadata;
		}
	};
}
