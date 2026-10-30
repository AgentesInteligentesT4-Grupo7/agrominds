import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Api } from '../api';

@Component({
  selector: 'agro-moldura',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatToolbarModule, MatButtonModule],
  template: `
    <mat-toolbar class="topo">
      <span class="marca">🌱 AgroMinds</span>
      <nav>
        <a mat-button routerLink="/" routerLinkActive="ativo" [routerLinkActiveOptions]="{ exact: true }">Painel</a>
        <a mat-button routerLink="/usuarios" routerLinkActive="ativo">Usuários</a>
        <a mat-button routerLink="/envios" routerLinkActive="ativo">Envios</a>
        <a mat-button routerLink="/contas" routerLinkActive="ativo">Contas</a>
      </nav>
      <span class="espaco"></span>
      <span class="quem">{{ api.eu()?.nome }} · {{ api.eu()?.papel === 'admin' ? 'admin' : 'só leitura' }}</span>
      <button mat-button type="button" (click)="sair()">Sair</button>
    </mat-toolbar>
    <router-outlet />
  `,
  styles: `
    .topo { background: #fff; border-bottom: 1px solid var(--agro-line); gap: 8px; flex-wrap: wrap; height: auto; min-height: 56px; }
    .marca { font-weight: 600; margin-right: 12px; }
    nav { display: flex; gap: 2px; flex-wrap: wrap; }
    .ativo { background: var(--mat-sys-primary-container); }
    .espaco { flex: 1; }
    .quem { font-size: 13px; color: var(--agro-muted); }
  `,
})
export class Moldura {
  protected readonly api = inject(Api);
  private readonly router = inject(Router);

  async sair(): Promise<void> {
    await this.api.sair();
    await this.router.navigate(['/entrar']);
  }
}
