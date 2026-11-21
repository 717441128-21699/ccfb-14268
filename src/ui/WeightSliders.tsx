import { BANDS } from '../core/bands';
import type { BandWeights } from '../core/types';

/** 六个波段的权重滑杆组（0..3） */
export function WeightSliders({
  weights,
  onChange,
}: {
  weights: BandWeights;
  onChange: (next: BandWeights) => void;
}) {
  return (
    <div>
      {BANDS.map((b, i) => (
        <div className="weight-row" key={b.id}>
          <span style={{ color: b.color, fontSize: 12 }}>{b.short}</span>
          <input
            type="range"
            min={0}
            max={3}
            step={0.05}
            value={weights[i]}
            onChange={(e) => {
              const next = [...weights] as BandWeights;
              next[i] = Number(e.target.value);
              onChange(next);
            }}
          />
          <span className="wv">{weights[i]!.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}
