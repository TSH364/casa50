/**
 * Identidade do build que esta rodando.
 *
 * Os valores sao embutidos no bundle pelo `next.config.ts` - por isso sao
 * lidos como literais, e nao montando o nome da variavel em tempo de
 * execucao: o Next substitui `process.env.APP_BUILD_SHA` pelo texto durante o
 * build, e um acesso dinamico nao seria substituido.
 */

export interface BuildInfo {
  /** 7 primeiros caracteres do commit, ou "local" fora da Vercel. */
  sha: string;
  /** Branch do deploy. Vazio fora da Vercel. */
  ref: string;
  /** "production", "preview" ou vazio. */
  env: string;
  /** Momento do build, em ISO. Vazio se indisponivel. */
  builtAt: string;
}

export function buildInfo(): BuildInfo {
  return {
    sha: process.env.APP_BUILD_SHA || "local",
    ref: process.env.APP_BUILD_REF || "",
    env: process.env.APP_BUILD_ENV || "",
    builtAt: process.env.APP_BUILT_AT || "",
  };
}

const STAMP = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/**
 * Texto longo para o `title`: tudo que identifica o build, numa linha.
 *
 * O horario e o que responde ao caso do redeploy sem codigo novo, em que o
 * commit e o mesmo mas o build e outro.
 */
export function buildLabel(info: BuildInfo = buildInfo()): string {
  const parts = [`Versão ${info.sha}`];
  if (info.ref) parts.push(info.ref);
  if (info.env) parts.push(info.env === "production" ? "produção" : info.env);
  if (info.builtAt) {
    const date = new Date(info.builtAt);
    if (!Number.isNaN(date.getTime())) {
      parts.push(`build de ${STAMP.format(date)}`);
    }
  }
  return parts.join(" · ");
}
