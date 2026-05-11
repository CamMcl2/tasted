export default async function healthRoutes(fastify) {
  fastify.get('/health', async (req, reply) => {
    return reply.send({ status: 'ok', ts: new Date().toISOString() });
  });
}
