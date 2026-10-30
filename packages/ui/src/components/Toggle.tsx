export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

export function Toggle({ checked, onChange, disabled, ...rest }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`kvl-toggle ${checked ? 'kvl-on' : ''}`.trim()}
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <span className="kvl-toggle-thumb" />
    </button>
  );
}
