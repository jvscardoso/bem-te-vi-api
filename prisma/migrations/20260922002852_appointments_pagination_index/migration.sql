-- DropIndex
DROP INDEX "appointments_tenant_id_idx";

-- CreateIndex
CREATE INDEX "appointments_tenant_id_scheduled_at_idx" ON "appointments"("tenant_id", "scheduled_at");
