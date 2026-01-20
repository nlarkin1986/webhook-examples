/**
 * Background Job Processor
 *
 * Simple in-memory queue for processing conversation analysis jobs.
 * Features:
 * - Async processing (webhook returns immediately)
 * - Retry logic with exponential backoff
 * - Structured logging
 */

const dayjs = require('dayjs');
const { runOrchestrator } = require('./agents/orchestrator');

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 30000]; // 1s, 5s, 30s

class JobQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
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
    this.process();
  }

  /**
   * Get current queue size
   * @returns {number}
   */
  getQueueSize() {
    return this.queue.length;
  }

  /**
   * Process jobs from the queue
   */
  async process() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const job = this.queue.shift();
    const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss');

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

    this.processing = false;

    // Process next job if queue not empty
    if (this.queue.length > 0) {
      setImmediate(() => this.process());
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
    console.log(JSON.stringify(logEntry, null, 2));
    console.log('=========================\n');

    return result;
  }

  /**
   * Handle job failure with retry logic
   * @param {object} job - Failed job
   * @param {Error} error - Error that caused failure
   */
  async handleFailure(job, error) {
    const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss');

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
      console.log(JSON.stringify(failedLogEntry, null, 2));
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
      processing: this.processing,
      processedCount: this.processedCount,
      failedCount: this.failedCount
    };
  }
}

// Singleton instance
const queueProcessor = new JobQueue();

module.exports = { queueProcessor };
