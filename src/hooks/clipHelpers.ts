import type { ClipNode } from "../audio/ClipNode";
import { linFromDb } from "../audio/utils";
import type { ControlKey } from "../controls/controlDefs";

export function applyValueToClip(
	node: ClipNode,
	key: ControlKey,
	value: number,
) {
	switch (key) {
		case "playhead":
			node.playhead = value;
			break;
		case "offset":
			node.offset = value;
			break;
		case "duration":
			node.duration = value;
			break;
		case "loopStart":
			node.loopStart = value;
			break;
		case "loopEnd":
			node.loopEnd = value;
			break;
		case "loopCrossfade":
			node.loopCrossfade = value;
			break;
		case "loopCrossfadeOffset":
			node.loopCrossfadeOffset = value;
			break;
		case "fadeIn":
			node.fadeIn = value;
			break;
		case "fadeOut":
			node.fadeOut = value;
			break;
		case "playbackRate":
			node.playbackRate.value = value;
			break;
		case "detune":
			node.detune.value = value;
			break;
		case "gain":
			node.gain.value = linFromDb(value);
			break;
		case "pan":
			node.pan.value = value;
			break;
		case "lowpass":
			node.lowpass.value = value;
			break;
		case "highpass":
			node.highpass.value = value;
			break;
		case "startDelay":
		case "stopDelay":
			break;
	}
}

export function applyToggleToClip(
	node: ClipNode,
	key: ControlKey,
	on: boolean,
) {
	switch (key) {
		case "fadeIn":
			node.toggleFadeIn(on);
			break;
		case "fadeOut":
			node.toggleFadeOut(on);
			break;
		case "loopCrossfade":
			node.toggleLoopCrossfade(on);
			break;
		case "loopStart":
			node.toggleLoopStart(on);
			break;
		case "loopEnd":
			node.toggleLoopEnd(on);
			break;
		case "playbackRate":
			node.togglePlaybackRate(on);
			break;
		case "detune":
			node.toggleDetune(on);
			break;
		case "gain":
			node.toggleGain(on);
			break;
		case "pan":
			node.togglePan(on);
			break;
		case "lowpass":
			node.toggleLowpass(on);
			break;
		case "highpass":
			node.toggleHighpass(on);
			break;
		case "offset":
			node.offset = on ? node.offset : 0;
			break;
		case "duration":
			node.duration = on ? node.duration : -1;
			break;
		case "startDelay":
		case "stopDelay":
		case "loopCrossfadeOffset":
			break;
	}
}
