import { FastifyInstance } from "fastify";
import { findRoomTypeBySlug, listExtras, listRoomTypes } from "./catalog.service.js";

export async function catalogRoutes(app: FastifyInstance) {
  app.get("/room-types", async () => ({ data: await listRoomTypes() }));

  app.get<{ Params: { slug: string } }>("/room-types/:slug", async (request, reply) => {
    const roomType = await findRoomTypeBySlug(request.params.slug);
    if (!roomType) {
      return reply.code(404).send({ error: { code: "ROOM_TYPE_NOT_FOUND", message: "Hébergement introuvable." } });
    }
    return { data: roomType };
  });

  app.get("/extras", async () => ({ data: await listExtras() }));
}
