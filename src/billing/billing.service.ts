import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Charge, ChargeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { pageOf } from '../common/pagination/page.js';
import { CreateChargeDto } from './dto/create-charge.dto.js';
import { UpdateChargeDto } from './dto/update-charge.dto.js';
import { ListChargesQueryDto, type ChargeStatusFilter } from './dto/list-charges-query.dto.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import { BillingSummaryQueryDto } from './dto/billing-summary-query.dto.js';

// Campos "de conteúdo" de uma cobrança: só editáveis enquanto pendente e sem pagamento algum.
const CONTENT_FIELDS = ['patientId', 'appointmentId', 'description', 'amountCents', 'dueDate'] as const;

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async createCharge(tenantId: string, actorId: string, dto: CreateChargeDto) {
    await this.assertPatientInTenant(tenantId, dto.patientId);
    if (dto.appointmentId) {
      await this.assertAppointmentInTenant(tenantId, dto.appointmentId, dto.patientId);
    }
    const charge = await this.prisma.charge.create({
      data: {
        tenantId,
        patientId: dto.patientId,
        appointmentId: dto.appointmentId,
        description: dto.description,
        amountCents: dto.amountCents,
        dueDate: new Date(dto.dueDate),
        createdByUserId: actorId,
      },
    });
    return this.withComputed(charge);
  }

  async findAllCharges(tenantId: string, query: ListChargesQueryDto) {
    const { patientId, status, from, to, page, pageSize } = query;
    const where: Prisma.ChargeWhereInput = {
      tenantId,
      patientId,
      dueDate: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined },
      ...this.statusFilter(status),
    };

    const [data, total] = await Promise.all([
      this.prisma.charge.findMany({
        where,
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.charge.count({ where }),
    ]);
    return pageOf(data.map((charge) => this.withComputed(charge)), total, page, pageSize);
  }

  async findOneCharge(tenantId: string, id: string) {
    const charge = await this.getChargeOrThrow(tenantId, id);
    const payments = await this.prisma.payment.findMany({
      where: { chargeId: id },
      orderBy: { paidAt: 'desc' },
    });
    return { ...this.withComputed(charge), payments };
  }

  async updateCharge(tenantId: string, id: string, dto: UpdateChargeDto) {
    const charge = await this.getChargeOrThrow(tenantId, id);
    const paidCents = await this.paidCents(id);
    const changesContent = CONTENT_FIELDS.some((field) => dto[field] !== undefined);

    this.assertStatusTransition(charge.status, dto.status);
    if (paidCents > 0 && (changesContent || dto.status === 'cancelled')) {
      throw new ConflictException('Cobrança com pagamento registrado não pode ser editada nem cancelada');
    }
    if (charge.status !== 'pending' && changesContent) {
      throw new ConflictException('Só é possível editar uma cobrança pendente');
    }

    const patientId = dto.patientId ?? charge.patientId;
    if (dto.patientId) {
      await this.assertPatientInTenant(tenantId, dto.patientId);
    }
    if (dto.appointmentId) {
      await this.assertAppointmentInTenant(tenantId, dto.appointmentId, patientId);
    }

    const updated = await this.prisma.charge.update({
      where: { id },
      data: { ...dto, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined },
    });
    return this.withComputed(updated);
  }

  // DELETE cancela (não apaga) — mesma convenção da agenda.
  async cancelCharge(tenantId: string, id: string) {
    return this.updateCharge(tenantId, id, { status: 'cancelled' });
  }

  // O lock serializa pagamentos concorrentes da MESMA cobrança; sem ele, duas requisições
  // simultâneas poderiam passar juntas pela checagem de saldo e somar mais que o valor devido
  // (mesmo problema, e mesma solução, da checagem de sobreposição de horário na agenda).
  async recordPayment(tenantId: string, chargeId: string, actorId: string, dto: CreatePaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`charge:${chargeId}`}))`;

      const charge = await tx.charge.findFirst({ where: { id: chargeId, tenantId } });
      if (!charge) {
        throw new NotFoundException(`Cobrança ${chargeId} não encontrada`);
      }
      if (charge.status !== 'pending') {
        throw new ConflictException('Só é possível registrar pagamento numa cobrança pendente');
      }

      const paidSoFar = await tx.payment.aggregate({
        where: { chargeId },
        _sum: { amountCents: true },
      });
      const remaining = charge.amountCents - (paidSoFar._sum.amountCents ?? 0);
      if (dto.amountCents > remaining) {
        throw new BadRequestException(
          `O pagamento (${dto.amountCents} centavos) excede o saldo devedor da cobrança (${remaining} centavos)`,
        );
      }

      const payment = await tx.payment.create({
        data: {
          tenantId,
          chargeId,
          amountCents: dto.amountCents,
          method: dto.method,
          paidAt: dto.paidAt ? new Date(dto.paidAt) : undefined,
          notes: dto.notes,
          recordedByUserId: actorId,
        },
      });

      if (dto.amountCents === remaining) {
        await tx.charge.update({ where: { id: chargeId }, data: { status: 'paid' } });
      }

      return payment;
    });
  }

  async listPayments(tenantId: string, chargeId: string) {
    await this.getChargeOrThrow(tenantId, chargeId);
    return this.prisma.payment.findMany({ where: { chargeId }, orderBy: { paidAt: 'desc' } });
  }

  // "Pago no período" olha a data do pagamento; os demais são o total atual (não teria
  // sentido perguntar "quanto estava pendente em janeiro" sem reconstruir o histórico).
  async summary(tenantId: string, { from, to }: BillingSummaryQueryDto) {
    const [pending, overdue, cancelled, paidInPeriod] = await Promise.all([
      this.prisma.charge.aggregate({
        where: { tenantId, ...this.statusFilter('pending') },
        _count: true,
        _sum: { amountCents: true },
      }),
      this.prisma.charge.aggregate({
        where: { tenantId, ...this.statusFilter('overdue') },
        _count: true,
        _sum: { amountCents: true },
      }),
      this.prisma.charge.aggregate({
        where: { tenantId, status: 'cancelled' },
        _count: true,
        _sum: { amountCents: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          tenantId,
          paidAt: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined },
        },
        _count: true,
        _sum: { amountCents: true },
      }),
    ]);

    const view = (agg: { _count: number; _sum: { amountCents: number | null } }) => ({
      count: agg._count,
      amountCents: agg._sum.amountCents ?? 0,
    });
    return {
      pending: view(pending),
      overdue: view(overdue),
      cancelled: view(cancelled),
      paidInPeriod: view(paidInPeriod),
    };
  }

  private async getChargeOrThrow(tenantId: string, id: string): Promise<Charge> {
    const charge = await this.prisma.charge.findFirst({ where: { id, tenantId } });
    if (!charge) {
      throw new NotFoundException(`Cobrança ${id} não encontrada`);
    }
    return charge;
  }

  private async paidCents(chargeId: string): Promise<number> {
    const agg = await this.prisma.payment.aggregate({
      where: { chargeId },
      _sum: { amountCents: true },
    });
    return agg._sum.amountCents ?? 0;
  }

  private assertStatusTransition(current: ChargeStatus, next?: ChargeStatus) {
    if (!next || next === current) {
      return;
    }
    if (current !== 'pending' || next !== 'cancelled') {
      throw new ConflictException(`Transição de status inválida: ${current} -> ${next}`);
    }
  }

  // 'pending' e 'overdue' se excluem: uma cobrança pendente cai em exatamente um dos dois.
  private statusFilter(status?: ChargeStatusFilter): Prisma.ChargeWhereInput {
    const today = new Date(new Date().toISOString().slice(0, 10));
    switch (status) {
      case 'pending':
        return { status: 'pending', dueDate: { gte: today } };
      case 'overdue':
        return { status: 'pending', dueDate: { lt: today } };
      case 'paid':
        return { status: 'paid' };
      case 'cancelled':
        return { status: 'cancelled' };
      default:
        return {};
    }
  }

  private withComputed(charge: Charge) {
    const today = new Date(new Date().toISOString().slice(0, 10));
    return { ...charge, isOverdue: charge.status === 'pending' && charge.dueDate < today };
  }

  // O FK do banco só garante que o paciente existe, não que é deste tenant nem que está ativo.
  private async assertPatientInTenant(tenantId: string, patientId: string) {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!patient) {
      throw new BadRequestException('patientId inválido para este tenant');
    }
  }

  // Também confere que o agendamento é do MESMO paciente da cobrança — senão dava para
  // cobrar um paciente citando o agendamento de outro.
  private async assertAppointmentInTenant(tenantId: string, appointmentId: string, patientId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId, patientId },
      select: { id: true },
    });
    if (!appointment) {
      throw new BadRequestException('appointmentId inválido para este tenant ou paciente');
    }
  }
}
