export interface ProgressRingProps {
  /** 0-100 */
  percent: number;
  label?: string;
  size?: number;
}

export function ProgressRing({ percent, label, size = 104 }: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = size / 2 - 9;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const gradientId = `kvl-ring-gradient-${size}`;

  return (
    <div className="kvl-ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgb(var(--border) / 0.26)" strokeWidth={9} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#7c868f" />
          </linearGradient>
        </defs>
      </svg>
      <div className="kvl-ring-pct">
        <span style={{ fontSize: 19, fontWeight: 800, color: 'rgb(var(--foreground))' }}>{clamped}%</span>
        {label ? <span style={{ fontSize: 9, color: 'rgb(var(--muted))' }}>{label}</span> : null}
      </div>
    </div>
  );
}
