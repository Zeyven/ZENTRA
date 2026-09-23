import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@ayra/ui', '@ayra/design-tokens'],
  poweredByHeader: false,
};
export default config;
