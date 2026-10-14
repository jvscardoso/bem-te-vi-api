-- Versão da senha em que cada sessão nasceu (ver Session.passwordVersion no schema).
-- Sessões já abertas recebem 0: se o usuário já trocou a senha alguma vez, a versão dele é maior,
-- e o próximo refresh recusa a sessão (o usuário só precisa logar de novo).
ALTER TABLE "sessions" ADD COLUMN "password_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sessions" ALTER COLUMN "password_version" DROP DEFAULT;
