import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * Home Assistant na tela da Casa: o codigo aparece uma vez, junto com o que
 * colar; depois, so a configuracao (sem o codigo); e sem a migracao, o
 * motivo, sem botao.
 */

const gerarCodigoHA = vi.fn(async () => ({ codigo: "fluxo_" + "a".repeat(43) }));
vi.mock("@/actions/home-assistant", () => ({
  gerarCodigoHA: () => gerarCodigoHA(),
  desligarHA: vi.fn(async () => ({})),
  salvarTarifaHA: vi.fn(async () => ({})),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { HomeAssistantCard } = await import("@/components/house/home-assistant");

const desligado = { disponivel: true, ativo: false, criadoEm: null, ultimoAcessoEm: null, resumoEm: null, tarifaKwh: null };
const ligado = { ...desligado, ativo: true, criadoEm: "2026-11-03T12:00:00Z", ultimoAcessoEm: null, tarifaKwh: 0.95 };

describe("Home Assistant na Casa", () => {
  it("gerar mostra o código uma vez, com o secrets.yaml e a configuração", async () => {
    render(<HomeAssistantCard estado={desligado} podeConfigurar base="https://fluxo.app" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Gerar o código da casa" }));
    });
    expect(screen.getByText(/O código aparece só agora/)).toBeTruthy();
    expect(screen.getByText(`fluxo_auth: "Bearer fluxo_${"a".repeat(43)}"`)).toBeTruthy();
    expect(screen.getByText(/https:\/\/fluxo\.app\/api\/ha\/resumo/)).toBeTruthy();
  });

  it("ligado: a configuração sem o código, a tarifa, e os botões de trocar e desligar", () => {
    render(<HomeAssistantCard estado={ligado} podeConfigurar base="https://fluxo.app" />);
    fireEvent.click(screen.getByRole("button", { name: "Ver a configuração" }));
    expect(screen.getByText(/COLE_AQUI_O_CODIGO/)).toBeTruthy();
    expect((screen.getByLabelText("Tarifa de energia (R$ por kWh)") as HTMLInputElement).value).toBe("0,95");
    expect(screen.getByRole("button", { name: "Trocar o código" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Desligar" })).toBeTruthy();
  });

  it("sem a migração: diz o motivo, sem botão", () => {
    render(<HomeAssistantCard estado={{ ...desligado, disponivel: false }} podeConfigurar base="https://fluxo.app" />);
    expect(screen.getByText(/Falta aplicar a atualização do banco/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Gerar/ })).toBeNull();
  });
});
