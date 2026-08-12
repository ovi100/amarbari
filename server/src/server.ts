import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import prisma from './utils/prisma';
import { closeKeyValueStore, initKeyValueStore } from './utils/keyValueStore';
import { closeSockets, initSockets } from './sockets';

async function main() {
  await initKeyValueStore();

  const app = createApp();
  const server = http.createServer(app);
  initSockets(server);

  server.listen(env.port, () => {
    logger.info(`AmarBari API listening on http://localhost:${env.port}`);
    logger.info(`REST base: http://localhost:${env.port}/api/v1`);
    logger.info(`CORS origins: ${env.cors.origins.join(', ')}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    server.close();
    await closeSockets();
    await closeKeyValueStore();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error('Fatal startup error:', error);
  process.exit(1);
});
