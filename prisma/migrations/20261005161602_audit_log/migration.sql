-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "patient_id" TEXT,
    "entity_type" VARCHAR(40),
    "entity_id" TEXT,
    "details" JSONB,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_patient_id_created_at_idx" ON "audit_logs"("tenant_id", "patient_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_actor_user_id_created_at_idx" ON "audit_logs"("tenant_id", "actor_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trilha de auditoria imutável: registro gravado não é reescrito por ninguém, nem pela aplicação
-- nem por um UPDATE manual. DELETE continua possível porque é como a clínica inteira é removida
-- (cascata de tenants); a aplicação não tem rota que apague registros.
CREATE FUNCTION audit_logs_block_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs é somente inserção: registros de auditoria não podem ser alterados';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_update();

-- Nova permissão para consultar a trilha. Vai só para papéis de administrador (com
-- users:manage + roles:manage + tenant:manage, a mesma definição de AccessPolicyService):
-- a trilha mostra quem acessou qual paciente, então não deve vazar para a equipe toda.
INSERT INTO "permissions" ("id", "key", "description")
VALUES (gen_random_uuid()::text, 'audit:read', 'Ver a trilha de auditoria (quem acessou ou alterou dados de pacientes)')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p_audit."id"
FROM "roles" r
CROSS JOIN "permissions" p_audit
WHERE p_audit."key" = 'audit:read'
  AND (
    SELECT count(DISTINCT p."key")
    FROM "role_permissions" rp
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE rp."role_id" = r."id" AND p."key" IN ('users:manage', 'roles:manage', 'tenant:manage')
  ) = 3
ON CONFLICT DO NOTHING;
