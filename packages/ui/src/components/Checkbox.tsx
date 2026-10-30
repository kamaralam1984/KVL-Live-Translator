export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, label, disabled }: CheckboxProps) {
  return (
    <label className="kvl-check-row" style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span
        role="checkbox"
        aria-checked={checked}
        className={`kvl-checkbox ${checked ? 'kvl-checked' : ''}`.trim()}
        onClick={() => !disabled && onChange(!checked)}
      />
      {label ? <span style={{ fontSize: 13, color: 'rgb(var(--foreground))' }}>{label}</span> : null}
    </label>
  );
}
