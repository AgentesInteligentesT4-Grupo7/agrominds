import { inject } from '@angular/core';
import { type CanActivateFn, Router, type Routes } from '@angular/router';
import { Api } from './api';

/** Só entra quem tem sessão; sem ela, vai para o login. */
const logado: CanActivateFn = async () => {
  const api = inject(Api);
  return (api.eu() ?? (await api.carregarEu())) ? true : inject(Router).createUrlTree(['/entrar']);
};

export const routes: Routes = [
  { path: 'entrar', loadComponent: () => import('./paginas/entrar').then((m) => m.Entrar), title: 'Entrar · AgroMinds' },
  {
    path: '',
    canActivate: [logado],
    loadComponent: () => import('./paginas/moldura').then((m) => m.Moldura),
    children: [
      { path: '', loadComponent: () => import('./paginas/inicio').then((m) => m.Inicio), title: 'Painel · AgroMinds' },
      { path: 'usuarios', loadComponent: () => import('./paginas/usuarios').then((m) => m.Usuarios), title: 'Usuários · AgroMinds' },
      { path: 'usuarios/:id', loadComponent: () => import('./paginas/usuario').then((m) => m.UsuarioDetalhe), title: 'Usuário · AgroMinds' },
      { path: 'envios', loadComponent: () => import('./paginas/envios').then((m) => m.Envios), title: 'Envios · AgroMinds' },
      { path: 'contas', loadComponent: () => import('./paginas/contas').then((m) => m.Contas), title: 'Contas · AgroMinds' },
    ],
  },
  { path: '**', redirectTo: '' },
];
