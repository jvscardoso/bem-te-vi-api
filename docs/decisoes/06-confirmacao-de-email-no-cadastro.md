# 06 · Confirmação de email no cadastro da clínica

**Esforço:** P (reaproveita os tokens e os emails de senha e convite)

## Situação atual

- `POST /tenants` (cadastro público) cria a clínica e o dono **já ativo**, sem confirmar o email. O front já entra em seguida.
- A única proteção contra abuso é o limite de 10 cadastros por minuto por IP.

## Riscos

| Risco | Exemplo |
|---|---|
| **Email digitado errado** | O dono erra uma letra, usa o sistema por semanas e, quando esquece a senha, o link vai para o endereço errado. A conta fica inacessível, sem recuperação |
| **Email de outra pessoa** | Alguém cadastra uma clínica usando o email de um terceiro. Os emails do sistema passam a ir para quem não pediu |
| **Subdomínio ocupado** | Cadastros falsos ou abandonados ficam com subdomínios (`clinica-sao-jose`) para sempre |
| **Robôs** | 10 por minuto por IP ainda permite milhares de clínicas falsas por dia, vindas de vários IPs |

## Opções

### A. Manter como está
- ✅ Zero esforço e zero atrito no cadastro.
- ❌ Os riscos acima.

### B. Confirmar o email antes do primeiro login (recomendada)
- O cadastro cria a clínica e o dono com status **"aguardando confirmação"**. O login é recusado com uma mensagem específica, como "Confirme seu email para entrar".
- O email de confirmação usa o mesmo mecanismo dos de senha e convite: token de uso único, só o hash no banco, validade de 24h a 48h e opção de reenviar.
- O link abre uma página do front que confirma e já leva ao login, ou entra direto.
- **Limpeza:** cadastros não confirmados em, por exemplo, 7 dias são apagados, e o subdomínio é liberado. Isso precisa de um job agendado, o mesmo agendador da decisão 04, ou de uma limpeza feita no próprio cadastro.
- ✅ Garante que o dono tem acesso ao email: a recuperação de senha passa a ser confiável.
- ❌ Um passo a mais no cadastro. O front muda: deixa de entrar direto e mostra "verifique seu email".

### C. Entrar logo, mas com limites até confirmar
O dono entra na hora e vê um aviso para confirmar. Sem confirmação, não convida usuários e não cadastra pacientes, por exemplo.
- ✅ Menos atrito: a pessoa experimenta o produto na hora.
- ❌ Mais regras espalhadas pela API. A conta fica num "meio-termo" que precisa ser tratado em várias telas.

### Complemento contra robôs: captcha
Um captcha invisível no formulário de cadastro, como o **Cloudflare Turnstile** (gratuito), validado pela API. Resolve os robôs, enquanto B e C resolvem o email.

## Pontos a decidir

1. **B ou C?** Recomendo **B**: mais simples, e quem está contratando um sistema de clínica não se incomoda em confirmar um email.
2. **Prazo para apagar cadastros não confirmados:** recomendo **7 dias**.
3. **Captcha agora ou só se aparecer abuso?** Recomendo **só se aparecer abuso**, mas com a validação já prevista.

## Impacto (opção B)

- **Banco:** um tipo novo de token (`email_verification`) e um status novo do usuário, ou reaproveitar `invited`.
- **API:** o cadastro envia o email em vez de liberar o login, uma rota pública para confirmar, uma rota para reenviar e a mensagem própria no login.
- **Front:** a tela pós-cadastro muda para "verifique seu email", com uma página de confirmação e um botão de reenviar.

## Perguntas para você

- [ ] A, B ou C?
- [ ] Prazo para apagar cadastros não confirmados?
- [ ] Captcha agora ou depois?
