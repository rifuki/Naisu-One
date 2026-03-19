/**
 * Uniswap V4 Backend API Entry Point
 *
 * Production-ready REST API for Uniswap V4 on-chain queries
 * Built with Hono, Viem, and Bun
 */
import 'dotenv/config'
import { serve } from '@hono/node-server'
import { app } from './routes'
import { config } from './config/env'
import { logger } from './lib/logger'
import { startCronJobs, stopCronJobs } from './cron'

// ============================================================================
// Server Startup
// ============================================================================

async function startServer() {
  // Start cron jobs
  startCronJobs()

  // Start server (Hono Node adapter)
  const server = serve({
    fetch: app.fetch,
    port: config.server.port,
    hostname: config.server.host,
  })

  logger.info(
    `🚀 ${config.server.isProd ? 'Production' : 'Development'} server running at http://${config.server.host}:${server.port}`
  )

  logger.info(
    `📚 API documentation available at http://${config.server.host}:${server.port}/api/v1/health`
  )

  // Graceful shutdown
  const gracefulShutdown = (signal: string) => {
    logger.info({ signal }, 'Starting graceful shutdown...')

    // Stop accepting new connections
    void server.stop()

    // Stop cron jobs
    void stopCronJobs()

    logger.info('Graceful shutdown completed')
    process.exit(0)
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))

  // Handle uncaught errors
  process.on('uncaughtException', (err) => {
    logger.error({ error: err }, 'Uncaught exception')
    process.exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection')
    process.exit(1)
  })
}

// Start the server
startServer().catch((error) => {
  logger.error({ error }, 'Failed to start server')
  process.exit(1)
})
