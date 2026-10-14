// Nome em português de cada campo dos DTOs, usado nas mensagens de validação ("Email do
// responsável inválido"). O gênero concorda o adjetivo ("obrigatório" / "obrigatória").
// Procura primeiro "Classe.campo" (o mesmo `name` é "Nome da clínica" num DTO e "Nome do
// paciente" em outro) e depois só "campo". Campo sem entrada aparece pelo nome técnico.
export interface FieldLabel {
  label: string;
  feminine?: boolean;
}

const f = (label: string): FieldLabel => ({ label, feminine: true });
const m = (label: string): FieldLabel => ({ label });

const BY_PROPERTY: Record<string, FieldLabel> = {
  name: m('Nome'),
  email: m('Email'),
  password: f('Senha'),
  currentPassword: f('Senha atual'),
  newPassword: f('Nova senha'),
  token: m('Link'),
  host: m('Endereço'),
  subdomain: m('Subdomínio'),
  customDomain: m('Domínio próprio'),
  confirmSubdomain: f('Confirmação do subdomínio'),
  defaultAppointmentDurationMinutes: f('Duração padrão do atendimento'),
  minAppointmentDurationMinutes: f('Duração mínima do atendimento'),
  owner: m('Responsável'),
  legalAcceptance: m('Aceite dos Termos e da Política'),
  termsVersion: f('Versão dos Termos de Uso'),
  privacyVersion: f('Versão da Política de Privacidade'),
  tradeName: m('Nome fantasia'),
  logoUrl: f('URL do logo'),
  primaryColor: f('Cor primária'),
  secondaryColor: f('Cor secundária'),
  fullName: m('Nome do paciente'),
  cpf: m('CPF'),
  birthDate: f('Data de nascimento'),
  phone: m('Telefone'),
  address: m('Endereço'),
  notes: m('Campo de observações'),
  patientId: m('Paciente'),
  professionalId: m('Profissional'),
  appointmentId: m('Agendamento'),
  templateId: m('Formulário'),
  roleId: m('Papel'),
  actorUserId: m('Usuário'),
  permissionIds: f('Lista de permissões'),
  scheduledAt: m('Início do atendimento'),
  endsAt: m('Fim do atendimento'),
  status: m('Status'),
  action: f('Ação'),
  from: f('Data inicial'),
  to: f('Data final'),
  page: f('Página'),
  pageSize: m('Tamanho da página'),
  q: m('Termo de busca'),
  closure: m('Filtro de encerramento'),
  description: f('Descrição'),
  amountCents: m('Valor'),
  dueDate: m('Vencimento'),
  method: f('Forma de pagamento'),
  paidAt: f('Data do pagamento'),
  answers: m('Conjunto de respostas'),
  fields: f('Lista de campos'),
  key: f('Chave do campo'),
  label: m('Rótulo do campo'),
  type: m('Tipo do campo'),
  required: f('Indicação de obrigatório'),
  options: f('Lista de opções'),
};

const BY_CLASS: Record<string, FieldLabel> = {
  'CreateTenantDto.name': m('Nome da clínica'),
  'UpdateTenantDto.name': m('Nome da clínica'),
  'CreateTenantOwnerDto.name': m('Nome do responsável'),
  'CreateTenantOwnerDto.email': m('Email do responsável'),
  'CreateTenantOwnerDto.password': f('Senha do responsável'),
  'CreateUserDto.name': m('Nome do usuário'),
  'UpdateUserDto.name': m('Nome do usuário'),
  'CreateUserDto.email': m('Email do usuário'),
  'UpdateUserDto.email': m('Email do usuário'),
  'CreatePatientDto.email': m('Email do paciente'),
  'UpdatePatientDto.email': m('Email do paciente'),
  'CreateRoleDto.name': m('Nome do papel'),
  'UpdateRoleDto.name': m('Nome do papel'),
  'CreateRoleDto.description': f('Descrição do papel'),
  'UpdateRoleDto.description': f('Descrição do papel'),
  'CreateAnamnesisTemplateDto.name': m('Nome do formulário'),
  'UpdateAnamnesisTemplateDto.name': m('Nome do formulário'),
  'CreateChargeDto.description': f('Descrição da cobrança'),
  'UpdateChargeDto.description': f('Descrição da cobrança'),
  'CreatePaymentDto.amountCents': m('Valor do pagamento'),
  'CreatePaymentDto.notes': m('Campo de observações do pagamento'),
};

export function fieldLabel(className: string | undefined, property: string): FieldLabel {
  return BY_CLASS[`${className}.${property}`] ?? BY_PROPERTY[property] ?? m(`Campo "${property}"`);
}
