import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AiStatus } from "@/lib/ai-config";

/**
 * A tela da chave de IA, na Casa.
 *
 * O que guarda: a chave entra e nao volta (o campo se esvazia, e a tela so
 * mostra o final dela); quem nao administra ve o estado mas nao mexe; a chave
 * da Vercel vence e a tela nao finge o contrario; e "sem limite de gasto"
 * aparece como alerta, porque e o unico caso sem teto.
 */

const estado = {
  salvas: [] as string[],
  resposta: { ok: true, hint: "…WXYZ" } as Record<string, unknown>,
  gasto: { info: { usageUsd: 0.42, limitUsd: 5 } } as Record<string, unknown>,
  removidas: 0,
};

vi.mock("@/actions/ai-settings", () => ({
  saveAiKey: async ({ key }: { key: string }) => {
    estado.salvas.push(key);
    return estado.resposta;
  },
  removeAiKey: async () => {
    estado.removidas += 1;
    return { ok: true };
  },
  saveQuoteModel: async () => ({ ok: true }),
  aiKeyUsage: async () => estado.gasto,
}));

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("sonner", () => ({ toast }));

const { AiSettings } = await import("@/components/house/ai-settings");

const SEM_CHAVE: AiStatus = {
  source: null,
  keyHint: null,
  quoteModel: "anthropic/claude-sonnet-5",
  quoteModelLocked: false,
};
const COM_CHAVE: AiStatus = { ...SEM_CHAVE, source: "casa", keyHint: "…a1b2" };
const DO_SERVIDOR: AiStatus = { ...SEM_CHAVE, source: "servidor" };

const CHAVE_VALIDA = "sk-or-v1-abcdefghijklmnopqrstuvwxyz0123";

describe("AiSettings", () => {
  beforeEach(() => {
    estado.salvas = [];
    estado.resposta = { ok: true, hint: "…0123" };
    estado.gasto = { info: { usageUsd: 0.42, limitUsd: 5 } };
    estado.removidas = 0;
    vi.clearAllMocks();
  });

  it("sem chave, mostra o campo para quem administra", () => {
    render(<AiSettings status={SEM_CHAVE} canManage />);
    expect(screen.getByText(/Nenhuma chave/)).toBeTruthy();
    expect(screen.getByLabelText("Chave do OpenRouter")).toBeTruthy();
  });

  it("o campo é de senha e o navegador não guarda", () => {
    render(<AiSettings status={SEM_CHAVE} canManage />);
    const campo = screen.getByLabelText("Chave do OpenRouter") as HTMLInputElement;
    expect(campo.type).toBe("password");
    expect(campo.autocomplete).toBe("off");
  });

  it("não deixa enviar o que não tem formato de chave", () => {
    render(<AiSettings status={SEM_CHAVE} canManage />);
    fireEvent.change(screen.getByLabelText("Chave do OpenRouter"), {
      target: { value: "minha-senha-do-banco" },
    });
    expect(screen.getByText(/começa com sk-or-/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Testar e guardar/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("guarda, e a chave some do campo assim que foi aceita", async () => {
    render(<AiSettings status={SEM_CHAVE} canManage />);
    const campo = screen.getByLabelText("Chave do OpenRouter") as HTMLInputElement;
    fireEvent.change(campo, { target: { value: CHAVE_VALIDA } });
    fireEvent.click(screen.getByRole("button", { name: /Testar e guardar/ }));
    await waitFor(() => expect(estado.salvas).toEqual([CHAVE_VALIDA]));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    // Deixar a chave no campo seria deixa-la na tela de quem olhar por cima.
    expect(campo.value).toBe("");
  });

  it("chave recusada pelo OpenRouter fica no campo, com o motivo", async () => {
    estado.resposta = { error: "O OpenRouter recusou esta chave. Confira se copiou inteira." };
    render(<AiSettings status={SEM_CHAVE} canManage />);
    const campo = screen.getByLabelText("Chave do OpenRouter") as HTMLInputElement;
    fireEvent.change(campo, { target: { value: CHAVE_VALIDA } });
    fireEvent.click(screen.getByRole("button", { name: /Testar e guardar/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/copiou inteira/)));
    // Fica para corrigir: apagar obrigaria a colar de novo.
    expect(campo.value).toBe(CHAVE_VALIDA);
  });

  it("com chave, mostra só o final dela — e nenhum campo com a chave", async () => {
    render(<AiSettings status={COM_CHAVE} canManage />);
    expect(screen.getByText("…a1b2")).toBeTruthy();
    expect(screen.queryByLabelText("Chave do OpenRouter")).toBeNull();
    await waitFor(() => expect(screen.getByText(/US\$\s?0,42 de US\$\s?5,00/)).toBeTruthy());
  });

  it("sem limite de gasto aparece como alerta", async () => {
    estado.gasto = { info: { usageUsd: 1.2, limitUsd: null } };
    render(<AiSettings status={COM_CHAVE} canManage />);
    await waitFor(() => expect(screen.getByText(/sem limite de gasto/)).toBeTruthy());
  });

  it("quem não administra vê o estado, e nada para mexer", () => {
    render(<AiSettings status={COM_CHAVE} canManage={false} />);
    expect(screen.getByText("…a1b2")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Trocar chave/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Apagar/ })).toBeNull();
    expect((screen.getByLabelText("Modelo para ler orçamento") as HTMLSelectElement).disabled).toBe(true);
  });

  it("chave da Vercel: a tela diz que é ela que vale, e não oferece campo", () => {
    render(<AiSettings status={DO_SERVIDOR} canManage />);
    expect(screen.getByText(/definida no servidor/)).toBeTruthy();
    expect(screen.queryByLabelText("Chave do OpenRouter")).toBeNull();
    expect(screen.queryByRole("button", { name: /Trocar chave/ })).toBeNull();
  });

  it("trocar abre o campo; apagar pede confirmação", async () => {
    render(<AiSettings status={COM_CHAVE} canManage />);
    fireEvent.click(screen.getByRole("button", { name: /Trocar chave/ }));
    expect(screen.getByLabelText("Chave do OpenRouter")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    fireEvent.click(screen.getByRole("button", { name: /Apagar/ }));
    expect(estado.removidas).toBe(0);
    fireEvent.click(await screen.findByRole("button", { name: "Apagar chave" }));
    await waitFor(() => expect(estado.removidas).toBe(1));
  });
});
