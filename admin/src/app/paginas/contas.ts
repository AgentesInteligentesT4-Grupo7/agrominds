import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { type Admin, Api, mensagemDeErro, utc } from '../api';

@Component({
  selector: 'agro-contas',
  imports: [FormsModule, DatePipe, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  template: `
    <section class="pagina">
      <h1>Contas do painel</h1>
      <p class="muted">Quem entra neste painel. "Só leitura" vê tudo, mas não muda nada (bom para apresentar).</p>
      <div class="cartao">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Desde</th></tr></thead>
          <tbody>
            @for (a of contas(); track a.email) {
              <tr><td>{{ a.nome }}</td><td>{{ a.email }}</td><td>{{ a.papel === 'admin' ? 'admin' : 'só leitura' }}</td><td>{{ utc(a.criadoEm) | date: 'dd/MM/yyyy' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (api.podeEditar()) {
        <form class="cartao nova" (ngSubmit)="criar()">
          <h2>Nova conta</h2>
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Nome</mat-label><input matInput name="nome" [(ngModel)]="nome" /></mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>E-mail</mat-label><input matInput type="email" name="email" [(ngModel)]="email" required /></mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Senha (mín. 8)</mat-label><input matInput type="password" name="senha" [(ngModel)]="senha" autocomplete="new-password" required /></mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Papel</mat-label>
            <mat-select name="papel" [(ngModel)]="papel"><mat-option value="leitura">Só leitura</mat-option><mat-option value="admin">Admin</mat-option></mat-select>
          </mat-form-field>
          <button mat-flat-button type="submit">Criar</button>
          @if (mensagem()) { <p role="status">{{ mensagem() }}</p> }
        </form>
      }
    </section>
  `,
  styles: `
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--agro-line); }
    th { font-size: 12px; color: var(--agro-muted); font-weight: 500; text-transform: uppercase; }
    .nova { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .nova h2 { width: 100%; font-size: 15px; font-weight: 500; margin: 0; }
  `,
})
export class Contas {
  protected readonly api = inject(Api);
  protected readonly utc = utc;
  readonly contas = signal<Admin[]>([]);
  readonly mensagem = signal('');
  nome = '';
  email = '';
  senha = '';
  papel: 'admin' | 'leitura' = 'leitura';

  constructor() {
    void this.carregar();
  }

  async carregar(): Promise<void> {
    this.contas.set(await this.api.administradores().catch(() => []));
  }

  async criar(): Promise<void> {
    try {
      const conta = await this.api.criarAdministrador({ email: this.email, nome: this.nome, senha: this.senha, papel: this.papel });
      this.mensagem.set(`Conta ${conta.email} criada.`);
      this.senha = '';
      await this.carregar();
    } catch (e) {
      this.mensagem.set(`⚠️ ${mensagemDeErro(e)}`);
    }
  }
}
