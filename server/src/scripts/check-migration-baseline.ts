import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

const requiredTables = [
  "properties",
  "room_types",
  "rooms",
  "amenities",
  "room_type_amenities",
  "rate_plans",
  "extras",
  "bookings",
  "booking_rooms",
  "booking_extras",
  "guests",
  "reservation_holds",
  "availability_blocks",
  "room_allocations",
  "payments",
  "invoices",
  "invoice_lines",
  "admin_users",
  "admin_memberships",
  "audit_logs",
] as const;

const requiredConstraints = [
  "room_allocations_no_active_overlap",
  "room_allocations_exactly_one_source",
  "bookings_valid_stay",
  "bookings_valid_guests",
  "bookings_non_negative_amounts",
] as const;

const requiredColumns = [
  ["bookings", "publicAccessTokenHash"],
  ["bookings", "publicAccessTokenExpiresAt"],
  ["payments", "refundReason"],
] as const;

async function main() {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (${Prisma.join([...requiredTables])})
  `;
  const constraints = await prisma.$queryRaw<Array<{ constraint_name: string }>>`
    SELECT conname AS constraint_name
    FROM pg_constraint
    WHERE conname IN (${Prisma.join([...requiredConstraints])})
  `;
  const columns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (${Prisma.join(
        requiredColumns.map(([table, column]) => Prisma.sql`(${table}, ${column})`),
      )})
  `;
  const publicTables = await prisma.$queryRaw<Array<{ table_name: string; rls_enabled: boolean }>>`
    SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
    ORDER BY c.relname
  `;

  const presentTables = new Set(tables.map((item) => item.table_name));
  const presentConstraints = new Set(constraints.map((item) => item.constraint_name));
  const presentColumns = new Set(columns.map((item) => `${item.table_name}.${item.column_name}`));
  const missingTables = requiredTables.filter((name) => !presentTables.has(name));
  const missingConstraints = requiredConstraints.filter((name) => !presentConstraints.has(name));
  const missingColumns = requiredColumns
    .map(([table, column]) => `${table}.${column}`)
    .filter((name) => !presentColumns.has(name));
  const missingRls = publicTables
    .filter((table) => !table.rls_enabled)
    .map((table) => table.table_name);

  console.log(JSON.stringify({
    requiredTables: requiredTables.length,
    presentTables: presentTables.size,
    publicTables: publicTables.length,
    missingTables,
    missingConstraints,
    missingColumns,
    missingRls,
  }, null, 2));

  if (missingTables.length || missingConstraints.length || missingColumns.length || missingRls.length) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
