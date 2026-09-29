/**
 * O que uma frase falada quer dizer no modo conversa (secao 16).
 *
 * Confirmar por voz grava dado - entao a regra e ESTRITA: so vale a frase
 * inteira ser uma confirmacao ("pode", "sim, pode confirmar"). "Pode me
 * dizer quanto gastei?" comeca com "pode" e e pergunta; "sim, mas muda o
 * valor" nao e confirmacao. Na duvida, vira pergunta para a IA - que no
 * pior caso pergunta de volta, e nada e gravado.
 */

export type VoiceIntent = "encerrar" | "confirmar" | "descartar" | "pergunta";

function limpar(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ENCERRAR = /^(tchau|tchau tchau|ate mais|ate logo|pode parar|para|parar|encerra|encerrar|sair|obrigad[oa] tchau|valeu tchau|e so isso|so isso|era so isso|terminei)$/;

const CONFIRMAR =
  /^(sim|pode|pode sim|sim pode|confirma|confirmo|confirmar|pode confirmar|sim pode confirmar|confirma sim|pode fazer|pode gravar|pode salvar|faz|faca|faz isso|isso|isso mesmo|exato|fechado|beleza pode|ok pode|ok|manda ver|manda|confirmado|com certeza|claro|claro pode)$/;

const DESCARTAR =
  /^(nao|nao obrigad[oa]|nao pode|nao precisa|deixa|deixa pra la|deixa quieto|cancela|cancelar|descarta|descartar|esquece|melhor nao|agora nao|nao quero)$/;

/** `pending`: ha propostas esperando resposta na ultima resposta da IA. */
export function voiceIntent(text: string, pending: boolean): VoiceIntent {
  const t = limpar(text);
  if (ENCERRAR.test(t)) return "encerrar";
  if (pending && CONFIRMAR.test(t)) return "confirmar";
  if (pending && DESCARTAR.test(t)) return "descartar";
  return "pergunta";
}
