/**
 * Alert Generator Service
 *
 * Creates actionable alerts from detected trends and anomalies.
 * Supports multiple notification channels (Slack, email, webhook).
 *
 * Implements alert fatigue prevention:
 * - Tiered severity with different thresholds
 * - Cooldown periods (no re-alert within 4 hours)
 * - Grouped alerts for related anomalies
 */

const db = require('../db/connection');
const credentialService = require('./credential-service');

// ============================================================================
// SSRF Protection
// Validates webhook URLs to prevent Server-Side Request Forgery
// ============================================================================

const ALLOWED_WEBHOOK_HOSTS = new Set([
  'hooks.slack.com',
  'discord.com',
  'discordapp.com',
  'api.telegram.org'
  // Note: Add customer-specific webhook hosts via environment variable if needed
]);

/**
 * Check if an IP address is private
 * @param {string} hostname - Hostname to check
 * @returns {boolean} True if private
 */
function isPrivateIP(hostname) {
  // Check for private IP patterns
  const privatePatterns = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^0\./,
    /^169\.254\./,
    /^::1$/,
    /^fc00:/i,
    /^fe80:/i
  ];

  return privatePatterns.some(pattern => pattern.test(hostname));
}

/**
 * Validate webhook URL for SSRF protection
 * @param {string} url - URL to validate
 * @returns {string} Validated URL
 * @throws {Error} If URL is not allowed
 */
function validateWebhookUrl(url) {
  if (!url) throw new Error('Webhook URL is required');

  const parsed = new URL(url);

  // Block private IPs
  if (isPrivateIP(parsed.hostname)) {
    throw new Error('Webhook URL cannot target private IP');
  }

  // Allowlist hosts
  if (!ALLOWED_WEBHOOK_HOSTS.has(parsed.hostname)) {
    throw new Error(`Webhook host not allowed: ${parsed.hostname}`);
  }

  // Require HTTPS
  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTPS');
  }

  return url;
}

// ============================================================================
// Alert Generator Class
// ============================================================================

class AlertGenerator {
  constructor(tenantId, config = {}) {
    this.tenantId = tenantId;
    this.config = config;
    this.cooldownPeriod = 4 * 60 * 60 * 1000; // 4 hours in ms
  }

  /**
   * Generate alerts from trend detection data
   * @param {object} trendData - Output from TrendDetector.detectTrends()
   * @returns {Promise<Array>} Created alerts
   */
  async generateAlerts(trendData) {
    const alerts = [];

    // Product issue alerts
    for (const anomaly of trendData.anomalies.products) {
      if (await this.shouldCreateAlert('product_issue', anomaly.productId)) {
        const alert = await this.createAlert({
          type: 'product_issue',
          severity: anomaly.severity,
          title: `Product Issue Spike: ${anomaly.productTitle}`,
          description: `${anomaly.complaints} complaints in the last period (${anomaly.zScore} std deviations above normal). Average sentiment: ${anomaly.sentiment}`,
          referenceType: 'product',
          referenceId: anomaly.productId,
          referenceData: anomaly,
          metricName: 'complaint_count',
          metricValue: anomaly.complaints,
          thresholdValue: 2  // z-score threshold
        });
        if (alert) alerts.push(alert);
      }
    }

    // Geographic alerts
    for (const anomaly of trendData.anomalies.geographic) {
      if (await this.shouldCreateAlert('geographic_cluster', anomaly.state)) {
        const topIssues = Object.entries(anomaly.topIssues || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');

        const alert = await this.createAlert({
          type: 'geographic_cluster',
          severity: anomaly.severity,
          title: `Issue Cluster: ${anomaly.state}`,
          description: `${anomaly.issues} issues concentrated in ${anomaly.state} (${anomaly.zScore} std deviations). Top issues: ${topIssues}`,
          referenceType: 'geography',
          referenceId: anomaly.state,
          referenceData: anomaly,
          metricName: 'issue_count',
          metricValue: anomaly.issues,
          thresholdValue: 2
        });
        if (alert) alerts.push(alert);
      }
    }

    // Emerging topic alerts (only for negative sentiment)
    for (const topic of trendData.emerging) {
      const sentiment = parseFloat(topic.sentiment);
      if (sentiment < -0.3 && await this.shouldCreateAlert('emerging_issue', `${topic.topic}:${topic.subtopic}`)) {
        const alert = await this.createAlert({
          type: 'emerging_issue',
          severity: 'medium',
          title: `New Issue Emerging: ${topic.topic}`,
          description: `New topic "${topic.topic}${topic.subtopic ? ': ' + topic.subtopic : ''}" appeared ${topic.mentions} times. Sentiment: ${topic.sentiment}`,
          referenceType: 'topic',
          referenceId: `${topic.topic}:${topic.subtopic || ''}`,
          referenceData: topic,
          metricName: 'mention_count',
          metricValue: topic.mentions,
          thresholdValue: 3
        });
        if (alert) alerts.push(alert);
      }
    }

    // Trending negative alerts
    for (const topic of trendData.trending) {
      const sentiment = parseFloat(topic.sentiment);
      if (sentiment < -0.3 && await this.shouldCreateAlert('trending_topic', `${topic.topic}:${topic.subtopic}`)) {
        const alert = await this.createAlert({
          type: 'trending_topic',
          severity: 'high',
          title: `Negative Trend: ${topic.topic}`,
          description: `"${topic.topic}" mentions up ${topic.changePercent}% with negative sentiment (${topic.sentiment})`,
          referenceType: 'topic',
          referenceId: `${topic.topic}:${topic.subtopic || ''}`,
          referenceData: topic,
          metricName: 'change_percentage',
          metricValue: parseFloat(topic.changePercent),
          thresholdValue: 50
        });
        if (alert) alerts.push(alert);
      }
    }

    // Send notifications for high/critical alerts
    const highPriorityAlerts = alerts.filter(a =>
      a.severity === 'critical' || a.severity === 'high'
    );

    if (highPriorityAlerts.length > 0) {
      await this.sendNotifications(highPriorityAlerts);
    }

    return alerts;
  }

  /**
   * Check if an alert should be created (cooldown check)
   * @param {string} alertType - Type of alert
   * @param {string} referenceId - Reference identifier
   * @returns {Promise<boolean>} True if alert should be created
   */
  async shouldCreateAlert(alertType, referenceId) {
    const result = await db.queryWithTenant(this.tenantId, `
      SELECT id, created_at
      FROM intelligence_alerts
      WHERE tenant_id = $1
        AND alert_type = $2
        AND reference_id = $3
        AND status IN ('open', 'acknowledged')
        AND created_at > NOW() - INTERVAL '4 hours'
      ORDER BY created_at DESC
      LIMIT 1
    `, [this.tenantId, alertType, referenceId]);

    // No recent alert exists - ok to create
    return result.rows.length === 0;
  }

  /**
   * Create an alert in the database
   * @param {object} alertData - Alert data
   * @returns {Promise<object|null>} Created alert or null if skipped
   */
  async createAlert(alertData) {
    try {
      const result = await db.queryWithTenant(this.tenantId, `
        INSERT INTO intelligence_alerts (
          tenant_id, alert_type, severity, title, description,
          reference_type, reference_id, reference_data,
          metric_name, metric_value, threshold_value
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `, [
        this.tenantId,
        alertData.type,
        alertData.severity,
        alertData.title,
        alertData.description,
        alertData.referenceType,
        alertData.referenceId,
        JSON.stringify(alertData.referenceData),
        alertData.metricName,
        alertData.metricValue,
        alertData.thresholdValue
      ]);

      console.log(`[AlertGenerator] Created alert: ${alertData.title}`);
      return result.rows[0];
    } catch (error) {
      console.error('[AlertGenerator] Error creating alert:', error.message);
      return null;
    }
  }

  /**
   * Send notifications for alerts
   * @param {Array} alerts - Alerts to send notifications for
   * @returns {Promise<void>}
   */
  async sendNotifications(alerts) {
    const notifications = [];

    // Slack notification
    if (this.config.slackWebhook) {
      try {
        const webhookUrl = validateWebhookUrl(this.config.slackWebhook);
        const slackPayload = this.formatSlackMessage(alerts);
        notifications.push(
          this.sendWebhook(webhookUrl, slackPayload, 'slack')
        );
      } catch (error) {
        console.error('[AlertGenerator] Slack webhook validation failed:', error.message);
      }
    }

    // Generic webhook notification
    if (this.config.webhookUrl) {
      try {
        const webhookUrl = validateWebhookUrl(this.config.webhookUrl);
        notifications.push(
          this.sendWebhook(webhookUrl, { alerts, tenant_id: this.tenantId }, 'webhook')
        );
      } catch (error) {
        console.error('[AlertGenerator] Webhook validation failed:', error.message);
      }
    }

    // Wait for all notifications
    const results = await Promise.allSettled(notifications);

    // Track sent notifications
    for (const alert of alerts) {
      const sentChannels = results
        .map((r, i) => r.status === 'fulfilled' ? ['slack', 'webhook'][i] : null)
        .filter(Boolean);

      if (sentChannels.length > 0) {
        await this.trackNotificationSent(alert.id, sentChannels);
      }
    }
  }

  /**
   * Send a webhook notification
   * @param {string} url - Webhook URL
   * @param {object} payload - Payload to send
   * @param {string} channel - Channel name for tracking
   * @returns {Promise<void>}
   */
  async sendWebhook(url, payload, channel) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      console.log(`[AlertGenerator] ${channel} notification sent`);
    } catch (error) {
      console.error(`[AlertGenerator] ${channel} notification failed:`, error.message);
      throw error;
    }
  }

  /**
   * Track that a notification was sent
   * @param {string} alertId - Alert UUID
   * @param {Array} channels - Channels notification was sent to
   * @returns {Promise<void>}
   */
  async trackNotificationSent(alertId, channels) {
    await db.queryWithTenant(this.tenantId, `
      UPDATE intelligence_alerts
      SET notifications_sent = notifications_sent || $1::jsonb
      WHERE id = $2
    `, [
      JSON.stringify(channels.map(c => ({
        channel: c,
        sent_at: new Date().toISOString()
      }))),
      alertId
    ]);
  }

  /**
   * Format alerts as a Slack message
   * @param {Array} alerts - Alerts to format
   * @returns {object} Slack message payload
   */
  formatSlackMessage(alerts) {
    const criticalAlerts = alerts.filter(a => a.severity === 'critical');
    const highAlerts = alerts.filter(a => a.severity === 'high');

    return {
      text: 'Customer Intelligence Alert',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'Customer Intelligence Alerts' }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${criticalAlerts.length} Critical* | *${highAlerts.length} High Priority*`
          }
        },
        ...alerts.slice(0, 5).map(alert => ({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${alert.severity === 'critical' ? ':red_circle:' : ':large_orange_diamond:'} *${alert.title}*\n${alert.description}`
          }
        })),
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View Dashboard' },
              url: `${this.config.dashboardUrl || ''}/intelligence`
            }
          ]
        }
      ]
    };
  }

  /**
   * Update alert status
   * @param {string} alertId - Alert UUID
   * @param {string} status - New status
   * @param {string} note - Optional note
   * @param {string} userId - User making the update
   * @returns {Promise<object>} Updated alert
   */
  async updateAlertStatus(alertId, status, note = null, userId = null) {
    const updateFields = ['status = $2'];
    const params = [alertId, status];
    let paramIndex = 3;

    if (status === 'acknowledged') {
      updateFields.push(`acknowledged_at = NOW()`);
      if (userId) {
        updateFields.push(`acknowledged_by = $${paramIndex++}`);
        params.push(userId);
      }
    } else if (status === 'resolved') {
      updateFields.push(`resolved_at = NOW()`);
      if (note) {
        updateFields.push(`resolution_note = $${paramIndex++}`);
        params.push(note);
      }
    }

    const result = await db.queryWithTenant(this.tenantId, `
      UPDATE intelligence_alerts
      SET ${updateFields.join(', ')}, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, params);

    return result.rows[0];
  }

  /**
   * Get open alerts
   * @param {object} filters - Optional filters
   * @returns {Promise<Array>} Open alerts
   */
  async getOpenAlerts(filters = {}) {
    let whereClause = 'tenant_id = $1 AND status = $2';
    const params = [this.tenantId, filters.status || 'open'];
    let paramIndex = 3;

    if (filters.severity) {
      whereClause += ` AND severity = $${paramIndex++}`;
      params.push(filters.severity);
    }

    if (filters.alertType) {
      whereClause += ` AND alert_type = $${paramIndex++}`;
      params.push(filters.alertType);
    }

    const result = await db.queryWithTenant(this.tenantId, `
      SELECT *
      FROM intelligence_alerts
      WHERE ${whereClause}
      ORDER BY
        CASE severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
        END,
        created_at DESC
      LIMIT $${paramIndex}
    `, [...params, filters.limit || 50]);

    return result.rows;
  }

  /**
   * Create a custom/manual alert
   * @param {object} alertData - Alert data
   * @returns {Promise<object>} Created alert
   */
  async createCustomAlert(alertData) {
    return this.createAlert({
      type: 'custom',
      severity: alertData.severity || 'medium',
      title: alertData.title,
      description: alertData.description,
      referenceType: alertData.referenceType || 'custom',
      referenceId: alertData.referenceId || `custom-${Date.now()}`,
      referenceData: alertData.referenceData || {},
      metricName: alertData.metricName,
      metricValue: alertData.metricValue,
      thresholdValue: alertData.thresholdValue
    });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an alert generator for a tenant
 * @param {string} tenantId - Tenant UUID
 * @param {object} config - Alert configuration
 * @returns {AlertGenerator} Configured alert generator
 */
function createAlertGenerator(tenantId, config = {}) {
  return new AlertGenerator(tenantId, config);
}

/**
 * Load alert config from database
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<object>} Alert configuration
 */
async function loadAlertConfig(tenantId) {
  const result = await db.queryWithTenant(tenantId, `
    SELECT
      alert_thresholds,
      slack_webhook_encrypted,
      slack_webhook_iv,
      slack_webhook_tag,
      alert_email,
      webhook_url
    FROM agent_configs
    WHERE tenant_id = $1
  `, [tenantId]);

  const config = result.rows[0];
  if (!config) return {};

  // Decrypt Slack webhook if present
  let slackWebhook = null;
  if (config.slack_webhook_encrypted) {
    try {
      slackWebhook = credentialService.decrypt({
        encrypted: config.slack_webhook_encrypted,
        iv: config.slack_webhook_iv,
        tag: config.slack_webhook_tag
      });
    } catch (error) {
      console.error('[AlertGenerator] Failed to decrypt Slack webhook');
    }
  }

  return {
    thresholds: config.alert_thresholds || {},
    slackWebhook,
    alertEmail: config.alert_email,
    webhookUrl: config.webhook_url
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  AlertGenerator,
  createAlertGenerator,
  loadAlertConfig,
  validateWebhookUrl,
  ALLOWED_WEBHOOK_HOSTS
};
