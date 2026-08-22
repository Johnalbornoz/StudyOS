import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'StudyUS',
    short_name: 'StudyUS',
    description:
      'Personalized AI learning for deeper understanding, concept mastery, and better academic performance.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F7F6F3',
    theme_color: '#2F6B5E',
    icons: [
      {
        src: '/icon.png',
        sizes: '1254x1254',
        type: 'image/png',
      },
    ],
  };
}
