import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AppointmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAppointmentDto } from './dto/create-appointment.dto.js';
import { UpdateAppointmentDto } from './dto/update-appointment.dto.js';
import { FindAppointmentsQueryDto } from './dto/find-appointments-query.dto.js';

const MS_PER_MINUTE = 60_000;

// Só estes status ocupam a agenda do profissional.
const ACTIVE_STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed', 'completed'];

// Status finais (sem saída) deixam o agendamento congelado: só as observações mudam.
const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['confirmed', 'completed', 'cancelled', 'no_show'],
  confirmed: ['completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
};

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateAppointmentDto) {
    await this.assertPatientInTenant(tenantId, dto.patientId);
    const professional = await this.getActiveProfessional(tenantId, dto.professionalId);
    const settings = await this.getTenantSettings(tenantId);

    // Dois modos: início+fim explícitos, ou só o início e o fim vem da duração configurada
    // (do profissional, se tiver; senão, da clínica).
    const start = new Date(dto.scheduledAt);
    const end = dto.endsAt
      ? new Date(dto.endsAt)
      : new Date(
          start.getTime() +
            (professional.defaultAppointmentDurationMinutes ??
              settings.defaultAppointmentDurationMinutes) *
              MS_PER_MINUTE,
        );
    this.assertValidInterval(start, end, settings.minAppointmentDurationMinutes);

    return this.prisma.$transaction(async (tx) => {
      await this.assertNoOverlap(tx, tenantId, dto.professionalId, start, end);
      return tx.appointment.create({
        data: {
          tenantId,
          patientId: dto.patientId,
          professionalId: dto.professionalId,
          scheduledAt: start,
          endsAt: end,
          notes: dto.notes,
        },
      });
    });
  }

  findAll(tenantId: string, query: FindAppointmentsQueryDto) {
    return this.prisma.appointment.findMany({
      where: {
        tenantId,
        professionalId: query.professionalId,
        patientId: query.patientId,
        scheduledAt: {
          gte: query.from ? new Date(query.from) : undefined,
          lte: query.to ? new Date(query.to) : undefined,
        },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const appointment = await this.prisma.appointment.findFirst({ where: { id, tenantId } });
    if (!appointment) {
      throw new NotFoundException(`Agendamento ${id} não encontrado`);
    }
    return appointment;
  }

  async update(tenantId: string, id: string, dto: UpdateAppointmentDto) {
    const existing = await this.findOne(tenantId, id);
    this.assertStatusTransition(existing.status, dto.status);

    const timesChanged = dto.scheduledAt !== undefined || dto.endsAt !== undefined;
    const professionalChanged =
      dto.professionalId !== undefined && dto.professionalId !== existing.professionalId;
    const patientChanged = dto.patientId !== undefined && dto.patientId !== existing.patientId;

    // Ao remarcar só o início, a duração original é preservada.
    let start = existing.scheduledAt;
    let end = existing.endsAt;
    if (timesChanged) {
      const settings = await this.getTenantSettings(tenantId);
      start = dto.scheduledAt ? new Date(dto.scheduledAt) : existing.scheduledAt;
      end = dto.endsAt
        ? new Date(dto.endsAt)
        : new Date(start.getTime() + (existing.endsAt.getTime() - existing.scheduledAt.getTime()));
      this.assertValidInterval(start, end, settings.minAppointmentDurationMinutes);
    }

    const rescheduled =
      professionalChanged ||
      start.getTime() !== existing.scheduledAt.getTime() ||
      end.getTime() !== existing.endsAt.getTime();

    if (ALLOWED_TRANSITIONS[existing.status].length === 0 && (rescheduled || patientChanged)) {
      throw new ConflictException(
        'Agendamento encerrado não pode ter horário, paciente ou profissional alterados',
      );
    }

    if (patientChanged && dto.patientId) {
      await this.assertPatientInTenant(tenantId, dto.patientId);
    }
    if (professionalChanged && dto.professionalId) {
      await this.getActiveProfessional(tenantId, dto.professionalId);
    }

    const data: Prisma.AppointmentUncheckedUpdateInput = {
      patientId: dto.patientId,
      professionalId: dto.professionalId,
      notes: dto.notes,
      status: dto.status,
      scheduledAt: timesChanged ? start : undefined,
      endsAt: timesChanged ? end : undefined,
    };

    const occupiesAgenda = ACTIVE_STATUSES.includes(dto.status ?? existing.status);
    if (!rescheduled || !occupiesAgenda) {
      return this.prisma.appointment.update({ where: { id }, data });
    }

    return this.prisma.$transaction(async (tx) => {
      await this.assertNoOverlap(
        tx,
        tenantId,
        dto.professionalId ?? existing.professionalId,
        start,
        end,
        id,
      );
      return tx.appointment.update({ where: { id }, data });
    });
  }

  async remove(tenantId: string, id: string) {
    await this.update(tenantId, id, { status: 'cancelled' });
  }

  private assertStatusTransition(current: AppointmentStatus, next?: AppointmentStatus) {
    if (!next || next === current) {
      return;
    }
    if (!ALLOWED_TRANSITIONS[current].includes(next)) {
      throw new ConflictException(`Transição de status inválida: ${current} -> ${next}`);
    }
  }

  private assertValidInterval(start: Date, end: Date, minMinutes: number) {
    if (end <= start) {
      throw new BadRequestException('endsAt deve ser posterior a scheduledAt');
    }
    if ((end.getTime() - start.getTime()) / MS_PER_MINUTE < minMinutes) {
      throw new BadRequestException(
        `A duração mínima de atendimento desta clínica é de ${minMinutes} minutos`,
      );
    }
  }

  // O lock serializa reservas concorrentes do mesmo profissional; sem ele, duas requisições
  // simultâneas poderiam passar juntas pela checagem de sobreposição.
  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    tenantId: string,
    professionalId: string,
    start: Date,
    end: Date,
    excludeId?: string,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${professionalId}))`;

    const conflict = await tx.appointment.findFirst({
      where: {
        tenantId,
        professionalId,
        status: { in: ACTIVE_STATUSES },
        scheduledAt: { lt: end },
        endsAt: { gt: start },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (conflict) {
      throw new ConflictException('O profissional já possui um agendamento neste horário');
    }
  }

  // Os FKs do banco só garantem que paciente/profissional existem, não que são deste tenant.
  private async assertPatientInTenant(tenantId: string, patientId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) {
      throw new BadRequestException('patientId inválido para este tenant');
    }
  }

  private async getActiveProfessional(tenantId: string, professionalId: string) {
    const professional = await this.prisma.user.findFirst({
      where: { id: professionalId, tenantId, status: 'active' },
      select: { id: true, defaultAppointmentDurationMinutes: true },
    });
    if (!professional) {
      throw new BadRequestException('professionalId inválido para este tenant');
    }
    return professional;
  }

  private getTenantSettings(tenantId: string) {
    return this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { defaultAppointmentDurationMinutes: true, minAppointmentDurationMinutes: true },
    });
  }
}
