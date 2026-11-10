/*
 * AgroMinds no chat web do K7: botão 📍 na caixa de mensagem para cadastrar e escolher os lugares onde a pessoa
 * planta. Não precisa estar no lugar: dá para buscar a cidade ou o endereço, ou colar a coordenada do Google Maps.
 * Usa o window.K7 da página (botao, mostrar, api, el, esc).
 */
(function () {
  var K7 = window.K7;
  if (!K7 || !K7.botao) return;
  var ROTA = '/api/x/agro/lugares';
  var lugares = [];
  var dialogo = null;

  var botao = K7.botao('📍', 'Meus lugares (onde fica a plantação)', abrir);

  function atualizarBotao() {
    var atual = lugares.filter(function (l) { return l.atual; })[0];
    botao.title = atual ? '📍 ' + atual.nome + ' — trocar ou adicionar lugar' : '📍 Cadastrar onde fica a sua plantação';
    botao.classList.toggle('agro-sem-lugar', !atual);
  }

  function carregar() {
    return K7.api(ROTA).then(function (r) { lugares = r.lugares || []; atualizarBotao(); if (dialogo) desenhar(); });
  }
  K7.onReady(function () { carregar().catch(function () {}); });

  /** Manda para a rota da fita e mostra a resposta no chat (com a imagem do tempo do lugar). */
  function enviar(caminho, corpo, voce) {
    fechar();
    var balao = K7.mostrar({ texto: '⏳ Um momento…' }, voce);
    return K7.api(caminho, { method: 'POST', body: corpo })
      .then(function (r) { lugares = r.lugares || lugares; atualizarBotao(); K7.mostrar(r.resposta, null, balao); })
      .catch(function (e) { K7.mostrar({ erro: '⚠️ ' + e.message }, null, balao); });
  }

  function apelido() {
    var campo = dialogo && dialogo.querySelector('.agro-apelido');
    return campo && campo.value.trim() ? campo.value.trim() : undefined;
  }

  function ondeEstou() {
    if (!navigator.geolocation || !window.isSecureContext) {
      aviso('Este navegador não deixa pegar a localização por este endereço. Busque a cidade ou cole a coordenada.');
      return;
    }
    aviso('Pegando a localização do navegador…');
    navigator.geolocation.getCurrentPosition(
      function (p) { enviar(ROTA, { lat: p.coords.latitude, lon: p.coords.longitude, apelido: apelido() }, '📍 Onde estou agora' + (apelido() ? ' (' + apelido() + ')' : '')); },
      function (erro) { aviso(motivoSemLocalizacao(erro)); },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  }

  /**
   * Por que o navegador não deu a posição. Permissão negada também acontece com o site liberado quando a localização
   * do sistema está desligada (Windows: Configurações → Privacidade e segurança → Localização).
   */
  function motivoSemLocalizacao(erro) {
    var fim = ' Ou busque a cidade ou cole a coordenada aqui embaixo.';
    if (erro && erro.code === 1) {
      return 'O navegador recusou a localização. Libere no cadeado ao lado do endereço e confira se a localização do ' +
        'aparelho está ligada (no Windows: Configurações → Privacidade e segurança → Localização, com o acesso dos ' +
        'aplicativos da área de trabalho ligado; no celular: GPS ligado).' + fim;
    }
    if (erro && erro.code === 3) return 'A localização demorou demais para chegar. Tente de novo em instantes.' + fim;
    return 'O aparelho não conseguiu descobrir onde está (sem GPS, Wi-Fi ou localização do sistema desligada).' + fim;
  }

  function buscar() {
    var texto = dialogo.querySelector('.agro-busca').value.trim();
    if (!texto) { aviso('Digite a cidade, o endereço ou a coordenada.'); return; }
    enviar(ROTA, { busca: texto, apelido: apelido() }, '📍 ' + texto + (apelido() ? ' (' + apelido() + ')' : ''));
  }

  function aviso(texto) {
    var a = dialogo && dialogo.querySelector('.agro-aviso');
    if (a) a.textContent = texto;
  }

  function botaoDe(texto, classe, aoClicar) {
    var b = K7.el('button', classe, K7.esc(texto));
    b.type = 'button';
    b.onclick = aoClicar;
    return b;
  }

  function desenhar() {
    dialogo.innerHTML = '';
    var caixa = K7.el('div', 'agro-caixa');
    caixa.appendChild(K7.el('h3', '', '📍 Seus lugares'));
    caixa.appendChild(K7.el('p', 'agro-suave', 'Onde fica a plantação: não precisa ser onde você está. Pode ter vários (a fazenda, o sítio, a horta de casa).'));

    var lista = K7.el('div', 'agro-lista');
    if (!lugares.length) lista.appendChild(K7.el('p', 'agro-suave', 'Nenhum lugar ainda.'));
    lugares.forEach(function (l) {
      var linha = K7.el('div', 'agro-lugar' + (l.atual ? ' atual' : ''));
      linha.appendChild(K7.el('span', 'agro-nome', (l.atual ? '● ' : '') + K7.esc(l.nome) + ' <small>' + l.plantas + ' planta' + (l.plantas === 1 ? '' : 's') + '</small>'));
      var acoes = K7.el('span', 'agro-acoes');
      if (!l.atual) acoes.appendChild(botaoDe('Usar', 'agro-link', function () { enviar(ROTA + '/' + l.id, { acao: 'usar' }, '📍 Usar ' + l.nome); }));
      acoes.appendChild(botaoDe('Renomear', 'agro-link', function () {
        var novo = window.prompt('Nome para este lugar (ex.: Sítio Boa Vista, Casa). Vazio = só a cidade.', l.apelido || '');
        if (novo !== null) enviar(ROTA + '/' + l.id, { acao: 'renomear', apelido: novo }, '✏️ Renomear ' + l.nome);
      }));
      acoes.appendChild(botaoDe('Remover', 'agro-link perigo', function () {
        if (window.confirm('Remover "' + l.nome + '" e as plantas cadastradas nele?')) enviar(ROTA + '/' + l.id, { acao: 'remover' }, '🗑️ Remover ' + l.nome);
      }));
      linha.appendChild(acoes);
      lista.appendChild(linha);
    });
    caixa.appendChild(lista);

    caixa.appendChild(K7.el('h4', '', 'Adicionar um lugar'));
    var nome = K7.el('input', 'agro-apelido');
    nome.placeholder = 'Nome (opcional): Sítio Boa Vista, Casa, Fazenda…';
    nome.maxLength = 40;
    caixa.appendChild(nome);
    var linhaBusca = K7.el('div', 'agro-linha');
    var busca = K7.el('input', 'agro-busca');
    busca.placeholder = 'Cidade, endereço ou coordenada (ex.: Rio Verde, GO · -16.68, -49.25)';
    busca.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); buscar(); } };
    linhaBusca.appendChild(busca);
    linhaBusca.appendChild(botaoDe('Buscar', 'agro-primario', buscar));
    caixa.appendChild(linhaBusca);
    caixa.appendChild(botaoDe('📡 Usar onde estou agora', 'agro-secundario', ondeEstou));
    caixa.appendChild(K7.el('p', 'agro-suave', 'Coordenada do Google Maps: clique com o botão direito no lugar do mapa e copie os números.'));
    caixa.appendChild(K7.el('p', 'agro-aviso', ''));
    caixa.appendChild(botaoDe('Fechar', 'agro-fechar', fechar));
    dialogo.appendChild(caixa);
    (lugares.length ? busca : nome).focus();
  }

  function abrir() {
    if (dialogo) return fechar();
    dialogo = K7.el('div', 'agro-dialogo');
    dialogo.onclick = function (e) { if (e.target === dialogo) fechar(); };
    document.addEventListener('keydown', esc);
    document.body.appendChild(dialogo);
    desenhar();
    carregar().catch(function () {});
  }

  function esc(e) { if (e.key === 'Escape') fechar(); }

  function fechar() {
    if (!dialogo) return;
    dialogo.remove();
    dialogo = null;
    document.removeEventListener('keydown', esc);
  }
})();
