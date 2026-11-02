import * as dotenv from 'dotenv';
dotenv.config();

export const config = {
  apiUrl: (process.env.API_URL ?? '').replace(/\/$/, ''),
  uiUrl: process.env.UI_URL ?? '',
  ownerEmail: process.env.OWNER_EMAIL ?? '',
  ownerPassword: process.env.OWNER_PASSWORD ?? '',
  locationId: process.env.LOCATION_ID ?? '',
};

if (!config.apiUrl) {
  throw new Error('API_URL is not set. Copy .env.example to .env and fill it in.');
}
