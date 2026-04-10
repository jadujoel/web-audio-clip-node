type ClipProcessorOnmessage = (ev: { readonly data: ClipProcessorMessageRx }) => void

interface ClipProcessorStateMap {
  readonly Initial: 0,
  readonly Started: 1,
  readonly Stopped: 2,
  readonly Paused: 3,
  readonly Scheduled: 4,
  readonly Ended: 5,
  readonly Disposed: 6
}

type ClipProcessorState = ClipProcessorStateMap[keyof ClipProcessorStateMap]

interface ClipWorkletOptions extends AudioWorkletNodeOptions {
  readonly processorOptions?: ClipProcessorOptions
}

interface ClipProcessorOptions {
  buffer?: Float32Array[],
  loop?: boolean,
  loopStart?: number,
  loopEnd?: number,
  loopCrossfade?: number
  offset?: number,
  duration?: number,
  playhead?: number,
  state?: ClipProcessorState
  startWhen?: number
  stopWhen?: number
  pauseWhen?: number
  resumeWhen?: number
  playedSamples?: number
  timesLooped?: number
  fadeInDuration?: number
  fadeOutDuration?: number
  enableFadeIn?: boolean
  enableFadeOut?: boolean
  enableLoopCrossfade?: boolean
  enableGain?: boolean
  enablePan?: boolean
  enableHighpass?: boolean
  enableLowpass?: boolean
  enableDetune?: boolean
  enablePlaybackRate?: boolean
}

interface BlockParameters {
  readonly playhead: number
  readonly durationSamples: number
  readonly loop: boolean
  readonly loopStartSamples: number
  readonly loopEndSamples: number
  readonly bufferLength: number
  readonly playbackRates: Float32Array
}

interface BlockReturnState {
  readonly playhead: number
  readonly ended: boolean
  readonly looped: boolean
  readonly indexes: number[]
}

type BlockState = BlockLoopState

type ClipProcessorMessageRx
  = ClipProcessorBufferMessageRx
  | ClipProcessorStartMessageRx
  | ClipProcessorStopMessageRx
  | ClipProcessorPauseMessageRx
  | ClipProcessorResumeMessageRx
  | ClipProcessorDisposeMessageRx
  | ClipProcessorLoopMessageRx
  | ClipProcessorLoopStartMessageRx
  | ClipProcessorLoopEndMessageRx
  | ClipProcessorPlayheadMessageRx
  | ClipProcessorFadeInMessageRx
  | ClipProcessorFadeOutMessageRx
  | ClipProcessorLoopCrossfadeMessageRx
  | ClipProcessorToggleMessageRx
  | ClipProcessorLogStateMessageRx

type ClipProcessorMessageType
  = 'buffer'
  | 'start'
  | 'stop'
  | 'pause'
  | 'resume'
  | 'dispose'
  | 'loop'
  | 'loopStart'
  | 'loopEnd'
  | 'playhead'
  | 'playbackRate'
  | 'offset'
  | 'fadeIn'
  | 'fadeOut'
  | 'loopCrossfade'
  | ClipProcessorToggleMessageType
  | 'logState'

type ClipProcessorToggleMessageType =
  'toggleFadeIn'
  | 'toggleFadeOut'
  | 'toggleLoopCrossfade'
  | 'toggleGain'
  | 'togglePan'
  | 'toggleHighpass'
  | 'toggleLowpass'
  | 'toggleDetune'
  | 'togglePlaybackRate'

interface ClipProcessorLogStateMessageRx {
  readonly type: 'logState'
  readonly data?: never
}

interface ClipProcessorToggleMessageRx {
  readonly type: ClipProcessorToggleMessageType
  readonly data?: boolean
}

interface ClipProcessorBufferMessageRx {
  readonly type: 'buffer',
  readonly data: Float32Array[]
}

interface ClipProcessorStartMessageRx {
  readonly type: 'start',
  readonly data?: {
    readonly duration?: number,
    readonly offset?: number,
    readonly when?: number
  }
}

interface ClipProcessorStopMessageRx {
  readonly type: 'stop',
  readonly data?: number
}

interface ClipProcessorPauseMessageRx {
  readonly type: 'pause',
  readonly data?: number
}

interface ClipProcessorResumeMessageRx {
  readonly type: 'resume',
  readonly data?: number
}

interface ClipProcessorDisposeMessageRx {
  readonly type: 'dispose'
  readonly data?: never
}

interface ClipProcessorLoopMessageRx {
  readonly type: 'loop',
  readonly data: boolean
}

interface ClipProcessorLoopStartMessageRx {
  readonly type: 'loopStart',
  readonly data: number
}

interface ClipProcessorLoopEndMessageRx {
  readonly type: 'loopEnd',
  readonly data: number
}

interface ClipProcessorPlayheadMessageRx {
  readonly type: 'playhead',
  readonly data: number
}

interface ClipProcessorFadeInMessageRx {
  readonly type: 'fadeIn',
  readonly data: number
}

interface ClipProcessorFadeOutMessageRx {
  readonly type: 'fadeOut',
  readonly data: number
}

interface ClipProcessorLoopCrossfadeMessageRx {
  readonly type: 'loopCrossfade',
  readonly data: number
}
