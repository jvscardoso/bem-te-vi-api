-- Nova permissão appointments:attend: quem atende pacientes (aparece como profissional e pode
-- receber agendamentos). Até aqui, todo usuário ativo era profissional.
--
-- Migração de dados, para ninguém que atende de verdade sumir da agenda no deploy:
--   1. o papel Admin do cadastro (o que tem todo o catálogo, exceto platform:*), para o dono de
--      uma clínica de um profissional só continuar atendendo;
--   2. todo papel com pelo menos um usuário que já foi profissional de algum agendamento (de
--      qualquer status).
-- Os outros papéis (ex.: uma recepção que nunca atendeu) ficam sem ela; a clínica ajusta depois
-- em Papéis e permissões.

-- A permissão precisa existir antes de ser concedida. O seed (que roda depois das migrations)
-- faz upsert pela key e só atualiza a descrição.
INSERT INTO "permissions" ("id", "key", "description")
VALUES (gen_random_uuid()::text, 'appointments:attend', 'Atende pacientes: tem agenda própria e pode ser o profissional de um agendamento')
ON CONFLICT ("key") DO NOTHING;

-- 1. Papéis com todas as permissões do catálogo, exceto platform:* e a própria attend.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p_attend."id"
FROM "roles" r
CROSS JOIN "permissions" p_attend
WHERE p_attend."key" = 'appointments:attend'
  AND NOT EXISTS (
    SELECT 1
    FROM "permissions" p
    WHERE p."key" NOT LIKE 'platform:%'
      AND p."key" <> 'appointments:attend'
      AND NOT EXISTS (
        SELECT 1 FROM "role_permissions" rp WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
      )
  )
ON CONFLICT DO NOTHING;

-- 2. Papéis de quem já foi profissional de algum agendamento.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT DISTINCT u."role_id", p_attend."id"
FROM "users" u
JOIN "appointments" a ON a."professional_id" = u."id"
CROSS JOIN "permissions" p_attend
WHERE p_attend."key" = 'appointments:attend'
ON CONFLICT DO NOTHING;
