import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

vi.mock('bcryptjs', () => ({ hash: vi.fn(async () => 'hashed') }));

const TENANT = 'tenant-a';

function setup() {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(async ({ data }) => ({ id: 'new-user', ...data })),
      update: vi.fn(async ({ data }) => ({ id: 'u1', ...data })),
    },
    role: { findFirst: vi.fn() },
    tenant: { findUniqueOrThrow: vi.fn(async () => ({ minAppointmentDurationMinutes: 30 })) },
  };
  const service = new UsersService(prisma as unknown as PrismaService);
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

    await expect(service.create(TENANT, createDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.role.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'role-1', tenantId: TENANT } }),
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates the user when the role belongs to the tenant', async () => {
    const { prisma, service } = setup();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.role.findFirst.mockResolvedValue({ id: 'role-1' });

    await service.create(TENANT, createDto);

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: TENANT, roleId: 'role-1', email: 'fulano@clinica.com' }),
      }),
    );
  });

  it('rejects update when the new role belongs to another tenant', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
    prisma.role.findFirst.mockResolvedValue(null);

    await expect(service.update(TENANT, 'u1', { roleId: 'foreign-role' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('skips the role check on update when roleId is not being changed', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });

    await service.update(TENANT, 'u1', { name: 'Novo nome' });

    expect(prisma.role.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalled();
  });
});

describe('UsersService appointment duration', () => {
  it('lets a professional set their own default duration', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });

    await service.updateOwnAppointmentSettings(TENANT, 'u1', { defaultAppointmentDurationMinutes: 45 });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { defaultAppointmentDurationMinutes: 45 } }),
    );
  });

  it('rejects a duration below the clinic minimum', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });

    await expect(
      service.updateOwnAppointmentSettings(TENANT, 'u1', { defaultAppointmentDurationMinutes: 15 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("null clears the professional's own duration without consulting the clinic minimum", async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue({ id: 'u1' });

    await service.updateOwnAppointmentSettings(TENANT, 'u1', { defaultAppointmentDurationMinutes: null });

    expect(prisma.tenant.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { defaultAppointmentDurationMinutes: null } }),
    );
  });
});
