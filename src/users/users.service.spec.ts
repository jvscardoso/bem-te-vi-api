import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { AccessPolicyService } from '../access/access-policy.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';

vi.mock('bcryptjs', () => ({ hash: vi.fn(async () => 'hashed') }));

const TENANT = 'tenant-a';

const ALL = ['users:manage', 'roles:manage', 'tenant:manage', 'patients:read'];
const actorWith = (permissions: string[], userId = 'actor'): AuthenticatedUser => ({
  userId,
  tenantId: TENANT,
  roleId: 'actor-role',
  permissions,
});
const admin = actorWith(ALL);

// Papel na forma que o AccessPolicyService lê do banco.
const roleWith = (...keys: string[]) => ({
  permissions: keys.map((key) => ({ permission: { key } })),
});

function setup() {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(async () => 1),
      create: vi.fn(async ({ data }) => ({ id: 'new-user', ...data })),
      update: vi.fn(async ({ data }) => ({ id: 'u1', ...data })),
    },
    role: { findFirst: vi.fn() },
    permission: { findMany: vi.fn() },
    tenant: { findUniqueOrThrow: vi.fn(async () => ({ minAppointmentDurationMinutes: 30 })) },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));

  const policy = new AccessPolicyService(prisma as unknown as PrismaService);
  const service = new UsersService(prisma as unknown as PrismaService, policy);
  return { prisma, service };
}

const createDto = {
  name: 'Fulano',
  email: 'Fulano@Clinica.com',
  password: '12345678',
  roleId: 'role-1',
};

describe('UsersService tenant isolation', () => {
  it('rejects create when the role belongs to another tenant', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.role.findFirst.mockResolvedValue(null);

    await expect(service.create(TENANT, admin, createDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.role.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'role-1', tenantId: TENANT } }),
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates the user when the role belongs to the tenant', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.role.findFirst.mockResolvedValue(roleWith('patients:read'));

    await service.create(TENANT, admin, createDto);

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT,
          roleId: 'role-1',
          email: 'fulano@clinica.com',
        }),
      }),
    );
  });

  it('rejects update when the new role belongs to another tenant', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ roleId: 'old-role' });
    // 1ª busca: papel atual do alvo; 2ª: papel novo (de outro tenant -> não existe aqui).
    prisma.role.findFirst.mockResolvedValueOnce(roleWith()).mockResolvedValueOnce(null);

    await expect(
      service.update(TENANT, admin, 'u1', { roleId: 'foreign-role' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('skips role lookups when a user edits themselves without changing the role', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ roleId: 'r1' });

    await service.update(TENANT, actorWith(ALL, 'u1'), 'u1', { name: 'Novo nome' });

    expect(prisma.role.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('returns 404 when the target user is not in the tenant', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.update(TENANT, admin, 'ghost', { name: 'x' })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('stores the email in lowercase on update (login only matches lowercase)', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ roleId: 'r1' });

    await service.update(TENANT, actorWith(ALL, 'u1'), 'u1', { email: 'Novo@Clinica.COM' });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'novo@clinica.com' }) }),
    );
  });
});

describe('UsersService privilege escalation', () => {
  const manager = actorWith(['users:manage', 'patients:read']);

  it('cannot create a user with a role holding permissions the actor lacks', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.role.findFirst.mockResolvedValue(roleWith(...ALL));

    await expect(service.create(TENANT, manager, createDto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('can create a user whose role is within the actor permissions', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.role.findFirst.mockResolvedValue(roleWith('patients:read'));

    await service.create(TENANT, manager, createDto);

    expect(prisma.user.create).toHaveBeenCalled();
  });

  it('cannot promote themselves to a role with more permissions', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ roleId: 'own-role' });
    prisma.role.findFirst.mockResolvedValue(roleWith(...ALL));

    await expect(
      service.update(TENANT, actorWith(manager.permissions, 'me'), 'me', { roleId: 'admin-role' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('cannot modify a user whose role is above the actor', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ roleId: 'admin-role' });
    prisma.role.findFirst.mockResolvedValue(roleWith(...ALL));

    await expect(service.update(TENANT, manager, 'boss', { name: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('can modify a user at or below the actor level', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ roleId: 'recep' });
    prisma.role.findFirst.mockResolvedValue(roleWith('patients:read'));

    await service.update(TENANT, manager, 'recep-user', { name: 'Novo' });

    expect(prisma.user.update).toHaveBeenCalled();
  });
});

describe('UsersService last administrator', () => {
  it('rolls back a status change that leaves the tenant without an active admin', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ roleId: 'admin-role' });
    prisma.role.findFirst.mockResolvedValue(roleWith(...ALL));
    // 1 admin antes da mudança, 0 depois.
    prisma.user.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(
      service.update(TENANT, admin, 'boss', { status: 'disabled' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('takes the per-tenant lock before counting admins', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ roleId: 'r1' });
    prisma.role.findFirst.mockResolvedValue(roleWith());

    await service.update(TENANT, admin, 'u1', { status: 'disabled' });

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const order = [
      prisma.$executeRaw.mock.invocationCallOrder[0],
      prisma.user.count.mock.invocationCallOrder[0],
    ];
    expect(order[0]).toBeLessThan(order[1]);
  });

  it('allows the change when another admin remains', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ roleId: 'admin-role' });
    prisma.role.findFirst.mockResolvedValue(roleWith(...ALL));
    prisma.user.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

    await service.update(TENANT, admin, 'boss', { status: 'disabled' });

    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('does not use the admin guard for edits that do not touch role or status', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ roleId: 'r1' });
    prisma.role.findFirst.mockResolvedValue(roleWith());

    await service.update(TENANT, admin, 'u1', { name: 'So o nome' });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.count).not.toHaveBeenCalled();
  });
});

describe('UsersService appointment duration', () => {
  const self = actorWith(['appointments:write'], 'u1');

  it('lets a professional set their own default duration', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ roleId: 'r1' });

    await service.updateOwnAppointmentSettings(TENANT, self, {
      defaultAppointmentDurationMinutes: 45,
    });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: { defaultAppointmentDurationMinutes: 45 },
      }),
    );
  });

  it('rejects a duration below the clinic minimum', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ roleId: 'r1' });

    await expect(
      service.updateOwnAppointmentSettings(TENANT, self, { defaultAppointmentDurationMinutes: 15 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("null clears the professional's own duration without consulting the clinic minimum", async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ roleId: 'r1' });

    await service.updateOwnAppointmentSettings(TENANT, self, {
      defaultAppointmentDurationMinutes: null,
    });

    expect(prisma.tenant.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { defaultAppointmentDurationMinutes: null } }),
    );
  });
});
