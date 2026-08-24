SELECT
  (SELECT count(*) FROM "properties") AS properties,
  (SELECT count(*) FROM "room_types") AS room_types,
  (SELECT count(*) FROM "rooms") AS rooms,
  (SELECT count(*) FROM "amenities") AS amenities,
  (SELECT count(*) FROM "rate_plans") AS rate_plans,
  (SELECT count(*) FROM "extras") AS extras,
  (SELECT count(*) FROM "tax_rules") AS tax_rules,
  (SELECT count(*) FROM "contract_terms_versions") AS contract_terms_versions,
  (SELECT count(*) FROM "booking_tax_lines") AS booking_tax_lines,
  (SELECT count(*) FROM "stored_files") AS stored_files;

SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'properties', 'room_types', 'rooms', 'amenities', 'room_type_amenities',
    'rate_plans', 'extras', 'bookings', 'booking_rooms', 'booking_extras',
    'guests', 'reservation_holds', 'availability_blocks', 'room_allocations',
    'payments', 'payment_provider_events', 'invoices', 'invoice_lines',
    'invoice_sequences', 'tax_rules', 'contract_terms_versions',
    'booking_tax_lines', 'stored_files', 'admin_users',
    'admin_memberships', 'audit_logs'
  )
ORDER BY c.relname;

SELECT conname, contype
FROM pg_constraint
WHERE conname IN (
  'room_allocations_no_active_overlap',
  'room_allocations_exactly_one_source',
  'bookings_valid_stay',
  'bookings_non_negative_tourist_tax',
  'tax_rules_valid_configuration',
  'invoices_valid_document_relation',
  'payments_valid_card_last4'
)
ORDER BY conname;
