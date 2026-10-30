import { useEffect } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

function resolveIsDark(preference: ThemePreference): boolean {
  if (preference === 'system') {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return preference === 'dark';
}

/** Applies/removes the `dark` class on <html> to match the given preference. */
export function useThemeSync(preference: ThemePreference) {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => root.classList.toggle('dark', resolveIsDark(preference));
    apply();

    if (preference !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, [preference]);
}
