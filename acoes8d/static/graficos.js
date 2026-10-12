// Gráficos SVG sem bibliotecas externas (mesmo padrão do Dashboard do
// Gerenciador: funciona na rede da empresa sem acesso à internet).
// Regras visuais: barras finas com ponta arredondada (4px) só no lado livre,
// 2px de espaço entre segmentos, rótulos de valor seletivos, tooltip no hover,
// legenda sempre que houver 2+ séries. Texto nunca usa a cor da série.
const A8Graficos = (() => {
  const SVGNS = "http://www.w3.org/2000/svg";

  // Paleta validada (skill dataviz). Status são reservados para situação.
  const COR = {
    // Identidade Wetzel: vermelho, preto e cinzas (sem azul). Verde e amarelo
    // só como status (concluída / vence em breve), como o farol G/Y do A3.
    azul: "#5f5f5f", // série neutra ("no prazo", "abertas"): cinza-escuro Wetzel
    laranja: "#d7261e", // segunda série: vermelho Wetzel
    bom: "#0ca30c", // status: concluída
    alerta: "#fab219", // status: vence em breve
    critico: "#b3261e", // status: atrasada
    azulRampa: ["#d4d4d4", "#b0b0b0", "#8c8c8c", "#666666", "#404040", "#1a1a1a"], // sequencial (cinza claro → preto)
  };

  function el(tag, atributos = {}) {
    const node = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(atributos)) if (v !== undefined && v !== null) node.setAttribute(k, v);
    return node;
  }

  function texto(x, y, conteudo, atributos = {}) {
    const { classe, ...outros } = atributos;
    const node = el("text", { x, y, ...outros });
    if (classe) node.setAttribute("class", classe);
    node.textContent = conteudo;
    return node;
  }

  // --- Tooltip ---------------------------------------------------------------
  let tooltip = null;
  function mostrarTooltip(evento, titulo, linhas) {
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "dash-tooltip";
      document.body.appendChild(tooltip);
    }
    tooltip.innerHTML = "";
    const t = document.createElement("strong");
    t.textContent = titulo;
    tooltip.appendChild(t);
    linhas.forEach(([cor, rotulo]) => {
      const linha = document.createElement("div");
      linha.className = "a8-tooltip-linha";
      if (cor) {
        const marca = document.createElement("span");
        marca.className = "a8-tooltip-marca";
        marca.style.background = cor;
        linha.appendChild(marca);
      }
      linha.appendChild(document.createTextNode(rotulo));
      tooltip.appendChild(linha);
    });
    tooltip.hidden = false;
    moverTooltip(evento);
  }
  function moverTooltip(evento) {
    if (!tooltip) return;
    const margem = 14;
    const largura = tooltip.offsetWidth || 220;
    const altura = tooltip.offsetHeight || 60;
    let x = evento.clientX + margem;
    let y = evento.clientY + margem;
    if (x + largura > window.innerWidth) x = evento.clientX - largura - margem;
    if (y + altura > window.innerHeight) y = evento.clientY - altura - margem;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }
  function esconderTooltip() {
    if (tooltip) tooltip.hidden = true;
  }

  function ligarHover(alvo, titulo, linhas, aoClicar) {
    alvo.addEventListener("mouseenter", (e) => mostrarTooltip(e, titulo, linhas));
    alvo.addEventListener("mousemove", moverTooltip);
    alvo.addEventListener("mouseleave", esconderTooltip);
    if (aoClicar) {
      alvo.style.cursor = "pointer";
      alvo.setAttribute("tabindex", "0");
      alvo.setAttribute("role", "button");
      alvo.setAttribute("aria-label", `${titulo}: ${linhas.map((l) => l[1]).join(", ")}`);
      alvo.addEventListener("click", () => { esconderTooltip(); aoClicar(); });
      alvo.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aoClicar(); } });
    }
  }

  function vazio(container, mensagem = "Sem dados para os filtros selecionados.") {
    container.innerHTML = "";
    const div = document.createElement("div");
    div.className = "dash-chart-vazio";
    div.textContent = mensagem;
    container.appendChild(div);
  }

  function legenda(container, series) {
    const caixa = document.createElement("div");
    caixa.className = "a8-legenda";
    series.forEach((s) => {
      const item = document.createElement("span");
      item.className = "a8-legenda-item";
      const marca = document.createElement("span");
      marca.className = "a8-legenda-marca";
      marca.style.background = s.cor;
      item.append(marca, document.createTextNode(s.rotulo));
      caixa.appendChild(item);
    });
    container.appendChild(caixa);
  }

  // Retângulo com cantos arredondados só de um lado (o lado livre da barra).
  function caminhoBarra(x, y, w, h, r, lado) {
    if (w <= 0 || h <= 0) return "";
    if (lado === "direita") {
      r = Math.min(r, w, h / 2);
      return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x} Z`;
    }
    if (lado === "topo") {
      r = Math.min(r, h, w / 2);
      return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
    }
    return `M${x},${y} h${w} v${h} h${-w} Z`;
  }

  // --- Barras horizontais empilhadas -------------------------------------------
  // itens: [{rotulo, <serie.chave>: n}], series: [{chave, rotulo, cor}]
  function barrasEmpilhadas(container, itens, series, { aoClicar, maxItens = 12, rotulosDentro = false } = {}) {
    itens = itens.filter((i) => series.some((s) => i[s.chave] > 0));
    if (!itens.length) return vazio(container);
    const outros = itens.slice(maxItens);
    itens = itens.slice(0, maxItens);
    if (outros.length) {
      const agregado = { rotulo: `Outros (${outros.length})`, outros: true };
      series.forEach((s) => (agregado[s.chave] = outros.reduce((t, i) => t + (i[s.chave] || 0), 0)));
      itens.push(agregado);
    }

    container.innerHTML = "";
    legenda(container, series);
    const largura = container.clientWidth || 480;
    const alturaBarra = rotulosDentro ? 22 : 18;
    const passo = rotulosDentro ? 32 : 30;
    const colunaRotulo = Math.min(170, Math.max(90, largura * 0.3));
    const margemDireita = 40;
    const altura = itens.length * passo + 8;
    const areaUtil = Math.max(largura - colunaRotulo - margemDireita, 40);
    const totais = itens.map((i) => series.reduce((t, s) => t + (i[s.chave] || 0), 0));
    const maximo = Math.max(...totais, 1);

    const svg = el("svg", { class: "dash-svg", viewBox: `0 0 ${largura} ${altura}`, width: "100%", height: altura, role: "img" });
    svg.appendChild(el("line", { class: "dash-eixo", x1: colunaRotulo, x2: colunaRotulo, y1: 0, y2: altura }));

    itens.forEach((item, i) => {
      const y = 6 + i * passo;
      const rotulo = item.rotulo.length > 24 ? `${item.rotulo.slice(0, 23)}…` : item.rotulo;
      svg.appendChild(texto(colunaRotulo - 8, y + alturaBarra / 2 + 4, rotulo, { "text-anchor": "end" }));
      const grupo = el("g", { class: "dash-mark" });
      let x = colunaRotulo;
      const visiveis = series.filter((s) => item[s.chave] > 0);
      visiveis.forEach((s, j) => {
        const w = (item[s.chave] / maximo) * areaUtil;
        const ultimo = j === visiveis.length - 1;
        const larguraDesenho = ultimo ? w : Math.max(w - 2, 1); // 2px de espaço entre segmentos
        grupo.appendChild(el("path", { d: caminhoBarra(x, y, larguraDesenho, alturaBarra, 4, ultimo ? "direita" : null), fill: s.cor }));
        // Número dentro da parte da barra (só quando cabe).
        if (rotulosDentro && larguraDesenho >= 16) {
          grupo.appendChild(texto(x + larguraDesenho / 2, y + alturaBarra / 2 + 4, String(item[s.chave]),
            { "text-anchor": "middle", classe: "a8-rotulo-dentro" }));
        }
        x += w;
      });
      // Área de clique maior que a barra.
      grupo.appendChild(el("rect", { x: 0, y: y - 5, width: largura, height: passo, fill: "transparent" }));
      svg.appendChild(grupo);
      svg.appendChild(texto(x + 6, y + alturaBarra / 2 + 4, String(totais[i]), { classe: "dash-valor-rotulo" }));
      ligarHover(grupo, item.rotulo, [
        ...series.map((s) => [s.cor, `${s.rotulo}: ${item[s.chave] || 0}`]),
        [null, `Total: ${totais[i]}`],
      ], aoClicar && !item.outros ? () => aoClicar(item) : null);
    });
    container.appendChild(svg);
  }

  // --- Colunas verticais (1 série, cor por item) ------------------------------
  // itens: [{rotulo, valor, cor}]
  function colunas(container, itens, { aoClicar, sufixo = "" } = {}) {
    if (!itens.some((i) => i.valor > 0)) return vazio(container);
    container.innerHTML = "";
    const largura = container.clientWidth || 480;
    const altura = 230;
    const topo = 22;
    const base = 44;
    const margem = 8;
    const areaAltura = altura - topo - base;
    const passo = (largura - 2 * margem) / itens.length;
    const larguraColuna = Math.min(56, passo * 0.62);
    const maximo = Math.max(...itens.map((i) => i.valor), 1);

    const svg = el("svg", { class: "dash-svg", viewBox: `0 0 ${largura} ${altura}`, width: "100%", height: altura, role: "img" });
    svg.appendChild(el("line", { class: "dash-eixo", x1: margem, x2: largura - margem, y1: altura - base, y2: altura - base }));
    itens.forEach((item, i) => {
      const centro = margem + passo * i + passo / 2;
      const h = (item.valor / maximo) * areaAltura;
      const y = altura - base - h;
      const grupo = el("g", { class: "dash-mark" });
      grupo.appendChild(el("path", { d: caminhoBarra(centro - larguraColuna / 2, y, larguraColuna, h, 4, "topo"), fill: item.cor }));
      grupo.appendChild(el("rect", { x: centro - passo / 2, y: topo - 10, width: passo, height: areaAltura + 10, fill: "transparent" }));
      svg.appendChild(grupo);
      svg.appendChild(texto(centro, y - 6, String(item.valor), { "text-anchor": "middle", classe: "dash-valor-rotulo" }));
      // Rótulo do eixo em até 2 linhas.
      const palavras = item.rotulo.split(" ");
      const meio = Math.ceil(palavras.length / 2);
      const linhas = palavras.length > 2 ? [palavras.slice(0, meio).join(" "), palavras.slice(meio).join(" ")] : [item.rotulo];
      linhas.forEach((l, k) => svg.appendChild(texto(centro, altura - base + 16 + k * 13, l, { "text-anchor": "middle" })));
      ligarHover(grupo, item.rotulo, [[item.cor, `${item.valor}${sufixo}`]], aoClicar && item.valor ? () => aoClicar(item) : null);
    });
    container.appendChild(svg);
  }

  // --- Colunas agrupadas (série temporal curta) ----------------------------------
  // pontos: [{rotulo, <serie.chave>: n}], series: [{chave, rotulo, cor}]
  function colunasAgrupadas(container, pontos, series) {
    if (!pontos.some((p) => series.some((s) => p[s.chave] > 0))) return vazio(container, "Sem movimentação nos últimos 12 meses.");
    container.innerHTML = "";
    legenda(container, series);
    const largura = container.clientWidth || 640;
    const altura = 240;
    const topo = 26;
    const base = 28;
    const esquerda = 30;
    const areaAltura = altura - topo - base;
    const passo = (largura - esquerda - 8) / pontos.length;
    const larguraColuna = Math.min(18, (passo * 0.7) / series.length);
    const maximo = Math.max(...pontos.flatMap((p) => series.map((s) => p[s.chave])), 1);
    const svg = el("svg", { class: "dash-svg", viewBox: `0 0 ${largura} ${altura}`, width: "100%", height: altura, role: "img" });

    // Grade recessiva: 0, metade, máximo.
    [0, 0.5, 1].forEach((f) => {
      const y = altura - base - f * areaAltura;
      svg.appendChild(el("line", { class: "dash-eixo", x1: esquerda, x2: largura - 8, y1: y, y2: y, "stroke-dasharray": f ? "2 4" : null }));
      svg.appendChild(texto(esquerda - 6, y + 4, String(Math.round(f * maximo)), { "text-anchor": "end" }));
    });

    pontos.forEach((p, i) => {
      const centro = esquerda + passo * i + passo / 2;
      const inicio = centro - (larguraColuna * series.length + 2 * (series.length - 1)) / 2;
      const grupo = el("g", { class: "dash-mark" });
      series.forEach((s, j) => {
        const h = (p[s.chave] / maximo) * areaAltura;
        const x = inicio + j * (larguraColuna + 2);
        grupo.appendChild(el("path", { d: caminhoBarra(x, altura - base - h, larguraColuna, h, 3, "topo"), fill: s.cor }));
        // Rótulo com a quantidade em cima de cada coluna (colunas zeradas não têm rótulo).
        if (p[s.chave] > 0) {
          svg.appendChild(texto(x + larguraColuna / 2, altura - base - h - 5, String(p[s.chave]),
            { "text-anchor": "middle", classe: "dash-valor-rotulo" }));
        }
      });
      grupo.appendChild(el("rect", { x: centro - passo / 2, y: topo, width: passo, height: areaAltura, fill: "transparent" }));
      svg.appendChild(grupo);
      svg.appendChild(texto(centro, altura - base + 16, p.rotulo, { "text-anchor": "middle" }));
      ligarHover(grupo, p.rotuloLongo || p.rotulo, series.map((s) => [s.cor, `${s.rotulo}: ${p[s.chave]}`]));
    });
    container.appendChild(svg);
  }

  // --- Rosca (parte de um todo, até 4 fatias) --------------------------------------
  // itens: [{rotulo, valor, cor}]
  function rosca(container, itens, { aoClicar, rotuloCentro = "ações" } = {}) {
    const total = itens.reduce((t, i) => t + i.valor, 0);
    if (!total) return vazio(container);
    container.innerHTML = "";
    const tamanho = 190;
    const raio = 84;
    const espessura = 26;
    const c = tamanho / 2;
    const wrap = document.createElement("div");
    wrap.className = "a8-rosca";
    const svg = el("svg", { class: "dash-svg", viewBox: `0 0 ${tamanho} ${tamanho}`, width: tamanho, height: tamanho, role: "img" });
    let angulo = -Math.PI / 2;
    const fatias = itens.filter((i) => i.valor > 0);
    fatias.forEach((item) => {
      const fracao = item.valor / total;
      const fim = angulo + fracao * 2 * Math.PI;
      const grupo = el("g", { class: "dash-mark" });
      if (fatias.length === 1) {
        grupo.appendChild(el("circle", { cx: c, cy: c, r: raio - espessura / 2, fill: "none", stroke: item.cor, "stroke-width": espessura }));
      } else {
        const folga = 1 / raio; // ~2px de espaço entre fatias
        const a0 = angulo + folga;
        const a1 = Math.max(fim - folga, a0 + 0.001);
        const ri = raio - espessura;
        const grande = a1 - a0 > Math.PI ? 1 : 0;
        const p = (r, a) => `${c + r * Math.cos(a)},${c + r * Math.sin(a)}`;
        grupo.appendChild(el("path", {
          d: `M${p(raio, a0)} A${raio},${raio} 0 ${grande} 1 ${p(raio, a1)} L${p(ri, a1)} A${ri},${ri} 0 ${grande} 0 ${p(ri, a0)} Z`,
          fill: item.cor,
        }));
      }
      svg.appendChild(grupo);
      ligarHover(grupo, item.rotulo, [[item.cor, `${item.valor} (${Math.round((100 * item.valor) / total)}%)`]],
        aoClicar ? () => aoClicar(item) : null);
      angulo = fim;
    });
    svg.appendChild(texto(c, c + 2, String(total), { "text-anchor": "middle", classe: "a8-rosca-total" }));
    svg.appendChild(texto(c, c + 20, rotuloCentro, { "text-anchor": "middle" }));
    wrap.appendChild(svg);

    const lista = document.createElement("ul");
    lista.className = "a8-rosca-legenda";
    itens.forEach((item) => {
      const li = document.createElement("li");
      const marca = document.createElement("span");
      marca.className = "a8-legenda-marca";
      marca.style.background = item.cor;
      const nome = document.createElement("span");
      nome.textContent = item.rotulo;
      const valor = document.createElement("strong");
      valor.textContent = `${item.valor} · ${Math.round((100 * item.valor) / total)}%`;
      li.append(marca, nome, valor);
      if (aoClicar && item.valor) {
        li.classList.add("linha-clicavel");
        li.addEventListener("click", () => aoClicar(item));
      }
      lista.appendChild(li);
    });
    wrap.appendChild(lista);
    container.appendChild(wrap);
  }

  // --- Linhas com área (série temporal) -----------------------------------------------
  // pontos: [{rotulo, rotuloLongo, <serie.chave>: n}], series: [{chave, rotulo, cor, opacidadeArea}]
  // Curvas suaves, área preenchida com degradê transparente, bolinhas e valor em
  // cada ponto, guia vertical do mês ao passar o mouse.
  let contadorGradiente = 0;
  function linhasArea(container, pontos, series) {
    if (!pontos.some((p) => series.some((s) => p[s.chave] > 0))) return vazio(container, "Sem movimentação nos últimos 12 meses.");
    container.innerHTML = "";
    legenda(container, series);
    const largura = container.clientWidth || 640;
    const altura = 260;
    const topo = 28;
    const base = 30;
    const esquerda = 34;
    const direita = 16;
    const areaAltura = altura - topo - base;
    const passo = (largura - esquerda - direita) / Math.max(pontos.length - 1, 1);
    const maximo = Math.max(...pontos.flatMap((p) => series.map((s) => p[s.chave] || 0)), 1);
    const teto = Math.ceil((maximo * 1.15) / 4) * 4 || 4; // folga em cima; múltiplo de 4 = grade com números inteiros
    const x = (i) => esquerda + passo * i;
    const y = (v) => altura - base - (v / teto) * areaAltura;
    const svg = el("svg", { class: "dash-svg a8-linhas", viewBox: `0 0 ${largura} ${altura}`, width: "100%", height: altura, role: "img" });

    // Grade recessiva.
    const defs = el("defs");
    svg.appendChild(defs);
    [0, 0.25, 0.5, 0.75, 1].forEach((f) => {
      const yy = altura - base - f * areaAltura;
      svg.appendChild(el("line", { class: "dash-eixo", x1: esquerda, x2: largura - direita, y1: yy, y2: yy, "stroke-dasharray": f ? "2 5" : null }));
      svg.appendChild(texto(esquerda - 8, yy + 4, String(Math.round(f * teto)), { "text-anchor": "end" }));
    });
    pontos.forEach((p, i) => svg.appendChild(texto(x(i), altura - base + 18, p.rotulo, { "text-anchor": "middle" })));

    // Curva suave (Catmull-Rom -> Bézier), sem passar abaixo de zero.
    const curva = (coords) => coords.reduce((d, [px, py], i) => {
      if (!i) return `M${px},${py}`;
      const [x0, y0] = coords[Math.max(i - 2, 0)], [x1, y1] = coords[i - 1], [x3, y3] = coords[Math.min(i + 1, coords.length - 1)];
      const t = 0.18;
      const c1 = [x1 + (px - x0) * t, Math.min(y1 + (py - y0) * t, altura - base)];
      const c2 = [px - (x3 - x1) * t, Math.min(py - (y3 - y1) * t, altura - base)];
      return `${d} C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${px.toFixed(1)},${py.toFixed(1)}`;
    }, "");

    const camadaPontos = el("g");
    series.forEach((s, indiceSerie) => {
      const id = `a8-grad-${++contadorGradiente}`;
      const grad = el("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 });
      grad.appendChild(el("stop", { offset: "0%", "stop-color": s.cor, "stop-opacity": s.opacidadeArea ?? 0.35 }));
      grad.appendChild(el("stop", { offset: "100%", "stop-color": s.cor, "stop-opacity": 0.02 }));
      defs.appendChild(grad);
      const coords = pontos.map((p, i) => [x(i), y(p[s.chave] || 0)]);
      const linha = curva(coords);
      svg.appendChild(el("path", { d: `${linha} L${x(pontos.length - 1)},${altura - base} L${x(0)},${altura - base} Z`, fill: `url(#${id})` }));
      svg.appendChild(el("path", { d: linha, fill: "none", stroke: s.cor, "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-opacity": s.opacidadeLinha ?? 1 }));
      coords.forEach(([px, py], i) => {
        const valor = pontos[i][s.chave] || 0;
        camadaPontos.appendChild(el("circle", { cx: px, cy: py, r: 4.5, fill: "#fff", stroke: s.cor, "stroke-width": 2.5 }));
        if (valor > 0) {
          // Pontos muito próximos: o rótulo do valor menor vai para baixo do ponto.
          const outros = series.filter((_, k) => k !== indiceSerie).map((o) => pontos[i][o.chave] || 0);
          const embaixo = outros.some((v) => Math.abs(y(v) - py) < 18 && (v > valor || (v === valor && indiceSerie > 0)));
          camadaPontos.appendChild(texto(px, embaixo ? py + 19 : py - 10, String(valor), { "text-anchor": "middle", classe: "dash-valor-rotulo" }));
        }
      });
    });
    svg.appendChild(camadaPontos);

    // Guia vertical + tooltip por mês.
    const guia = el("line", { class: "a8-linhas-guia", x1: 0, x2: 0, y1: topo - 10, y2: altura - base, visibility: "hidden" });
    svg.appendChild(guia);
    pontos.forEach((p, i) => {
      const alvo = el("rect", { x: x(i) - passo / 2, y: topo - 10, width: passo, height: areaAltura + 10, fill: "transparent" });
      alvo.addEventListener("mouseenter", () => { guia.setAttribute("x1", x(i)); guia.setAttribute("x2", x(i)); guia.setAttribute("visibility", "visible"); });
      alvo.addEventListener("mouseleave", () => guia.setAttribute("visibility", "hidden"));
      ligarHover(alvo, p.rotuloLongo || p.rotulo, series.map((s) => [s.cor, `${s.rotulo}: ${p[s.chave] || 0}`]));
      svg.appendChild(alvo);
    });
    container.appendChild(svg);
  }

  // --- Velocímetro (meio círculo com faixas coloridas e ponteiro) -----------------------
  // faixas: [[limiteSuperior|null, cor], ...] em ordem crescente; valor no mesmo eixo.
  function velocimetro(container, { valor, faixas, unidade = "dias", legenda = "", rodape = [] }) {
    container.innerHTML = "";
    if (valor === null || valor === undefined) return vazio(container, "Ainda não há A3 fechados para calcular a média.");
    const limites = faixas.map(([l]) => l).filter((l) => l !== null);
    const ultimo = limites[limites.length - 1];
    const maximo = Math.max(Math.ceil((ultimo * 1.5) / 10) * 10, Math.ceil((valor * 1.1) / 10) * 10);
    const largura = 360, altura = 230, cx = largura / 2, cy = 190, raio = 150, espessura = 46;
    const angulo = (v) => Math.PI + (Math.min(Math.max(v, 0), maximo) / maximo) * Math.PI; // 180° (esq.) -> 360° (dir.)
    const ponto = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const svg = el("svg", { class: "dash-svg a8-velocimetro", viewBox: `0 0 ${largura} ${altura}`, width: "100%", role: "img",
      "aria-label": `${legenda}: ${valor} ${unidade}` });
    let inicio = 0;
    faixas.forEach(([limite, cor], i) => {
      const fim = limite === null ? maximo : limite;
      const folga = 0.012; // espaço branco entre as faixas, como no modelo
      const a0 = angulo(inicio) + (i ? folga : 0), a1 = angulo(fim) - (i < faixas.length - 1 ? folga : 0);
      const [x0, y0] = ponto(raio, a0), [x1, y1] = ponto(raio, a1);
      const [x2, y2] = ponto(raio - espessura, a1), [x3, y3] = ponto(raio - espessura, a0);
      const grande = a1 - a0 > Math.PI ? 1 : 0;
      const faixa = el("path", {
        d: `M${x0},${y0} A${raio},${raio} 0 ${grande} 1 ${x1},${y1} L${x2},${y2} A${raio - espessura},${raio - espessura} 0 ${grande} 0 ${x3},${y3} Z`,
        fill: cor,
      });
      svg.appendChild(faixa);
      ligarHover(faixa, limite === null ? `Acima de ${inicio} ${unidade}` : `${inicio ? inicio + 1 : 0} a ${limite} ${unidade}`, []);
      inicio = fim;
    });
    // marcas dos limites
    [0, ...limites, maximo].forEach((v) => {
      const [x, y] = ponto(raio + 14, angulo(v));
      svg.appendChild(texto(x, y + 4, String(v), { "text-anchor": "middle", classe: "a8-velocimetro-marca" }));
    });
    // ponteiro
    const a = angulo(valor);
    const [px, py] = ponto(raio - 12, a);
    const [b1x, b1y] = ponto(9, a + Math.PI / 2), [b2x, b2y] = ponto(9, a - Math.PI / 2);
    svg.appendChild(el("path", { class: "a8-velocimetro-ponteiro", d: `M${b1x},${b1y} L${px},${py} L${b2x},${b2y} Z`, fill: "#1a1a1a" }));
    svg.appendChild(el("circle", { cx, cy, r: 14, fill: "#1a1a1a" }));
    container.appendChild(svg);
    const resumo = document.createElement("div");
    resumo.className = "a8-velocimetro-resumo";
    const numero = document.createElement("strong");
    numero.textContent = `${String(valor).replace(".", ",")} ${unidade}`;
    const sub = document.createElement("span");
    sub.textContent = legenda;
    resumo.append(numero, sub);
    container.appendChild(resumo);
    if (rodape.length) {
      const info = document.createElement("div");
      info.className = "a8-velocimetro-rodape";
      rodape.forEach((t) => { const s = document.createElement("span"); s.textContent = t; info.appendChild(s); });
      container.appendChild(info);
    }
  }

  // --- Barras horizontais de percentual (uma por item, ordem decrescente) ----------------
  // itens: [{rotulo, valor, detalhes}]; totalGeral = base dos %. Clique seleciona a barra.
  function barrasPercentuais(container, itens, { aoClicar, selecionado = null, totalGeral = null } = {}) {
    const total = totalGeral || itens.reduce((t, i) => t + i.valor, 0);
    if (!total) return vazio(container);
    container.innerHTML = "";
    const ordem = itens.map((item, i) => ({ item, i })).sort((a, b) => (a.item.ultimo ? 1 : 0) - (b.item.ultimo ? 1 : 0)
      || b.item.valor - a.item.valor || a.item.rotulo.localeCompare(b.item.rotulo, "pt-BR"));
    const largura = container.clientWidth || 480;
    const alturaBarra = 22, passo = 32;
    const colunaRotulo = Math.min(140, Math.max(90, largura * 0.22));
    const colunaValor = 92;
    const area = Math.max(largura - colunaRotulo - colunaValor, 40);
    const maximo = Math.max(...itens.map((i) => i.valor), 1);
    const altura = ordem.length * passo + 6;
    const svg = el("svg", { class: "dash-svg a8-barras-pct", viewBox: `0 0 ${largura} ${altura}`, width: "100%", height: altura, role: "img" });
    svg.appendChild(el("line", { class: "dash-eixo", x1: colunaRotulo, x2: colunaRotulo, y1: 0, y2: altura }));
    const grupos = [];
    ordem.forEach(({ item, i }, linha) => {
      const y = 4 + linha * passo;
      const pct = (item.valor / total) * 100;
      const w = item.valor ? Math.max((item.valor / maximo) * area, 3) : 0;
      svg.appendChild(texto(colunaRotulo - 8, y + alturaBarra / 2 + 4, item.rotulo, { "text-anchor": "end" }));
      const grupo = el("g", { class: "dash-mark a8-barra-pct" });
      grupo.appendChild(el("rect", { x: colunaRotulo, y, width: area, height: alturaBarra, rx: 4, class: "a8-barra-pct-fundo" }));
      if (w) grupo.appendChild(el("path", { d: caminhoBarra(colunaRotulo, y, w, alturaBarra, 4, "direita"), class: "a8-barra-pct-valor",
        style: item.cor ? `fill:${item.cor}` : null }));
      grupo.appendChild(el("rect", { x: 0, y: y - 5, width: largura, height: passo, fill: "transparent" }));
      svg.appendChild(grupo);
      const pctTexto = `${pct.toLocaleString("pt-BR", { maximumFractionDigits: pct < 10 && pct > 0 ? 1 : 0 })}%`;
      svg.appendChild(texto(colunaRotulo + area + 8, y + alturaBarra / 2 + 4, pctTexto, { classe: "dash-valor-rotulo a8-barra-pct-num" }));
      svg.appendChild(texto(colunaRotulo + area + 50, y + alturaBarra / 2 + 4, `(${item.valor})`, { classe: "a8-barra-pct-qtd" }));
      grupos[i] = grupo;
      ligarHover(grupo, item.rotulo, [[null, `${item.valor} de ${total} ações · ${pctTexto}`], ...(item.detalhes || [])],
        aoClicar && item.valor ? () => aoClicar(item, i) : null);
    });
    container.appendChild(svg);
    const marcar = (indice) => grupos.forEach((g, k) => {
      if (!g) return;
      g.classList.toggle("selecionado", k === indice);
      g.classList.toggle("apagado", indice !== null && k !== indice);
    });
    marcar(selecionado);
    return { marcar };
  }

  // --- Colunas verticais empilhadas (várias séries na mesma coluna) -------------------------
  // itens: [{rotulo, <serie.chave>: n}], series: [{chave, rotulo, cor}]. Número dentro de cada
  // parte (quando cabe) e o total em cima da coluna.
  function colunasEmpilhadas(container, itens, series, { aoClicar } = {}) {
    if (!itens.some((i) => series.some((s) => i[s.chave] > 0))) return vazio(container);
    container.innerHTML = "";
    legenda(container, series);
    const largura = container.clientWidth || 480;
    const altura = 240, topo = 24, base = 30, margem = 8;
    const areaAltura = altura - topo - base;
    const passo = (largura - 2 * margem) / itens.length;
    const larguraColuna = Math.min(70, passo * 0.5);
    const totais = itens.map((i) => series.reduce((t, s) => t + (i[s.chave] || 0), 0));
    const maximo = Math.max(...totais, 1);
    const svg = el("svg", { class: "dash-svg", viewBox: `0 0 ${largura} ${altura}`, width: "100%", height: altura, role: "img" });
    svg.appendChild(el("line", { class: "dash-eixo", x1: margem, x2: largura - margem, y1: altura - base, y2: altura - base }));
    itens.forEach((item, i) => {
      const centro = margem + passo * i + passo / 2;
      const x = centro - larguraColuna / 2;
      const grupo = el("g", { class: "dash-mark" });
      let y = altura - base;
      const visiveis = series.filter((s) => item[s.chave] > 0);
      visiveis.forEach((s, j) => {
        const h = (item[s.chave] / maximo) * areaAltura;
        const ultimo = j === visiveis.length - 1;
        const hDesenho = ultimo ? h : Math.max(h - 2, 1); // 2px de espaço entre as partes
        y -= h;
        grupo.appendChild(el("path", { d: caminhoBarra(x, y + (h - hDesenho), larguraColuna, hDesenho, 4, ultimo ? "topo" : null), fill: s.cor }));
        if (hDesenho >= 16) {
          grupo.appendChild(texto(centro, y + (h - hDesenho) + hDesenho / 2 + 4, String(item[s.chave]), { "text-anchor": "middle", classe: "a8-rotulo-dentro" }));
        }
      });
      grupo.appendChild(el("rect", { x: centro - passo / 2, y: topo - 10, width: passo, height: areaAltura + 10, fill: "transparent" }));
      svg.appendChild(grupo);
      svg.appendChild(texto(centro, y - 6, String(totais[i]), { "text-anchor": "middle", classe: "dash-valor-rotulo" }));
      svg.appendChild(texto(centro, altura - base + 16, item.rotulo, { "text-anchor": "middle" }));
      ligarHover(grupo, item.rotulo, [...series.map((s) => [s.cor, `${s.rotulo}: ${item[s.chave] || 0}`]), [null, `Total: ${totais[i]}`]],
        aoClicar && totais[i] ? () => aoClicar(item) : null);
    });
    container.appendChild(svg);
  }

  return { COR, barrasEmpilhadas, colunas, colunasAgrupadas, colunasEmpilhadas, linhasArea, rosca, velocimetro, barrasPercentuais, vazio };
})();
