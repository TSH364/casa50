import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ItemDoSecretario } from "@/data/secretario";

/**
 * Secretario - a tela.
 *
 * O que guarda: contas primeiro, cada tipo com o que fazer; "Lancar" abre o
 * formulario ja com o valor e o vencimento da conta; "Feito" tira da lista;
 * e na Casa cada pessoa ve o proprio Gmail com o botao certo, ou o motivo de
 * nao poder conectar.
 */

const marcarEmail = vi.fn(async () => ({}));
const criarTarefaDoEmail = vi.fn(async () => ({}));
vi.mock("@/actions/secretario", () => ({
  marcarEmail: (...a: unknown[]) => marcarEmail(...(a as [])),
  criarTarefaDoEmail: (...a: unknown[]) => criarTarefaDoEmail(...(a as [])),
  lerEmailsAgora: vi.fn(async () => ({ novos: 0, erros: [] })),
  desconectarGmail: vi.fn(async () => ({})),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/transactions", () => ({ createTransaction: vi.fn(), updateTransaction: vi.fn() }));
vi.mock("@/actions/jev", () => ({ suggestCategoryFromText: vi.fn(async () => ({})) }));

const item = (p: Partial<ItemDoSecretario>): ItemDoSecretario => ({
  id: "00000000-0000-4000-8000-000000000001",
  gmailId: "msg-0001",
  memberId: "u1",
  conta: "vini@gmail.com",
  fromName: "Condomínio",
  fromAddress: "adm@condominio.com.br",
  subject: "Boleto",
  receivedAt: "2026-10-08T12:00:00Z",
  tipo: "conta",
  resumo: "Condomínio de outubro",
  amountCents: 85_000,
  dueDate: "2026-10-15",
  eventDate: null,
  ...p,
});

const itens = [
  item({ id: "00000000-0000-4000-8000-000000000002", tipo: "compromisso", resumo: "Assembleia", amountCents: null, dueDate: null, eventDate: "2026-10-20" }),
  item({}),
  item({ id: "00000000-0000-4000-8000-000000000003", tipo: "acao", resumo: "Assinar o contrato", amountCents: null, dueDate: null }),
];

describe("a lista", () => {
  it("contas primeiro, com valor e prazo; cada tipo com a ação dele", async () => {
    const { SecretarioLista } = await import("@/components/secretario/secretario-lista");
    render(<SecretarioLista itens={itens} hoje="2026-10-09" categories={[]} cards={[]} members={[]} />);
    const secoes = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(secoes).toEqual(["Contas a pagar1", "Pedem uma ação1", "Compromissos1"]);
    const conta = screen.getByText("Condomínio de outubro").closest("li")!;
    expect(within(conta).getByText(/vence em 6 dias/)).toBeTruthy();
    expect(within(conta).getByRole("link", { name: /Abrir no Gmail/ }).getAttribute("href")).toContain("#all/msg-0001");
    expect(within(screen.getByText("Assinar o contrato").closest("li")!).getByRole("button", { name: "Criar tarefa" })).toBeTruthy();
    expect(within(screen.getByText("Assembleia").closest("li")!).getByText(/é em 11 dias/)).toBeTruthy();
  });

  it("Lançar abre o formulário com o valor e o vencimento; Feito tira da lista", async () => {
    const { SecretarioLista } = await import("@/components/secretario/secretario-lista");
    render(<SecretarioLista itens={itens} hoje="2026-10-09" categories={[]} cards={[]} members={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Lançar" }));
    expect((screen.getByLabelText("Valor") as HTMLInputElement).value).toBe("850");
    expect((screen.getByLabelText("Data") as HTMLInputElement).value).toBe("2026-10-15");
    expect((screen.getByLabelText("Descrição") as HTMLInputElement).value).toBe("Condomínio");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    fireEvent.click(within(screen.getByText("Assembleia").closest("li")!).getByRole("button", { name: /Feito/ }));
    expect(marcarEmail).toHaveBeenCalledWith({ id: "00000000-0000-4000-8000-000000000002", status: "feito" });
    expect(screen.queryByText("Assembleia")).toBeNull();
  });
});

describe("a conexão na Casa", () => {
  const minha = { memberId: "u1", nome: "Vini", email: "vini@gmail.com", lastSyncAt: null, lastError: null };

  it("sem Gmail: o botão de conectar leva ao Google", async () => {
    const { GmailConexao } = await import("@/components/secretario/gmail-conexao");
    render(<GmailConexao minha={null} outras={[]} podeConectar configurado disponivel aviso={undefined} />);
    expect(screen.getByRole("link", { name: "Conectar meu Gmail" }).getAttribute("href")).toBe("/api/gmail/conectar");
  });

  it("autorização vencida: o erro aparece e o botão vira Conectar de novo", async () => {
    const { GmailConexao } = await import("@/components/secretario/gmail-conexao");
    render(
      <GmailConexao
        minha={{ ...minha, lastError: "O Google não aceita mais a autorização." }}
        outras={[]}
        podeConectar
        configurado
        disponivel
        aviso={undefined}
      />,
    );
    expect(screen.getByText("O Google não aceita mais a autorização.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Conectar de novo" })).toBeTruthy();
  });

  it("sem configuração no servidor, ou sem migração: diz o motivo, sem botão", async () => {
    const { GmailConexao } = await import("@/components/secretario/gmail-conexao");
    const { rerender } = render(<GmailConexao minha={null} outras={[]} podeConectar configurado={false} disponivel aviso="recusado" />);
    expect(screen.getByText(/não foi configurado no servidor/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/não autorizou/);
    expect(screen.queryByRole("link", { name: /Conectar/ })).toBeNull();
    rerender(<GmailConexao minha={null} outras={[]} podeConectar configurado disponivel={false} aviso={undefined} />);
    expect(screen.getByText(/Falta aplicar a atualização do banco/)).toBeTruthy();
  });
});
