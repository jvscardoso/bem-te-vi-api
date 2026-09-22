-- Busca de pacientes: nome sem diferenciar acentos e CPF por dígitos.

-- unaccent: "joao" encontra "João", "conceicao" encontra "Conceição".
-- É uma extensão "trusted" (PG 13+): quem tem CREATE no banco consegue instalar.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- O CPF passa a ser guardado só com dígitos. Antes ficava como o cliente digitou, então
-- "111.111.111-11" e "11111111111" eram CPFs distintos para a unique (tenant_id, cpf).
-- Se já existirem duplicados em formatos diferentes no mesmo tenant, esta migration falha
-- na unique: resolva os cadastros duplicados e rode de novo.
UPDATE "patients"
SET "cpf" = NULLIF(regexp_replace("cpf", '\D', '', 'g'), '')
WHERE "cpf" IS NOT NULL;
