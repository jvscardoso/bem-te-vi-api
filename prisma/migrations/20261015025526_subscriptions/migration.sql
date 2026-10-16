-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('monthly', 'yearly');

-- CreateTable
CREATE TABLE "plans" (
    "id" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "monthly_price_cents" INTEGER NOT NULL,
    "max_professionals" INTEGER NOT NULL,
    "extra_professional_cents" INTEGER,
    "monthly_reminders" INTEGER NOT NULL,
    "monthly_bot_bookings" INTEGER NOT NULL,
    "monthly_campaign_messages" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_subscriptions" (
    "tenant_id" TEXT NOT NULL,
    "plan_id" VARCHAR(40) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
    "cycle" "BillingCycle" NOT NULL DEFAULT 'monthly',
    "trial_ends_at" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3),
    "past_due_since" TIMESTAMP(3),
    "asaas_customer_id" VARCHAR(64),
    "asaas_subscription_id" VARCHAR(64),
    "payment_url" TEXT,
    "billing_name" VARCHAR(150),
    "billing_document" VARCHAR(14),
    "billing_email" VARCHAR(150),
    "contracted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "asaas_webhook_events" (
    "id" VARCHAR(100) NOT NULL,
    "event" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "asaas_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_subscriptions_asaas_subscription_id_key" ON "tenant_subscriptions"("asaas_subscription_id");

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Planos da decisão 11 (14/10/2026). Preço em centavos, por clínica, por mês. Mudar preço ou limite
-- = uma migration de dado que atualiza a linha, sem mudar código.
INSERT INTO "plans" ("id", "name", "monthly_price_cents", "max_professionals", "extra_professional_cents",
                     "monthly_reminders", "monthly_bot_bookings", "monthly_campaign_messages", "sort_order")
VALUES
  ('individual',   'Individual',    9900,  1, NULL,  200,   0,   0, 1),
  ('essencial',    'Essencial',    14900,  5, NULL,  500,   0,   0, 2),
  ('profissional', 'Profissional', 29900, 10, 2900, 1000, 250,   0, 3),
  ('completo',     'Completo',     54900, 20, 2500, 2000, 500, 300, 4);

-- Clínicas que já existiam ganham o mesmo teste de quem se cadastra a partir de agora: 14 dias no
-- Essencial, contados do deploy. A clínica-plataforma (backoffice) não tem assinatura.
INSERT INTO "tenant_subscriptions" ("tenant_id", "plan_id", "status", "trial_ends_at", "updated_at")
SELECT "id", 'essencial', 'trialing', now() + interval '14 days', now()
FROM "tenants"
WHERE "is_platform" = false;
