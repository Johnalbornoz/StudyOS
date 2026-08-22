import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard/', '/api/', '/sign-in/', '/sign-up/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
