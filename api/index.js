/**
 * Tasted API — Fastify server
 *
 * Handles barcode lookups and search.
 * Redis → Supabase → Open Food Facts cascade.
 *
 * Deploy to Railway: railway up
 */

import Fastify        from 'fastify';
import compress       from '@fastify/compress';
import cors           from '@fastify/cors';
import rateLimit      from '@fastify/rate-limit';
import productRoutes  from './routes/product.js';
import healthRoutes   from './routes/health.js';

const PORT = Number(process.env.PORT) || 3001;
const PROD = process.env.NODE_ENV === 'production';

const fastify = Fastify({
  logger: PROD
    ? { level: 'warn' }
    : { level: 'info', transport: { target: 'pino-pretty' } },
  // Fastify serializes responses via compiled JSON schemas — much faster than JSON.stringify
  ajv: { customOptions: { coerceTypes: true, allErrors: false } },
});

// ── Plugins ───────────────────────────────────────────────────────────────────

// Gzip / Brotli compression
await fastify.register(compress, { global: true, encodings: ['br', 'gzip'] });

// CORS — allow Netlify frontend + local dev
await fastify.register(cors, {
  origin: [
    /netlify\.app$/,          // all Netlify preview URLs
    'http://localhost:5173',  // Vite dev
    'http://localhost:4173',  // Vite preview
    process.env.FRONTEND_URL, // explicit production URL
  ].filter(Boolean),
  methods: ['GET', 'POST'],
});

// Rate limiting — 100 requests per minute per IP
await fastify.register(rateLimit, {
  max:      100,
  timeWindow: '1 minute',
  // Upstash Redis store via ioredis (optional — falls back to in-memory)
  // Only use Redis for rate limiting if a real host is configured
  ...(process.env.UPSTASH_REDIS_HOST && !process.env.UPSTASH_REDIS_HOST.startsWith('#') ? {
    redis: await (async () => {
      const { default: Redis } = await import('ioredis');
      return new Redis({
        host:     process.env.UPSTASH_REDIS_HOST,
        port:     Number(process.env.UPSTASH_REDIS_PORT) || 6379,
        password: process.env.UPSTASH_REDIS_PASSWORD,
        tls:      {},
      });
    })(),
  } : {}),
});

// ── Routes ────────────────────────────────────────────────────────────────────
await fastify.register(healthRoutes);
await fastify.register(productRoutes);

// ── Global error handler ──────────────────────────────────────────────────────
fastify.setErrorHandler((err, req, reply) => {
  fastify.log.error(err);
  reply.code(err.statusCode || 500).send({
    error:   err.message || 'Internal server error',
    status:  err.statusCode || 500,
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`✓ Tasted API running on port ${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
