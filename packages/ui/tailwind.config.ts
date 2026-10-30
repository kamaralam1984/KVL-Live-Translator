import type { Config } from 'tailwindcss';

/**
 * Base design-token config for the Platinum Silver & Gold theme, shared by
 * every app that renders @kvl/ui components. Intentionally has no `content`
 * key — the consuming app's tailwind.config.ts spreads this and supplies its
 * own `content` globs.
 */
const baseConfig: Omit<Config, 'content'> = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'rgb(var(--background) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-tint': 'rgb(var(--surface-tint) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-text': 'rgb(var(--accent-text) / <alpha-value>)',
        'accent-ink': 'rgb(var(--accent-ink) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      keyframes: {
        kvlIdleShine: {
          '0%': { transform: 'translateX(-130%) skewX(-18deg)' },
          '38%': { transform: 'translateX(230%) skewX(-18deg)' },
          '100%': { transform: 'translateX(230%) skewX(-18deg)' },
        },
        kvlPulseGlow: {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
        kvlTileBreathe: {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'kvl-idle-shine': 'kvlIdleShine 3s ease-in-out infinite',
        'kvl-pulse-glow': 'kvlPulseGlow 2.2s ease-in-out infinite',
        'kvl-tile-breathe': 'kvlTileBreathe 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default baseConfig;
