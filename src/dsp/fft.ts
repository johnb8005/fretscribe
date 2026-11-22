// In-place iterative radix-2 FFT with cached twiddles + Hann window.

export class FFT {
  readonly size: number;
  private cos: Float64Array;
  private sin: Float64Array;
  private rev: Uint32Array;
  readonly window: Float32Array;
  private re: Float64Array;
  private im: Float64Array;
  readonly magnitudes: Float32Array;

  constructor(size: number) {
    if ((size & (size - 1)) !== 0) throw new Error("FFT size must be a power of 2");
    this.size = size;
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    const bits = Math.log2(size);
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.window = new Float32Array(size);
    for (let i = 0; i < size; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
    this.magnitudes = new Float32Array(size / 2);
  }

  /** Windowed magnitude spectrum of the last `size` samples of `input`. */
  magnitude(input: Float32Array): Float32Array {
    const n = this.size;
    const off = input.length - n;
    const { re, im, rev, window } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      re[j] = (input[off + i] ?? 0) * window[i];
      im[j] = 0;
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = this.sin[k * step];
          const a = i + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    const norm = 2 / n;
    for (let i = 0; i < n / 2; i++) this.magnitudes[i] = Math.hypot(re[i], im[i]) * norm;
    return this.magnitudes;
  }
}
