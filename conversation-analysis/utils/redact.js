/**
 * PII Redaction Utility
 *
 * Redacts sensitive information from objects before logging
 * to prevent information leakage in log output.
 */

/**
 * Redact PII and sensitive data from an object
 * @param {object} obj - Object to redact
 * @returns {object} - Deep copy with sensitive fields redacted
 */
function redactPII(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  // Create a deep copy to avoid mutating the original
  const redacted = JSON.parse(JSON.stringify(obj));

  // Redact conversation content from sentiment analysis
  if (redacted.results?.sentiment?.key_indicators) {
    redacted.results.sentiment.key_indicators = '[REDACTED]';
  }

  // Redact full conversation content
  if (redacted.results?.conversationContent) {
    redacted.results.conversationContent = '[REDACTED]';
  }

  // Redact customer PII
  if (redacted.customer?.emails) {
    redacted.customer.emails = '[REDACTED]';
  }
  if (redacted.customer?.name) {
    redacted.customer.name = '[REDACTED]';
  }

  // Redact results that may contain customer data
  if (redacted.results?.customer?.emails) {
    redacted.results.customer.emails = '[REDACTED]';
  }
  if (redacted.results?.customer?.name) {
    redacted.results.customer.name = '[REDACTED]';
  }

  // Sanitize error stack traces
  if (redacted.error?.stack) {
    redacted.error.stack = '[REDACTED]';
  }

  return redacted;
}

module.exports = { redactPII };
