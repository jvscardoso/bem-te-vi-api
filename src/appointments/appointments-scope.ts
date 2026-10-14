// appointments:read/write valem para a própria agenda (agendamentos em que o usuário é o
// profissional). Esta permissão estende as duas à agenda de todos os profissionais da clínica
// — é o que a recepção e o dono têm; um profissional recém-cadastrado, não.
export const APPOINTMENTS_ALL = 'appointments:all';

// Quem atende pacientes: tem agenda própria e pode ser o profissional de um agendamento. É
// independente das outras: um médico tem attend + read + write; a recepção, read + write + all,
// sem attend. Sem ela, o usuário não aparece como profissional nem recebe agendamentos novos.
export const APPOINTMENTS_ATTEND = 'appointments:attend';
