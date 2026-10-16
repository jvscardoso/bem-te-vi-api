import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsObject, IsString, ValidateNested } from 'class-validator';
import { RequiredText } from '../../common/validation/required-text.decorator.js';
import { IsCpfOrCnpj } from '../../common/validation/document.js';
import type { PaymentMethod } from '../payment-gateway.js';

export const PAYMENT_METHODS: PaymentMethod[] = ['pix', 'boleto', 'credit_card', 'any'];

// Quem paga e recebe a nota: pode ser outra pessoa (o contador, a empresa do dono) que não o
// responsável cadastrado na clínica.
export class BillingDetailsDto {
  @RequiredText(150)
  name!: string;

  @IsCpfOrCnpj()
  document!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;
}

export class ContractSubscriptionDto {
  @IsString()
  planId!: string;

  @IsIn(['monthly', 'yearly'])
  cycle!: 'monthly' | 'yearly';

  // `any`: a clínica escolhe Pix, boleto ou cartão na página de pagamento.
  @IsIn(PAYMENT_METHODS)
  paymentMethod!: PaymentMethod;

  @IsObject()
  @ValidateNested()
  @Type(() => BillingDetailsDto)
  billing!: BillingDetailsDto;
}
