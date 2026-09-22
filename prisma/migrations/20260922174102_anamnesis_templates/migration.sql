/*
  Warnings:

  - Added the required column `template_id` to the `anamnesis_records` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "anamnesis_records" ADD COLUMN     "template_id" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "anamnesis_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "fields" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anamnesis_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "anamnesis_templates_tenant_id_idx" ON "anamnesis_templates"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "anamnesis_templates_tenant_id_name_key" ON "anamnesis_templates"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "anamnesis_records_template_id_idx" ON "anamnesis_records"("template_id");

-- AddForeignKey
ALTER TABLE "anamnesis_templates" ADD CONSTRAINT "anamnesis_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anamnesis_records" ADD CONSTRAINT "anamnesis_records_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "anamnesis_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
