import Fastify       from 'fastify';
import compress      from '@fastify/compress';
import cors          from '@fastify/cors';
import rateLimit     from '@fastify/rate-limit';
import productRoutes from './routes/product.js';
import healthRoutes  from './routes/health.js';

const PORT = Number(process.env.PORT) || 3001;

const fastify = Fastify({ logger: true });

await fastify.register(compress);
await fastify.register(cors, { origin: true });
await fastify.register(rateLimit, { max: 200, timeWindow: '1 minute' });
await fastify.register(healthRoutes);
await fastify.register(productRoutes);

fastify.setErrorHandler((err, req, reply) => {
  fastify.log.error(err);
  reply.code(err.statusCode || 500).send({ error: err.message || 'Internal server error' });
});

try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`✓ Tasted API running on port ${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
