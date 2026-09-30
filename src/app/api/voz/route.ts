import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHouseId } from "@/actions/shared";
import { getAiKey } from "@/lib/ai-config";
import { recordAiUsage } from "@/lib/ai-usage";
import { textToSpeech } from "@/lib/openrouter";
import { DEFAULT_TTS_MODEL, DEFAULT_TTS_VOICE } from "@/domain/ai-models";

/**
 * A voz da Conversa (secao 16): texto -> audio pelo OpenRouter.
 *
 * Rota, e nao acao de servidor, porque devolve BYTES de audio. A chave da
 * casa fica aqui: o navegador so manda o texto e recebe o mp3. Sem casa ou
 * sem chave, recusa - e o app volta para a voz do navegador.
 *
 * O texto e curto por construcao (a Conversa fala no maximo tres frases, e
 * divide em pedacos): o teto de 600 caracteres impede usar a rota como
 * sintetizador gratis de qualquer coisa.
 */

export const maxDuration = 30;

const corpo = z.object({ text: z.string().trim().min(1).max(600) });

export async function POST(req: Request) {
  let houseId: string;
  try {
    houseId = await requireHouseId();
  } catch {
    return NextResponse.json({ error: "Sem casa." }, { status: 401 });
  }
  const parsed = corpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Texto inválido." }, { status: 400 });

  const apiKey = await getAiKey(houseId);
  if (!apiKey) return NextResponse.json({ error: "Sem chave de IA." }, { status: 403 });

  const model = process.env.OPENROUTER_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;
  try {
    const { audio, contentType } = await textToSpeech(parsed.data.text, {
      apiKey,
      model,
      voice: process.env.OPENROUTER_TTS_VOICE?.trim() || DEFAULT_TTS_VOICE,
    });
    // O endpoint de voz nao devolve o custo na resposta: fica a contagem, e o
    // total da chave (tela Casa) mostra o valor que o OpenRouter cobrou.
    await recordAiUsage(houseId, "voz", {
      calls: 1,
      costUsd: 0,
      model,
      details: { caracteres: parsed.data.text.length, bytes: audio.byteLength },
    });
    return new Response(audio, { headers: { "Content-Type": contentType, "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "A voz não respondeu." }, { status: 502 });
  }
}
