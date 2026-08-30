import { FastifyInstance } from "fastify";
import { findRoomTypeBySlug, listExtras, listRoomTypes } from "./catalog.service.js";

export async function catalogRoutes(app: FastifyInstance) {
  const cacheCatalog = (reply: { header: (name: string, value: string) => unknown }) =>
    reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");

  app.get("/room-types", async (_request, reply) => {
    cacheCatalog(reply);
    return { data: await listRoomTypes() };
  });

  app.get<{ Params: { slug: string } }>("/room-types/:slug", async (request, reply) => {
    cacheCatalog(reply);
    const roomType = await findRoomTypeBySlug(request.params.slug);
    if (!roomType) {
      return reply.code(404).send({ error: { code: "ROOM_TYPE_NOT_FOUND", message: "Hébergement introuvable." } });
    }
    return { data: roomType };
  });

  app.get("/extras", async (_request, reply) => {
    cacheCatalog(reply);
    return { data: await listExtras() };
  });
}
