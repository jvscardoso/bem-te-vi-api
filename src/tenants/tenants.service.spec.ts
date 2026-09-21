import { BadRequestException } from '@nestjs/common';
import { TenantsService } from './tenants.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

function setup(tenant = { defaultAppointmentDurationMinutes: 30, minAppointmentDurationMinutes: 5 }) {
  const prisma = {
    tenant: {
      findUnique: vi.fn(async () => ({ id: 't1', ...tenant })),
      update: vi.fn(async ({ data }) => ({ id: 't1', ...data })),
    },
    user: { count: vi.fn(async () => 0) },
  };
  const service = new TenantsService(prisma as unknown as PrismaService);
  return { prisma, service };
}

describe('TenantsService appointment duration settings', () => {
  it('lets a psychology clinic require sessions of at least 60 minutes', async () => {
    const { prisma, service } = setup();

    await service.update('t1', {
      defaultAppointmentDurationMinutes: 60,
      minAppointmentDurationMinutes: 60,
    });

    expect(prisma.tenant.update).toHaveBeenCalled();
  });

  it('rejects a default shorter than the minimum, using the stored value for the omitted field', async () => {
    const { prisma, service } = setup({
      defaultAppointmentDurationMinutes: 30,
      minAppointmentDurationMinutes: 5,
    });

    await expect(service.update('t1', { minAppointmentDurationMinutes: 60 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it("rejects raising the minimum above professionals' own default durations", async () => {
    const { prisma, service } = setup({
      defaultAppointmentDurationMinutes: 60,
      minAppointmentDurationMinutes: 5,
    });
    prisma.user.count.mockResolvedValue(2);

    await expect(service.update('t1', { minAppointmentDurationMinutes: 45 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { tenantId: 't1', defaultAppointmentDurationMinutes: { lt: 45 } },
    });
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });
});
