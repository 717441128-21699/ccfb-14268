import { useEffect, useRef } from 'react';
import { BANDS } from '../core/bands';
import { grayToImageData } from '../core/synthetic';
import type { GrayImage } from '../core/raster';

/** 六波段缩略图（离屏 canvas 一次性绘制） */
export function BandThumbs({ bands }: { bands: GrayImage[] }) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  useEffect(() => {
    bands.forEach((img, i) => {
      const canvas = refs.current[i];
      if (!canvas) return;
      const maxW = 120;
      const scale = maxW / img.width;
      canvas.width = maxW;
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d')!;
      const full = document.createElement('canvas');
      full.width = img.width;
      full.height = img.height;
      full.getContext('2d')!.putImageData(grayToImageData(img), 0, 0);
      ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
    });
  }, [bands]);

  return (
    <div className="band-thumb">
      {BANDS.map((b, i) => (
        <div className="tb" key={b.id} title={b.note}>
          <canvas ref={(el) => { refs.current[i] = el; }} />
          <div className="cap" style={{ color: b.color }}>{b.short}</div>
        </div>
      ))}
    </div>
  );
}
