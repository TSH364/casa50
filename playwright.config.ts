import { defineConfig, devices } from "@playwright/test";

/**
 * Testes de ponta a ponta (secao 24).
 *
 * O alvo padrão é o servidor de desenvolvimento local. Os testes que exigem
 * sessão só rodam quando `E2E_EMAIL` e `E2E_PASSWORD` estão no ambiente — sem
 * isso eles são pulados com uma mensagem, em vez de falharem por falta de
 * configuração e darem a impressão de que o app está quebrado.
 *
 * O celular é o primeiro alvo, não uma variação: a secao 21 define o app como
 * mobile-first, e é onde ele vai ser usado de fato.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Um worker de proposito: `next dev` compila cada rota no primeiro acesso,
  // e varios workers batendo ao mesmo tempo faziam a navegacao estourar o
  // tempo. O teste acusava defeito onde havia so compilacao — exatamente o
  // tipo de falso alarme que a secao 20 proibe na interface, e que tambem
  // nao serve num relatorio de teste.
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    navigationTimeout: 45_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "celular", use: { ...devices["iPhone 13"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
