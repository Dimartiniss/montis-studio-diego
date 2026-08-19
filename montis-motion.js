/* Montis Studio — camada de movimento (GSAP 3.13 + ScrollTrigger).
 *
 * Regras que guiaram este arquivo:
 *  - Nada aqui pode ser necessario para o conteudo aparecer. Se o GSAP nao
 *    carregar, ou se qualquer coisa estourar, a pagina volta ao estado estatico
 *    e continua legivel — por isso todo o bloco vive dentro de um try/catch com
 *    `revelarTudo()` como saida de emergencia.
 *  - A pagina e renderizada pelo runtime do Claude Design (React), entao o DOM
 *    nao existe no momento em que este script roda. Dai o polling inicial.
 *  - Duas coisas do proprio site nao podem ser tocadas: os `.fan-card` da secao
 *    de projetos (o script da pagina escreve transform neles) e as imagens do
 *    hero (elas casam pixel a pixel com o espelho da secao seguinte; mover
 *    qualquer uma reabriria a emenda). Ver comentarios nos respectivos blocos.
 */
(function () {
  'use strict';

  if (!window.gsap || !window.ScrollTrigger) {
    console.warn('[montis] GSAP nao carregou — a pagina segue sem animacao.');
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  gsap.defaults({ ease: 'power3.out', duration: 0.9 });
  ScrollTrigger.config({ ignoreMobileResize: true, limitCallbacks: true });

  /* Sobre fluidez — o que foi tentado e por que saiu:
   *
   * Uma versao anterior suspendia o backdrop-filter durante a entrada e chamava
   * clearProps no fim, para baratear o frame. As duas coisas economizam custo
   * medio mas introduzem MUDANCA DISCRETA: trocar backdrop-filter recria a
   * camada no inicio e no fim, e clearProps tira o elemento da composicao 3D
   * quando o tween acaba. O resultado era um movimento suave com dois solavancos
   * — exatamente o "trava e depois vai pro lugar" que aparecia na tela.
   *
   * Agora nada muda no meio do caminho: o vidro fica ligado o tempo todo, o
   * elemento entra em camada 3D e fica (force3D:true, sem clearProps), e o lote
   * inteiro anima numa sequencia continua. Custa um pouco mais de GPU por frame,
   * em troca de nao ter nenhum degrau.
   */

  var TENTATIVA_MAX = 120; // ~7s a 60ms
  var tentativas = 0;
  var iniciado = false;

  function pronto() {
    var hero = document.querySelector('#top');
    // Nao basta o DOM existir: a janela precisa ter altura de verdade. Montar a
    // cena com viewport 0 gera um pin de comprimento zero, e um pin de
    // comprimento zero nasce com progresso 1 — a cena inteira "ja aconteceu",
    // e a frase final aparece de saida.
    return document.querySelector('#contato') &&
           document.querySelectorAll('.rv').length > 0 &&
           window.innerHeight > 200 &&
           hero && hero.clientHeight > 200;
  }

  function revelarTudo() {
    try { gsap.set('.rv', { clearProps: 'all' }); } catch (e) {}
    document.querySelectorAll('.rv').forEach(function (el) {
      el.style.opacity = '';
      el.style.visibility = '';
      el.style.transform = '';
    });
  }

  function esperarDom() {
    if (iniciado) return;
    if (pronto()) {
      iniciado = true;
      try {
        iniciar();
      } catch (e) {
        console.error('[montis] falha ao montar a animacao, revertendo:', e);
        revelarTudo();
      }
      return;
    }
    if (++tentativas > TENTATIVA_MAX) {
      console.warn('[montis] DOM nao ficou pronto a tempo; sem animacao.');
      return;
    }
    setTimeout(esperarDom, 60); // setTimeout, nao rAF: continua funcionando em aba oculta
  }

  // ---------------------------------------------------------------- helpers
  //
  // Pausa dramatica: segura a rolagem por um tempo, uma vez so. Bloqueia roda,
  // toque e as teclas de rolagem, e ainda devolve a posicao caso alguem arraste
  // a barra. O `setTimeout` que solta e criado ANTES de qualquer coisa poder dar
  // errado — travar a pagina para sempre seria a pior falha possivel aqui.
  var rolagemTravada = false;
  function travarRolagem(ms) {
    if (rolagemTravada) return;
    rolagemTravada = true;
    var y = window.scrollY;
    var barra = function (e) { e.preventDefault(); };
    var volta = function () { window.scrollTo(0, y); };
    var teclas = function (e) {
      // espaco, page up/down, home/end, setas
      if ([32, 33, 34, 35, 36, 38, 40].indexOf(e.keyCode) !== -1) e.preventDefault();
    };
    var soltar = function () {
      window.removeEventListener('wheel', barra);
      window.removeEventListener('touchmove', barra);
      window.removeEventListener('keydown', teclas);
      window.removeEventListener('scroll', volta);
    };
    setTimeout(soltar, ms);
    window.addEventListener('wheel', barra, { passive: false });
    window.addEventListener('touchmove', barra, { passive: false });
    window.addEventListener('keydown', teclas, { passive: false });
    window.addEventListener('scroll', volta, { passive: true });
  }

  function acharTexto(raiz, seletor, trecho) {
    var achado = null;
    if (!raiz) return null;
    Array.prototype.forEach.call(raiz.querySelectorAll(seletor), function (el) {
      if (!achado && el.textContent.indexOf(trecho) !== -1) achado = el;
    });
    return achado;
  }

  function iniciar() {
    var mm = gsap.matchMedia();

    mm.add(
      {
        reduz: '(prefers-reduced-motion: reduce)',
        ok: '(prefers-reduced-motion: no-preference)',
        fone: '(max-width: 767px)'
      },
      function (ctx) {
        if (ctx.conditions.reduz) {
          revelarTudo();
          // Sem a cena do hero, o cabecalho volta ao limiar original.
          window.__montisHeaderAt = 80;
          gsap.set('#hero-final', { opacity: 0 });
          gsap.set('#hero-tag', { opacity: 1 });
          return;
        }
        // ORDEM IMPORTA, e custou um bug silencioso: `montarHero` cria o pin, que
        // insere um espaçador de ~1584px no topo e empurra a página inteira para
        // baixo. Gatilhos criados ANTES dele calculam suas posições sem esse
        // espaçador e ficam deslocados exatamente esse tanto — disparando com o
        // elemento ainda muito abaixo da tela. A animação acontecia fora de
        // vista e, com `once: true`, o gatilho se matava em seguida: o conteúdo
        // aparecia sem entrada nenhuma.
        //
        // O pin é a primeira coisa da página, então é a primeira a ser montada.
        // O `refreshPriority: 1` nele garante o mesmo em cada refresh seguinte
        // (redimensionar a janela, fonte carregando tarde, imagem entrando).
        montarHero(!!ctx.conditions.fone);
        montarEntradas();
        montarProfundidade();
        montarDetalhes();
        montarAbas();
        montarTilt();
        montarArrastoDoLeque();
      }
    );

    // A foto do "sobre" e pesada; sem um refresh depois do load os gatilhos
    // ficam calculados em cima de uma altura de pagina que ainda vai mudar.
    window.addEventListener('load', function () { ScrollTrigger.refresh(); });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
    }

    window.addEventListener('scroll', agendarVarredura, { passive: true });
    ScrollTrigger.addEventListener('refresh', agendarVarredura);
    setTimeout(varrerEsquecidos, 1200);
    setTimeout(varrerEsquecidos, 4000);

    // Gancho de diagnostico: `montisMotion.varrer()` no console força a
    // varredura, e `montisMotion.esquecidos()` lista o que ficou para tras.
    window.montisMotion = window.montisMotion || {};
    window.montisMotion.varrer = varrerEsquecidos;
    window.montisMotion.esquecidos = function () {
      return Array.prototype.filter.call(document.querySelectorAll('.rv'), function (el) {
        return parseFloat(getComputedStyle(el).opacity) === 0;
      });
    };
  }

  // ------------------------------------------------------ entradas de secao
  var especiais = [];

  // Rede de seguranca. O `interval` do ScrollTrigger.batch junta os callbacks e
  // despacha o lote pelo ticker do GSAP; um lote parcial que nao chegue a fechar
  // deixaria o elemento invisivel para sempre — o pior tipo de falha possivel
  // aqui. Esta varredura pega qualquer .rv que ja passou da linha de entrada e
  // continua em opacidade 0, e resolve na mao. Em uso normal ela nao faz nada.
  function varrerEsquecidos() {
    var perdidos = [];
    document.querySelectorAll('.rv').forEach(function (el) {
      if (parseFloat(getComputedStyle(el).opacity) > 0) return;
      if (gsap.isTweening(el)) return; // esta entrando agora, deixa quieto
      if (el.getBoundingClientRect().top < window.innerHeight * 0.95) perdidos.push(el);
    });
    if (!perdidos.length) return;
    // `clearProps: transform` no fim e importante: sem isso o resgate deixaria
    // um transform inline nos cartoes de vidro — que nao tem transform nenhum no
    // estado normal — e eles voltariam a pagar o custo de recompor o desfoque.
    // Como o estado final e translate(0,0), limpar nao muda nada na tela.
    gsap.to(perdidos, {
      autoAlpha: 1, x: 0, y: 0,
      duration: 0.45, ease: 'power2.out', overwrite: true, clearProps: 'transform'
    });
  }

  var esperaVarredura;
  function agendarVarredura() {
    clearTimeout(esperaVarredura);
    esperaVarredura = setTimeout(varrerEsquecidos, 320);
  }

  // Monta uma entrada em lote. `inicial` pode ser um objeto ou uma funcao que
  // recebe o elemento (usado pela entrada lateral, que depende da posicao).
  function montar(alvos, inicial, destino) {
    if (!alvos || !alvos.length) return;
    alvos.forEach(function (el) {
      gsap.set(el, typeof inicial === 'function' ? inicial(el) : inicial);
    });

    ScrollTrigger.batch(alvos, {
      start: 'top 88%',
      once: true,
      interval: 0.1,
      // Alto de proposito: com batchMax baixo o grupo era partido em sub-lotes,
      // e o `interval` entre eles aparecia como uma pausa no meio da sequencia.
      // Um lote unico deixa o stagger correr sem interrupcao.
      batchMax: 12,
      onEnter: function (lote) {
        // force3D fica por conta de cada grupo: promover camada so ajuda quem
        // realmente se desloca. Nos cartoes de vidro, que agora so mudam de
        // opacidade, seria custo sem retorno.
        gsap.to(lote, Object.assign({}, destino, { overwrite: true }));
      }
    });
  }

  function montarEntradas() {
    var frase = acharTexto(document.querySelector('#importancia'), 'p', 'Estar online');
    var manchete = acharTexto(document, 'h2', 'Onde grandes marcas');
    especiais = [frase, manchete].filter(Boolean);

    var alvos = gsap.utils.toArray('.rv').filter(function (el) {
      return especiais.indexOf(el) === -1;
    });

    // Tres tratamentos em vez de um so. Os cartoes de vidro do espelho e de
    // servicos ganharam entradas 3D proprias; o resto da pagina segue com a
    // entrada lateral, cuja direcao sai da posicao real do elemento na tela.
    var deVidro = gsap.utils.toArray('.rv').filter(function (el) {
      var s = getComputedStyle(el);
      var bf = s.backdropFilter || s.webkitBackdropFilter;
      return bf && bf !== 'none';
    });
    var topo = document.querySelector('#top');
    var secEspelho = topo && topo.nextElementSibling;
    var secServicos = document.querySelector('#servicos');

    var cartoesEspelho = deVidro.filter(function (el) { return secEspelho && secEspelho.contains(el); });
    var cartoesServicos = deVidro.filter(function (el) { return secServicos && secServicos.contains(el); });
    var especificos = cartoesEspelho.concat(cartoesServicos);
    var laterais = alvos.filter(function (el) { return especificos.indexOf(el) === -1; });

    // Espelho: os tres cartoes empilhados abrem como portas presas pela borda
    // esquerda, um atras do outro.
    // Cartoes de vidro: SO opacidade, sem deslocar um pixel.
    //
    // O motivo e concreto, nao estetico. backdrop-filter obriga o navegador a
    // reamostrar e desfocar o fundo toda vez que o elemento MUDA DE LUGAR —
    // girar, transladar ou escalar um cartao desses e das coisas mais caras que
    // da para pedir de um frame. Parado, o resultado do desfoque se mantem e so
    // o alfa muda na composicao: e o efeito mais barato que existe aqui.
    //
    // Por isso a entrada e um surgimento simples, um cartao depois do outro. Se
    // um dia alguem quiser devolver movimento a esses nove cartoes, o travamento
    // volta junto — o custo esta no deslocamento, nao na duracao nem no angulo.
    montar(cartoesEspelho,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: 0.5, ease: 'power1.out', stagger: 0.14 });

    montar(cartoesServicos,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: 0.45, ease: 'power1.out', stagger: 0.11 });

    // Resto: entra pelo lado em que o elemento ja esta; bloco de largura total sobe.
    var meio = window.innerWidth / 2;
    laterais.forEach(function (el) {
      var r = el.getBoundingClientRect();
      var largo = r.width > window.innerWidth * 0.55;
      el._dir = largo ? 0 : (r.left + r.width / 2 < meio ? -1 : 1);
    });
    montar(laterais,
      function (el) { return { autoAlpha: 0, x: el._dir * 48, y: el._dir === 0 ? 28 : 0 }; },
      { autoAlpha: 1, x: 0, y: 0, duration: 0.7, ease: 'power2.out', stagger: 0.06,
        force3D: true }); // estes se deslocam de verdade, entao vale a camada

    // Manchetes quebradas em <span>: cada linha sobe atras da anterior.
    especiais.forEach(function (el) {
      var linhas = el.querySelectorAll('span');
      if (!linhas.length) { gsap.set(el, { clearProps: 'all' }); return; }
      gsap.from(linhas, {
        autoAlpha: 0, y: 46, duration: 1.05, ease: 'power3.out', stagger: 0.13,
        scrollTrigger: { trigger: el, start: 'top 82%', once: true }
      });
    });
  }

  // ------------------------------------------------------------------- hero
  //
  // A cena do hero: o hero fica preso na tela por uma distancia de scroll e,
  // dentro dela, a pessoa controla o zoom. Medicoes que sustentam os numeros
  // abaixo (feitas casando o perfil da crista das duas fotos, que e o unico
  // sinal imune a diferenca de cor e de neve entre elas):
  //
  //   - a imagem final corresponde a um recorte de 313x176 px da foto aberta,
  //     centrado em u=0.494 / v=0.347 — ou seja, um zoom de 5.35x;
  //   - 5.35x sobre uma fonte de 1672px daria 6.1x de ampliacao na tela. Virava
  //     mingau. Por isso a foto aberta so avanca ate 2x (2.3x de ampliacao, que
  //     aguenta em movimento) e a chegada e feita pela imagem final, nitida.
  // O zoom acontece em DUAS etapas, cada uma com sua propria foto. Antes era uma
  // so: a foto aberta esticava 3x sozinha e chegava pixelada ate a troca. Com a
  // imagem intermediaria no meio, nenhuma das duas passa de ~2,3x e ~1,8x.
  //
  // Cada linha abaixo saiu de `_original/alinhar2.js`, casando o perfil da crista
  // de um par de fotos (o unico sinal imune a diferenca de cor entre elas).
  //
  // Etapa 1 — aberta (1672x941) -> intermediaria: recorte 425,219 de 791x391.
  //   Encaixe quase perfeito: RMS de 4,2px.
  var E1 = { U0: 0.25419, V0: 0.23262, CW: 0.47286, CH: 0.41548 };
  // Etapa 2 — intermediaria (1820x900) -> final: recorte 340,0 de 1092x614.
  //   Encaixe IMPERFEITO (RMS 102px): a imagem final tem mais ceu do que a
  //   intermediaria possui em qualquer recorte, entao nesta troca a nevoa nao e
  //   enfeite — e ela que esconde a diferenca.
  var E2 = { U0: 0.18681, V0: 0.00008, CW: 0.60008, CH: 0.68259 };
  [E1, E2].forEach(function (e) { e.UC = e.U0 + e.CW / 2; e.VC = e.V0 + e.CH / 2; });

  function montarHero(fone) {
    var hero = document.querySelector('#top');
    var bg = document.querySelector('#hero-bg');
    var fg = document.querySelector('#hero-fg');
    var inter = document.querySelector('#hero-inter');
    var fim = document.querySelector('#hero-final');
    var fog = document.querySelector('#hero-fog');
    var letras = document.querySelector('.hero-montis');
    if (!hero || !bg || !inter || !fim || !letras) return;

    // O navegador restaura a rolagem no reload (`scrollRestoration: auto`). Numa
    // hero presa na tela isso faz a pagina nascer no meio da cena: a frase final
    // dispara na hora e, como ela nao volta atras por design, aparece "de saida".
    // Era exatamente o sintoma relatado. A cena tem de comecar do zero.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);

    var spans = letras.querySelectorAll('span');
    var txEsq = document.querySelector('#hero-tx-esq');
    var txDir = document.querySelector('#hero-tx-dir');
    var dica = document.querySelector('#hero-scroll');
    var tag = document.querySelector('#hero-tag');

    // Piso de 600px: mesmo que a janela reporte altura absurda num momento de
    // transicao, a cena nunca vira um pin de comprimento zero.
    // 2.2x a altura da janela. A cena em si termina em 0.62 do percurso; o
    // trecho de 0.62 a 1 e proposital — e a "scrollada a mais" depois que a
    // frase aparece, para dar tempo de ler antes de o hero soltar.
    var distancia = function () {
      return Math.max(700, Math.round(window.innerHeight * (fone ? 1.5 : 2.2)));
    };
    // Enquanto a cena roda, o cabecalho nao deve trocar de estado.
    window.__montisHeaderAt = distancia() + 80;

    // Repete a conta que o object-fit:cover faz, para uma imagem qualquer.
    // Precisa ser por imagem: as tres tem proporcoes diferentes (1.777, 2.022 e
    // 1.778), entao a caixa recorta cada uma de um jeito.
    function cover(img) {
      var nw = img.naturalWidth || 1672, nh = img.naturalHeight || 941;
      var bw = hero.clientWidth, bh = hero.clientHeight;
      var s = Math.max(bw / nw, bh / nh);
      var dw = nw * s, dh = nh * s;
      return { ox: (bw - dw) / 2, oy: (bh - dh) / 2, dw: dw, dh: dh };
    }

    // O CORACAO DA CENA.
    //
    // A versao anterior escalava so a foto aberta e depois trocava para a final
    // por cima, em escala 1. Como as duas mostravam enquadramentos MUITO
    // diferentes no momento da troca, aquilo lia como um corte, nao como zoom —
    // era a "quebra artificial".
    //
    // Agora a imagem final recebe a transformacao que a coloca exatamente sobre
    // a regiao correspondente da foto aberta, em qualquer instante. As duas
    // enquadram a mesma coisa o tempo todo, entao a passagem de uma para a outra
    // e so troca de nitidez: nao ha salto de enquadramento para o olho pegar.
    var camadas1 = fg ? [bg, fg] : [bg];
    // Uma etapa de zoom: `quem` cresce ate o ponto em que o recorte descrito por
    // `E` preenche a caixa — que e exatamente onde `proxima` fica certa em escala
    // 1. Por isso a proxima imagem nunca precisa de transformacao: no instante em
    // que ela aparece, o lugar certo dela ja e o natural.
    function etapa(alvos, quem, proxima, E, q) {
      var bw = hero.clientWidth, bh = hero.clientHeight;
      var cx = bw / 2, cy = bh / 2;
      var P = cover(quem), N = cover(proxima);

      var sMax = N.dw / (E.CW * P.dw);
      var s = 1 + (sMax - 1) * q;

      // Alvo que deve terminar no centro da tela: do centro da foto ate o centro
      // do recorte. Com origem no centro C e escala s, um ponto P vai para
      // C + s*(P-C) + t; querendo o alvo em C, t = -s*(P-C).
      var u = 0.5 + (E.UC - 0.5) * q, v = 0.5 + (E.VC - 0.5) * q;
      var px = P.ox + u * P.dw, py = P.oy + v * P.dh;
      var tx = -s * (px - cx), ty = -s * (py - cy);
      for (var i = 0; i < alvos.length; i++) {
        gsap.set(alvos[i], { scale: s, x: tx, y: ty, force3D: true });
      }

      // Imagem final acompanhando a mesma regiao. Deduzido igualando as duas
      // projecoes; em q=1 isso da exatamente escala 1 e deslocamento 0.
      //
      // A IMAGEM FINAL NAO RECEBE TRANSFORMACAO NENHUMA — e essa a correcao.
      //
      // A conta acima chegaria a escala/deslocamento que a encaixam sobre a
      // regiao correspondente da foto aberta. So que enquanto essa escala for
      // menor que 1 ela e um retangulo MENOR que a tela, e o olho sempre acha a
      // aresta: era exatamente a borda que aparecia na captura.
      //
      // No fim do zoom (`s = sMax`) a foto aberta mostra precisamente o recorte
      // preenchendo o quadro — que e o mesmo que a imagem final mostra parada,
      // em escala 1. Ou seja: no momento em que ela precisa aparecer, o lugar
      // certo dela e justamente o natural. Deixando-a quieta, a passagem vira
      // uma dissolucao de tela cheia entre dois enquadramentos iguais, sem
      // nenhuma borda para denunciar a troca.
    }

    // As duas que vao ser reveladas comecam em repouso (escala 1, sem deslocamento).
    gsap.set([inter, fim], { clearProps: 'transform', opacity: 0 });

    var etapa1 = { q: 0 }, etapa2 = { q: 0 };
    var tagMostrada = false;
    // A frase so pode aparecer para quem ATRAVESSOU a cena. Desligar o
    // `scrollRestoration` ajuda, mas e uma API que nem todo navegador respeita —
    // entao a garantia de verdade e esta: enquanto a cena nao tiver sido vista
    // perto do inicio, a frase nao dispara, mesmo que a pagina abra no meio.
    var viuInicio = false;

    var cena = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: hero,
        start: 'top top',
        end: function () { return '+=' + distancia(); },
        pin: true,
        scrub: 1,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        // Este pin insere um espacador de ~1600px e empurra a pagina inteira
        // para baixo. Ele PRECISA ser recalculado antes de todos os outros
        // gatilhos, senao eles medem posicoes que o espacador ainda vai
        // deslocar — e passam a disparar 1600px cedo demais, fora da tela.
        // Na GSAP, MAIOR = recalculado PRIMEIRO (o contrario do que o nome
        // sugere). Medido: com -1 o erro de cada gatilho era -1584px, que e
        // exatamente o espacador; com 1, erro 0.
        refreshPriority: 1,
        onRefresh: function () { window.__montisHeaderAt = distancia() + 80; },
        onUpdate: function (self) {
          // "Acima do comum" e o unico elemento que NAO volta atras: uma vez que
          // apareceu, fica. Por isso vive fora do scrub, num disparo unico.
          // A checagem do comprimento e proposital: se por qualquer motivo o pin
          // nascer degenerado, o progresso ja vem em 1 e a frase dispararia sem
          // a pessoa ter rolado nada.
          if (self.progress < 0.5) viuInicio = true;
          // 0.70: a cena termina em 0.62, entao a frase chega com a montanha ja
          // parada — e ainda sobram 30% do percurso do pin para ela ser lida.
          if (!tagMostrada && viuInicio && tag && self.progress >= 0.78 && (self.end - self.start) > 200) {
            tagMostrada = true;
            var regras = tag.querySelectorAll('span[style*="width"]');
            var texto = tag.querySelector('span:not([style*="width"])');
            gsap.set(tag, { opacity: 1 });
            // A frase cresce, segura, e volta ao tamanho normal — tudo fluido.
            // O tamanho grande e so o destaque da PRIMEIRA aparicao; dali em
            // diante ela vive no tamanho de sempre. Antes ela surgia no tamanho
            // normal e em 1.2s: pequena e rapida demais para dar tempo de ver.
            var chegada = gsap.timeline({
              defaults: { ease: 'power3.out' },
              // Quando a frase termina de se assentar, a rolagem trava por 2s.
              // Sem isso o mesmo gesto que faz a frase surgir ja empurra a
              // pagina para a proxima secao, e nao sobra tempo de ver a frase
              // sobre a montanha.
              onComplete: function () { travarRolagem(2000); }
            });
            // No celular o 1.38 faria as reguas passarem da borda: os traços
            // laterais mais o texto ja ocupam quase a largura toda ali.
            chegada.fromTo(tag, { scale: 0.78 }, { scale: fone ? 1.12 : 1.38, duration: 1.15 }, 0);
            chegada.from(texto, { autoAlpha: 0, y: 20, letterSpacing: '0.78em', duration: 1.3 }, 0);
            chegada.from(regras, { scaleX: 0, duration: 1.1 }, 0.12);
            // Segura no tamanho grande e desce de volta ao normal.
            chegada.to(tag, { scale: 1, duration: 1.0, ease: 'power2.inOut' }, 1.7);
          }
        }
      }
    });

    // --- ETAPA 1: a foto aberta cresce ate o enquadramento da intermediaria.
    //     O recorte da montanha vai junto, para o sanduiche das letras valer.
    cena.to(etapa1, {
      q: 1, duration: 0.33, ease: 'power1.in',
      onUpdate: function () { etapa(camadas1, bg, inter, E1, etapa1.q); }
    }, 0);

    // --- ETAPA 2: a intermediaria assume e cresce ate o enquadramento da final.
    cena.to(etapa2, {
      q: 1, duration: 0.29, ease: 'power1.inOut',
      onUpdate: function () { etapa([inter], inter, fim, E2, etapa2.q); }
    }, 0.33);

    // --- letras se espalhando. Cada uma para um lado, com rotacao e escala
    //     proprias; a mascara de gradiente que ja existe faz a base sumir antes
    //     do topo, o que da a leitura de dissolver em vez de simplesmente subir.
    var ampX = fone ? window.innerWidth * 0.30 : Math.max(window.innerWidth * 0.22, 220);
    var ampY = window.innerHeight * (fone ? 0.42 : 0.55);
    var rumos = [
      { x: -1.00, y: -0.95, r: -14 }, { x: -0.58, y: -1.15, r: -9 },
      { x: -0.18, y: -1.30, r: -4 }, { x: 0.18, y: -1.28, r: 4 },
      { x: 0.58, y: -1.12, r: 9 }, { x: 1.00, y: -0.92, r: 14 }
    ];
    spans.forEach(function (sp, i) {
      var d = rumos[i] || rumos[rumos.length - 1];
      cena.to(sp, {
        x: d.x * ampX, y: d.y * ampY, rotation: d.r, scale: 1.18, autoAlpha: 0,
        duration: 0.37, force3D: true
      }, i * 0.020);
    });

    // --- textos laterais e a dica de rolagem. Como estao no scrub, voltam
    //     sozinhos quando a pessoa sobe.
    if (txEsq) cena.to(txEsq, { autoAlpha: 0, x: -30, duration: 0.23, force3D: true }, 0);
    if (txDir) cena.to(txDir, { autoAlpha: 0, x: 30, duration: 0.23, force3D: true }, 0);
    if (dica) cena.to(dica, { autoAlpha: 0, y: 20, duration: 0.15, force3D: true }, 0);

    // --- o recorte da montanha sai antes de a imagem final aparecer: ele
    //     pertence a foto aberta e ficaria por cima dela.
    if (fg) cena.to(fg, { autoAlpha: 0, duration: 0.12 }, 0.23);

    // --- as duas trocas, cada uma no exato fim da sua etapa (0.40 e 0.76), que
    //     e onde os enquadramentos coincidem. Cada uma acontece por dentro de um
    //     florescer de nevoa.
    // A camada de cima entra invertida na vertical para a parte densa da nuvem
    // ficar no topo; a do meio espelha na horizontal, para as tres nao repetirem
    // visivelmente o mesmo desenho.
    var cams = fog ? fog.querySelectorAll('.cam') : [];
    if (cams.length) {
      gsap.set(cams[1], { scaleY: -1 });
      gsap.set(cams[2], { scaleX: -1 });
    }

    function nevoa(centro, pico, subida, descida, deriva) {
      if (!fog) return;
      cena.fromTo(fog,
        { opacity: 0 },
        { opacity: pico, duration: subida, ease: 'power2.in' }, centro - subida);
      cena.to(fog, { opacity: 0, duration: descida, ease: 'power2.out' }, centro);

      // Cada camada anda uma distancia diferente e em sentido alternado. E essa
      // diferenca — nao a opacidade — que faz o olho ler nuvem passando em vez
      // de um veu aparecendo. Só xPercent/yPercent: nada de `scale`, que
      // apagaria as inversoes definidas acima.
      var total = subida + descida;
      var perfis = [
        { x: 0.8, y: -2 },   // base: devagar
        { x: -1.2, y: 2 },   // topo: sentido oposto
        { x: 1.9, y: -3 }    // meio: mais rapida, passa na frente
      ];
      for (var i = 0; i < cams.length; i++) {
        var p = perfis[i] || perfis[0];
        cena.fromTo(cams[i],
          { xPercent: -deriva * p.x, yPercent: p.y },
          { xPercent: deriva * p.x, yPercent: 0, duration: total, ease: 'none', immediateRender: false },
          centro - subida);
      }
    }

    // Troca 1: encaixe quase perfeito, entao a nevoa e leve — ela da coesao, nao
    // esconde defeito.
    nevoa(0.33, 0.72, 0.085, 0.10, 4);
    cena.to(inter, { opacity: 1, duration: 0.045 }, 0.310);
    cena.to(bg, { opacity: 0, duration: 0.045 }, 0.365);

    // Troca 2: e aqui que a nevoa trabalha. O encaixe e imperfeito por natureza
    // (a imagem final tem mais ceu), entao ela sobe mais e cobre mais tempo.
    nevoa(0.63, 1.0, 0.14, 0.19, 5.5);
    cena.to(fim, { opacity: 1, duration: 0.13, ease: 'power1.inOut' }, 0.575);
    // Assenta a escala enquanto aparece: chegar parado de um golpe e o que
    // deixava a ultima troca seca. Termina exatamente em 1, que e o
    // enquadramento do quadro final e o que a emenda do espelho espera.
    cena.fromTo(fim, { scale: 1.035 }, { scale: 1, duration: 0.26, ease: 'power2.out', immediateRender: false }, 0.575);
    cena.to(inter, { opacity: 0, duration: 0.10, ease: 'power1.inOut' }, 0.685);

    // Marca o fim da cena em 1.0. Sem isso a duracao total da timeline seria a
    // do ultimo filho (0.80), e todas as posicoes acima passariam a significar
    // outra coisa em termos de progresso do scroll — foi o que fez a dissolucao
    // cair no lugar errado na primeira tentativa.
    cena.set(hero, { '--montis-cena': 1 }, 1);

    // TRAVA CONTRA UM BUG SUTIL, e a razao dela importa.
    //
    // Um tween `to` grava o valor inicial no primeiro render. Com scrub, o tween
    // que esta na POSICAO 0 renderiza de imediato; os das posicoes seguintes so
    // renderizam quando o playhead chega neles. Se a intro (criada logo abaixo)
    // ja tiver mexido no elemento nesse meio tempo, o primeiro tween grava o
    // estado alterado como se fosse o natural.
    //
    // Era exatamente o caso do "M": tween na posicao 0, gravou `autoAlpha: 0`, e
    // ao voltar o scroll a letra "voltava" para invisivel. As outras cinco estao
    // em 0.02 a 0.10 e escapavam. Percorrer a timeline inteira agora, antes de a
    // intro existir, faz todos gravarem o estado natural.
    cena.progress(1, true).progress(0, true);

    // --- ENTRADA NO CARREGAMENTO (nada a ver com o scroll) ------------------
    //
    // Precisa ser criada DEPOIS da timeline da cena. Motivo: os tweens da cena
    // gravam o valor inicial quando renderizam pela primeira vez, e com scrub
    // isso acontece na criacao. Se a intro rodasse antes, eles gravariam o
    // estado "durante a intro" como se fosse o natural. Criada depois, a intro
    // sai de valores alterados e ATERRISSA no natural — que e exatamente o que a
    // cena registrou.
    var intro = gsap.timeline({ delay: 0.12, defaults: { ease: 'power3.out' } });

    // A montanha entra respirando: um respiro de escala que assenta. `etapa()`
    // so reescreve a transformacao quando ha scroll, e a intro morre no primeiro
    // scroll — entao as duas nunca disputam o mesmo frame.
    intro.from(camadas1, { scale: 1.06, duration: 2.4, ease: 'power2.out' }, 0);
    intro.from(spans, { autoAlpha: 0, yPercent: 26, duration: 1.3, stagger: 0.075 }, 0.2);
    if (txEsq) intro.from(txEsq, { autoAlpha: 0, x: -22, duration: 1.1 }, 0.6);
    if (txDir) intro.from(txDir, { autoAlpha: 0, x: 22, duration: 1.1 }, 0.72);
    if (dica) intro.from(dica, { autoAlpha: 0, y: 22, duration: 1.0 }, 0.95);

    // Se a pessoa rolar antes de a intro acabar, ela salta para o fim. Sem isso,
    // intro e cena escreveriam nas mesmas propriedades ao mesmo tempo.
    var matarIntro = function () { intro.progress(1); };
    window.addEventListener('scroll', matarIntro, { passive: true, once: true });
    // Diagnostico. O objeto so e montado no fim de `iniciar()`, depois daqui —
    // por isso a criacao defensiva em vez de um `if`.
    window.montisMotion = window.montisMotion || {};
    window.montisMotion.intro = intro;

    var seta = dica && dica.querySelector('svg');
    if (seta) {
      var pulo = gsap.to(seta, { y: 6, duration: 0.9, ease: 'sine.inOut', repeat: -1, yoyo: true });
      ScrollTrigger.create({
        trigger: hero, start: 'top bottom', end: 'bottom top',
        onToggle: function (self) { self.isActive ? pulo.play() : pulo.pause(); }
      });
    }
  }

  // --------------------------------------------------- profundidade / scrub
  function montarProfundidade() {
    var foto = document.querySelector('#foto-diego');
    if (foto) {
      // A escala abre a folga necessaria para o deslocamento nao mostrar borda
      // dentro do quadro (o container tem overflow:hidden).
      gsap.set(foto, { scale: 1.16 });
      gsap.fromTo(foto,
        { y: -26 },
        {
          y: 26, ease: 'none',
          scrollTrigger: {
            trigger: foto.closest('section') || foto,
            start: 'top bottom', end: 'bottom top', scrub: 0.8
          }
        }
      );
    }

    // O logo do header NAO e animado. Ele vive dentro de um header que ganha
    // backdrop-filter ao rolar; escalar qualquer coisa la dentro obriga o
    // navegador a refazer o desfoque do header a cada frame, justo durante o
    // scroll. Custo alto para um efeito que quase nao se via.

    // Anel de luz do CTA final: pausa fora de campo. E uma animacao infinita
    // sobre um pseudo-elemento com filter:blur, ou seja, repinta sem parar
    // mesmo com a secao longe da tela.
    var anel = document.querySelector('.rainbow-cta');
    if (anel) {
      anel.classList.add('fora-de-campo');
      ScrollTrigger.create({
        trigger: anel, start: 'top bottom', end: 'bottom top',
        onToggle: function (self) { anel.classList.toggle('fora-de-campo', !self.isActive); }
      });
    }
  }

  // -------------------------------------------- arrastar o leque de projetos
  //
  // O componente da pagina e dono da posicao dos cartoes: `layoutFan()` os
  // coloca a partir de `dataset.active`, e cada cartao tem um `onclick` que
  // chama `goTo(i)`. Escrever transform neles daqui seria disputar a caneta com
  // ele — foi por isso que os `.fan-card` ficaram de fora de todo o resto.
  //
  // Entao o arrasto faz duas coisas separadas:
  //   1. troca o cartao ativo pelo caminho do PROPRIO componente (um `click`
  //      programatico), deixando a transicao CSS dele animar a virada;
  //   2. desloca o PALCO — um transform so, num elemento que ninguem mais toca —
  //      para o leque acompanhar o dedo entre uma virada e outra.
  function montarArrastoDoLeque() {
    var palco = document.querySelector('#fan-stage');
    if (!palco) return;
    var cards = Array.prototype.slice.call(palco.querySelectorAll('.fan-card'));
    if (cards.length < 2) return;
    var N = cards.length;

    // A PRIMEIRA VERSAO TRAVAVA, e vale registrar por que: ela virava o cartao em
    // degraus, chamando o `goTo` do componente. Cada virada re-dispara a
    // transicao CSS de 0.65s em TODOS os cartoes; num arrasto continuo isso
    // reinicia sem parar e a transicao nunca termina, entao os cartoes ficam
    // eternamente correndo atras do dedo. E entre um limiar e outro so o palco
    // se mexia — quase nada. Dai a sensacao de emperrado seguido de pulo.
    //
    // Agora o indice e FRACIONARIO e o leque e redesenhado a cada quadro. A
    // transicao CSS sai de cena (classe `livre`) e o easing passa a ser do GSAP,
    // que da para interromper no meio. A conta abaixo e a mesma do `layoutFan()`
    // do componente, so que continua — nos indices inteiros as duas coincidem,
    // entao um resize (que faz o componente redesenhar) nao causa salto.
    palco.classList.add('livre');

    var idx = Number(palco.dataset.active || 1); // fracionario durante o gesto
    var w = 0, compacto = false, cw = 0, ch = 0, mostra = 3;

    function medir() {
      w = palco.clientWidth || 1000;
      compacto = w < 620;
      cw = compacto ? Math.min(300, w * 0.62) : Math.max(180, Math.min(300, w * 0.42));
      mostra = compacto ? 1 : 3;
      ch = cw * 4.4 / 3;
      // Largura so quando muda: escrever a cada quadro forcaria layout.
      cards.forEach(function (el) { if (el.style.width !== cw + 'px') el.style.width = cw + 'px'; });
    }

    function desenhar() {
      var geo = function (a) {
        var s = 0.9 - Math.min(Math.max(a - 1, 0), 2) * 0.035;
        var th = Math.min(a, 3) * 8.5 * Math.PI / 180;
        return {
          rot: ch * s * Math.sin(th) / 2,
          half: (cw * s * Math.cos(th) + ch * s * Math.sin(th)) / 2,
          steps: a <= 1 ? a : 1 + (a - 1) * 0.62
        };
      };
      var spread = cw * 0.62;
      for (var k = 0; k < N; k++) {
        var aa = Math.abs(k - idx);
        if (aa < 0.02 || aa > mostra) continue;
        var g = geo(aa);
        spread = Math.min(spread, Math.max(24, (w / 2 - g.half - g.rot - 8) / g.steps));
      }
      for (var i = 0; i < N; i++) {
        var el = cards[i];
        var d = i - idx, a = Math.abs(d), sign = d < 0 ? -1 : 1;
        var ac = Math.min(a, mostra);
        var dx = sign * spread * (ac <= 1 ? ac : 1 + (ac - 1) * 0.62);
        // Versoes continuas do que o componente faz por degrau: em a=0 dao
        // exatamente o estado "ativo", em a=1 o estado "vizinho".
        var esc = a <= 1 ? 1 - a * 0.1 : 0.9 - Math.min(a - 1, 2) * 0.035;
        var perto = Math.min(a, 1);
        var vis = Math.max(0, Math.min(1, (mostra + 0.6 - a) / 0.6));
        el.style.transform = 'translate(-50%,-50%) translateX(' + dx + 'px) translateY(' +
          (ac * 24) + 'px) rotate(' + (sign * ac * 8.5) + 'deg) scale(' + esc + ')';
        el.style.zIndex = String(Math.round(20 - a));
        el.style.opacity = String((1 - perto * 0.1) * vis);
        el.style.filter = perto < 0.002 ? 'none'
          : 'brightness(' + (1 - perto * 0.38) + ') saturate(' + (1 - perto * 0.2) + ')';
        el.style.boxShadow = perto < 0.5
          ? '0 34px 70px rgba(20,26,26,.34)' : '0 18px 44px rgba(20,26,26,.20)';
        el.style.pointerEvents = vis > 0.05 ? 'auto' : 'none';
        var slot = el.querySelector('.fan-slot');
        if (slot) slot.style.pointerEvents = a < 0.5 ? 'auto' : 'none';
      }
      // Mantem o componente em sintonia: o getter `active` dele le daqui.
      palco.dataset.active = String(Math.max(0, Math.min(N - 1, Math.round(idx))));
    }

    var animando = null;
    function irPara(alvo, dur) {
      alvo = Math.max(0, Math.min(N - 1, alvo));
      if (animando) animando.kill();
      animando = gsap.to({ v: idx }, {
        v: alvo, duration: dur == null ? 0.62 : dur, ease: 'power3.out',
        onUpdate: function () { idx = this.targets()[0].v; desenhar(); }
      });
    }

    // --- gesto
    var PASSO = 150;  // px de arrasto por cartao
    var LIMITE = 22;  // acima disso o gesto e arrasto, nao clique
    var arrastando = false, x0 = 0, base = 0, andou = 0, ultX = 0, ultT = 0, vel = 0;

    palco.addEventListener('pointerdown', function (e) {
      if (e.button) return;
      if (animando) animando.kill();
      arrastando = true; andou = 0; vel = 0;
      x0 = ultX = e.clientX; ultT = performance.now(); base = idx;
      palco.classList.add('arrastando');
      if (palco.setPointerCapture) { try { palco.setPointerCapture(e.pointerId); } catch (err) {} }
    });

    palco.addEventListener('pointermove', function (e) {
      if (!arrastando) return;
      var agora = performance.now();
      var dt = agora - ultT;
      if (dt > 0) vel = (e.clientX - ultX) / dt; // px por ms
      ultX = e.clientX; ultT = agora;

      var dx = e.clientX - x0;
      andou = Math.max(andou, Math.abs(dx));
      var bruto = base - dx / PASSO;
      // Elastico nas pontas: passa um pouco, mas puxa de volta ao soltar.
      if (bruto < 0) bruto *= 0.35;
      else if (bruto > N - 1) bruto = (N - 1) + (bruto - (N - 1)) * 0.35;
      idx = bruto;
      desenhar();
    });

    function soltar() {
      if (!arrastando) return;
      arrastando = false;
      palco.classList.remove('arrastando');
      // A velocidade entra na conta para um lance rapido passar de cartao mesmo
      // sem ter arrastado a distancia inteira.
      irPara(Math.round(idx - vel * 90 / PASSO), 0.62);
    }
    palco.addEventListener('pointerup', soltar);
    palco.addEventListener('pointercancel', soltar);

    // O clique tambem passa a ser nosso: deixar o `goTo` do componente agir aqui
    // devolveria o salto instantaneo, ja que a transicao CSS esta desligada.
    palco.addEventListener('click', function (e) {
      e.stopPropagation();
      if (andou > LIMITE) { e.preventDefault(); return; }
      var alvo = e.target.closest ? e.target.closest('.fan-card') : null;
      if (!alvo) return;
      var i = cards.indexOf(alvo);
      // Cartao que NAO esta na frente: o clique serve so para traze-lo. Se o
      // link agisse aqui, clicar num cartao do fundo mandaria a pessoa para
      // fora do site antes de ela ter visto o projeto de perto — e ela nem
      // saberia em que clicou, porque o cartao estava escurecido e girado.
      if (i !== Math.round(idx)) { e.preventDefault(); irPara(i); return; }
      // Ja na frente: nao faco nada, e o <a> que cobre o cartao abre o projeto
      // sozinho. Cartao sem link simplesmente nao reage, que e o certo para os
      // que ainda nao tem site publicado.
    }, true);

    palco.addEventListener('dragstart', function (e) { e.preventDefault(); });
    window.addEventListener('resize', function () { medir(); desenhar(); });

    medir();
    desenhar();
  }

  // ------------------------------------------------------ abas do cabecalho
  function montarAbas() {
    var nav = document.querySelector('#site-header nav.abas');
    if (!nav) return;
    var realce = nav.querySelector('.aba-realce');
    var ativa = nav.querySelector('.aba-ativa');
    var links = Array.prototype.slice.call(nav.querySelectorAll('a'));
    if (!realce || !ativa || !links.length) return;

    // offsetLeft e relativo ao ancestral posicionado — a propria nav, que e
    // position:relative. Por isso a medida ja vem no sistema certo.
    function medir(a) { return { left: a.offsetLeft, width: a.offsetWidth }; }

    links.forEach(function (a) {
      a.addEventListener('mouseenter', function () {
        var m = medir(a);
        gsap.to(realce, { left: m.left, width: m.width, opacity: 1, duration: 0.32, ease: 'power2.out' });
      });
    });
    nav.addEventListener('mouseleave', function () {
      gsap.to(realce, { opacity: 0, duration: 0.25, ease: 'power2.out' });
    });

    // O tracinho de baixo segue a secao que esta em tela.
    var atual = null;
    function marcar(a) {
      if (atual === a) return;
      atual = a;
      if (!a) { gsap.to(ativa, { opacity: 0, duration: 0.25, ease: 'power2.out' }); return; }
      var m = medir(a);
      gsap.to(ativa, { left: m.left, width: m.width, opacity: 1, duration: 0.36, ease: 'power2.out' });
    }
    // Qual aba marcar sai de uma conta direta, nao de um ScrollTrigger por
    // secao. Motivo: `limitCallbacks: true` (ligado la em cima por performance)
    // suprime callbacks em saltos grandes de rolagem — indo do fim da pagina
    // direto para o topo, o tracinho ficava preso na ultima aba visitada. Uma
    // conta simples nao tem esse buraco.
    //
    // As faixas ficam em cache e so sao remedidas no refresh, entao o scroll nao
    // paga nenhuma leitura de layout.
    var faixas = [];
    function medirFaixas() {
      faixas = [];
      links.forEach(function (a) {
        var sec = document.querySelector(a.getAttribute('href'));
        if (!sec) return;
        var topo = sec.getBoundingClientRect().top + window.scrollY;
        faixas.push({ a: a, topo: topo, base: topo + sec.offsetHeight });
      });
    }
    function atualizarAba() {
      var linha = window.scrollY + window.innerHeight * 0.45;
      var achou = null;
      for (var i = 0; i < faixas.length; i++) {
        if (linha >= faixas[i].topo && linha < faixas[i].base) { achou = faixas[i].a; break; }
      }
      marcar(achou); // null no hero: ali nenhuma aba corresponde ao que esta em tela
    }
    medirFaixas();
    atualizarAba();
    window.addEventListener('scroll', atualizarAba, { passive: true });
    ScrollTrigger.addEventListener('refresh', function () { medirFaixas(); atualizarAba(); });
  }

  // ------------------------------------------- inclinacao e brilho nos cards
  function montarTilt() {
    // Sem isso, em telas de toque o "hover" fica preso no ultimo cartao tocado.
    if (!window.matchMedia || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    var MAX = 8; // graus. Contido de proposito: ver a nota de custo abaixo.

    gsap.utils.toArray('.tilt').forEach(function (card) {
      var brilho = card.querySelector('.brilho');
      var caixa = null;
      gsap.set(card, { transformPerspective: 900 });

      // quickTo reaproveita um unico tween em vez de criar um novo a cada
      // mousemove — e a forma recomendada para valor guiado por cursor.
      var rx = gsap.quickTo(card, 'rotationX', { duration: 0.5, ease: 'power3' });
      var ry = gsap.quickTo(card, 'rotationY', { duration: 0.5, ease: 'power3' });
      var bx = brilho && gsap.quickTo(brilho, 'x', { duration: 0.45, ease: 'power3' });
      var by = brilho && gsap.quickTo(brilho, 'y', { duration: 0.45, ease: 'power3' });

      card.addEventListener('mouseenter', function () {
        // Mede uma vez na entrada. Ler getBoundingClientRect a cada mousemove
        // seria uma leitura de layout por quadro, sem necessidade.
        caixa = card.getBoundingClientRect();
        if (brilho) gsap.to(brilho, { opacity: 1, duration: 0.35, ease: 'power2.out' });
      });
      card.addEventListener('mousemove', function (e) {
        if (!caixa) caixa = card.getBoundingClientRect();
        var px = (e.clientX - caixa.left) / caixa.width;
        var py = (e.clientY - caixa.top) / caixa.height;
        ry((px - 0.5) * MAX);
        rx((0.5 - py) * MAX);
        if (bx) { bx(e.clientX - caixa.left); by(e.clientY - caixa.top); }
      });
      card.addEventListener('mouseleave', function () {
        caixa = null;
        rx(0); ry(0);
        if (brilho) gsap.to(brilho, { opacity: 0, duration: 0.4, ease: 'power2.out' });
      });
    });
  }

  // -------------------------------------------------------------- detalhes
  function montarDetalhes() {
    // Palco dos projetos: animo o CONTAINER, nunca os .fan-card — o script da
    // propria pagina escreve transform em cada card para montar o leque, e as
    // duas escritas se anulariam.
    var palco = document.querySelector('#fan-stage');
    if (palco) {
      gsap.from(palco, {
        autoAlpha: 0, y: 60, duration: 1.1,
        scrollTrigger: { trigger: palco, start: 'top 85%', once: true }
      });
    }

    // Cartoes de servico e etapas do processo ganham um respiro extra no hover
    // que o CSS sozinho nao dava (o CSS ja cuida do card; aqui e so o icone).
    gsap.utils.toArray('#servicos svg').forEach(function (icone) {
      var pai = icone.closest('div');
      if (!pai) return;
      pai.addEventListener('mouseenter', function () {
        gsap.to(icone, { scale: 1.15, rotate: -4, duration: 0.4, ease: 'back.out(2)' });
      });
      pai.addEventListener('mouseleave', function () {
        gsap.to(icone, { scale: 1, rotate: 0, duration: 0.4, ease: 'power2.out' });
      });
    });
  }

  esperarDom();
})();
