import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://vicarius-agent.vercel.app';
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/login'],
      disallow: ['/api/', '/setup'],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
