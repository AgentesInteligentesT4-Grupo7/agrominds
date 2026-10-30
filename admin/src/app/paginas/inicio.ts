import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { EChartsOption } from 'echarts';
import { NgxEchartsDirective } from 'ngx-echarts';
import { Api, REGRAS, type Resumo, baixarCsv, mensagemDeErro } from '../api';
import { Mapa } from '../componentes/mapa';

@Component({
  selector: 'agro-inicio',
  imports: [NgxEchartsDirective, Mapa, RouterLink],
  template: `
    <section class="pagina">
      <h1>Painel</h1>
      @if (erro()) {
        <p class="erro">{{ erro() }}</p>
      }
      @if (resumo(); as r) {
        <div class="grade cartoes">
          <a class="cartao numero" routerLink="/usuarios"><b>{{ r.usuarios.ativos }}</b><span>usuários ativos</span></a>
          <a class="cartao numero" routerLink="/usuarios"><b [class.sev-atencao]="r.usuarios.pendentes > 0">{{ r.usuarios.pendentes }}</b><span>pedidos esperando</span></a>
          <div class="cartao numero"><b>{{ r.lugares }}</b><span>lugares cadastrados</span></div>
          <a class="cartao numero" routerLink="/envios"><b>{{ r.enviosHoje }}</b><span>envios hoje</span></a>
          <div class="cartao numero"><b>{{ totalAlertas() }}</b><span>alertas na semana</span></div>
        </div>
        <div class="grade duas">
          <div class="cartao">
            <h2>Onde estão as lavouras</h2>
            <agro-mapa [pontos]="r.mapa" />
          </div>
          <div class="cartao">
            <h2>Alertas da semana por tipo</h2>
            @if (r.alertasSemana.length) {
              <div echarts class="grafico" [options]="graficoAlertas()"></div>
            } @else {
              <p class="muted">Nenhum alerta nos últimos 7 dias.</p>
            }
          </div>
        </div>
        <div class="cartao">
          <div class="titulo">
            <h2>Envios por dia (30 dias)</h2>
            <button type="button" class="link" (click)="exportar(r)">Exportar CSV</button>
          </div>
          <div echarts class="grafico" [options]="graficoEnvios()"></div>
        </div>
      } @else if (!erro()) {
        <p class="muted">Carregando…</p>
      }
    </section>
  `,
  styles: `
    .cartoes { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-bottom: 16px; }
    .numero { display: flex; flex-direction: column; text-decoration: none; color: inherit; }
    .numero b { font-size: 30px; font-weight: 500; }
    .numero span { color: var(--agro-muted); font-size: 13px; }
    .duas { grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); margin-bottom: 16px; }
    h2 { font-size: 15px; font-weight: 500; margin: 0 0 10px; }
    .titulo { display: flex; justify-content: space-between; align-items: center; }
    .link { background: none; border: 0; color: var(--mat-sys-primary); cursor: pointer; font: inherit; }
    @media (max-width: 720px) { .duas { grid-template-columns: 1fr; } }
  `,
})
export class Inicio {
  private readonly api = inject(Api);
  readonly resumo = signal<Resumo | null>(null);
  readonly erro = signal('');
  readonly totalAlertas = computed(() => (this.resumo()?.alertasSemana ?? []).reduce((t, a) => t + a.n, 0));

  readonly graficoAlertas = computed<EChartsOption>(() => {
    const dados = [...(this.resumo()?.alertasSemana ?? [])].sort((a, b) => a.n - b.n);
    return {
      grid: { left: 120, right: 24, top: 10, bottom: 24 },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: { type: 'category', data: dados.map((d) => REGRAS[d.regra] ?? d.regra) },
      series: [{ type: 'bar', barMaxWidth: 28, data: dados.map((d) => d.n), itemStyle: { color: '#b26a00' } }],
      tooltip: {},
    };
  });

  readonly graficoEnvios = computed<EChartsOption>(() => {
    const linhas = this.resumo()?.enviosPorDia ?? [];
    const dias = [...new Set(linhas.map((l) => l.dia))];
    const tipos: Array<[string, string, string]> = [['boletim', 'Boletins', '#2e7d32'], ['alerta', 'Alertas', '#c62828'], ['resposta', 'Respostas (/clima)', '#1565c0'], ['teste', 'Testes', '#8d8d8d']];
    return {
      legend: { top: 0 },
      grid: { left: 40, right: 16, top: 36, bottom: 30 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: dias.map((d) => d.slice(5).split('-').reverse().join('/')) },
      yAxis: { type: 'value', minInterval: 1 },
      series: tipos.map(([tipo, nome, cor]) => ({ type: 'bar' as const, stack: 'envios', barMaxWidth: 28, name: nome, itemStyle: { color: cor }, data: dias.map((d) => linhas.find((l) => l.dia === d && l.tipo === tipo)?.n ?? 0) })),
    };
  });

  constructor() {
    this.api.resumo().then((r) => this.resumo.set(r)).catch((e) => this.erro.set(mensagemDeErro(e)));
  }

  exportar(r: Resumo): void {
    baixarCsv('agrominds-envios-por-dia.csv', r.enviosPorDia);
  }
}
