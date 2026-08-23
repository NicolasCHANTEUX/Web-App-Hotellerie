import "dotenv/config";
import { AdminRole } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

type AuthUser = {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
};

type ProvisionOptions = {
  email: string;
  property: string;
  role: AdminRole;
  displayName?: string;
  dryRun: boolean;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredEnv(name: "SUPABASE_URL" | "SUPABASE_SECRET_KEY") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function argumentValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}.`);
  return value;
}

function assertKnownArguments(args: string[]) {
  const valueFlags = new Set(["--email", "--property", "--role", "--display-name"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") continue;
    if (!argument || !valueFlags.has(argument)) {
      throw new Error(`Unknown argument: ${argument ?? "(empty)"}.`);
    }
    index += 1;
  }
}

function parseOptions(args: string[]): ProvisionOptions {
  assertKnownArguments(args);
  const email = argumentValue(args, "--email")?.toLowerCase();
  const property = argumentValue(args, "--property");
  const rawRole = argumentValue(args, "--role")?.toUpperCase() ?? AdminRole.ADMIN;
  const displayName = argumentValue(args, "--display-name");
  const dryRun = args.includes("--dry-run");

  if (!email || !property) {
    throw new Error(
      "Usage: tsx src/scripts/provision-admin.ts --email admin@example.com --property hotel-rivage [--role ADMIN] [--display-name \"Prénom Nom\"] [--dry-run]",
    );
  }
  if (!Object.values(AdminRole).includes(rawRole as AdminRole)) {
    throw new Error(`Invalid role. Expected one of: ${Object.values(AdminRole).join(", ")}.`);
  }
  return { email, property, role: rawRole as AdminRole, displayName, dryRun };
}

function authUsers(payload: unknown): AuthUser[] {
  if (!payload || typeof payload !== "object") return [];
  const rawUsers = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as Record<string, unknown>).users)
      ? (payload as Record<string, unknown>).users as unknown[]
      : [];

  return rawUsers.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.id !== "string" || typeof candidate.email !== "string") return [];
    const metadata = candidate.user_metadata;
    return [{
      id: candidate.id,
      email: candidate.email,
      ...(metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? { user_metadata: metadata as Record<string, unknown> }
        : {}),
    }];
  });
}

async function findExistingAuthUser(email: string) {
  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/+$/, "");
  const secretKey = requiredEnv("SUPABASE_SECRET_KEY");
  const perPage = 1_000;
  const headers: Record<string, string> = { apikey: secretKey };
  if (!secretKey.startsWith("sb_secret_")) {
    headers.authorization = `Bearer ${secretKey}`;
  }

  for (let page = 1; page <= 100; page += 1) {
    let response: Response;
    try {
      response = await fetch(
        `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
        {
          headers,
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new Error("Supabase Auth is unreachable.");
    }

    if (!response.ok) {
      throw new Error(`Supabase Auth refused the admin user lookup (HTTP ${response.status}).`);
    }
    const payload: unknown = await response.json().catch(() => null);
    const users = authUsers(payload);
    const match = users.find((user) => user.email.toLowerCase() === email);
    if (match) return match;
    if (users.length < perPage) return null;
  }

  throw new Error("Supabase Auth user lookup exceeded the pagination limit.");
}

function metadataDisplayName(user: AuthUser) {
  const fullName = user.user_metadata?.full_name;
  const name = user.user_metadata?.name;
  if (typeof fullName === "string" && fullName.trim()) return fullName.trim();
  if (typeof name === "string" && name.trim()) return name.trim();
  return user.email.split("@")[0] ?? user.email;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const authUser = await findExistingAuthUser(options.email);
  if (!authUser) {
    throw new Error(
      `No existing Supabase Auth user matches ${options.email}. Create the user in Supabase Auth first; this script never creates credentials.`,
    );
  }

  const property = uuidPattern.test(options.property)
    ? await prisma.property.findUnique({ where: { id: options.property } })
    : await prisma.property.findUnique({ where: { slug: options.property } });
  if (!property) throw new Error(`Property not found: ${options.property}.`);

  const displayName = options.displayName ?? metadataDisplayName(authUser);
  if (options.dryRun) {
    console.info(
      `Dry run successful: ${authUser.email} can be linked to ${property.name} (${options.role}).`,
    );
    return;
  }

  const adminUser = await prisma.$transaction(async (transaction) => {
    const [bySubject, byEmail] = await Promise.all([
      transaction.adminUser.findUnique({ where: { authSubject: authUser.id } }),
      transaction.adminUser.findUnique({ where: { email: authUser.email.toLowerCase() } }),
    ]);
    if (bySubject && byEmail && bySubject.id !== byEmail.id) {
      throw new Error("Conflicting local admin records exist for this Auth subject and email.");
    }
    if (byEmail && byEmail.authSubject !== authUser.id) {
      throw new Error(
        "A local admin already uses this email with another Auth subject. Resolve the conflict before provisioning.",
      );
    }

    const user = bySubject
      ? await transaction.adminUser.update({
          where: { id: bySubject.id },
          data: { email: authUser.email.toLowerCase(), displayName, isActive: true },
        })
      : await transaction.adminUser.create({
          data: {
            authSubject: authUser.id,
            email: authUser.email.toLowerCase(),
            displayName,
          },
        });

    await transaction.adminMembership.deleteMany({
      where: {
        adminUserId: user.id,
        propertyId: property.id,
        role: { not: options.role },
      },
    });
    await transaction.adminMembership.upsert({
      where: {
        adminUserId_propertyId_role: {
          adminUserId: user.id,
          propertyId: property.id,
          role: options.role,
        },
      },
      update: {},
      create: {
        adminUserId: user.id,
        propertyId: property.id,
        role: options.role,
      },
    });
    return user;
  });

  console.info(
    `Admin provisioned: ${adminUser.email} -> ${property.name} (${options.role}).`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Admin provisioning failed.");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
