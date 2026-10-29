import type { NextConfig } from 'next';
import { nodeFileTrace } from '@vercel/nft';
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['unpdf', '@itk-wasm/dicom', 'itk-wasm', 'dicom-parser', 'sharp'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://*.supabase.co; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
          },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};
export default async function createConfig(): Promise<NextConfig> {
  const { fileList } = await nodeFileTrace(['scripts/dicom-worker.mjs'], {
    base: process.cwd(),
    conditions: ['node', 'import', 'default'],
  });
  return {
    ...config,
    outputFileTracingIncludes: {
      '/api/v1/**': [
        './public/fonts/*.ttf',
        ...Array.from(fileList, (p) => './' + p),
        './node_modules/@itk-wasm/dicom/dist/pipelines/**/*',
      ],
    },
  };
}
