import { type Previsao, horaLocal, somarHoras } from './OpenMeteo.js';
import { type Regra, serie } from './Regras.js';

/**
 * Melhor hora para pulverizar, hora a hora, com o motivo das horas ruins. Usa as mesmas condições da regra de janela
 * de pulverização (`regras/clima.yaml`, `tipo: janela`): mudar um limite lá muda esta conta também.
 */
export interface HoraDePulverizar {
  /** "2026-11-10T07:00" (local). */
  hora: string;
  boa: boolean;
  /** Condições que falharam: categoria (para juntar horas seguidas) e o valor da hora. */
  falhas: Array<{ chave: string; valor: number | null }>;
}

type Condicao = NonNullable<Regra['condicoes_hora']>[number];

function compara(a: number, op: string, b: number): boolean {
  return op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : op === '>=' ? a >= b : a === b;
}

/** "abaixo" quando a condição pede um mínimo (>=, >) e não chegou; "acima" quando passou de um máximo. */
const chaveDe = (c: Condicao) => `${c.variavel}:${c.operador.startsWith('>') ? 'abaixo' : 'acima'}`;

export function horasDePulverizar(p: Previsao, regra: Regra, agora: Date, dias = 2): HoraDePulverizar[] {
  const s = serie(p);
  const agoraLocal = horaLocal(agora, p.utcOffsetSeconds);
  const fim = somarHoras(`${agoraLocal.slice(0, 10)}T00:00`, 24 * dias);
  const out: HoraDePulverizar[] = [];
  s.time.forEach((hora, i) => {
    if (hora < agoraLocal || hora >= fim) return;
    const h = Number(hora.slice(11, 13));
    if (regra.apenas_dia && (h < 6 || h > 18)) return;
    const falhas = (regra.condicoes_hora ?? []).flatMap((c) => {
      const v = s.get(c.variavel, i);
      return v !== null && compara(v, c.operador, c.valor) ? [] : [{ chave: v === null ? `${c.variavel}:sem_dado` : chaveDe(c), valor: v }];
    });
    out.push({ hora, boa: falhas.length === 0, falhas });
  });
  return out;
}

const n = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');

/** O motivo em português, com o valor mais extremo das horas juntadas. */
function motivo(chave: string, extremo: number | null): string {
  const [variavel, lado] = chave.split(':');
  if (lado === 'sem_dado' || extremo === null) return 'sem dado da previsão';
  switch (variavel) {
    case 'wind_speed_10m':
      return lado === 'abaixo' ? `vento quase parado (${n(extremo)} km/h): a gota fina fica no ar e pode ir longe` : `vento forte (até ${n(extremo)} km/h): deriva`;
    case 'wind_gusts_10m':
      return `rajadas de até ${n(extremo)} km/h`;
    case 'temperature_2m':
      return `calor (até ${n(extremo)} °C): a gota evapora antes de chegar na planta`;
    case 'relative_humidity_2m':
      return `ar seco (umidade de ${n(extremo)}%)`;
    case 'delta_t':
      return lado === 'abaixo' ? `ar muito úmido (Delta T ${n(extremo)}): a gota demora a secar e pode escorrer` : `ar seco demais (Delta T até ${n(extremo)}): a gota evapora`;
    case 'chuva_proximas_2h':
      return `chuva logo depois (até ${n(extremo)} mm em 2 h): lava o produto`;
    default:
      return `${variavel} fora do limite (${n(extremo)})`;
  }
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function nomeDoDia(dia: string, hoje: string): string {
  if (dia === hoje) return 'Hoje';
  if (dia === somarHoras(`${hoje}T12:00`, 24).slice(0, 10)) return 'Amanhã';
  const nome = DIAS[new Date(`${dia}T12:00:00Z`).getUTCDay()]!;
  return `${nome[0]!.toUpperCase()}${nome.slice(1)} (${dia.slice(8, 10)}/${dia.slice(5, 7)})`;
}

const hr = (hora: string) => Number(hora.slice(11, 13));
const faixa = (de: string, ate: string) => (de === ate ? `às ${hr(de)}h` : `das ${hr(de)}h às ${hr(ate) + 1}h`);

/** Junta horas seguidas que têm a mesma característica (boa, ou o mesmo primeiro motivo). */
function trechos(horas: HoraDePulverizar[], chave: (h: HoraDePulverizar) => string): Array<{ chave: string; horas: HoraDePulverizar[] }> {
  const out: Array<{ chave: string; horas: HoraDePulverizar[] }> = [];
  for (const h of horas) {
    const k = chave(h);
    const ultimo = out.at(-1);
    if (ultimo && ultimo.chave === k && somarHoras(ultimo.horas.at(-1)!.hora, 1) === h.hora) ultimo.horas.push(h);
    else out.push({ chave: k, horas: [h] });
  }
  return out;
}

/** Texto para o agente (e para quem não recebe imagem). */
export function textoPulverizacao(horas: HoraDePulverizar[], regra: Regra, lugar: string, p: Previsao, agora: Date, dias = 2): string {
  const hoje = horaLocal(agora, p.utcOffsetSeconds).slice(0, 10);
  const linhas = [`🧴 Melhor hora para pulverizar · ${lugar} · ${dias === 1 ? 'hoje' : `próximos ${dias} dias`}`];
  if (!horas.length) linhas.push('Não há mais horas de dia para olhar neste período.');
  const porDia = new Map<string, HoraDePulverizar[]>();
  for (const h of horas) porDia.set(h.hora.slice(0, 10), [...(porDia.get(h.hora.slice(0, 10)) ?? []), h]);
  let proxima: string | undefined;
  for (const [dia, doDia] of porDia) {
    const boas = trechos(doDia.filter((h) => h.boa), () => 'boa');
    const ruins = trechos(doDia.filter((h) => !h.boa), (h) => h.falhas[0]!.chave)
      .sort((a, b) => b.horas.length - a.horas.length)
      .slice(0, 3)
      .sort((a, b) => (a.horas[0]!.hora < b.horas[0]!.hora ? -1 : 1))
      .map((t) => {
        const valores = t.horas.map((h) => h.falhas.find((f) => f.chave === t.chave)?.valor ?? null).filter((v): v is number => v !== null);
        const extremo = !valores.length ? null : t.chave.endsWith(':abaixo') ? Math.min(...valores) : Math.max(...valores);
        return `${motivo(t.chave, extremo)} ${faixa(t.horas[0]!.hora, t.horas.at(-1)!.hora)}`;
      });
    const nome = nomeDoDia(dia, hoje);
    if (boas.length) {
      proxima ??= `${nome.toLowerCase()} ${faixa(boas[0]!.horas[0]!.hora, boas[0]!.horas.at(-1)!.hora)}`;
      linhas.push(`• ${nome}: boas horas ${boas.map((t) => faixa(t.horas[0]!.hora, t.horas.at(-1)!.hora)).join(' e ')}.${ruins.length ? ` Fora delas: ${ruins.join('; ')}.` : ''}`);
    } else {
      linhas.push(`• ${nome}: nenhuma hora boa — ${ruins.join('; ') || 'sem dado'}.`);
    }
  }
  linhas.push(proxima ? `Próxima janela boa: ${proxima}.` : 'Nenhuma janela boa no período: vale olhar de novo amanhã.');
  linhas.push(
    `Critério (regras da fita): ${regra.fonte?.replace(/^Referência inicial:\s*/i, '') ?? 'as condições da regra de pulverização'}.${regra.revisado_por ? '' : ' (regra em revisão)'}`,
    'É previsão de modelo: confira o vento no local antes de começar. Produto e dose, só com receituário de um(a) agrônomo(a).',
  );
  if (p.desatualizada) linhas.push('(Última previsão guardada: o serviço não respondeu agora.)');
  return linhas.join('\n');
}
