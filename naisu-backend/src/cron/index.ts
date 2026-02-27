/**
 * Cron Jobs
 * Background tasks for the backend
 */
import { logger } from '@lib/logger'
import { startIndexer, stopIndexer } from '@services/indexer'

// ============================================================================
// Job Definitions
// ============================================================================

interface CronJob {
  name: string
  intervalMs: number
  fn: () => Promise<void>
  lastRun?: Date
}

const jobs: CronJob[] = [
  // Add cron jobs here if needed
]

let intervals: ReturnType<typeof setInterval>[] = []

/**
 * Start all cron jobs
 */
export function startCronJobs(): void {
  // Start intent indexer (background on-chain event polling)
  startIndexer()

  if (jobs.length === 0) {
    logger.info('No additional cron jobs configured')
    return
  }

  logger.info(`Starting ${jobs.length} cron jobs...`)

  for (const job of jobs) {
    logger.info({ name: job.name, intervalMs: job.intervalMs }, 'Scheduling job')

    job.fn().catch((error) => {
      logger.error({ error, job: job.name }, 'Cron job failed')
    })

    const interval = setInterval(() => {
      job.lastRun = new Date()
      job.fn().catch((error) => {
        logger.error({ error, job: job.name }, 'Cron job failed')
      })
    }, job.intervalMs)

    intervals.push(interval)
  }

  logger.info(`${jobs.length} cron jobs started`)
}

/**
 * Stop all cron jobs
 */
export function stopCronJobs(): void {
  logger.info('Stopping cron jobs...')
  stopIndexer()

  for (const interval of intervals) {
    clearInterval(interval)
  }

  intervals = []
  logger.info('Cron jobs stopped')
}

/**
 * Get job status
 */
export function getJobStatus(): Array<{ name: string; lastRun?: Date }> {
  return jobs.map((job) => ({
    name: job.name,
    lastRun: job.lastRun,
  }))
}
