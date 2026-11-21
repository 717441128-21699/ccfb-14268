/** float32 -> IEEE 754 half（反射率已钳制到 0..1，无 NaN/Inf） */
export function floatToHalf(v: number): number {
  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  f32[0] = v;
  const x = u32[0]!;
  const bits = (x >>> 16) & 0x8000;
  const m = x & 0x7fffff;
  const e = (x >>> 23) & 0xff;
  let r: number;
  if (e === 0) {
    r = 0;
  } else if (e < 113) {
    const mm = m | 0x800000;
    r = (mm >>> (126 - e)) + 1;
    r = r >>> 1;
  } else if (e <= 142) {
    r = ((e - 112) << 10) | (m >>> 13);
  } else {
    r = 0x7c00;
  }
  return bits | r;
}
