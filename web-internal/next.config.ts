import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Dev-only: allow accessing the dev server via 127.0.0.1 as well as localhost
  // (Next 16 blocks cross-origin requests to /_next/* dev resources by default).
  allowedDevOrigins: ['127.0.0.1'],
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: 'http://127.0.0.1:8080/api/v1/:path*',
      },
    ];
  },
};

export default nextConfig;
