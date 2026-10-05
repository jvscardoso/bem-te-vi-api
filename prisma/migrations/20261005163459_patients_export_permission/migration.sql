-- Exportação completa dos dados de um paciente (cadastro, fichas clínicas, agenda, cobranças):
-- é como a clínica atende o direito de acesso/portabilidade do titular (LGPD). É uma cópia de
-- prontuário inteira em um arquivo, então vai só para papéis de administrador — mesma regra de
-- audit:read (users:manage + roles:manage + tenant:manage). O Admin de clínica nova já recebe
-- pelo cadastro (todo o catálogo, exceto platform:*).
INSERT INTO "permissions" ("id", "key", "description")
VALUES (gen_random_uuid()::text, 'patients:export', 'Exportar todos os dados de um paciente (pedido do titular, LGPD)')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p_export."id"
FROM "roles" r
CROSS JOIN "permissions" p_export
WHERE p_export."key" = 'patients:export'
  AND (
    SELECT count(DISTINCT p."key")
    FROM "role_permissions" rp
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE rp."role_id" = r."id" AND p."key" IN ('users:manage', 'roles:manage', 'tenant:manage')
  ) = 3
ON CONFLICT DO NOTHING;
