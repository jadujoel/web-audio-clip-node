
declare type Scale = 'linear' | 'log10' | 'exponential' | 'decibel';

declare interface SnappableSliderProperties {
  /**
   * The current value of the slider.
   */
  readonly value?: number,
  /**
   * The minimum value of the slider.
   * @default 0
   */
  readonly min?: number,
  /**
   * The maximum value of the slider.
   * @default 1
   */
  readonly max?: number,
  readonly snap?: boolean,
  readonly snaps?: number[],
  /**
   * The skew factor of the slider.
   * This property determines the mapping of the slider value to the actual value.
   * - 'linear': The slider value is mapped linearly to the actual value.
   * - 'logarithmic': The slider value is mapped logarithmically to the actual value.
   *   - a value of 1 maps to 0
   *   - a value of 10 maps to 1
   *   - a value of 100 maps to 2
   *   - a value of 1000 maps to 3
   * - 'exponential': The slider value is mapped exponentially to the actual value.
   * - 'decibel': The slider value is mapped to the actual value in decibels.
   * @default 'linear'
   *
   */
  readonly scale?: Scale,
  readonly skew?: number,
  readonly preset?: string
  // readonly children?: readonly HTMLElement[],
}

type Transform = 'lin' | 'dB'

type Writeable<T> = { -readonly [P in keyof T]: T[P] };
declare type SnappableSliderState = Writeable<Required<SnappableSliderProperties>>;
