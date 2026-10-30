import { Component, type ElementRef, type OnDestroy, effect, input, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { inject } from '@angular/core';
import * as L from 'leaflet';
import type { Resumo } from '../api';

const COR: Record<string, string> = { grave: '#c62828', atencao: '#b26a00', info: '#1565c0', nada: '#2e7d32' };

/** Lugares no mapa (OpenStreetMap), em ponto aproximado (~11 km), com a cor do alerta mais recente. */
@Component({
  selector: 'agro-mapa',
  template: `<div #alvo class="mapa" role="img" aria-label="Mapa dos lugares cadastrados"></div>
    <p class="legenda muted">
      <span style="color:#2e7d32">●</span> sem alerta · <span style="color:#b26a00">●</span> atenção · <span style="color:#c62828">●</span> grave
      · pontos aproximados (~11 km) · mapa © OpenStreetMap
    </p>`,
  styles: `
    .mapa { height: 360px; border-radius: 10px; overflow: hidden; border: 1px solid var(--agro-line); }
    .legenda { font-size: 12px; margin: 6px 0 0; }
  `,
})
export class Mapa implements OnDestroy {
  readonly pontos = input.required<Resumo['mapa']>();
  private readonly alvo = viewChild.required<ElementRef<HTMLDivElement>>('alvo');
  private readonly router = inject(Router);
  private mapa?: L.Map;
  private camada?: L.LayerGroup;

  constructor() {
    effect(() => {
      const pontos = this.pontos();
      if (!this.mapa) {
        this.mapa = L.map(this.alvo().nativeElement, { scrollWheelZoom: false }).setView([-15.8, -49.5], 5);
        // Mapa do OpenStreetMap: o servidor do painel manda o Referer só com a origem, como a política de uso exige
        // (sem Referer, o OSM devolve a imagem "Access blocked").
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: '© OpenStreetMap' }).addTo(this.mapa);
        this.camada = L.layerGroup().addTo(this.mapa);
      }
      this.camada!.clearLayers();
      for (const p of pontos) {
        L.circleMarker([p.lat, p.lon], { radius: 9, color: '#fff', weight: 2, fillColor: COR[p.severidade ?? 'nada'], fillOpacity: 0.9 })
          .bindTooltip(p.nome)
          .on('click', () => void this.router.navigate(['/usuarios', p.userId]))
          .addTo(this.camada!);
      }
      if (pontos.length) this.mapa.fitBounds(L.latLngBounds(pontos.map((p) => [p.lat, p.lon] as [number, number])).pad(0.5), { maxZoom: 8 });
    });
  }

  ngOnDestroy(): void {
    this.mapa?.remove();
  }
}
