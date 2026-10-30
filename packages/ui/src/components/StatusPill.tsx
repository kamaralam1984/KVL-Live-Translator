import { Badge, type BadgeVariant } from './Badge';

export type StatusPillState = 'idle' | 'connecting' | 'connected' | 'listening' | 'error';

export interface StatusPillProps {
  label: string;
  state: StatusPillState;
}

const stateVariant: Record<StatusPillState, BadgeVariant> = {
  idle: 'neutral',
  connecting: 'warning',
  connected: 'success',
  listening: 'gold',
  error: 'danger',
};

const stateDotColor: Record<StatusPillState, string> = {
  idle: 'rgb(var(--muted))',
  connecting: 'rgb(var(--warning))',
  connected: 'rgb(var(--success))',
  listening: 'rgb(var(--accent))',
  error: 'rgb(var(--danger))',
};

export function StatusPill({ label, state }: StatusPillProps) {
  return (
    <Badge variant={stateVariant[state]} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: stateDotColor[state],
          flexShrink: 0,
        }}
      />
      {label}
    </Badge>
  );
}
