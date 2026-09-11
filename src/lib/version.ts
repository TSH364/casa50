/**
 * Identidade do build que esta rodando.
 *
 * Os valores sao embutidos no bundle pelo `next.config.ts` - por isso sao
 * lidos como literais, e nao montando o nome da variavel em tempo de
 * execucao: o Next substitui `process.env.APP_BUILD_SHA` pelo texto durante o
 * build, e um acesso dinamico nao seria substituido.
 */

export interface BuildInfo {
  /** Numero legivel do `package.json`, ex. "0.2.0". Vazio se indisponivel. */
  version: string;
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
    version: process.env.APP_VERSION || "",
    sha: process.env.APP_BUILD_SHA || "local",
    ref: process.env.APP_BUILD_REF || "",
    env: process.env.APP_BUILD_ENV || "",
    builtAt: process.env.APP_BUILT_AT || "",
  };
}

/**
 * "0.2.0" -> "v0.2"; "0.2.1" -> "v0.2.1".
 *
 * O `.0` final some porque nao informa nada: quem le "v0.2" entende que e a
 * segunda versao, e o zero so ocupa espaco num cabecalho apertado. Um patch
 * diferente de zero aparece, porque ai ele distingue duas entregas.
 */
export function versionLabel(info: BuildInfo = buildInfo()): string {
  if (!info.version) return info.sha;
  const parts = info.version.split(".");
  const short = parts[2] === "0" ? parts.slice(0, 2).join(".") : info.version;
  return `v${short}`;
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
  // O numero vem na frente porque e o que se le; o commit fica logo atras,
  // porque e o que identifica sem ambiguidade quando algo da errado.
  const parts = [info.version ? `Versão ${versionLabel(info)}` : "Versão"];
  parts.push(info.sha);
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
