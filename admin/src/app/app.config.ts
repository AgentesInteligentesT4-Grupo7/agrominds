import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import localePt from '@angular/common/locales/pt';
import { type ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideEchartsCore } from 'ngx-echarts';
import { cabecalhoDoPainel } from './api';
import { routes } from './app.routes';

registerLocaleData(localePt);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([cabecalhoDoPainel])),
    // ECharts carregado só quando um gráfico aparece (o painel abre mais rápido).
    provideEchartsCore({ echarts: () => import('echarts') }),
    { provide: LOCALE_ID, useValue: 'pt-BR' },
  ],
};
