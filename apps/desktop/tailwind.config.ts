import type { Config } from 'tailwindcss';
// @ts-expect-error -- no type declarations ship for this subpath export
import baseConfig from '@kvl/ui/tailwind.config';

export default {
  ...baseConfig,
  content: ['./src/renderer/**/*.{ts,tsx,html}', '../../packages/ui/src/**/*.{ts,tsx}'],
} satisfies Config;
