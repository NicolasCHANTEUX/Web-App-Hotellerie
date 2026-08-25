import assert from "node:assert/strict";
import test from "node:test";
import { validateRoomTypeImage } from "./media.service.js";

test("valide une image JPEG depuis sa signature et non son extension", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(validateRoomTypeImage(jpeg, "image/jpeg"), "image/jpeg");
});

test("refuse une image dont le contenu ne correspond pas au type annoncé", () => {
  assert.throws(() => validateRoomTypeImage(Buffer.from("not an image"), "image/png"));
  assert.throws(() => validateRoomTypeImage(Buffer.alloc(20), "image/gif"));
});
