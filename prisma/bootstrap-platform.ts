// Ao contrário de seed.ts (sempre chamado via `prisma db seed`, que carrega o .env através
// de prisma.config.ts), este script roda direto via `tsx`/npm script — precisa do próprio.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

// Cria (uma única vez) a clínica-plataforma que hospeda o backoffice de gestão de tenants.
// De propósito, nunca pelo signup público (POST /tenants): assim `platform:manage` nunca
// corre o risco de ser concedida sem querer a um tenant de cliente de verdade.
//
// Rodar com (senha forte, nunca comitada):
//   PLATFORM_ADMIN_EMAIL=voce@empresa.com PLATFORM_ADMIN_PASSWORD=... npm run bootstrap:platform
//
// Idempotente: rodar de novo não duplica nada nem reseta a senha de um usuário já criado.
const SALT_ROUNDS = 12;
const SUBDOMAIN = process.env.PLATFORM_SUBDOMAIN ?? 'platform';
const ADMIN_NAME = process.env.PLATFORM_ADMIN_NAME ?? 'Administrador da plataforma';
const ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.PLATFORM_ADMIN_PASSWORD;

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('Defina PLATFORM_ADMIN_EMAIL e PLATFORM_ADMIN_PASSWORD antes de rodar.');
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const tenant = await prisma.tenant.upsert({
    where: { subdomain: SUBDOMAIN },
    update: {},
    create: { name: 'Plataforma', subdomain: SUBDOMAIN, isPlatform: true },
  });
  if (!tenant.isPlatform) {
    throw new Error(
      `O subdomínio "${SUBDOMAIN}" já pertence a um tenant de cliente, não à plataforma. ` +
        'Ajuste PLATFORM_SUBDOMAIN.',
    );
  }

  // Depende de `npx prisma db seed` já ter rodado (é lá que o catálogo de permissões nasce).
  const platformPermission = await prisma.permission.findUnique({
    where: { key: 'platform:manage' },
  });
  if (!platformPermission) {
    throw new Error('Permissão "platform:manage" não existe. Rode `npx prisma db seed` antes.');
  }

  const role = await prisma.role.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: 'Platform Admin' } },
    update: {},
    create: { tenantId: tenant.id, name: 'Platform Admin', description: 'Acesso ao backoffice' },
  });
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: role.id, permissionId: platformPermission.id } },
    update: {},
    create: { roleId: role.id, permissionId: platformPermission.id },
  });

  const existingOwner = await prisma.user.findFirst({ where: { tenantId: tenant.id } });
  if (existingOwner) {
    console.log(`Clínica-plataforma já bootstrapada (usuário existente: ${existingOwner.email}).`);
  } else {
    const passwordHash = await hash(ADMIN_PASSWORD, SALT_ROUNDS);
    const owner = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        roleId: role.id,
        name: ADMIN_NAME,
        email: ADMIN_EMAIL.toLowerCase(),
        passwordHash,
      },
    });
    console.log(`Usuário do backoffice criado: ${owner.email}`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
