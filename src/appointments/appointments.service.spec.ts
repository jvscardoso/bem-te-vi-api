import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppointmentsService } from './appointments.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/types/auth.types.js';

const TENANT = 'tenant-a';
const START = '2026-10-01T13:00:00.000Z';
const minutes = (n: number) => n * 60_000;

function setup({ tenantDefault = 30, tenantMin = 5, professionalDefault = null as number | null } = {}) {
  const prisma: any = {
    appointment: {
      findFirst: vi.fn(),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }) => ({ id: 'new', ...data })),
      update: vi.fn(async ({ data }) => ({ id: 'a1', ...data })),
    },
    patient: { findFirst: vi.fn(async () => ({ id: 'patient-1' })) },
    user: {
      findFirst: vi.fn(async () => ({ id: 'pro-1', defaultAppointmentDurationMinutes: professionalDefault })),
    },
    tenant: {
      findUniqueOrThrow: vi.fn(async () => ({
        defaultAppointmentDurationMinutes: tenantDefault,
        minAppointmentDurationMinutes: tenantMin,
      })),
    },
    $executeRaw: vi.fn(async () => 1),
  };
  prisma.$transaction = vi.fn(async (callback) => callback(prisma));
  const service = new AppointmentsService(prisma as PrismaService);
  return { prisma, service };
}

// Recepção: vê e mexe na agenda de todos (appointments:all). O escopo da própria agenda tem
// testes dedicados no fim do arquivo.
const RECEPTION: AuthenticatedUser = {
  userId: 'reception-1',
  tenantId: TENANT,
  roleId: 'role-reception',
  permissions: ['appointments:read', 'appointments:write', 'appointments:all'],
};
// Profissional sem appointments:all: só a própria agenda (é o 'pro-1' dos agendamentos).
const OWN_ONLY: AuthenticatedUser = {
  userId: 'pro-1',
  tenantId: TENANT,
  roleId: 'role-doctor',
  permissions: ['appointments:read', 'appointments:write'],
};

const createDto = { patientId: 'patient-1', professionalId: 'pro-1', scheduledAt: START };

function existingAppointment(overrides = {}) {
  return {
    id: 'a1',
    tenantId: TENANT,
    patientId: 'patient-1',
    professionalId: 'pro-1',
    status: 'scheduled',
    scheduledAt: new Date(START),
    endsAt: new Date(new Date(START).getTime() + minutes(60)),
    ...overrides,
  };
}

describe('tenant isolation', () => {
  it('rejects create when the patient is not in the tenant (or is soft-deleted)', async () => {
    const { prisma, service } = setup();
    prisma.patient.findFirst.mockResolvedValue(null);

    await expect(service.create(TENANT, RECEPTION, createDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.patient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'patient-1', tenantId: TENANT, deletedAt: null } }),
    );
    expect(prisma.appointment.create).not.toHaveBeenCalled();
  });

  it('rejects create when the professional is not an active user of the tenant', async () => {
    const { prisma, service } = setup();
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.create(TENANT, RECEPTION, createDto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pro-1', tenantId: TENANT, status: 'active' } }),
    );
    expect(prisma.appointment.create).not.toHaveBeenCalled();
  });

  it('rejects update when the new professional is from another tenant', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment());
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.update(TENANT, RECEPTION, 'a1', { professionalId: 'foreign-pro' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('skips reference checks on update when patient/professional are not changing', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment());

    await service.update(TENANT, RECEPTION, 'a1', { notes: 'remarcar' });

    expect(prisma.patient.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.appointment.update).toHaveBeenCalled();
  });
});

describe('duration on create', () => {
  const created = (prisma: any) => prisma.appointment.create.mock.calls[0][0].data;

  it('uses the explicit start and end when both are sent', async () => {
    const { prisma, service } = setup({ tenantDefault: 30, professionalDefault: 45 });
    prisma.appointment.findFirst.mockResolvedValue(null);

    await service.create(TENANT, RECEPTION, { ...createDto, endsAt: '2026-10-01T15:30:00.000Z' });

    expect(created(prisma).endsAt).toEqual(new Date('2026-10-01T15:30:00.000Z'));
  });

  it('falls back to the clinic default when the professional has none (clinic A: 30 min)', async () => {
    const { prisma, service } = setup({ tenantDefault: 30 });
    prisma.appointment.findFirst.mockResolvedValue(null);

    await service.create(TENANT, RECEPTION, createDto);

    expect(created(prisma).endsAt).toEqual(new Date(new Date(START).getTime() + minutes(30)));
  });

  it("prefers the professional's own default over the clinic's", async () => {
    const { prisma, service } = setup({ tenantDefault: 60, tenantMin: 60, professionalDefault: 90 });
    prisma.appointment.findFirst.mockResolvedValue(null);

    await service.create(TENANT, RECEPTION, createDto);

    expect(created(prisma).endsAt).toEqual(new Date(new Date(START).getTime() + minutes(90)));
  });

  it('enforces the clinic minimum on explicit intervals (clinic B: at least 60 min)', async () => {
    const { prisma, service } = setup({ tenantDefault: 60, tenantMin: 60 });

    await expect(
      service.create(TENANT, RECEPTION, { ...createDto, endsAt: '2026-10-01T13:30:00.000Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.appointment.create).not.toHaveBeenCalled();
  });

  it('rejects an end that is not after the start', async () => {
    const { service } = setup();

    await expect(service.create(TENANT, RECEPTION, { ...createDto, endsAt: START })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects when the configured default is below the clinic minimum (stale config)', async () => {
    const { service } = setup({ tenantDefault: 60, tenantMin: 60, professionalDefault: 20 });

    await expect(service.create(TENANT, RECEPTION, createDto)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('double booking', () => {
  it('rejects create when the professional already has an overlapping active appointment', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValue({ id: 'other' });

    await expect(service.create(TENANT, RECEPTION, createDto)).rejects.toBeInstanceOf(ConflictException);

    const { where } = prisma.appointment.findFirst.mock.calls[0][0];
    expect(where).toMatchObject({
      tenantId: TENANT,
      professionalId: 'pro-1',
      status: { in: ['scheduled', 'confirmed', 'completed'] },
      scheduledAt: { lt: new Date(new Date(START).getTime() + minutes(30)) },
      endsAt: { gt: new Date(START) },
    });
    expect(prisma.appointment.create).not.toHaveBeenCalled();
  });

  it('takes the per-professional lock before checking for overlaps', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValue(null);

    await service.create(TENANT, RECEPTION, createDto);

    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.appointment.findFirst.mock.invocationCallOrder[0],
    );
  });
});

describe('update', () => {
  it('keeps the original duration when only the start is rescheduled', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValueOnce(existingAppointment()).mockResolvedValue(null);

    await service.update(TENANT, RECEPTION, 'a1', { scheduledAt: '2026-10-02T09:00:00.000Z' });

    const { data } = prisma.appointment.update.mock.calls[0][0];
    expect(data.scheduledAt).toEqual(new Date('2026-10-02T09:00:00.000Z'));
    expect(data.endsAt).toEqual(new Date('2026-10-02T10:00:00.000Z'));
  });

  it('ignores the appointment itself when checking for overlaps', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValueOnce(existingAppointment()).mockResolvedValue(null);

    await service.update(TENANT, RECEPTION, 'a1', { scheduledAt: '2026-10-01T13:15:00.000Z' });

    const { where } = prisma.appointment.findFirst.mock.calls[1][0];
    expect(where.id).toEqual({ not: 'a1' });
  });

  it('rejects a reschedule that overlaps another appointment', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst
      .mockResolvedValueOnce(existingAppointment())
      .mockResolvedValue({ id: 'other' });

    await expect(
      service.update(TENANT, RECEPTION, 'a1', { scheduledAt: '2026-10-01T14:00:00.000Z' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('checks overlaps against the new professional when the professional changes', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValueOnce(existingAppointment()).mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue({ id: 'pro-2', defaultAppointmentDurationMinutes: null });

    await service.update(TENANT, RECEPTION, 'a1', { professionalId: 'pro-2' });

    expect(prisma.appointment.findFirst.mock.calls[1][0].where.professionalId).toBe('pro-2');
  });

  it('does not touch the agenda for status/notes-only changes', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment());

    await service.update(TENANT, RECEPTION, 'a1', { status: 'confirmed', notes: 'ok' });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.appointment.update).toHaveBeenCalled();
  });
});

describe('status transitions', () => {
  it.each([
    ['completed', 'scheduled'],
    ['cancelled', 'confirmed'],
    ['no_show', 'scheduled'],
    ['confirmed', 'scheduled'],
  ])('rejects %s -> %s', async (from, to) => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment({ status: from }));

    await expect(service.update(TENANT, RECEPTION, 'a1', { status: to as never })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('freezes time, patient and professional on finished appointments but still allows notes', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment({ status: 'completed' }));

    await expect(
      service.update(TENANT, RECEPTION, 'a1', { scheduledAt: '2026-10-05T10:00:00.000Z' }),
    ).rejects.toBeInstanceOf(ConflictException);

    await service.update(TENANT, RECEPTION, 'a1', { notes: 'evolução registrada' });
    expect(prisma.appointment.update).toHaveBeenCalledTimes(1);
  });

  it('cancels through remove without any overlap check', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment());

    await service.remove(TENANT, RECEPTION, 'a1');

    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }),
    );
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('refuses to cancel an appointment that was already completed', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment({ status: 'completed' }));

    await expect(service.remove(TENANT, RECEPTION, 'a1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('escopo da agenda (appointments:all)', () => {
  const listQuery = { page: 1, pageSize: 50 };

  it('sem appointments:all, a listagem é sempre a da própria agenda', async () => {
    const { prisma, service } = setup();

    await service.findAll(TENANT, OWN_ONLY, listQuery);

    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ professionalId: 'pro-1' }) }),
    );
    expect(prisma.appointment.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ professionalId: 'pro-1' }),
    });
  });

  it('sem appointments:all, pedir a agenda de outro profissional é 403 (não lista vazia)', async () => {
    const { prisma, service } = setup();

    await expect(
      service.findAll(TENANT, OWN_ONLY, { ...listQuery, professionalId: 'pro-2' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    // Filtrar pela própria agenda explicitamente continua valendo.
    await service.findAll(TENANT, OWN_ONLY, { ...listQuery, professionalId: 'pro-1' });
  });

  it('com appointments:all, lista todas as agendas (ou a do profissional filtrado)', async () => {
    const { prisma, service } = setup();

    await service.findAll(TENANT, RECEPTION, listQuery);
    expect(prisma.appointment.findMany.mock.calls[0][0].where.professionalId).toBeUndefined();

    await service.findAll(TENANT, RECEPTION, { ...listQuery, professionalId: 'pro-2' });
    expect(prisma.appointment.findMany.mock.calls[1][0].where.professionalId).toBe('pro-2');
  });

  it('sem appointments:all, agendamento de outro profissional responde 404 (não confirma que existe)', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValue(null);

    await expect(service.findOne(TENANT, OWN_ONLY, 'a1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a1', tenantId: TENANT, professionalId: 'pro-1' } }),
    );
  });

  it('com appointments:all, o detalhe não filtra por profissional', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment({ professionalId: 'pro-2' }));

    await service.findOne(TENANT, RECEPTION, 'a1');
    expect(prisma.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a1', tenantId: TENANT } }),
    );
  });

  it('sem appointments:all, só cria na própria agenda', async () => {
    const { prisma, service } = setup();

    await expect(
      service.create(TENANT, OWN_ONLY, { ...createDto, professionalId: 'pro-2' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.appointment.create).not.toHaveBeenCalled();

    await service.create(TENANT, OWN_ONLY, createDto);
    expect(prisma.appointment.create).toHaveBeenCalled();
  });

  it('sem appointments:all, não passa um agendamento próprio para a agenda de outro', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment());

    await expect(
      service.update(TENANT, OWN_ONLY, 'a1', { professionalId: 'pro-2' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });

  it('sem appointments:all, edita e cancela agendamentos da própria agenda', async () => {
    const { prisma, service } = setup();
    prisma.appointment.findFirst.mockResolvedValue(existingAppointment());

    await service.update(TENANT, OWN_ONLY, 'a1', { notes: 'retorno em 30 dias' });
    await service.remove(TENANT, OWN_ONLY, 'a1');
    expect(prisma.appointment.update).toHaveBeenCalledTimes(2);
  });
});
