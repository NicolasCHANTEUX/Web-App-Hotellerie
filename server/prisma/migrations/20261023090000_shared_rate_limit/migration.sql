CREATE TABLE "rate_limit_counters" (
    "key" CHAR(64) NOT NULL,
    "hits" BIGINT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "rate_limit_counters_expires_at_idx" ON "rate_limit_counters"("expires_at");

ALTER TABLE "rate_limit_counters" ENABLE ROW LEVEL SECURITY;
