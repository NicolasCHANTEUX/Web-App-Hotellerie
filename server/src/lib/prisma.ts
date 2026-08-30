import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

const sslDisabled = /(?:\?|&)sslmode=disable(?:&|$)/i.test(env.databaseUrl);
const adapter = new PrismaPg({
  connectionString: env.databaseUrl,
  ssl: sslDisabled
    ? false
    : {
        rejectUnauthorized: true,
        ca: readFileSync(resolve(process.cwd(), env.databaseSslCa), "utf8"),
      },
});

export const prisma = new PrismaClient({ adapter });
