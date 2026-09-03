import { expect, test } from "@playwright/test";

/**
 * O que dá para verificar sem sessão.
 *
 * Estes testes não precisam de banco nem de conta: cobrem o que qualquer
 * visitante encontra. São os que valem em CI sem segredo configurado.
 */

test("a raiz leva para a entrada quando ninguém está logado", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/entrar/);
});

test("a tela de entrada tem rótulo em todo campo", async ({ page }) => {
  await page.goto("/entrar");

  // Campo sem rótulo é inacessível a leitor de tela, e a secao 21 não abre
  // exceção para formulário de login.
  const email = page.getByLabel(/e-?mail/i);
  const senha = page.getByLabel(/senha/i);

  await expect(email).toBeVisible();
  await expect(senha).toBeVisible();
  await expect(email).toHaveAttribute("type", "email");
  await expect(senha).toHaveAttribute("type", "password");
});

test("dá para navegar pelo teclado até o botão de entrar", async ({ page }) => {
  await page.goto("/entrar");

  await page.getByLabel(/e-?mail/i).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel(/senha/i)).toBeFocused();
});

test("recusa e-mail inválido sem recarregar a página", async ({ page }) => {
  await page.goto("/entrar");

  await page.getByLabel(/e-?mail/i).fill("nao-e-um-email");
  await page.getByLabel(/senha/i).fill("qualquercoisa");
  await page.getByRole("button", { name: /entrar/i }).click();

  // A validação do navegador ou a do servidor precisam segurar; o que não
  // pode é a página aceitar em silêncio e mandar para dentro.
  await expect(page).toHaveURL(/\/entrar/);
});

test("a rota protegida não abre sem sessão", async ({ page }) => {
  await page.goto("/inicio");
  await expect(page).toHaveURL(/\/entrar/);
});

test("a página tem título e idioma declarados", async ({ page }) => {
  await page.goto("/entrar");

  await expect(page).toHaveTitle(/Fluxo/);
  // Sem `lang`, o leitor de tela lê português com pronúncia inglesa.
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
});

test("no celular, nada transborda para os lados", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "celular", "Só no alvo de celular.");

  await page.goto("/entrar");

  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });

  // Rolagem horizontal em celular é defeito de layout, não preferência.
  expect(overflow).toBeLessThanOrEqual(1);
});

test("os alvos de toque têm pelo menos 44px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "celular", "Só no alvo de celular.");

  await page.goto("/entrar");

  const botoes = await page.getByRole("button").all();
  for (const botao of botoes) {
    if (!(await botao.isVisible())) continue;
    const box = await botao.boundingBox();
    if (!box) continue;
    expect(box.height).toBeGreaterThanOrEqual(40);
  }
});
