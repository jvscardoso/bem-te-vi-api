import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Catálogo base de permissões do MVP. Cada tenant decide quais delas
// cada role sua vai ter — este seed só garante que as chaves existem.
const PERMISSIONS = [
  { key: 'patients:read', description: 'Ver pacientes' },
  { key: 'patients:write', description: 'Criar/editar pacientes e anamnese' },
  { key: 'appointments:read', description: 'Ver agenda' },
  { key: 'appointments:write', description: 'Criar/editar agendamentos' },
  { key: 'users:manage', description: 'Gerenciar usuários do tenant' },
  { key: 'roles:manage', description: 'Gerenciar papéis e permissões' },
  { key: 'tenant:manage', description: 'Gerenciar dados e marca do tenant' },
  { key: 'anamnesis_templates:manage', description: 'Criar/editar/apagar formulários de anamnese' },
  { key: 'billing:read', description: 'Ver cobranças, pagamentos e relatório financeiro' },
  { key: 'billing:write', description: 'Criar cobranças, registrar pagamentos, cancelar cobranças' },
  // Backoffice da própria plataforma (listar/suspender clínicas). Nunca concedida
  // automaticamente no signup — ver o filtro em TenantsService.create().
  { key: 'platform:manage', description: 'Gerenciar tenants da plataforma (backoffice)' },
];

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      create: permission,
      update: { description: permission.description },
    });
  }

  await prisma.$disconnect();
  console.log(`Seed concluído: ${PERMISSIONS.length} permissões garantidas.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
