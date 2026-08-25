import { prisma } from "../lib/prisma.js";
import { attachRoomTypeCover, storeRoomTypeCover } from "../modules/media/media.service.js";

const apply = process.argv.includes("--apply");
const roomTypes = await prisma.roomType.findMany({
  where: { coverImageUrl: { startsWith: "data:image/" } },
  select: { id: true, propertyId: true, name: true, coverImageUrl: true, gallery: true },
  orderBy: { createdAt: "asc" },
});

if (!apply) {
  console.log(JSON.stringify({ candidates: roomTypes.length, applied: false, hint: "Relancez avec --apply après vérification." }));
  await prisma.$disconnect();
  process.exit(0);
}

let migrated = 0;
for (const roomType of roomTypes) {
  const match = /^data:image\/(jpeg|png|webp);base64,([a-z0-9+/=]+)$/i.exec(roomType.coverImageUrl);
  if (!match?.[1] || !match[2]) continue;
  const mimeType = `image/${match[1].toLowerCase() === "jpeg" ? "jpeg" : match[1].toLowerCase()}`;
  const stored = await storeRoomTypeCover(roomType.propertyId, Buffer.from(match[2], "base64"), mimeType);
  await prisma.$transaction(async (transaction) => {
    const gallery = Array.isArray(roomType.gallery)
      ? roomType.gallery.filter((item): item is string => typeof item === "string" && item !== roomType.coverImageUrl)
      : [];
    await transaction.roomType.update({
      where: { id: roomType.id },
      data: { coverImageUrl: stored.url, gallery: [stored.url, ...gallery] },
    });
    await attachRoomTypeCover(transaction, roomType.propertyId, roomType.id, stored.storedFileId);
    await transaction.auditLog.create({
      data: {
        propertyId: roomType.propertyId,
        action: "ROOM_TYPE_COVER_MIGRATED",
        entityType: "RoomType",
        entityId: roomType.id,
        before: { coverImageUrl: "[image intégrée]" },
        after: { coverImageUrl: stored.url, storedFileId: stored.storedFileId },
        metadata: { source: "MEDIA_MIGRATION_SCRIPT" },
      },
    });
  });
  migrated += 1;
}

console.log(JSON.stringify({ candidates: roomTypes.length, migrated, applied: true }));
await prisma.$disconnect();
