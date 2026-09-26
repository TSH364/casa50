import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BoardColumn, Task } from "@/domain/tasks";

/**
 * O quadro de tarefas na tela.
 *
 * O que guarda: o cartao mostra prazo vencido, quem faz e previsto x gasto;
 * marcar feita e arrastar para outra coluna mudam a tela na hora e chamam o
 * servidor com o lugar certo; e o dialogo move a tarefa pela "Coluna" -
 * o caminho do celular, onde nao ha arrastar.
 */

const chamadas: { acao: string; input: unknown }[] = [];
const registra = (acao: string) => async (input: unknown) => {
  chamadas.push({ acao, input });
  return { ok: true };
};

vi.mock("@/actions/tasks", () => ({
  createDefaultBoard: registra("createDefaultBoard"),
  createList: registra("createList"),
  createTask: registra("createTask"),
  deleteList: registra("deleteList"),
  moveList: registra("moveList"),
  moveTask: registra("moveTask"),
  renameList: registra("renameList"),
  toggleTaskDone: registra("toggleTaskDone"),
  updateTask: registra("updateTask"),
  deleteTask: registra("deleteTask"),
  linkTransaction: registra("linkTransaction"),
  unlinkTransaction: registra("unlinkTransaction"),
  searchTransactionsForTask: async () => ({ options: [] }),
}));
vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));

const { TaskBoard } = await import("@/components/tasks/task-board");

const VINI = "11111111-1111-4111-8111-111111111111";
const LARI = "22222222-2222-4222-8222-222222222222";
const membros = [
  { id: VINI, name: "Vinicius" },
  { id: LARI, name: "Larissa" },
];

function tarefa(p: Partial<Task>): Task {
  return {
    id: "t",
    listId: "a",
    title: "Tarefa",
    notes: null,
    position: 0,
    memberId: null,
    isJoint: false,
    dueDate: null,
    expectedCents: null,
    done: false,
    linked: [],
    ...p,
  };
}

function quadro(): BoardColumn[] {
  return [
    {
      id: "a",
      name: "A fazer",
      position: 0,
      tasks: [
        tarefa({
          id: "chuveiro",
          title: "Consertar o chuveiro",
          dueDate: "2026-09-20",
          isJoint: true,
          expectedCents: 25_000,
          linked: [{ id: "l1", date: "2026-09-21", label: "CASA DO ELETRICISTA", cents: 30_000 }],
        }),
        tarefa({ id: "pia", title: "Trocar a pia", position: 1, memberId: LARI }),
      ],
    },
    { id: "b", name: "Feito", position: 1, tasks: [] },
  ];
}

describe("TaskBoard", () => {
  beforeEach(() => {
    chamadas.length = 0;
  });

  it("o cartão diz prazo vencido, quem faz e previsto x gasto", () => {
    render(<TaskBoard columns={quadro()} members={membros} todayIso="2026-09-26" />);
    const card = screen.getByText("Consertar o chuveiro").closest("button")!;
    expect(within(card).getByText("20/09")).toBeTruthy();
    expect(within(card).getByText("(vencida)")).toBeTruthy();
    expect(within(card).getByText("Os dois")).toBeTruthy();
    expect(card.textContent).toMatch(/R\$\s*300 de R\$\s*250/);
    expect(screen.getByText("Trocar a pia").closest("button")!.textContent).toMatch(/Larissa/);
  });

  it("marcar como feita risca na hora e grava", async () => {
    render(<TaskBoard columns={quadro()} members={membros} todayIso="2026-09-26" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Marcar “Trocar a pia”/ }));
    expect(screen.getByRole("checkbox", { name: /Desmarcar “Trocar a pia”/ })).toBeTruthy();
    await waitFor(() => expect(chamadas).toContainEqual({ acao: "toggleTaskDone", input: { id: "pia", done: true } }));
  });

  it("arrastar para a coluna vazia leva a tarefa para o fim dela", async () => {
    render(<TaskBoard columns={quadro()} members={membros} todayIso="2026-09-26" />);
    const item = screen.getByText("Trocar a pia").closest("li")!;
    fireEvent.dragStart(item, { dataTransfer: { setData: () => {}, effectAllowed: "" } });
    const feito = screen.getByRole("heading", { name: /Feito/ }).closest("li")!;
    fireEvent.dragOver(feito);
    fireEvent.drop(feito);
    await waitFor(() =>
      expect(chamadas).toContainEqual({ acao: "moveTask", input: { id: "pia", listId: "b", index: 0 } }),
    );
    expect(within(feito).getByText("Trocar a pia")).toBeTruthy();
  });

  it("no diálogo, trocar a coluna move a tarefa (o caminho do celular)", async () => {
    render(<TaskBoard columns={quadro()} members={membros} todayIso="2026-09-26" />);
    fireEvent.click(screen.getByText("Trocar a pia"));
    fireEvent.change(await screen.findByLabelText("Coluna"), { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(chamadas.map((c) => c.acao)).toEqual(["updateTask", "moveTask"]),
    );
    expect(chamadas[0]!.input).toMatchObject({ id: "pia", who: LARI, expectedCents: null });
    expect(chamadas[1]!.input).toEqual({ id: "pia", listId: "b", index: 0 });
  });

  it("previsto inválido não grava", async () => {
    render(<TaskBoard columns={quadro()} members={membros} todayIso="2026-09-26" />);
    fireEvent.click(screen.getByText("Trocar a pia"));
    fireEvent.change(await screen.findByLabelText(/Valor previsto/), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText(/Valor inválido/)).toBeTruthy();
    expect(chamadas).toHaveLength(0);
  });
});
