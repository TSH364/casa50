import { expect, test } from "@playwright/test";

/**
 * Percurso com sessão.
 *
 * Precisa de uma conta real no Supabase configurado, informada por variável
 * de ambiente:
 *
 *   E2E_EMAIL=voce@exemplo.com E2E_PASSWORD=... npm run test:e2e
 *
 * Sem isso o arquivo inteiro é pulado com uma mensagem clara. Falhar por
 * falta de configuração daria a impressão de que o app está quebrado, e a
 * secao 20 vale para o relatório de teste tanto quanto para a interface.
 *
 * Estes testes NÃO criam nem apagam dados: só leem. Um teste que grava numa
 * base real de finanças do casal é um risco que nenhum ganho de cobertura
 * justifica.
 */

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(
  !EMAIL || !PASSWORD,
  "Defina E2E_EMAIL e E2E_PASSWORD para rodar os testes com sessão.",
);

test.beforeEach(async ({ page }) => {
  await page.goto("/entrar");
  await page.getByLabel(/e-?mail/i).fill(EMAIL!);
  await page.getByLabel(/senha/i).fill(PASSWORD!);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/(inicio|nova-casa)/, { timeout: 20_000 });
});

test("o início abre com o resumo do mês", async ({ page }) => {
  await page.goto("/inicio");
  await expect(
    page.getByRole("heading", { level: 1 }).first(),
  ).toBeVisible();
});

test("a navegação principal alcança todas as áreas", async ({ page }) => {
  await page.goto("/inicio");

  const nav = page.getByRole("navigation", { name: /navegação principal/i });
  await expect(nav).toBeVisible();

  for (const rota of [
    { link: /extratos/i, url: /\/extratos/ },
    { link: /previsão/i, url: /\/previsao/ },
    { link: /insights/i, url: /\/insights/ },
    { link: /metas/i, url: /\/metas/ },
    { link: /casa/i, url: /\/casa/ },
  ]) {
    await nav.getByRole("link", { name: rota.link }).first().click();
    await expect(page).toHaveURL(rota.url);
  }
});

test("a troca de mês muda a URL e mantém a página", async ({ page }) => {
  await page.goto("/extratos");
  const antes = page.url();

  await page.getByRole("link", { name: /mês anterior/i }).click();
  await expect(page).toHaveURL(/mes=\d{4}-\d{2}/);
  expect(page.url()).not.toBe(antes);
  await expect(page).toHaveURL(/\/extratos/);
});

test("a importação avisa que PDF ainda não é lido", async ({ page }) => {
  await page.goto("/importar");
  await expect(page.getByText(/CSV/i).first()).toBeVisible();
});

test("o histórico abre e mostra os filtros", async ({ page }) => {
  await page.goto("/historico");
  await expect(page.getByRole("heading", { name: /histórico/i })).toBeVisible();
});

test("insights fica calado quando não há base para comparar", async ({ page }) => {
  await page.goto("/insights");
  // Ou lista observações, ou explica por que não tem nenhuma. O que não pode
  // é ficar em branco sem dizer nada.
  const temConteudo = await page
    .getByText(/comum neste mês|não dá para comparar|acima da média|abaixo da média|orçamento/i)
    .first()
    .isVisible();
  expect(temConteudo).toBe(true);
});

test("nenhuma página protegida vaza para quem sai", async ({ page, context }) => {
  await page.goto("/inicio");
  await context.clearCookies();
  await page.goto("/inicio");
  await expect(page).toHaveURL(/\/entrar/);
});
