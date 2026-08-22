import type { MetadataRoute } from 'next';
import { SITE_URL, MARKETING_LOCALES, buildLanguageAlternates } from '@/lib/seo';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of MARKETING_LOCALES) {
    entries.push({
      url: `${SITE_URL}/${locale}`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 1,
      alternates: { languages: buildLanguageAlternates() },
    });
    entries.push({
      url: `${SITE_URL}/${locale}/how-it-works`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.8,
      alternates: { languages: buildLanguageAlternates('/how-it-works') },
    });
  }

  return entries;
}
