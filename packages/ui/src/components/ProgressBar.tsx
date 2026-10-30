export interface ProgressBarProps {
  /** 0-100 */
  percent: number;
  label?: string;
}

export function ProgressBar({ percent, label }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {label ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'rgb(var(--muted))' }}>
          <span>{label}</span>
          <span>{clamped}%</span>
        </div>
      ) : null}
      <div className="kvl-progress-track">
        <div className="kvl-progress-fill" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
