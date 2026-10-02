-- appointments:read/write passam a valer só para a própria agenda; ver e gerenciar a agenda de
-- todos os profissionais exige a nova permissão appointments:all.
--
-- Migração de dados, para ninguém perder acesso no deploy: todo papel que hoje tem
-- appointments:read (que até aqui significava "todas as agendas") recebe appointments:all.
-- Quem deve ver só a própria agenda (ex.: um papel "Médico") tem a permissão removida depois,
-- pelo editor de papéis.

-- A permissão precisa existir antes de ser concedida. O seed (que roda depois das migrations)
-- faz upsert pela key e só atualiza a descrição.
INSERT INTO "permissions" ("id", "key", "description")
VALUES (gen_random_uuid()::text, 'appointments:all', 'Ver e gerenciar a agenda de todos os profissionais')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT rp."role_id", p_all."id"
FROM "role_permissions" rp
JOIN "permissions" p_read ON p_read."id" = rp."permission_id" AND p_read."key" = 'appointments:read'
CROSS JOIN "permissions" p_all
WHERE p_all."key" = 'appointments:all'
ON CONFLICT DO NOTHING;
