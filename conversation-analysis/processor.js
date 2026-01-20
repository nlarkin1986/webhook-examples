/**
 * Background Job Processor
 *
 * Simple in-memory queue for processing conversation analysis jobs.
 * Features:
 * - Async processing (webhook returns immediately)
 * - Retry logic with exponential backoff
 * - Structured logging
 */

const { runOrchestrator } = require('./agents/orchestrator');
const { redactPII } = require('./utils/redact');

/**
 * Format timestamp for logging in YYYY-MM-DD HH:mm:ss format
 * @returns {string} Formatted timestamp
 */
function formatTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 30000]; // 1s, 5s, 30s

/**
 * In-Memory Job Queue
 *
 * LIMITATION: Jobs are stored in memory only and will be lost on server restart.
 * This is acceptable for development and testing since Gladly webhooks will
 * automatically re-fire if the initial request is not acknowledged with a 2xx response.
 *
 * For production deployments, consider:
 * - Bull/BullMQ with Redis for persistent, distributed queue
 * - File-based persistence for simple single-server deployments
 * - Database-backed queue (PostgreSQL, etc.) for existing DB infrastructure
 *
 * See: https://github.com/OptimalBits/bull for Redis-based queue implementation
 */
class JobQueue {
  constructor(concurrency = parseInt(process.env.JOB_CONCURRENCY) || 3) {
    this.queue = [];
    this.concurrency = concurrency;
    this.activeJobs = 0;
    this.processedCount = 0;
    this.failedCount = 0;
  }

  /**
   * Add a job to the queue
   * @param {object} job - Job data
   */
  add(job) {
    this.queue.push({
      ...job,
      retryCount: 0,
      addedAt: new Date().toISOString()
    });

    // Log queue metrics when job is added
    this.logQueueMetrics('Job added');

    this.process();
  }

  /**
   * Log current queue metrics for monitoring
   * @param {string} context - Context for the log entry
   */
  logQueueMetrics(context) {
    const stats = this.getStats();
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] Queue metrics (${context}): pending=${stats.queueSize}, active=${stats.activeJobs}, processed=${stats.processedCount}, failed=${stats.failedCount}`);
  }

  /**
   * Get current queue size
   * @returns {number}
   */
  getQueueSize() {
    return this.queue.length;
  }

  /**
   * Process jobs from the queue with configurable concurrency
   */
  async process() {
    // Start processing jobs up to concurrency limit
    while (this.activeJobs < this.concurrency && this.queue.length > 0) {
      this.activeJobs++;
      const job = this.queue.shift();

      // Process job without awaiting to allow concurrent execution
      this.executeJob(job).finally(() => {
        this.activeJobs--;
        // Try to process more jobs when one completes
        this.process();
      });
    }
  }

  /**
   * Execute a single job with logging and error handling
   * @param {object} job - Job to execute
   */
  async executeJob(job) {
    const timestamp = formatTimestamp();

    console.log(`[${timestamp}] Processing job: ${job.eventId}`);
    console.log(`[${timestamp}] Event type: ${job.eventType}`);
    console.log(`[${timestamp}] Conversation: ${job.conversationId}`);

    try {
      const result = await this.processJob(job);

      this.processedCount++;
      console.log(`[${timestamp}] Job completed successfully: ${job.eventId}`);
      console.log(`[${timestamp}] Result summary: ${result.summary || 'N/A'}`);

    } catch (error) {
      console.error(`[${timestamp}] Job failed: ${job.eventId}`, error.message);
      await this.handleFailure(job, error);
    }
  }

  /**
   * Process a single job
   * @param {object} job - Job data
   * @returns {Promise<object>} Processing result
   */
  async processJob(job) {
    const { eventType, conversationId, customerId } = job;
    const startTime = Date.now();

    // Run the orchestrator agent
    const result = await runOrchestrator({
      eventType,
      conversationId,
      customerId
    });

    const processingTime = Date.now() - startTime;

    // Log structured results
    const logEntry = {
      timestamp: new Date().toISOString(),
      eventId: job.eventId,
      eventType,
      conversationId,
      customerId,
      gladlyLink: `${process.env.GLADLY_HOST}/customer/${customerId}/conversation/${conversationId}`,
      processingTimeMs: processingTime,
      results: result
    };

    console.log('\n=== ANALYSIS COMPLETE ===');
    console.log(JSON.stringify(redactPII(logEntry), null, 2));
    console.log('=========================\n');

    return result;
  }

  /**
   * Handle job failure with retry logic
   * @param {object} job - Failed job
   * @param {Error} error - Error that caused failure
   */
  async handleFailure(job, error) {
    const timestamp = formatTimestamp();

    if (job.retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAYS[job.retryCount] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
      job.retryCount++;

      console.log(`[${timestamp}] Scheduling retry ${job.retryCount}/${MAX_RETRIES} in ${delay}ms`);

      setTimeout(() => {
        this.queue.push(job);
        this.process();
      }, delay);

    } else {
      this.failedCount++;
      console.error(`[${timestamp}] Job permanently failed after ${MAX_RETRIES} retries: ${job.eventId}`);
      console.error(`[${timestamp}] Final error: ${error.message}`);

      // Log failed job for debugging
      const failedLogEntry = {
        timestamp: new Date().toISOString(),
        eventId: job.eventId,
        eventType: job.eventType,
        conversationId: job.conversationId,
        customerId: job.customerId,
        error: error.message,
        retryCount: job.retryCount,
        status: 'FAILED'
      };

      console.log('\n=== JOB FAILED ===');
      console.log(JSON.stringify(redactPII(failedLogEntry), null, 2));
      console.log('==================\n');
    }
  }

  /**
   * Get queue statistics
   * @returns {object}
   */
  getStats() {
    return {
      queueSize: this.queue.length,
      activeJobs: this.activeJobs,
      concurrency: this.concurrency,
      processedCount: this.processedCount,
      failedCount: this.failedCount
    };
  }
}

// Singleton instance
const queueProcessor = new JobQueue();

/**
 * Get queue statistics (convenience export)
 * @returns {object} Queue stats including pending, active, processed, and failed counts
 */
function getStats() {
  return queueProcessor.getStats();
}

module.exports = { queueProcessor, getStats };
