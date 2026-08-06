export interface SparklinePaths {
  linePath: string;
  areaPath: string;
}

/**
 * Builds SVG path `d` strings for a simple line + area-under-the-line
 * sparkline, scaling `data` to fit within [padding, height - padding]
 * against its own min/max. Flat data (or a single point) renders as a
 * flat line at mid-height rather than dividing by zero.
 */
export function buildSparklinePath(data: number[], width: number, height: number, padding = 4): SparklinePaths {
  if (data.length === 0) return { linePath: '', areaPath: '' };

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;
  const usableHeight = Math.max(0, height - padding * 2);
  const midY = height / 2;

  const points = data.map((value, i) => {
    const x = data.length === 1 ? width / 2 : (i / (data.length - 1)) * width;
    const y = range === 0 ? midY : height - padding - ((value - min) / range) * usableHeight;
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');

  const first = points[0];
  const last = points[points.length - 1];
  const areaPath = `${linePath} L ${last.x.toFixed(2)} ${height} L ${first.x.toFixed(2)} ${height} Z`;

  return { linePath, areaPath };
}
