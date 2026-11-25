import 'dotenv/config';

const required = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5001),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  ninKeyHex: required('NIN_ENCRYPTION_KEY'),
  autoApproveBookings: process.env.AUTO_APPROVE_BOOKINGS === 'true',
  offerTimeoutMinutes: Number(process.env.OFFER_TIMEOUT_MINUTES || 60),
  vatRate: Number(process.env.VAT_RATE || 0),
  contact: {
    phone: process.env.CONTACT_PHONE || '',
    email: process.env.CONTACT_EMAIL || '',
    whatsapp: process.env.CONTACT_WHATSAPP || '',
    address: process.env.CONTACT_ADDRESS || '',
    hours: process.env.CONTACT_HOURS || '',
  },
  accessTtl: '15m',
  refreshTtlDays: 7,
  serviceDistricts: (process.env.SERVICE_DISTRICTS || 'Kampala,Wakiso,Mukono')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean),
};

export const isServedDistrict = (name) =>
  config.serviceDistricts.some((d) => d.toLowerCase() === String(name).trim().toLowerCase());

if (!/^[0-9a-f]{64}$/i.test(config.ninKeyHex)) {
  throw new Error('NIN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
}
// Placeholder secrets from .env.example must never reach production.
if (config.env === 'production' && /change-me/.test(`${config.jwtAccessSecret}${config.jwtRefreshSecret}`)) {
  throw new Error('Replace the placeholder JWT secrets before running in production');
}
