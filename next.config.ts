import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/**
 * Identidade do build, congelada aqui e embutida no bundle.
 *
 * Existe para responder uma pergunta só: "a versão que estou vendo é a que
 * acabou de subir?". Sem isso não há como distinguir um deploy novo de uma
 * página em cache, e a resposta vira tentativa e erro.
 *
 * Na Vercel o commit vem das variáveis de sistema. Fora dela, tenta o git
 * local; se nem isso existir (build em container sem `.git`), fica "local",
 * que é honesto - melhor do que inventar um número de versão.
 */
function commitSha(): string {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel) return fromVercel.slice(0, 7);

  try {
    return execSync("git rev-parse --short=7 HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "local";
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Bibliotecas de importacao (xlsx/pdfjs) entram na Etapa 3 e sao pesadas:
    // mantemos o bundle do servidor enxuto ate la.
    serverActions: { bodySizeLimit: "10mb" },
  },
  env: {
    APP_BUILD_SHA: commitSha(),
    APP_BUILD_REF: process.env.VERCEL_GIT_COMMIT_REF ?? "",
    // production | preview | development na Vercel; vazio fora dela.
    APP_BUILD_ENV: process.env.VERCEL_ENV ?? "",
    // Avaliado quando o build roda: é o carimbo que muda a cada deploy,
    // mesmo quando o commit é o mesmo (um redeploy sem código novo).
    APP_BUILT_AT: new Date().toISOString(),
  },
};

export default nextConfig;
