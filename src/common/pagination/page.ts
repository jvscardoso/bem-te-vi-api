export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Envelope padrão das listagens paginadas (pacientes, agenda, ...).
export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export function pageOf<T>(data: T[], total: number, page: number, pageSize: number): Page<T> {
  return { data, meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) } };
}
