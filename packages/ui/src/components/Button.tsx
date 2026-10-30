import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'metal' | 'gold' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  metal: 'kvl-btn-metal kvl-metal',
  gold: 'kvl-btn-gold',
  secondary: 'kvl-btn-secondary',
  ghost: 'kvl-btn-ghost',
  danger: 'kvl-btn-danger',
};

export function Button({ variant = 'secondary', className = '', children, ...rest }: ButtonProps) {
  return (
    <button className={`kvl-btn ${variantClass[variant]} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
