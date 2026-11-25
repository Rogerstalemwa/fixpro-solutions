import app from './app.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { startBackgroundJobs } from './lib/delivery.js';

const server = app.listen(config.port, () =>
  logger.info(`FixPro API listening on http://localhost:${config.port}/api/v1`)
);

startBackgroundJobs();

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
