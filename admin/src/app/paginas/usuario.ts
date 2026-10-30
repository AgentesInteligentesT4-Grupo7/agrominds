import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import type { EChartsOption } from 'echarts';
import { NgxEchartsDirective } from 'ngx-echarts';
import { Api, type Balanco, type Cultura, type Envio, LAYOUTS, MODOS, type Modo, type Planta, REGRAS, type Tempo, type Usuario, baixarCsv, mensagemDeErro, utc } from '../api';

const COR_SEV: Record<string, string> = { info: '#1565c0', atencao: '#b26a00', grave: '#c62828' };
const HORAS = [5, 6, 7, 12, 17, 18, 19];
/** Ferramenta do ECharts para baixar o gráfico como PNG (para a apresentação). */
const SALVAR = { feature: { saveAsImage: { title: 'Salvar PNG', pixelRatio: 2 } }, right: 8 };

@Component({
  selector: 'agro-usuario',
  imports: [RouterLink, FormsModule, DatePipe, NgxEchartsDirective, MatButtonModule, MatSelectModule, MatFormFieldModule, MatInputModule, MatCheckboxModule],
  template: `
    <section class="pagina">
      <p><a routerLink="/usuarios">← Usuários</a></p>
      @if (usuario(); as u) {
        <h1>{{ u.nome }} @if (u.username) { <span class="muted">@{{ u.username }}</span> }</h1>
        <p class="muted">
          {{ u.lugar?.nome ?? 'sem localização' }} · <span class="pill" [class]="'pill st-' + u.status">{{ u.status }}</span> ·
          entrou por {{ u.origem }}{{ u.criadoEm ? ' em ' + (utc(u.criadoEm) | date: 'dd/MM/yyyy') : '' }}
        </p>
        @if (mensagem()) {
          <p class="aviso" role="status">{{ mensagem() }}</p>
        }

        <div class="grade duas">
          <div class="cartao">
            <h2>Plantas ({{ u.plantas.length }})</h2>
            @for (l of u.plantas; track l.planta) {
              <div class="planta">
                <span>
                  <b>{{ l.nome }}</b> · {{ nomeFase(l.cultura, l.fase) }}
                  @if (l.plantio) { · plantio {{ l.plantio | date: 'dd/MM/yyyy' }} }
                  @if (l.irrigada) { · 💧 irrigada }
                </span>
                @if (api.podeEditar()) { <button type="button" class="link" (click)="removerPlanta(l.planta, l.nome)">remover</button> }
              </div>
            } @empty {
              <p class="muted">Nenhuma planta ainda (a pessoa escolhe no Telegram, em /plantas).</p>
            }
            @if (api.podeEditar()) {
              <div class="linha nova">
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Planta</mat-label>
                  <mat-select [(ngModel)]="novaPlanta">
                    @for (p of catalogo(); track p.id) { <mat-option [value]="p.id">{{ p.grupo === 'horta' ? '🥬' : '🚜' }} {{ p.nome }}</mat-option> }
                  </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>Plantio (opcional)</mat-label>
                  <input matInput type="date" [(ngModel)]="novoPlantio">
                </mat-form-field>
                <mat-checkbox [(ngModel)]="novaIrrigada">Irrigada</mat-checkbox>
                <button mat-stroked-button type="button" [disabled]="!novaPlanta" (click)="adicionarPlanta()">Adicionar</button>
              </div>
            }
          </div>
          <div class="cartao">
            <h2>O que recebe</h2>
            <div class="linha">
              <mat-form-field appearance="outline" subscriptSizing="dynamic">
                <mat-label>Modo</mat-label>
                <mat-select [(ngModel)]="modo" [disabled]="!api.podeEditar()">
                  @for (m of modos; track m[0]) { <mat-option [value]="m[0]">{{ m[1] }}</mat-option> }
                </mat-select>
              </mat-form-field>
              <mat-checkbox [(ngModel)]="pausado" [disabled]="!api.podeEditar()">Pausado</mat-checkbox>
            </div>
            <div class="linha horas">
              <span class="muted">Boletim às:</span>
              @for (h of horas; track h) {
                <mat-checkbox [checked]="horarios().includes(h)" (change)="alternarHora(h)" [disabled]="!api.podeEditar()">{{ h }}h</mat-checkbox>
              }
            </div>
            @if (api.podeEditar()) {
              <button mat-stroked-button type="button" (click)="salvarPreferencias()">Salvar</button>
              @if (u.lugar && u.status === 'ativo') { <button mat-button type="button" (click)="teste()">Enviar boletim de teste agora</button> }
            }
          </div>
        </div>

        @if (u.lugar) {
          <div class="cartao">
            <div class="titulo">
              <h2>O que a pessoa recebe no Telegram</h2>
              <span>
                @for (l of layouts; track l[0]) {
                  <button type="button" class="link" [class.sel]="layout() === l[0]" (click)="layout.set(l[0])">{{ l[1] }}</button>
                }
                <a class="link" [href]="api.imagem(id(), layout(), versao())" [download]="'agrominds-' + layout() + '.png'">Baixar PNG</a>
              </span>
            </div>
            <img class="print" [src]="api.imagem(id(), layout(), versao())" [alt]="'Imagem ' + layout()" loading="lazy">
          </div>
        }

        @if (tempo(); as t) {
          <div class="cartao">
            <div class="titulo">
              <h2>Meteograma — {{ t.lugar.nome }} (últimos {{ dias() }} dias e próximos 7)</h2>
              <span>
                @for (d of [7, 30, 90]; track d) {
                  <button type="button" class="link" [class.sel]="dias() === d" (click)="dias.set(d)">{{ d }} dias</button>
                }
                <button type="button" class="link" (click)="csvTempo(t)">CSV</button>
              </span>
            </div>
            <div echarts class="grafico alto" [options]="meteograma()"></div>
            <p class="muted pe">Linha cheia: o que aconteceu (análise do modelo) · tracejada: previsão · barras: chuva por hora · Dados: Open-Meteo.com, consultado {{ t.consultadoEm | date: 'dd/MM HH:mm' }}</p>
          </div>
          <div class="grade duas">
            <div class="cartao">
              <h2>Umidade e déficit de pressão de vapor (VPD)</h2>
              <div echarts class="grafico" [options]="umidade()"></div>
              <p class="muted pe">VPD acima de 1,6 kPa: a planta perde muita água; abaixo de 0,4 kPa: ambiente úmido, favorece doenças.</p>
            </div>
            <div class="cartao">
              <h2>Previsto × ocorrido (previsão feita 24 h antes)</h2>
              @if (t.comparacao.length) {
                <div echarts class="grafico" [options]="comparacao()"></div>
              } @else {
                <p class="muted">Ainda sem dados: a comparação aparece depois que a previsão de 24 h antes for conferida com o que aconteceu (1 dia de bot ligado).</p>
              }
            </div>
          </div>
          <div class="grade duas">
            <div class="cartao">
              <h2>Balanço de água (7 dias){{ balanco() ? ' · ' + nomePlanta(balanco()!.planta) : '' }}</h2>
              @if (balanco(); as b) {
                <div echarts class="grafico" [options]="graficoBalanco()"></div>
                <p class="muted pe">Kc {{ b.kc }} · déficit atual {{ b.deficit }} mm · chuva prevista em 2 dias {{ b.chuvaPrevista }} mm · linha vermelha: limite para avisar ({{ b.limite }} mm)</p>
              } @else {
                <p class="muted">Cadastre uma planta para ver o balanço.</p>
              }
            </div>
            <div class="cartao">
              <h2>Linha do tempo dos alertas</h2>
              @if (t.alertas.length) {
                <div echarts class="grafico" [options]="linhaAlertas()"></div>
              } @else {
                <p class="muted">Nenhum alerta enviado ainda.</p>
              }
            </div>
          </div>
        } @else if (u.lugar) {
          <p class="muted">Carregando o tempo…</p>
        }

        <div class="cartao">
          <h2>O que foi enviado ({{ envios().length }})</h2>
          @for (e of envios(); track e.id) {
            <div class="envio">
              <div class="muted">
                {{ utc(e.quando) | date: 'dd/MM/yyyy HH:mm' }} · {{ e.tipo }}
                @if (e.severidade) { · <span [class]="'sev-' + e.severidade">{{ e.severidade }}</span> }
                @if (e.regras.length) { · {{ nomesRegras(e.regras) }} }
                @if (!e.entregue) { · <span class="sev-grave">não entregue: {{ e.erro }}</span> }
              </div>
              <div class="mensagem">{{ e.texto }}</div>
            </div>
          } @empty {
            <p class="muted">Nada enviado ainda.</p>
          }
        </div>
      } @else {
        <p class="muted">{{ mensagem() || 'Carregando…' }}</p>
      }
    </section>
  `,
  styles: `
    h2 { font-size: 15px; font-weight: 500; margin: 0 0 10px; }
    .duas { grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); margin-bottom: 16px; }
    .cartao { margin-bottom: 16px; }
    .linha { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
    .horas { gap: 2px; }
    .planta { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--agro-line); }
    .nova { margin-top: 12px; }
    .print { display: block; max-width: 100%; width: 480px; margin: 8px auto 0; border-radius: 12px; border: 1px solid var(--agro-line); }
    .alto { height: 420px; }
    .pe { font-size: 12px; margin: 6px 0 0; }
    .titulo { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
    .link { background: none; border: 0; color: var(--mat-sys-primary); cursor: pointer; font: inherit; padding: 2px 6px; border-radius: 6px; }
    .link.sel { background: var(--mat-sys-primary-container); }
    .aviso { background: var(--mat-sys-primary-container); padding: 8px 12px; border-radius: 8px; }
    .envio { padding: 10px 0; border-bottom: 1px solid var(--agro-line); }
    .envio .muted { font-size: 12px; margin-bottom: 4px; }
    @media (max-width: 720px) { .duas { grid-template-columns: 1fr; } }
  `,
})
export class UsuarioDetalhe {
  /** Da rota (/usuarios/:id). */
  readonly id = input.required<string>();
  protected readonly api = inject(Api);
  protected readonly utc = utc;
  protected readonly modos = Object.entries(MODOS) as Array<[Modo, string]>;
  protected readonly horas = HORAS;
  readonly usuario = signal<Usuario | null>(null);
  readonly culturas = signal<Cultura[]>([]);
  readonly catalogo = signal<Planta[]>([]);
  protected readonly layouts = LAYOUTS;
  readonly layout = signal('tempo');
  /** Muda a cada recarga: a imagem é gerada de novo. */
  readonly versao = signal(0);
  readonly tempo = signal<Tempo | null>(null);
  readonly balanco = signal<Balanco | null>(null);
  readonly envios = signal<Envio[]>([]);
  readonly dias = signal(30);
  readonly mensagem = signal('');
  readonly horarios = signal<number[]>([]);
  novaPlanta = '';
  novoPlantio = '';
  novaIrrigada = false;
  modo: Modo = 'boletim';
  pausado = false;

  constructor() {
    effect(() => void this.carregar(this.id()));
    effect(() => {
      const id = this.id();
      const dias = this.dias();
      if (this.usuario()?.lugar) this.api.tempo(id, dias).then((t) => this.tempo.set(t)).catch((e) => this.mensagem.set(mensagemDeErro(e)));
    });
    this.api.culturas().then((c) => this.culturas.set(c)).catch(() => undefined);
    this.api.plantas().then((p) => this.catalogo.set(p)).catch(() => undefined);
  }

  async carregar(id: string): Promise<void> {
    try {
      const u = (await this.api.usuarios()).find((x) => x.userId === id);
      if (!u) return void this.mensagem.set('Usuário não encontrado.');
      this.usuario.set(u);
      this.modo = u.preferencias.modo;
      this.pausado = u.preferencias.pausado;
      this.horarios.set([...u.preferencias.horarios]);
      this.envios.set(await this.api.envios({ usuario: id }));
      this.versao.update((v) => v + 1);
      this.balanco.set(u.lugar && u.plantas.length ? await this.api.balanco(id).catch(() => null) : null);
    } catch (e) {
      this.mensagem.set(mensagemDeErro(e));
    }
  }

  alternarHora(h: number): void {
    this.horarios.update((hs) => (hs.includes(h) ? hs.filter((x) => x !== h) : [...hs, h].sort((a, b) => a - b)));
  }

  nomeFase(cultura: string, fase: string): string {
    return this.culturas().find((c) => c.id === cultura)?.fases[fase]?.nome ?? fase;
  }

  nomePlanta(id: string): string {
    return this.catalogo().find((p) => p.id === id)?.nome ?? id;
  }

  async adicionarPlanta(): Promise<void> {
    const dados = { planta: this.novaPlanta, irrigada: this.novaIrrigada, ...(this.novoPlantio ? { plantio: this.novoPlantio } : {}) };
    await this.agir(() => this.api.salvarPlanta(this.id(), dados), `${this.nomePlanta(this.novaPlanta)} adicionada.`);
    this.novaPlanta = '';
    this.novoPlantio = '';
    this.novaIrrigada = false;
  }

  async removerPlanta(planta: string, nome: string): Promise<void> {
    await this.agir(() => this.api.salvarPlanta(this.id(), { planta, remover: true }), `${nome} removida.`);
  }

  async salvarPreferencias(): Promise<void> {
    await this.agir(() => this.api.salvarPreferencias(this.id(), { modo: this.modo, horarios: this.horarios(), pausado: this.pausado }), 'Preferências salvas.');
  }

  async teste(): Promise<void> {
    await this.agir(async () => {
      const r = await this.api.enviarTeste(this.id());
      if (!r.entregue) throw new Error(`não chegou: ${r.erro}`);
    }, 'Boletim de teste enviado.');
  }

  nomesRegras(regras: string[]): string {
    return regras.map((r) => REGRAS[r] ?? r).join(', ');
  }

  csvTempo(t: Tempo): void {
    baixarCsv(`agrominds-${this.id()}-tempo.csv`, [...t.ocorrido.map((p) => ({ tipo: 'ocorrido', ...p })), ...t.previsao.map((p) => ({ tipo: 'previsao', ...p }))]);
  }

  readonly meteograma = computed<EChartsOption>(() => {
    const t = this.tempo();
    if (!t) return {};
    const ocorrido = t.ocorrido.map((p) => [p.hora, p.temperatura]);
    const previsao = t.previsao.map((p) => [p.hora, p.temperatura]);
    const chuva = [...t.ocorrido, ...t.previsao].map((p) => [p.hora, p.chuva]);
    const rajada = [...t.ocorrido, ...t.previsao].map((p) => [p.hora, p.rajada]);
    return {
      toolbox: SALVAR,
      tooltip: { trigger: 'axis' },
      legend: { top: 0, left: 0 },
      grid: { left: 48, right: 56, top: 40, bottom: 60 },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8 }],
      xAxis: { type: 'time' },
      yAxis: [
        { type: 'value', name: '°C', scale: true },
        { type: 'value', name: 'mm · km/h', position: 'right', splitLine: { show: false } },
      ],
      series: [
        { name: 'Temperatura (ocorrida)', type: 'line', showSymbol: false, data: ocorrido, itemStyle: { color: '#d84315' } },
        { name: 'Temperatura (prevista)', type: 'line', showSymbol: false, data: previsao, lineStyle: { type: 'dashed' }, itemStyle: { color: '#d84315' }, markLine: previsao.length ? { symbol: 'none', label: { formatter: 'agora' }, lineStyle: { color: '#888' }, data: [{ xAxis: previsao[0]![0] as string }] } : undefined },
        { name: 'Chuva (mm/h)', type: 'bar', yAxisIndex: 1, data: chuva, itemStyle: { color: '#1e88e5' }, barMaxWidth: 6 },
        { name: 'Rajada (km/h)', type: 'line', yAxisIndex: 1, showSymbol: false, data: rajada, lineStyle: { width: 1, opacity: 0.6 }, itemStyle: { color: '#78909c' } },
      ],
    };
  });

  readonly umidade = computed<EChartsOption>(() => {
    const t = this.tempo();
    if (!t) return {};
    const pontos = [...t.ocorrido, ...t.previsao];
    return {
      toolbox: SALVAR,
      tooltip: { trigger: 'axis' },
      legend: { top: 0, left: 0 },
      grid: { left: 44, right: 48, top: 36, bottom: 30 },
      xAxis: { type: 'time' },
      yAxis: [
        { type: 'value', name: '%', min: 0, max: 100 },
        { type: 'value', name: 'kPa', position: 'right', splitLine: { show: false } },
      ],
      series: [
        { name: 'Umidade (%)', type: 'line', showSymbol: false, data: pontos.map((p) => [p.hora, p.umidade]), itemStyle: { color: '#00897b' } },
        {
          name: 'VPD (kPa)',
          type: 'line',
          yAxisIndex: 1,
          showSymbol: false,
          data: pontos.map((p) => [p.hora, p.vpd]),
          itemStyle: { color: '#8e24aa' },
          markArea: { silent: true, itemStyle: { color: 'rgba(198,40,40,0.06)' }, data: [[{ yAxis: 1.6 }, { yAxis: 10 }]] },
        },
      ],
    };
  });

  readonly comparacao = computed<EChartsOption>(() => {
    const c = this.tempo()?.comparacao ?? [];
    return {
      toolbox: SALVAR,
      tooltip: { trigger: 'axis' },
      legend: { top: 0, left: 0 },
      grid: { left: 44, right: 48, top: 36, bottom: 30 },
      xAxis: { type: 'time' },
      yAxis: [{ type: 'value', name: '°C', scale: true }, { type: 'value', name: 'mm', position: 'right', splitLine: { show: false } }],
      series: [
        { name: 'Temperatura prevista', type: 'line', showSymbol: false, lineStyle: { type: 'dashed' }, data: c.map((p) => [p.hora, p.previstaTemperatura]), itemStyle: { color: '#ff7043' } },
        { name: 'Temperatura ocorrida', type: 'line', showSymbol: false, data: c.map((p) => [p.hora, p.ocorridaTemperatura]), itemStyle: { color: '#bf360c' } },
        { name: 'Chuva prevista', type: 'bar', yAxisIndex: 1, data: c.map((p) => [p.hora, p.previstaChuva]), itemStyle: { color: '#90caf9' } },
        { name: 'Chuva ocorrida', type: 'bar', yAxisIndex: 1, data: c.map((p) => [p.hora, p.ocorridaChuva]), itemStyle: { color: '#1565c0' } },
      ],
    };
  });

  readonly graficoBalanco = computed<EChartsOption>(() => {
    const b = this.balanco();
    if (!b) return {};
    const dias = b.serie.map((d) => d.dia.slice(5).split('-').reverse().join('/'));
    return {
      toolbox: SALVAR,
      tooltip: { trigger: 'axis' },
      legend: { top: 0, left: 0 },
      grid: { left: 44, right: 16, top: 36, bottom: 30 },
      xAxis: { type: 'category', data: dias },
      yAxis: { type: 'value', name: 'mm' },
      series: [
        { name: 'Água perdida (ET0 × Kc)', type: 'bar', data: b.serie.map((d) => d.et), itemStyle: { color: '#ffa000' } },
        { name: 'Chuva', type: 'bar', data: b.serie.map((d) => d.chuva), itemStyle: { color: '#1e88e5' } },
        {
          name: 'Déficit acumulado',
          type: 'line',
          data: b.serie.map((d) => d.deficit),
          itemStyle: { color: '#6d4c41' },
          markLine: { symbol: 'none', lineStyle: { color: '#c62828', type: 'dashed' }, label: { formatter: 'limite' }, data: [{ yAxis: b.limite }] },
        },
      ],
    };
  });

  readonly linhaAlertas = computed<EChartsOption>(() => {
    const alertas = this.tempo()?.alertas ?? [];
    const regras = [...new Set(alertas.flatMap((a) => a.regras))];
    return {
      toolbox: SALVAR,
      tooltip: { formatter: (p: unknown) => { const d = (p as { data: { value: [string, string]; sev: string } }).data; return `${d.value[1]} · ${d.sev}<br>${new Date(d.value[0]).toLocaleString('pt-BR')}`; } },
      grid: { left: 120, right: 16, top: 16, bottom: 30 },
      xAxis: { type: 'time' },
      yAxis: { type: 'category', data: regras.map((r) => REGRAS[r] ?? r) },
      series: [
        {
          type: 'scatter',
          symbolSize: 14,
          data: alertas.flatMap((a) => a.regras.map((r) => ({ value: [utc(a.quando)!, REGRAS[r] ?? r], sev: a.severidade ?? 'info', itemStyle: { color: COR_SEV[a.severidade ?? 'info'] } }))),
        },
      ],
    } as EChartsOption;
  });

  private async agir(acao: () => Promise<unknown>, sucesso: string): Promise<void> {
    try {
      await acao();
      this.mensagem.set(sucesso);
      await this.carregar(this.id());
    } catch (e) {
      this.mensagem.set(`⚠️ ${mensagemDeErro(e)}`);
    }
  }
}
