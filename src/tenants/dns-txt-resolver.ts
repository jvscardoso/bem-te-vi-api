import { Injectable, Logger } from '@nestjs/common';
import { promises as dns } from 'node:dns';

const TIMEOUT_MS = 5_000;

// Isolado numa classe injetável para o teste poder substituir por um dublê controlável —
// não dá para "criar" um domínio real e apontar um TXT nele para provar o caminho feliz
// num teste automatizado, e depender de DNS de verdade tornaria a suíte lenta e instável.
@Injectable()
export class DnsTxtResolver {
  private readonly logger = new Logger(DnsTxtResolver.name);

  // Nunca rejeita: para quem verifica um domínio, "não respondeu", "não existe" e "existe mas
  // sem esse TXT" são o mesmo resultado prático (ainda não verificado) — não é erro da API.
  async resolveTxt(hostname: string): Promise<string[]> {
    // No caminho feliz (o comum), a consulta real termina bem antes do timeout. Sem cancelar
    // esse setTimeout, ele dispara 5s depois mesmo assim, rejeitando uma promise que ninguém
    // mais está esperando — um unhandled rejection silencioso a cada chamada bem-sucedida.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const records = await Promise.race([
        dns.resolveTxt(hostname),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Tempo esgotado ao consultar o DNS')), TIMEOUT_MS);
        }),
      ]);
      // Um registro TXT longo pode vir fragmentado em várias strings; concatena por registro.
      return records.map((chunks) => chunks.join(''));
    } catch (error) {
      this.logger.debug(`Falha ao resolver TXT de ${hostname}: ${(error as Error).message}`);
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
