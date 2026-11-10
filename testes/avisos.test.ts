import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registrarFerramentas } from '../extensao/ferramentas.js';
import { registrarTelegram } from '../extensao/telegram.js';
import { montarFita, previsaoSintetica } from './apoio.js';

async function montar() {
  const m = await montarFita(() => previsaoSintetica('2026-10-30T09:00'));
  registrarTelegram(m.contexto);
  registrarFerramentas(m.contexto);
  return m;
}

describe('Ferramenta avisos_automaticos', () => {
  it('Telegram: liga o boletim no horário pedido, pausa e volta; horário inválido é recusado', async () => {
    const { k7, banco } = await montar();
    await k7.pessoa('60').localizacao(-16.69, -49.26);
    const avisos = k7.ferramentas.get('avisos_automaticos')!;
    const ctx = k7.ctxFerramenta('60');

    assert.match(await avisos.run({ acao: 'ver' }, ctx), /boletim nos horários e alerta grave na hora, todo dia às 6h e 18h \(hora de Goiânia\/GO\)/);
    banco.salvarPreferencias('60', { modo: 'pedir' });
    assert.match(await avisos.run({ acao: 'ligar', horarios: [7, 7, 30, 19] }, ctx), /boletim nos horários.*todo dia às 7h e 19h/, '"só quando pedir" vira boletim; repetido e fora de 0–23 saem');
    assert.deepEqual(banco.preferencias('60').horarios, [7, 19]);
    assert.match(await avisos.run({ acao: 'pausar' }, ctx), /PAUSADO/);
    assert.match(await avisos.run({ acao: 'voltar' }, ctx), /todo dia às 7h e 19h/);
    assert.match(await avisos.run({ acao: 'ligar', modo: 'alertas' }, ctx), /só os alertas/);
    await assert.rejects(avisos.run({ acao: 'ligar', horarios: [25] }, ctx), (e: { userMessage?: string }) => /Horário inválido/.test(e.userMessage ?? ''));
  });

  it('chat web: não liga nada e explica que a mensagem automática é pelo Telegram (botão ✈️)', async () => {
    const { k7, banco } = await montar();
    const texto = await k7.ferramentas.get('avisos_automaticos')!.run({ acao: 'ligar', horarios: [6] }, k7.ctxFerramenta('web-abc'));
    assert.match(texto, /não consigo mandar mensagem sozinho[\s\S]*botão ✈️/);
    assert.deepEqual(banco.preferencias('web-abc').horarios, [6, 18], 'nada mudou');
  });
});
