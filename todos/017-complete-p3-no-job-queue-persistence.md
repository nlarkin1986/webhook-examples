---
status: complete
priority: p3
issue_id: "017"
tags: [code-review, architecture, reliability]
dependencies: []
---

# No Persistence for Job Queue

## Problem Statement

The job queue is in-memory only. Server restarts lose all pending jobs, and there's no visibility into queue state.

## Findings

**Location:** `conversation-analysis/processor.js`

**Current implementation:**
```javascript
const queue = [];

function add(job) {
  queue.push(job);
  // Lost on restart
}
```

**Impact:**
- Server restart = lost jobs
- No retry across restarts
- No queue visibility/monitoring
- No dead letter queue for failed jobs

## Proposed Solutions

### Option A: Simple File-Based Queue

```javascript
const fs = require('fs');
const QUEUE_FILE = './data/job-queue.json';

function persistQueue() {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue));
}

function loadQueue() {
  if (fs.existsSync(QUEUE_FILE)) {
    return JSON.parse(fs.readFileSync(QUEUE_FILE));
  }
  return [];
}
```

### Option B: Redis-Based Queue (Future)

For production scale:
- Bull or BullMQ with Redis
- Automatic retries
- Job visibility
- Distributed processing

### Option C: Accept Limitation (Current)

For development/testing:
- Document that jobs are lost on restart
- Webhooks will re-fire if not acknowledged
- Keep simple for now

| Aspect | Details |
|--------|---------|
| Effort | Medium (file) / Large (Redis) |
| Risk | Low |

## Acceptance Criteria

- [ ] Document current limitation
- [ ] For production: implement persistence (file or Redis)
- [ ] Add queue metrics (size, processing rate)
- [ ] Consider dead letter queue for repeated failures
