import { AsyncLocalStorage } from 'node:async_hooks';

// Dados da requisição em curso que interessam além do controller (hoje: a trilha de
// auditoria). Guardados por requisição via AsyncLocalStorage, sem precisar passar IP e
// navegador por todas as camadas até o serviço que grava o registro.
export interface RequestContextStore {
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export const RequestContext = {
  run<T>(store: RequestContextStore, callback: () => T): T {
    return storage.run(store, callback);
  },
  current(): RequestContextStore {
    return storage.getStore() ?? {};
  },
};
