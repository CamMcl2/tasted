/**
 * BullMQ queue — lazy initialisation.
 * Only connects to Redis if UPSTASH_REDIS_HOST is set.
 * Safe to import even when Redis isn't configured yet.
 */
import { Queue } from 'bullmq';

let _queue = null;

function getConnection() {
  return {
    host:     process.env.UPSTASH_REDIS_HOST,
    port:     Number(process.env.UPSTASH_REDIS_PORT) || 6379,
    password: process.env.UPSTASH_REDIS_PASSWORD,
    tls:      {},
  };
}

function getQueue() {
  if (_queue) return _queue;
  _queue = new Queue('enrichment', {
    connection: getConnection(),
    defaultJobOptions: {
      attempts:         3,
      backoff:          { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail:     { count: 50  },
    },
  });
  return _queue;
}

/**
 * Enqueue a product for background enrichment.
 * No-op if Redis isn't configured — server still works, just no AI summaries.
 */
export async function queueEnrichment(productId, barcode, priority = 10) {
  if (!process.env.UPSTASH_REDIS_HOST) {
    console.log(`[queue] Redis not configured — skipping enrichment for ${barcode}`);
    return null;
  }
  try {
    return await getQueue().add(
      'enrich-product',
      { productId, barcode },
      { jobId: `enrich:${productId}`, priority }
    );
  } catch (err) {
    console.warn(`[queue] Failed to enqueue ${barcode}:`, err.message);
    return null;
  }
}
