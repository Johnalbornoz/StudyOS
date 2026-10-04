import type { MetadataRoute } from 'next';
import { BRAND_NAME, BRAND_SHORT_NAME, BRAND_COLOR, BRAND_ICON_192, BRAND_ICON_512, BRAND_ICON_MASKABLE_512 } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND_NAME,
    short_name: BRAND_NAME,
    description:
      'Personalized AI learning for deeper understanding, concept mastery, and better academic performance.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F7F6F3',
    theme_color: BRAND_COLOR,
    icons: [
      { src: BRAND_ICON_192, sizes: '192x192', type: 'image/png' },
      { src: BRAND_ICON_512, sizes: '512x512', type: 'image/png' },
      { src: BRAND_ICON_MASKABLE_512, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
