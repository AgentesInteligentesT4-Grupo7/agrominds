import type { Lugar } from './Banco.js';
import { type Contexto, tempoAgora } from './Servicos.js';

/** Resposta no formato do chat do K7 (K7.mostrar): texto em markdown e imagens. */
interface RespostaChat {
  texto?: string;
  erro?: string;
  imagens?: Array<{ url: string; legenda?: string }>;
}

const LIMITE_HORA = 30;

/**
 * Lugares pelo chat web (a página não tem o botão de localização do Telegram): o script web/chat.js põe o botão 📍
 * na caixa de mensagem, com "onde estou agora" (localização do navegador), busca por cidade, endereço ou coordenada
 * (não precisa estar no lugar) e a lista dos lugares para usar, renomear ou remover. Cada visitante tem os dele.
 */
export function registrarWeb(c: Contexto): void {
  const { k7, banco } = c;
  k7.web.painel({ script: 'web/chat.js', estilo: 'web/chat.css' });
  const pedidos = new Map<string, number[]>();
  const limitar = (userId: string) => {
    const agora = Date.now();
    const recentes = (pedidos.get(userId) ?? []).filter((t) => agora - t < 3600_000);
    if (recentes.length >= LIMITE_HORA) return false;
    pedidos.set(userId, [...recentes, agora]);
    return true;
  };

  const lista = (userId: string) =>
    banco.lugaresDe(userId).map((l) => ({ id: l.id, nome: l.nome, apelido: l.apelido, cidade: l.cidade, atual: l.atual, plantas: banco.lavouras(userId, l.id).length }));

  /** O tempo do lugar em imagem, para a pessoa ver na hora que escolhe (sem passar pelo agente). */
  const comTempo = async (userId: string, lugar: Lugar, texto: string): Promise<RespostaChat> => {
    try {
      const s = await tempoAgora(c, userId, 'clima', new Date(), lugar.id);
      if (typeof s.mensagem !== 'string' && s.mensagem.imagem) {
        const legenda = s.mensagem.texto.split('\n')[0];
        return { texto, imagens: [{ url: `data:image/png;base64,${s.mensagem.imagem.toString('base64')}`, ...(legenda ? { legenda } : {}) }] };
      }
    } catch (error) {
      k7.log.aviso(`Tempo do lugar ${lugar.id} (web): ${error instanceof Error ? error.message : String(error)}`);
    }
    return { texto };
  };

  const DICA =
    'Agora pergunte, por exemplo: "como está o tempo?", "vai chover no fim de semana?", "o que plantar agora?" ou conte o que você ' +
    'planta ("tenho alface e couve na horta").';

  k7.web.rota('GET', /^\/api\/x\/agro\/lugares$/, (ctx) => ctx.json({ lugares: lista(ctx.userId) }));

  // Novo lugar (ou, com `id`, a nova posição de um que já existe): pela coordenada do navegador ou pelo que a pessoa digitou.
  k7.web.rota('POST', /^\/api\/x\/agro\/lugares$/, async (ctx) => {
    if (!limitar(ctx.userId)) return ctx.falhar(429, 'Muitas mudanças de lugar em pouco tempo; espere um pouco.');
    const b = (await ctx.lerJson()) as { lat?: unknown; lon?: unknown; busca?: unknown; apelido?: unknown; id?: unknown };
    const apelido = typeof b.apelido === 'string' && b.apelido.trim() ? b.apelido.trim().slice(0, 40) : undefined;
    const id = typeof b.id === 'number' && banco.lugarPorId(ctx.userId, b.id) ? b.id : undefined;
    let ponto: { cidade: string; uf: string | null; lat: number; lon: number } | undefined;
    if (typeof b.lat === 'number' && typeof b.lon === 'number' && Math.abs(b.lat) <= 90 && Math.abs(b.lon) <= 180) {
      const { nome, uf } = await c.nomeDoLugar(b.lat, b.lon);
      ponto = { cidade: nome, uf, lat: b.lat, lon: b.lon };
    } else if (typeof b.busca === 'string' && b.busca.trim()) {
      ponto = await c.buscarLugar(b.busca);
      if (!ponto) return ctx.falhar(404, `Não achei "${b.busca.trim().slice(0, 60)}". Tente "cidade, UF" ou cole a coordenada (ex.: -16.68, -49.25).`);
    } else {
      return ctx.falhar(400, 'Mande a localização do navegador ou digite a cidade, o endereço ou a coordenada.');
    }
    const lugar = banco.salvarLugar(ctx.userId, ponto.cidade, ponto.lat, ponto.lon, ponto.uf, { ...(id !== undefined ? { id } : {}), ...(apelido ? { apelido } : {}) });
    const texto = `📍 ${id !== undefined ? 'Lugar atualizado' : 'Lugar salvo'}: **${lugar.nome}**${banco.lugaresDe(ctx.userId).length > 1 ? ' (agora é o lugar em uso)' : ''}.\n\n${DICA}`;
    ctx.json({ resposta: await comTempo(ctx.userId, lugar, texto), lugares: lista(ctx.userId) });
  });

  // Usar, renomear ou remover um lugar.
  k7.web.rota('POST', /^\/api\/x\/agro\/lugares\/(\d{1,9})$/, async (ctx) => {
    if (!limitar(ctx.userId)) return ctx.falhar(429, 'Muitas mudanças de lugar em pouco tempo; espere um pouco.');
    const id = Number(ctx.params[0]);
    const lugar = banco.lugarPorId(ctx.userId, id);
    if (!lugar) return ctx.falhar(404, 'Esse lugar não existe mais.');
    const b = (await ctx.lerJson()) as { acao?: unknown; apelido?: unknown };
    if (b.acao === 'usar') {
      banco.usarLugar(ctx.userId, id);
      return ctx.json({ resposta: await comTempo(ctx.userId, banco.lugarPorId(ctx.userId, id)!, `📍 Lugar em uso: **${lugar.nome}**.\n\n${DICA}`), lugares: lista(ctx.userId) });
    }
    if (b.acao === 'renomear') {
      banco.renomearLugar(ctx.userId, id, typeof b.apelido === 'string' ? b.apelido : null);
      return ctx.json({ resposta: { texto: `✏️ Agora o lugar se chama **${banco.lugarPorId(ctx.userId, id)!.nome}**.` }, lugares: lista(ctx.userId) });
    }
    if (b.acao === 'remover') {
      banco.removerLugar(ctx.userId, id);
      const atual = banco.lugar(ctx.userId);
      return ctx.json({ resposta: { texto: `🗑️ Removi **${lugar.nome}** e as plantas dele.${atual ? ` Lugar em uso: **${atual.nome}**.` : ''}` }, lugares: lista(ctx.userId) });
    }
    return ctx.falhar(400, 'Ação: usar, renomear ou remover.');
  });
}
