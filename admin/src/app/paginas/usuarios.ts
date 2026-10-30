import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { Api, MODOS, type Usuario, mensagemDeErro, utc } from '../api';

@Component({
  selector: 'agro-usuarios',
  imports: [RouterLink, FormsModule, DatePipe, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <section class="pagina">
      <h1>Usuários do bot</h1>
      <p class="muted">Quem pode usar o bot da AgroMinds no Telegram. Ninguém precisa informar o ID: a pessoa entra pelo convite (QR) ou pede acesso e você aprova.</p>
      @if (mensagem()) {
        <p class="aviso" role="status">{{ mensagem() }}</p>
      }

      @if (api.podeEditar()) {
        <div class="cartao convite">
          <h2>Convidar alguém</h2>
          <div class="linha">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Nome (opcional)</mat-label>
              <input matInput [(ngModel)]="nomeConvite" maxlength="60" />
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="curto">
              <mat-label>Dias</mat-label>
              <input matInput type="number" min="1" max="90" [(ngModel)]="dias" />
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="curto">
              <mat-label>Pessoas</mat-label>
              <input matInput type="number" min="1" max="1000" [(ngModel)]="usos" />
            </mat-form-field>
            <button mat-flat-button type="button" (click)="convidar()">Gerar convite</button>
          </div>
          @if (convite(); as c) {
            <div class="qr">
              <img [src]="c.qr" alt="QR code do convite" width="200" height="200" />
              <div>
                <p><b>Mostre o QR para a pessoa escanear</b> (ou mande o link). Ela toca em Iniciar e já entra.</p>
                <p class="link">{{ c.link }}</p>
                <p class="muted">Vale até {{ c.expiraEm }} · {{ usos === 1 ? 'uso único' : usos + ' pessoas' }}</p>
                <button mat-stroked-button type="button" (click)="copiar(c.link)">Copiar link</button>
              </div>
            </div>
          }
        </div>
      }

      <div class="cartao">
        <div class="filtros">
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Buscar</mat-label>
            <input matInput [ngModel]="busca()" (ngModelChange)="busca.set($event)" placeholder="nome, @, lugar" />
          </mat-form-field>
          <span class="muted">{{ filtrados().length }} de {{ usuarios().length }}</span>
        </div>
        <div class="tabela">
          <table>
            <thead>
              <tr><th>Pessoa</th><th>Situação</th><th>Lugar</th><th>Plantas</th><th>Recebe</th><th>Último envio</th><th></th></tr>
            </thead>
            <tbody>
              @for (u of filtrados(); track u.userId) {
                <tr>
                  <td>
                    <a [routerLink]="['/usuarios', u.userId]">{{ u.nome }}</a>
                    @if (u.username) { <span class="muted"> @{{ u.username }}</span> }
                    <div class="muted id">{{ u.userId }} · {{ u.origem }}</div>
                  </td>
                  <td><span class="pill" [class]="'pill st-' + u.status">{{ u.status }}</span></td>
                  <td>{{ u.lugar?.nome ?? '—' }}</td>
                  <td>{{ lavoura(u) }}</td>
                  <td>{{ u.preferencias.pausado ? 'pausado' : modos[u.preferencias.modo] }}</td>
                  <td>
                    @if (u.ultimoEnvio; as e) {
                      {{ utc(e.quando) | date: 'dd/MM HH:mm' }} · {{ e.tipo }}
                      @if (!e.entregue) { <span class="sev-grave">não entregue</span> }
                    } @else { — }
                  </td>
                  <td class="acoes">
                    @if (api.podeEditar()) {
                      @if (u.status !== 'ativo') {
                        <button mat-stroked-button type="button" (click)="status(u, 'ativo')">{{ u.status === 'pendente' ? 'Aprovar' : 'Liberar' }}</button>
                      }
                      @if (u.status !== 'bloqueado' && u.origem !== 'dono') {
                        <button mat-button type="button" class="perigo" (click)="status(u, 'bloqueado')">{{ u.status === 'pendente' ? 'Recusar' : 'Bloquear' }}</button>
                      }
                      @if (u.lugar && u.status === 'ativo') {
                        <button mat-button type="button" (click)="teste(u)">Boletim de teste</button>
                      }
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="7" class="muted">Ninguém ainda. Gere um convite acima.</td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `,
  styles: `
    .convite, .cartao { margin-bottom: 16px; }
    h2 { font-size: 15px; font-weight: 500; margin: 0 0 10px; }
    .linha, .filtros { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
    .curto { width: 100px; }
    .qr { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
    .qr img { border: 1px solid var(--agro-line); border-radius: 10px; background: #fff; }
    .link { font-family: ui-monospace, Consolas, monospace; font-size: 13px; word-break: break-all; }
    .aviso { background: var(--mat-sys-primary-container); padding: 8px 12px; border-radius: 8px; }
    .tabela { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--agro-line); vertical-align: middle; }
    th { font-size: 12px; color: var(--agro-muted); font-weight: 500; text-transform: uppercase; }
    .id { font-size: 12px; }
    .acoes { white-space: nowrap; }
    .perigo { color: var(--agro-grave); }
  `,
})
export class Usuarios {
  protected readonly api = inject(Api);
  protected readonly modos = MODOS;
  protected readonly utc = utc;
  readonly usuarios = signal<Usuario[]>([]);
  readonly busca = signal('');
  readonly mensagem = signal('');
  readonly convite = signal<{ link: string; expiraEm: string; qr: string } | null>(null);
  nomeConvite = '';
  dias = 7;
  usos = 1;

  readonly filtrados = computed(() => {
    const q = this.busca().trim().toLowerCase();
    return this.usuarios().filter((u) => !q || [u.nome, u.username, u.lugar?.nome, u.userId].some((v) => v?.toLowerCase().includes(q)));
  });

  constructor() {
    void this.carregar();
  }

  async carregar(): Promise<void> {
    try {
      this.usuarios.set(await this.api.usuarios());
    } catch (e) {
      this.mensagem.set(mensagemDeErro(e));
    }
  }

  lavoura(u: Usuario): string {
    if (!u.plantas.length) return '—';
    return u.plantas.map((l) => `${l.nome}${l.irrigada ? ' 💧' : ''}`).join(', ');
  }

  async status(u: Usuario, status: 'ativo' | 'bloqueado'): Promise<void> {
    await this.agir(() => this.api.definirStatus(u.userId, status), `${u.nome}: ${status === 'ativo' ? 'liberado(a)' : 'bloqueado(a)'}.`);
  }

  async teste(u: Usuario): Promise<void> {
    await this.agir(async () => {
      const r = await this.api.enviarTeste(u.userId);
      if (!r.entregue) throw new Error(`não chegou: ${r.erro}`);
    }, `Boletim de teste enviado para ${u.nome}.`);
  }

  async convidar(): Promise<void> {
    await this.agir(async () => this.convite.set(await this.api.convite({ nome: this.nomeConvite, dias: this.dias, usos: this.usos })), '');
  }

  copiar(texto: string): void {
    void navigator.clipboard.writeText(texto).then(() => this.mensagem.set('Link copiado.'));
  }

  private async agir(acao: () => Promise<unknown>, sucesso: string): Promise<void> {
    try {
      await acao();
      this.mensagem.set(sucesso);
      await this.carregar();
    } catch (e) {
      this.mensagem.set(`⚠️ ${mensagemDeErro(e)}`);
    }
  }
}
