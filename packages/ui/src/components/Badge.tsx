import type { HTMLAttributes, ReactNode } from 'react';

export type BadgeVariant = 'neutral' | 'color' | 'success' | 'warning' | 'danger' | 'gold';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: ReactNode;
}

const variantClass: Record<BadgeVariant, string> = {
  neutral: 'kvl-badge-neutral',
  color: 'kvl-badge-color',
  success: 'kvl-badge-success',
  warning: 'kvl-badge-warning',
  danger: 'kvl-badge-danger',
  gold: 'kvl-badge-gold',
};

export function Badge({ variant = 'neutral', className = '', children, ...rest }: BadgeProps) {
  return (
    <span className={`kvl-badge ${variantClass[variant]} ${className}`.trim()} {...rest}>
      {children}
    </span>
  );
}
