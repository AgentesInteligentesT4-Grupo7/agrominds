import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import { Api, mensagemDeErro } from '../api';

@Component({
  selector: 'agro-entrar',
  imports: [FormsModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <main class="entrar">
      <form class="cartao" (ngSubmit)="entrar()">
        <h1>🌱 AgroMinds</h1>
        <p class="muted">Painel administrativo: usuários do bot, o que foi enviado, as plantas e o tempo de cada pessoa.</p>
        <mat-form-field appearance="outline">
          <mat-label>E-mail</mat-label>
          <input matInput type="email" name="email" [(ngModel)]="email" autocomplete="username" required />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Senha</mat-label>
          <input matInput type="password" name="senha" [(ngModel)]="senha" autocomplete="current-password" required />
        </mat-form-field>
        @if (erro()) {
          <p class="erro" role="alert">{{ erro() }}</p>
        }
        <button mat-flat-button type="submit" [disabled]="enviando()">{{ enviando() ? 'Entrando…' : 'Entrar' }}</button>
        <p class="muted dica">Primeira vez? Crie a conta no terminal: <code>npm run fita -- agrominds admin-criar voce&#64;exemplo.com</code></p>
      </form>
    </main>
  `,
  styles: `
    .entrar { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
    form { width: min(380px, 100%); display: flex; flex-direction: column; gap: 4px; }
    h1 { margin: 0; font-weight: 500; }
    .dica { font-size: 12px; margin-top: 12px; }
  `,
})
export class Entrar {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  email = '';
  senha = '';
  readonly erro = signal('');
  readonly enviando = signal(false);

  async entrar(): Promise<void> {
    this.enviando.set(true);
    this.erro.set('');
    try {
      await this.api.entrar(this.email, this.senha);
      await this.router.navigate(['/']);
    } catch (e) {
      this.erro.set(mensagemDeErro(e));
    } finally {
      this.enviando.set(false);
    }
  }
}
