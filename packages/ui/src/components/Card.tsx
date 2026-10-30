import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  children: ReactNode;
}

export function Card({ interactive = false, className = '', children, ...rest }: CardProps) {
  const interactiveClass = interactive ? 'kvl-card-interactive' : '';
  return (
    <div className={`kvl-card ${interactiveClass} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}
