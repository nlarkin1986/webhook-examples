---
status: complete
priority: p2
issue_id: "004"
tags: [code-review, performance, scalability]
dependencies: []
---

# Single-Threaded Sequential Queue Processing

## Problem Statement

The job queue processes exactly ONE job at a time. The `processing` flag creates a mutex that blocks all concurrent processing, limiting throughput to ~2-6 jobs/minute.

**Why it matters:**
- Each job takes 10-30 seconds (multiple API calls)
- At 50 conversations/hour: 8-24 minute delays
- At 100 conversations/hour: system falls behind indefinitely

## Findings

**Location:** `/Users/natelarkin/webhook-examples/conversation-analysis/processor.js` lines 49-79

```javascript
async process() {
  if (this.processing || this.queue.length === 0) {
    return;
  }
  this.processing = true;  // Mutex blocks all concurrency
  const job = this.queue.shift();
  // ... process single job
  this.processing = false;
}
```

## Proposed Solutions

### Option A: Configurable Concurrency (Recommended)

**Implementation:**
```javascript
class JobQueue {
  constructor(concurrency = 3) {
    this.concurrency = concurrency;
    this.activeJobs = 0;
    this.queue = [];
  }

  async process() {
    while (this.activeJobs < this.concurrency && this.queue.length > 0) {
      this.activeJobs++;
      const job = this.queue.shift();
      this.processJob(job).finally(() => {
        this.activeJobs--;
        this.process();
      });
    }
  }
}
```

| Aspect | Details |
|--------|---------|
| Pros | 3-5x throughput, configurable |
| Cons | Need to handle concurrent errors carefully |
| Effort | Medium (2-3 hours) |
| Risk | Low |

## Acceptance Criteria

- [ ] Multiple jobs process concurrently
- [ ] Concurrency configurable via environment variable
- [ ] Error in one job doesn't affect others
- [ ] Stats endpoint shows active job count
