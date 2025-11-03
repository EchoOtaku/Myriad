export const SITE = {
  title: 'Myriad',
  description: 'Multi-platform personal information aggregation and analysis platform',
  defaultLanguage: 'en-us',
} as const;

export const API_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:3000';

export const PET_IMAGE_URL = import.meta.env.PUBLIC_PET_IMAGE_URL || 'https://api.fuukei.org/myriad/frontend/public/furina.png';
