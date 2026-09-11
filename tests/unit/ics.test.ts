import { describe, expect, it } from "vitest";
import { parseIcs } from "@/importers/ics";

const JANEIRO = { from: "2026-01-01", to: "2026-01-31" };

function ics(...body: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...body, "END:VCALENDAR"].join("\r\n");
}

function evento(...lines: string[]): string {
  return ics("BEGIN:VEVENT", ...lines, "END:VEVENT");
}

describe("parseIcs — evento simples", () => {
  it("lê um evento de dia inteiro com DTEND exclusivo", () => {
    const result = parseIcs(
      evento(
        "UID:viagem-1",
        "SUMMARY:Viagem para Paraty",
        "LOCATION:Paraty, RJ",
        "DTSTART;VALUE=DATE:20260110",
        "DTEND;VALUE=DATE:20260115",
      ),
      JANEIRO,
    );

    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]).toMatchObject({
      uid: "viagem-1",
      title: "Viagem para Paraty",
      location: "Paraty, RJ",
      startsOn: "2026-01-10",
      // DTEND=20260115 é exclusivo: o último dia da viagem é 14.
      endsOn: "2026-01-14",
      allDay: true,
    });
  });

  it("evento sem DTEND ocupa um dia só", () => {
    const result = parseIcs(
      evento("UID:x", "SUMMARY:Dentista", "DTSTART:20260112T140000"),
      JANEIRO,
    );
    expect(result.occurrences[0]).toMatchObject({
      startsOn: "2026-01-12",
      endsOn: "2026-01-12",
      allDay: false,
    });
  });

  it("traz o horário UTC para o dia certo em Brasília", () => {
    // 01:00Z do dia 13 são 22:00 do dia 12 em São Paulo.
    const result = parseIcs(
      evento("UID:x", "SUMMARY:Jantar", "DTSTART:20260113T010000Z"),
      JANEIRO,
    );
    expect(result.occurrences[0]?.startsOn).toBe("2026-01-12");
  });

  it("desdobra linha quebrada e desescapa o texto", () => {
    const result = parseIcs(
      evento(
        "UID:x",
        "SUMMARY:Reunião com a equipe sobre o orçamento anual da",
        "  casa\\, parte 2",
        "DTSTART;VALUE=DATE:20260105",
      ),
      JANEIRO,
    );
    expect(result.occurrences[0]?.title).toBe(
      "Reunião com a equipe sobre o orçamento anual da casa, parte 2",
    );
  });

  it("ignora evento cancelado", () => {
    const result = parseIcs(
      evento("UID:x", "SUMMARY:Voo", "DTSTART;VALUE=DATE:20260105", "STATUS:CANCELLED"),
      JANEIRO,
    );
    expect(result.occurrences).toHaveLength(0);
  });

  it("não confunde propriedade do alarme com a do evento", () => {
    const result = parseIcs(
      evento(
        "UID:x",
        "SUMMARY:Consulta",
        "DTSTART;VALUE=DATE:20260120",
        "BEGIN:VALARM",
        "SUMMARY:Lembrete",
        "TRIGGER:-PT30M",
        "END:VALARM",
      ),
      JANEIRO,
    );
    expect(result.occurrences[0]?.title).toBe("Consulta");
  });

  it("aceita DURATION no lugar de DTEND", () => {
    const result = parseIcs(
      evento("UID:x", "SUMMARY:Feriadão", "DTSTART;VALUE=DATE:20260123", "DURATION:P3D"),
      JANEIRO,
    );
    expect(result.occurrences[0]).toMatchObject({
      startsOn: "2026-01-23",
      endsOn: "2026-01-25",
    });
  });
});

describe("parseIcs — janela", () => {
  it("inclui a viagem que atravessa a virada do mês", () => {
    const result = parseIcs(
      evento(
        "UID:x",
        "SUMMARY:Réveillon",
        "DTSTART;VALUE=DATE:20251228",
        "DTEND;VALUE=DATE:20260104",
      ),
      JANEIRO,
    );
    // Começa em dezembro, mas encosta em janeiro: tem que contar.
    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]?.startsOn).toBe("2025-12-28");
  });

  it("descarta o que está inteiramente fora", () => {
    const result = parseIcs(
      evento("UID:x", "SUMMARY:Antigo", "DTSTART;VALUE=DATE:20250301"),
      JANEIRO,
    );
    expect(result.occurrences).toHaveLength(0);
    // O evento existe no arquivo, ainda que fora da janela.
    expect(result.eventCount).toBe(1);
  });
});

describe("parseIcs — repetição", () => {
  it("expande semanal com BYDAY", () => {
    const result = parseIcs(
      evento(
        "UID:x",
        "SUMMARY:Academia",
        "DTSTART;VALUE=DATE:20260105",
        "RRULE:FREQ=WEEKLY;BYDAY=MO,WE",
      ),
      JANEIRO,
    );
    const dias = result.occurrences.map((o) => o.startsOn);
    // Janeiro de 2026: segundas 5,12,19,26 e quartas 7,14,21,28.
    expect(dias).toEqual([
      "2026-01-05",
      "2026-01-07",
      "2026-01-12",
      "2026-01-14",
      "2026-01-19",
      "2026-01-21",
      "2026-01-26",
      "2026-01-28",
    ]);
  });

  it("respeita INTERVAL na semanal", () => {
    const result = parseIcs(
      evento(
        "UID:x",
        "SUMMARY:Quinzenal",
        "DTSTART;VALUE=DATE:20260105",
        "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
      ),
      JANEIRO,
    );
    expect(result.occurrences.map((o) => o.startsOn)).toEqual([
      "2026-01-05",
      "2026-01-19",
    ]);
  });

  it("conta COUNT desde o começo da série, não desde a janela", () => {
    const result = parseIcs(
      evento(
        "UID:x",
        "SUMMARY:Curso",
        "DTSTART;VALUE=DATE:20251201",
        "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=6",
      ),
      JANEIRO,
    );
    // Seis segundas a partir de 1/dez: 1, 8, 15, 22, 29 de dezembro e 5 de
    // janeiro. Só a última cai na janela.
    expect(result.occurrences.map((o) => o.startsOn)).toEqual(["2026-01-05"]);
  });

  it("respeita UNTIL", () => {
    const result = parseIcs(
      evento(
        "UID:x",
        "SUMMARY:Terapia",
        "DTSTART;VALUE=DATE:20260106",
        "RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20260120T000000Z",
      ),
      JANEIRO,
    );
    expect(result.occurrences.map((o) => o.startsOn)).toEqual([
      "2026-01-06",
      "2026-01-13",
      "2026-01-20",
    ]);
  });

  it("mensal pula o mês em que o dia não existe", () => {
    const result = parseIcs(
      evento("UID:x", "SUMMARY:Dia 31", "DTSTART;VALUE=DATE:20251231", "RRULE:FREQ=MONTHLY"),
      { from: "2026-01-01", to: "2026-04-30" },
    );
    // Fevereiro e abril não têm dia 31, e a RFC manda pular — não empurrar.
    expect(result.occurrences.map((o) => o.startsOn)).toEqual([
      "2026-01-31",
      "2026-03-31",
    ]);
  });

  it("mensal com dia ordinal da semana", () => {
    const result = parseIcs(
      evento(
        "UID:x",
        "SUMMARY:Reunião do prédio",
        "DTSTART;VALUE=DATE:20260113",
        "RRULE:FREQ=MONTHLY;BYDAY=2TU",
      ),
      { from: "2026-01-01", to: "2026-03-31" },
    );
    expect(result.occurrences.map((o) => o.startsOn)).toEqual([
      "2026-01-13",
      "2026-02-10",
      "2026-03-10",
    ]);
  });

  it("anual repete no mesmo dia", () => {
    const result = parseIcs(
      evento(
        "UID:x",
        "SUMMARY:Aniversário da Larissa",
        "DTSTART;VALUE=DATE:20200118",
        "RRULE:FREQ=YEARLY",
      ),
      JANEIRO,
    );
    expect(result.occurrences.map((o) => o.startsOn)).toEqual(["2026-01-18"]);
  });

  it("aplica EXDATE", () => {
    const result = parseIcs(
      evento(
        "UID:x",
        "SUMMARY:Aula",
        "DTSTART;VALUE=DATE:20260105",
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "EXDATE;VALUE=DATE:20260112,20260126",
      ),
      JANEIRO,
    );
    expect(result.occurrences.map((o) => o.startsOn)).toEqual([
      "2026-01-05",
      "2026-01-19",
    ]);
  });

  it("uma ocorrência remarcada troca de dia, não duplica", () => {
    const result = parseIcs(
      ics(
        "BEGIN:VEVENT",
        "UID:serie",
        "SUMMARY:Reunião",
        "DTSTART;VALUE=DATE:20260105",
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:serie",
        "RECURRENCE-ID;VALUE=DATE:20260112",
        "SUMMARY:Reunião (remarcada)",
        "DTSTART;VALUE=DATE:20260114",
        "END:VEVENT",
      ),
      JANEIRO,
    );
    const dias = result.occurrences.map((o) => o.startsOn);
    expect(dias).toEqual(["2026-01-05", "2026-01-14", "2026-01-19", "2026-01-26"]);
  });

  it("uma ocorrência cancelada some da série", () => {
    const result = parseIcs(
      ics(
        "BEGIN:VEVENT",
        "UID:serie",
        "SUMMARY:Reunião",
        "DTSTART;VALUE=DATE:20260105",
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:serie",
        "RECURRENCE-ID;VALUE=DATE:20260112",
        "STATUS:CANCELLED",
        "DTSTART;VALUE=DATE:20260112",
        "END:VEVENT",
      ),
      JANEIRO,
    );
    expect(result.occurrences.map((o) => o.startsOn)).toEqual([
      "2026-01-05",
      "2026-01-19",
      "2026-01-26",
    ]);
  });

  it("uma série infinita não trava nem explode", () => {
    const result = parseIcs(
      evento("UID:x", "SUMMARY:Todo dia", "DTSTART;VALUE=DATE:20260101", "RRULE:FREQ=DAILY"),
      JANEIRO,
    );
    expect(result.occurrences).toHaveLength(31);
  });

  it("mantém a duração em cada ocorrência da série", () => {
    const result = parseIcs(
      evento(
        "UID:x",
        "SUMMARY:Plantão",
        "DTSTART;VALUE=DATE:20260103",
        "DTEND;VALUE=DATE:20260105",
        "RRULE:FREQ=WEEKLY;BYDAY=SA",
      ),
      JANEIRO,
    );
    expect(result.occurrences[0]).toMatchObject({
      startsOn: "2026-01-03",
      endsOn: "2026-01-04",
    });
    expect(result.occurrences[1]).toMatchObject({
      startsOn: "2026-01-10",
      endsOn: "2026-01-11",
    });
  });
});

describe("parseIcs — arquivo hostil", () => {
  it("não quebra com arquivo vazio", () => {
    expect(parseIcs("", JANEIRO).occurrences).toEqual([]);
  });

  it("ignora VEVENT sem DTSTART", () => {
    const result = parseIcs(evento("UID:x", "SUMMARY:Sem data"), JANEIRO);
    expect(result.occurrences).toEqual([]);
  });

  it("evento sem título ganha rótulo em vez de string vazia", () => {
    const result = parseIcs(evento("UID:x", "DTSTART;VALUE=DATE:20260105"), JANEIRO);
    expect(result.occurrences[0]?.title).toBe("(sem título)");
  });

  it("FREQ desconhecida vale como evento único", () => {
    const result = parseIcs(
      evento("UID:x", "SUMMARY:Estranho", "DTSTART;VALUE=DATE:20260105", "RRULE:FREQ=HOURLY"),
      JANEIRO,
    );
    expect(result.occurrences).toHaveLength(1);
  });
});

describe("parseIcs — arquivo no formato que o Google exporta", () => {
  // Reproduz a forma real: VTIMEZONE antes dos eventos, VALARM dentro deles,
  // linhas dobradas em 75 colunas, DTSTART com TZID e RRULE com UNTIL em UTC.
  const arquivo = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:vinicius.roselli@mcaa.arq.br",
    "X-WR-TIMEZONE:America/Sao_Paulo",
    "BEGIN:VTIMEZONE",
    "TZID:America/Sao_Paulo",
    "X-LIC-LOCATION:America/Sao_Paulo",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0300",
    "TZOFFSETTO:-0300",
    "TZNAME:-03",
    "DTSTART:19700101T000000",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20260110",
    "DTEND;VALUE=DATE:20260115",
    "DTSTAMP:20250910T120000Z",
    "UID:2p8kq1r9mv3n4b5c6d7e8f9g0h@google.com",
    "CREATED:20250801T140000Z",
    "DESCRIPTION:Passagens compradas\\, hotel a confirmar",
    "LAST-MODIFIED:20250815T101500Z",
    "LOCATION:Trancoso\\, Porto Seguro - BA",
    "SEQUENCE:0",
    "STATUS:CONFIRMED",
    "SUMMARY:Viagem de aniversário para Trancoso com a famíli",
    " a toda",
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;TZID=America/Sao_Paulo:20260106T190000",
    "DTEND;TZID=America/Sao_Paulo:20260106T200000",
    "RRULE:FREQ=WEEKLY;WKST=SU;UNTIL=20260127T020000Z;BYDAY=TU",
    "DTSTAMP:20250910T120000Z",
    "UID:terapia-semanal@google.com",
    "SEQUENCE:0",
    "STATUS:CONFIRMED",
    "SUMMARY:Terapia",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Lembrete de terapia",
    "TRIGGER:-PT30M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const result = parseIcs(arquivo, JANEIRO);

  it("lê a viagem com o último dia certo e o título inteiro", () => {
    const viagem = result.occurrences.find((o) => o.uid.startsWith("2p8kq"));
    expect(viagem).toMatchObject({
      title: "Viagem de aniversário para Trancoso com a família toda",
      location: "Trancoso, Porto Seguro - BA",
      startsOn: "2026-01-10",
      endsOn: "2026-01-14",
      allDay: true,
    });
  });

  it("expande a série semanal sem se confundir com o alarme nem com o fuso", () => {
    const terapia = result.occurrences.filter((o) => o.uid === "terapia-semanal@google.com");
    expect(terapia.map((o) => o.startsOn)).toEqual([
      "2026-01-06",
      "2026-01-13",
      "2026-01-20",
      "2026-01-27",
    ]);
    expect(terapia[0]?.title).toBe("Terapia");
    expect(terapia[0]?.allDay).toBe(false);
  });

  it("o VTIMEZONE não vira evento", () => {
    expect(result.eventCount).toBe(2);
  });
});
