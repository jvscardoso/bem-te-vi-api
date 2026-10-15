-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('whatsapp', 'marketing');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('staff', 'patient');

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "phone_e164" VARCHAR(16);

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo';

-- CreateTable
CREATE TABLE "patient_consents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" "ConsentSource" NOT NULL,
    "recorded_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patient_consents_patient_id_purpose_created_at_idx" ON "patient_consents"("patient_id", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "patient_consents_tenant_id_idx" ON "patient_consents"("tenant_id");

-- CreateIndex
CREATE INDEX "patients_tenant_id_phone_e164_idx" ON "patients"("tenant_id", "phone_e164");

-- AddForeignKey
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preenche phone_e164 dos pacientes que já existem, com a mesma regra de normalizePhone
-- (src/patients/phone.ts; um teste e2e confere que as duas dão o mesmo resultado):
--   com "+" na frente: o número internacional como veio (8 a 15 dígitos);
--   sem "+": número brasileiro. Tira um "0" de discagem na frente; 10 ou 11 dígitos (DDD +
--   número) ganham o +55; 12 ou 13 começando com 55 já têm o código do país.
-- O que não se encaixa fica null (o telefone continua lá, como foi digitado).
UPDATE "patients" p
SET "phone_e164" = CASE
    WHEN n.raw LIKE '+%' THEN CASE WHEN length(n.digits) BETWEEN 8 AND 15 THEN '+' || n.digits END
    WHEN length(n.local) IN (10, 11) THEN '+55' || n.local
    WHEN length(n.local) IN (12, 13) AND n.local LIKE '55%' THEN '+' || n.local
  END
FROM (
  SELECT "id",
         btrim("phone") AS raw,
         regexp_replace("phone", '[^0-9]', '', 'g') AS digits,
         CASE WHEN regexp_replace("phone", '[^0-9]', '', 'g') LIKE '0%'
              THEN substr(regexp_replace("phone", '[^0-9]', '', 'g'), 2)
              ELSE regexp_replace("phone", '[^0-9]', '', 'g') END AS local
  FROM "patients"
  WHERE "phone" IS NOT NULL
) n
WHERE p."id" = n."id";
