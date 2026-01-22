/**
 * Metrics Calculator Service
 *
 * Calculates customer metrics from Shopify order data:
 * - Gross Revenue
 * - Net Revenue (gross - refunds)
 * - LTV (Lifetime Value)
 * - AOV (Average Order Value)
 * - Order/Return counts
 * - Customer lifetime in months
 */

/**
 * Calculate the number of months between two dates
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {number} Number of months (rounded down)
 */
function monthsBetween(startDate, endDate) {
  const months = (endDate.getFullYear() - startDate.getFullYear()) * 12
    + (endDate.getMonth() - startDate.getMonth());
  return Math.max(0, months);
}

/**
 * Calculate customer metrics from Shopify customer data
 * @param {object} shopifyCustomer - Shopify customer object with orders
 * @returns {object} Calculated metrics
 */
function calculateCustomerMetrics(shopifyCustomer) {
  if (!shopifyCustomer) {
    return {
      grossRevenue: 0,
      netRevenue: 0,
      ltv: 0,
      aov: 0,
      orderCount: 0,
      returnCount: 0,
      lifetimeMonths: 0,
      lastTransaction: null,
      currency: 'USD'
    };
  }

  const orders = shopifyCustomer.orders?.edges?.map(e => e.node) || [];

  if (orders.length === 0) {
    return {
      grossRevenue: 0,
      netRevenue: 0,
      ltv: 0,
      aov: 0,
      orderCount: 0,
      returnCount: 0,
      lifetimeMonths: 0,
      lastTransaction: null,
      currency: shopifyCustomer.amountSpent?.currencyCode || 'USD'
    };
  }

  // Gross Revenue: Sum of all order totals
  const grossRevenue = orders.reduce((sum, order) => {
    const amount = parseFloat(order.totalPriceSet?.shopMoney?.amount || 0);
    return sum + amount;
  }, 0);

  // Total Refunds
  const totalRefunds = orders.reduce((sum, order) => {
    const amount = parseFloat(order.totalRefundedSet?.shopMoney?.amount || 0);
    return sum + amount;
  }, 0);

  // Net Revenue: Gross minus refunds
  const netRevenue = grossRevenue - totalRefunds;

  // Order Count (excluding fully refunded orders)
  const validOrders = orders.filter(o => o.displayFinancialStatus !== 'REFUNDED');
  const orderCount = validOrders.length;

  // Return Count (orders with any refund)
  const returnCount = orders.filter(o => {
    const refundAmount = parseFloat(o.totalRefundedSet?.shopMoney?.amount || 0);
    return refundAmount > 0;
  }).length;

  // AOV: Net Revenue / Valid Orders
  const aov = orderCount > 0 ? netRevenue / orderCount : 0;

  // LTV: Using simple historical value (net revenue)
  // Could extend with predictive LTV model in future
  const ltv = netRevenue;

  // Customer Lifetime: Months since first order
  const sortedByDate = [...orders].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );
  const firstOrder = sortedByDate[0];
  const lifetimeMonths = firstOrder
    ? monthsBetween(new Date(firstOrder.createdAt), new Date())
    : 0;

  // Last Transaction: Most recent order
  const lastOrder = orders[0];  // Already sorted reverse by createdAt from GraphQL
  const lastTransaction = lastOrder?.createdAt || null;

  // Currency from first order or customer's amountSpent
  const currency = orders[0]?.totalPriceSet?.shopMoney?.currencyCode
    || shopifyCustomer.amountSpent?.currencyCode
    || 'USD';

  return {
    grossRevenue: Math.round(grossRevenue * 100) / 100,
    netRevenue: Math.round(netRevenue * 100) / 100,
    ltv: Math.round(ltv * 100) / 100,
    aov: Math.round(aov * 100) / 100,
    orderCount,
    returnCount,
    lifetimeMonths,
    lastTransaction,
    currency
  };
}

/**
 * Assign customer tier based on fixed thresholds (O(1) complexity)
 * @param {object} customer - Customer with metrics
 * @param {object} [thresholds] - Tier thresholds
 * @returns {object} { tier, reason }
 */
function assignCustomerTier(customer, thresholds = {}) {
  const {
    top_min_ltv: topMinLtv = 5000,
    vip_min_ltv: vipMinLtv = 2000,
    at_risk_max_sentiment: atRiskMaxSentiment = -0.30
  } = thresholds;

  const { totalOrders = 0, ltv = 0, avgSentiment = null } = customer;

  // New customer: No orders
  if (totalOrders === 0) {
    return {
      tier: 'new',
      reason: 'No purchase history'
    };
  }

  // At Risk: Negative sentiment trend
  if (avgSentiment !== null && avgSentiment < atRiskMaxSentiment) {
    return {
      tier: 'at_risk',
      reason: 'Negative sentiment detected'
    };
  }

  // Top Customer: LTV >= $5,000 (default)
  if (ltv >= topMinLtv) {
    return {
      tier: 'top',
      reason: `Lifetime value >= $${topMinLtv.toLocaleString()}`
    };
  }

  // VIP: LTV >= $2,000 (default)
  if (ltv >= vipMinLtv) {
    return {
      tier: 'vip',
      reason: `Lifetime value >= $${vipMinLtv.toLocaleString()}`
    };
  }

  // Standard customer
  return {
    tier: 'standard',
    reason: 'Active customer'
  };
}

/**
 * Format recent orders for display
 * @param {object} shopifyCustomer - Shopify customer with orders
 * @param {number} [limit=5] - Max orders to return
 * @returns {Array} Formatted orders
 */
function formatRecentOrders(shopifyCustomer, limit = 5) {
  const orders = shopifyCustomer?.orders?.edges?.map(e => e.node) || [];

  return orders.slice(0, limit).map(order => ({
    id: order.id,
    orderNumber: order.name,
    createdAt: order.createdAt,
    total: parseFloat(order.totalPriceSet?.shopMoney?.amount || 0),
    currency: order.totalPriceSet?.shopMoney?.currencyCode || 'USD',
    refunded: parseFloat(order.totalRefundedSet?.shopMoney?.amount || 0),
    financialStatus: order.displayFinancialStatus,
    fulfillmentStatus: order.displayFulfillmentStatus,
    items: order.lineItems?.edges?.map(e => ({
      title: e.node.title,
      quantity: e.node.quantity
    })) || []
  }));
}

module.exports = {
  calculateCustomerMetrics,
  assignCustomerTier,
  formatRecentOrders,
  monthsBetween
};
