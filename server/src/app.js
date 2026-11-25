import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import routes from './routes.js';
import { PHOTO_DIR } from './lib/uploads.js';
import { notFound, errorHandler } from './middleware/error.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));

// Profile photos are public. ID documents live in a separate private folder and are never served statically.
app.use('/uploads/photos', express.static(PHOTO_DIR, {
  maxAge: '7d',
  setHeaders: (res) => res.set('Cross-Origin-Resource-Policy', 'cross-origin'),
}));

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'fixpro-api' }));
app.use('/api/v1', routes);
app.use(notFound);
app.use(errorHandler);

export default app;
