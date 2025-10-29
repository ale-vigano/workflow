import type { NextConfig } from 'next';
import { withWorkflow } from 'workflow/next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@node-rs/xxhash'],
  transpilePackages: ['@worklow-npm-library'],
  workflows: {
    libraries: ['@worklow-npm-library'],
  },
};

export default withWorkflow(nextConfig);
