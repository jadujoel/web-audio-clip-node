/**
 * Test utilities for managing AudioContext lifecycle.
 *
 * In browser mode (Vitest), all Web Audio and DOM APIs are native.
 */

type ManagedAudioContext = AudioContext | OfflineAudioContext;

const registeredAudioContexts = new Set<ManagedAudioContext>();

function isClosableAudioContext(
	context: ManagedAudioContext,
): context is AudioContext {
	return typeof (context as AudioContext).close === "function";
}

function isAlreadyClosedError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const name = error.name.toLowerCase();
	const message = error.message.toLowerCase();
	return (
		name.includes("invalidstate") ||
		message.includes("closed") ||
		message.includes("cannot close")
	);
}

export function registerAudioContext<T extends ManagedAudioContext>(
	context: T,
): T {
	registeredAudioContexts.add(context);
	return context;
}

export function getRegisteredAudioContextCountForTest(): number {
	return registeredAudioContexts.size;
}

export async function closeRegisteredAudioContexts(): Promise<void> {
	const contexts = [...registeredAudioContexts];
	registeredAudioContexts.clear();

	for (const context of contexts) {
		if (!isClosableAudioContext(context)) {
			continue;
		}

		try {
			await context.close();
		} catch (error) {
			if (isAlreadyClosedError(error)) {
				continue;
			}
			throw error;
		}
	}
}

/**
 * Create an AudioContext for tests.
 *
 * Defaults to OfflineAudioContext to keep tests fast and deterministic.
 * Pass `preferOffline: false` only when you explicitly need real-time
 * behaviour (e.g. testing AudioContext.state transitions).
 */
export function createContext(opts?: {
	sampleRate?: number;
	length?: number;
	channels?: number;
	/** @default true */
	preferOffline?: boolean;
}): AudioContext | OfflineAudioContext {
	const sampleRate = opts?.sampleRate ?? 44100;
	if (opts?.preferOffline !== false) {
		return registerAudioContext(
			new OfflineAudioContext(
				opts?.channels ?? 1,
				opts?.length ?? sampleRate,
				sampleRate,
			),
		);
	}
	try {
		return registerAudioContext(new AudioContext({ sampleRate }));
	} catch {
		return registerAudioContext(
			new OfflineAudioContext(
				opts?.channels ?? 1,
				opts?.length ?? sampleRate,
				sampleRate,
			),
		);
	}
}

/**
 * Run audio through the context and then clean up.
 * - OfflineAudioContext: calls startRendering()
 * - AudioContext: waits for the given duration then closes
 */
export async function renderContext(
	context: AudioContext | OfflineAudioContext,
	durationMs = 150,
): Promise<void> {
	if (context instanceof OfflineAudioContext) {
		await context.startRendering();
	} else {
		await new Promise((resolve) => setTimeout(resolve, durationMs));
		await context.close();
	}
}
