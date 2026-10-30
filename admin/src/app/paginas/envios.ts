import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { Api, type Envio, REGRAS, baixarCsv, mensagemDeErro, utc } from '../api';

@Component({
  selector: 'agro-envios',
  imports: [FormsModule, DatePipe, RouterLink, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  template: `
    <section class="pagina">
      <h1>O que foi enviado</h1>
      <div class="cartao filtros">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Tipo</mat-label>
          <mat-select [(ngModel)]="tipo">
            <mat-option value="">Todos</mat-option>
            <mat-option value="boletim">Boletins</mat-option>
            <mat-option value="alerta">Alertas</mat-option>
            <mat-option value="resposta">Respostas (/clima)</mat-option>
            <mat-option value="teste">Testes</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>De</mat-label>
          <input matInput type="date" [(ngModel)]="de" />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Até</mat-label>
          <input matInput type="date" [(ngModel)]="ate" />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Texto contém</mat-label>
          <input matInput [(ngModel)]="q" (keyup.enter)="buscar()" />
        </mat-form-field>
        <button mat-flat-button type="button" (click)="buscar()">Filtrar</button>
        <button mat-button type="button" (click)="exportar()">Exportar CSV</button>
      </div>
      @if (erro()) { <p class="erro">{{ erro() }}</p> }
      <p class="muted">{{ envios().length }} envio(s){{ envios().length >= 300 ? ' (os 300 mais recentes; filtre para ver outros)' : '' }}</p>
      @for (e of envios(); track e.id) {
        <div class="cartao envio">
          <div class="cab">
            <a [routerLink]="['/usuarios', e.userId]">{{ nomes()[e.userId] ?? e.userId }}</a>
            <span class="muted">{{ utc(e.quando) | date: 'dd/MM/yyyy HH:mm' }} · {{ e.tipo }}</span>
            @if (e.severidade) { <span class="pill" [class]="'pill sev-' + e.severidade">{{ e.severidade }}</span> }
            @for (r of e.regras; track r) { <span class="pill">{{ regra(r) }}</span> }
            @if (!e.entregue) { <span class="pill sev-grave">não entregue: {{ e.erro }}</span> }
          </div>
          <div class="mensagem">{{ e.texto }}</div>
        </div>
      } @empty {
        <p class="muted">Nada encontrado.</p>
      }
    </section>
  `,
  styles: `
    .filtros { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
    .envio { margin-bottom: 10px; }
    .cab { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 6px; font-size: 14px; }
  `,
})
export class Envios {
  private readonly api = inject(Api);
  protected readonly utc = utc;
  readonly envios = signal<Envio[]>([]);
  readonly nomes = signal<Record<string, string>>({});
  readonly erro = signal('');
  tipo = '';
  de = '';
  ate = '';
  q = '';

  constructor() {
    void this.buscar();
    this.api.usuarios().then((us) => this.nomes.set(Object.fromEntries(us.map((u) => [u.userId, u.nome])))).catch(() => undefined);
  }

  async buscar(): Promise<void> {
    try {
      this.erro.set('');
      this.envios.set(await this.api.envios({ tipo: this.tipo, de: this.de, ate: this.ate, q: this.q }));
    } catch (e) {
      this.erro.set(mensagemDeErro(e));
    }
  }

  regra(id: string): string {
    return REGRAS[id] ?? id;
  }

  exportar(): void {
    baixarCsv('agrominds-envios.csv', this.envios().map((e) => ({ ...e, pessoa: this.nomes()[e.userId] ?? '' })));
  }
}
