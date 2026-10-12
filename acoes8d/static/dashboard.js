(() => {
  const { api, criar, fmtData } = A8;
  const G = A8Graficos;
  const COR = G.COR;
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  // Filtros (combinados com E). Ordem = ordem das etiquetas de filtros ativos.
  const filtros = {
    analista: document.getElementById("a8-d-analista"),
    cliente: document.getElementById("a8-d-cliente"),
    peca: document.getElementById("a8-d-peca"),
    de: document.getElementById("a8-d-de"),
    ate: document.getElementById("a8-d-ate"),
  };
  const ROTULOS_FILTRO = {
    analista: "Analista", cliente: "Cliente", peca: "Peça", de: "De", ate: "Até",
  };
  // Filtros vindos na URL (ex.: link compartilhado ou botão Voltar).
  const daUrl = new URLSearchParams(location.search);
  const valoresIniciais = Object.fromEntries(Object.keys(filtros).map((k) => [k, daUrl.get(k) || ""]));
  filtros.de.value = valoresIniciais.de;
  filtros.ate.value = valoresIniciais.ate;
  const SERIES_SITUACAO = [
    { chave: "atrasada", rotulo: "Atrasadas", cor: COR.critico },
    { chave: "no_prazo", rotulo: "No prazo", cor: COR.azul },
  ];
  const COR_FAIXA_PRAZO = {
    atrasada_30: COR.critico, atrasada_8_30: COR.critico, atrasada_1_7: COR.critico,
    vence_0_7: COR.alerta, vence_8_30: COR.azul, vence_30: COR.azul,
  };

  let ultimo = null;
  let modelo = null;
  const desenharAnalistas = A8.botoesDoSelect(filtros.analista, document.getElementById("a8-d-analista-botoes"));

  // Vai para o Controle de Ações já filtrado (filtros do dashboard + o clicado).
  // Formulário A3 com o cliente/ID da Visão Geral (+ status do card clicado).
  function irParaAnalises(extra = {}) {
    const p = new URLSearchParams();
    for (const chave of ["analista", "cliente", "peca", "de", "ate"]) if (filtros[chave].value) p.set(chave, filtros[chave].value);
    for (const [chave, valor] of Object.entries(extra)) if (valor) p.set(chave, valor);
    window.location.href = `${A8.base}/analises${p.toString() ? `?${p}` : ""}`;
  }

  function irParaControle(extra = {}) {
    const p = new URLSearchParams();
    for (const [chave, campo] of Object.entries(filtros)) if (campo.value.trim()) p.set(chave, campo.value.trim());
    for (const [chave, valor] of Object.entries(extra)) if (valor) p.set(chave, valor);
    window.location.href = `${A8.base}/acoes?${p}`;
  }

  function parametrosAtuais() {
    const p = new URLSearchParams();
    for (const [chave, campo] of Object.entries(filtros)) {
      const valor = campo.value.trim() || valoresIniciais[chave]; // 1ª carga: filtros da URL
      if (valor) p.set(chave, valor);
    }
    return p;
  }

  async function carregar() {
    if (filtros.de.value && filtros.ate.value && filtros.de.value > filtros.ate.value) {
      [filtros.de.value, filtros.ate.value] = [filtros.ate.value, filtros.de.value];
    }
    const p = parametrosAtuais();
    history.replaceState(null, "", `${location.pathname}${p.toString() ? `?${p}` : ""}`);
    try {
      ultimo = await api(`/api/dashboard?${p}`);
    } catch (erro) {
      document.getElementById("a8-d-kpis-a3").textContent = erro.message;
      return;
    }
    preencherFiltros(ultimo.opcoes);
    renderizarFiltrosAtivos();
    renderizar();
    const agora = new Date();
    document.getElementById("a8-d-atualizado").textContent =
      `Atualizado às ${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;
  }

  function preencherFiltros(opcoes) {
    const manter = (select, lista, vazio) => {
      const atual = select.value || valoresIniciais[Object.keys(filtros).find((k) => filtros[k] === select)] || "";
      A8.preencherSelect(select, lista, { vazio });
      select.value = lista.some((o) => (Array.isArray(o) ? o[0] : o) === atual) ? atual : "";
    };
    manter(filtros.analista, opcoes.analistas, "Todos");
    desenharAnalistas();
    manter(filtros.cliente, opcoes.clientes, "Todos");
    manter(filtros.peca, opcoes.pecas, "Todas");
    Object.keys(valoresIniciais).forEach((k) => (valoresIniciais[k] = "")); // só vale na 1ª carga
  }

  // Etiquetas dos filtros ativos ("Setor: Qualidade ×").
  function textoDoFiltro(chave) {
    const campo = filtros[chave];
    if (campo.type === "date") return fmtData(campo.value);
    if (campo.tagName === "SELECT") return campo.selectedOptions[0] ? campo.selectedOptions[0].text : campo.value;
    return campo.value.trim();
  }

  function renderizarFiltrosAtivos() {
    const caixa = document.getElementById("a8-d-ativos");
    caixa.innerHTML = "";
    const ativos = Object.keys(filtros).filter((k) => filtros[k].value.trim());
    caixa.hidden = !ativos.length;
    document.getElementById("a8-d-limpar").disabled = !ativos.length;
    if (!ativos.length) return;
    caixa.appendChild(criar("span", { classe: "a8-filtros-ativos-rotulo", texto: "Filtros ativos:" }));
    ativos.forEach((k) => caixa.appendChild(criar("span", { classe: "a8-etiqueta-filtro" }, [
      criar("span", { texto: `${ROTULOS_FILTRO[k]}: ${textoDoFiltro(k)}` }),
      criar("button", {
        type: "button", classe: "a8-etiqueta-remover", title: `Remover filtro ${ROTULOS_FILTRO[k]}`,
        "aria-label": `Remover filtro ${ROTULOS_FILTRO[k]}`, texto: "×",
        onclick: () => { filtros[k].value = ""; carregar(); },
      }),
    ])));
  }

  A8.descreverFiltros = () => Object.keys(filtros)
    .filter((k) => filtros[k].value.trim())
    .map((k) => `${ROTULOS_FILTRO[k]}: ${textoDoFiltro(k)}`)
    .join(" · ");

  function limparFiltros() {
    Object.values(filtros).forEach((campo) => (campo.value = ""));
    carregar();
  }

  function renderizar() {
    const d = ultimo;
    renderizarKpis(d.kpis);

    G.rosca(document.getElementById("a8-g-status"), [
      { chave: "atrasada", rotulo: "Atrasadas", valor: d.status_geral[0].valor, cor: COR.critico },
      { chave: "no_prazo", rotulo: "Abertas no prazo", valor: d.status_geral[1].valor, cor: COR.azul },
      { chave: "concluida", rotulo: "Concluídas", valor: d.status_geral[2].valor, cor: COR.bom },
    ], { aoClicar: (item) => irParaControle({ situacao: item.chave === "no_prazo" ? "abertas" : item.chave }) });

    G.rosca(document.getElementById("a8-g-status-a3"), [
      { chave: "vencido", rotulo: "Atrasados", valor: d.kpis.a3_prazo_vencido, cor: COR.critico },
      { chave: "no_prazo", rotulo: "Abertos no prazo", valor: d.kpis.a3_em_andamento - d.kpis.a3_prazo_vencido, cor: COR.azul },
      { chave: "concluido", rotulo: "Concluídos", valor: d.kpis.a3_concluidos, cor: COR.bom },
    ], {
      rotuloCentro: "A3",
      aoClicar: (item) => irParaAnalises(item.chave === "concluido"
        ? { status: "Concluído" } : { status: "Em andamento", prazo: item.chave }),
    });

    const v = d.velocimetro || {};
    G.velocimetro(document.getElementById("a8-g-velocimetro"), {
      valor: v.media,
      faixas: v.faixas || [],
      legenda: "média atual",
      // Rodapé: meta e % de A3 fechados dentro da meta (até 30 dias).
      rodape: v.quantidade ? [
        `Meta: ${v.meta} dias`,
        `${Math.round((100 * v.no_prazo) / v.quantidade)}% fechados dentro da meta`,
      ] : [],
    });

    // Concluídos (verde) + no prazo (cinza escuro) + atrasados (vermelho), igual aos gráficos de ações.
    G.colunasEmpilhadas(document.getElementById("a8-g-a3-area"), d.a3_por_area || [], [
      { chave: "concluida", rotulo: "Concluídos", cor: COR.bom },
      { chave: "no_prazo", rotulo: "No prazo", cor: "#3d3d3d" },
      { chave: "atrasada", rotulo: "Atrasados", cor: COR.critico },
    ], { aoClicar: (item) => irParaAnalises({ status: "todos", area: item.rotulo }) });

    G.colunas(document.getElementById("a8-g-prazo"),
      d.faixas_prazo.map((f) => ({ ...f, cor: COR_FAIXA_PRAZO[f.chave] })),
      { aoClicar: (item) => irParaControle({ situacao: item.chave.startsWith("atrasada") ? "atrasada" : item.chave === "vence_0_7" ? "vence7" : "abertas" }) });

    // Concluídas (verde) + no prazo (cinza escuro) + atrasadas (vermelho), com o número dentro de cada parte.
    const SERIES_TODAS = [
      { chave: "concluida", rotulo: "Concluídas", cor: COR.bom },
      { chave: "no_prazo", rotulo: "No prazo", cor: "#3d3d3d" },
      { chave: "atrasada", rotulo: "Atrasadas", cor: COR.critico },
    ];
    // Só quem ainda tem ação em aberto (no prazo ou atrasada): quem já concluiu tudo sai do gráfico.
    G.barrasEmpilhadas(document.getElementById("a8-g-responsavel"),
      d.por_responsavel.filter((p) => p.no_prazo + p.atrasada > 0), SERIES_TODAS,
      { rotulosDentro: true, aoClicar: (item) => irParaControle({ responsavel: item.rotulo }) });

    G.barrasEmpilhadas(document.getElementById("a8-g-setor"), d.por_setor, SERIES_TODAS,
      { rotulosDentro: true, aoClicar: (item) => irParaControle({ setor: item.rotulo === "(sem setor)" ? "" : item.rotulo }) });

    G.colunas(document.getElementById("a8-g-dias"),
      d.faixas_dias_aberto.map((f, i) => ({ ...f, cor: COR.azulRampa[i] })),
      { sufixo: " ações abertas" });

    const grupoPorRotulo = Object.fromEntries(modelo.grupos_acao.map((g) => [g.rotulo, g.chave]));
    G.barrasEmpilhadas(document.getElementById("a8-g-grupo"), d.por_grupo, SERIES_SITUACAO,
      { aoClicar: (item) => irParaControle({ grupo: grupoPorRotulo[item.rotulo] }) });

    const porMes = (lista) => lista.map((m) => {
      const [ano, mes] = m.mes.split("-");
      return { ...m, rotulo: MESES[Number(mes) - 1], rotuloLongo: `${MESES[Number(mes) - 1]}/${ano}` };
    });
    G.linhasArea(document.getElementById("a8-g-evolucao"), porMes(d.evolucao_mensal), [
      { chave: "abertas", rotulo: "Abertas no mês", cor: "#3d3d3d", opacidadeArea: 0.22 },
      { chave: "concluidas", rotulo: "Concluídas no mês", cor: "#1fe36b", opacidadeArea: 0.38, opacidadeLinha: 0.9 },
    ]);
    // Mesmo gráfico para os A3 (abertos pela data de emissão, concluídos pela data de fechamento).
    G.linhasArea(document.getElementById("a8-g-evolucao-a3"), porMes(d.evolucao_mensal_a3 || []), [
      { chave: "abertas", rotulo: "Abertos no mês", cor: "#3d3d3d", opacidadeArea: 0.22 },
      { chave: "concluidas", rotulo: "Concluídos no mês", cor: "#1fe36b", opacidadeArea: 0.38, opacidadeLinha: 0.9 },
    ]);

    renderizarAtrasadas(d.mais_atrasadas);
    renderizarListaA3(d.a3_status_atual || []);
    renderizarMapa(d.mapa_setores);
  }

  // --- Mapa dos setores ------------------------------------------------------------
  let setorAberto = null; // rótulo do setor com a lista aberta (sobrevive à troca de filtros)
  let controleMapa = null;

  const SEM_SETOR = "Sem setor";

  function renderizarMapa(mapa) {
    // Barras só dos setores que têm ações: os oficiais, os setores digitados fora da lista
    // oficial (cada um com a sua barra) e, por último, as ações sem setor (barra cinza).
    const item = (rotulo, acoes, extra = {}) => {
      const conta = (sit) => acoes.filter((a) => a.situacao === sit).length;
      return {
        rotulo, valor: acoes.length, acoes, ...extra,
        detalhes: [[COR.bom, `Concluídas: ${conta("concluida")}`], [COR.azul, `Abertas no prazo: ${conta("no_prazo")}`],
          [COR.critico, `Atrasadas: ${conta("atrasada")}`]],
      };
    };
    const itens = mapa.setores.filter((s) => s.acoes.length).map((s) => item(s.rotulo, s.acoes));
    const outros = new Map();
    mapa.fora_do_mapa.filter((a) => a.setor).forEach((a) => outros.set(a.setor, [...(outros.get(a.setor) || []), a]));
    outros.forEach((acoes, setor) => itens.push(item(setor, acoes, { foraDaLista: true })));
    const semSetor = mapa.fora_do_mapa.filter((a) => !a.setor);
    if (semSetor.length) itens.push(item(SEM_SETOR, semSetor, { semSetor: true, cor: "#9a9a9a", ultimo: true }));

    const total = itens.reduce((t, i) => t + i.valor, 0);
    const indiceAberto = itens.findIndex((i) => i.rotulo === setorAberto);
    controleMapa = G.barrasPercentuais(document.getElementById("a8-g-mapa"), itens, {
      selecionado: indiceAberto >= 0 ? indiceAberto : null,
      totalGeral: total,
      aoClicar: (it, i) => abrirSetor(it.rotulo, it.acoes, total, i, { semFiltro: it.semSetor }),
    });
    document.getElementById("a8-mapa-fora").hidden = true;

    if (indiceAberto >= 0) abrirSetor(setorAberto, itens[indiceAberto].acoes, total, indiceAberto, { semFiltro: itens[indiceAberto].semSetor });
    else fecharSetor();
  }

  function abrirSetor(rotulo, acoes, total, indice, { semFiltro = false } = {}) {
    setorAberto = rotulo;
    if (controleMapa) controleMapa.marcar(indice);
    const painel = document.getElementById("a8-mapa-painel");
    painel.hidden = false;
    painel.innerHTML = "";
    const conta = (sit) => acoes.filter((a) => a.situacao === sit).length;
    const pct = total ? Math.round((acoes.length / total) * 100) : 0;
    const ordem = { atrasada: 0, no_prazo: 1, concluida: 2 };
    const lista = [...acoes].sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || (b.dias_atraso || 0) - (a.dias_atraso || 0)
      || String(a.prazo || "").localeCompare(String(b.prazo || "")));

    painel.appendChild(criar("div", { classe: "a8-mapa-painel-topo" }, [
      criar("strong", { texto: rotulo }),
      criar("span", { texto: `${acoes.length} de ${total} ações · ${pct}% · ${conta("concluida")} concluídas · ${conta("no_prazo")} no prazo · ${conta("atrasada")} atrasadas` }),
      criar("span", { classe: "a8-espaco" }),
      indice !== null && !semFiltro ? criar("button", { type: "button", classe: "btn btn-secondary btn-small", texto: "Abrir na Gestão de Ações",
        onclick: () => irParaControle({ setor: rotulo }) }) : null,
      criar("button", { type: "button", classe: "btn btn-secondary btn-small", texto: "Fechar", onclick: fecharSetor }),
    ].filter(Boolean)));

    const corpo = criar("tbody");
    if (!lista.length) corpo.appendChild(criar("tr", {}, criar("td", { colspan: 6, classe: "empty", texto: "Nenhuma ação neste setor." })));
    lista.forEach((a) => corpo.appendChild(criar("tr", {
      classe: `linha-clicavel ${a.situacao === "atrasada" ? "a8-linha-atrasada" : ""}`,
      title: "Abrir o A3",
      onclick: () => (window.location.href = `${A8.base}/analises/${a.analise_id}#acoes`),
    }, [
      criar("td", {}, A8.badgeSituacao(a)),
      criar("td", { classe: "id-mrhb", texto: a.id_mrhb }),
      criar("td", { texto: a.grupo_rotulo }),
      criar("td", { classe: "a8-texto-acao", texto: a.descricao }),
      criar("td", { texto: a.responsavel || "" }),
      criar("td", { classe: "a8-data", texto: fmtData(a.prazo) }),
    ])));
    painel.appendChild(criar("div", { classe: "table-wrap" }, criar("table", { classe: "a8-tabela-controle" }, [
      criar("thead", {}, criar("tr", {}, ["Situação", "ID Wetzel", "Tipo", "Ação", "Responsável", "Prazo"].map((t) => criar("th", { texto: t })))),
      corpo,
    ])));
  }

  // Esc fecha a lista do setor aberta no mapa.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && setorAberto !== null) fecharSetor();
  });

  function fecharSetor() {
    setorAberto = null;
    if (controleMapa) controleMapa.marcar(null);
    const painel = document.getElementById("a8-mapa-painel");
    painel.hidden = true;
    painel.innerHTML = "";
  }

  function renderizarKpis(k) {
    // Cards de A3 no painel "Indicadores de A3"; cards de ações no painel "Indicadores de ações".
    const caixaA3 = document.getElementById("a8-d-kpis-a3");
    const caixaAcoes = document.getElementById("a8-d-kpis-acoes");
    caixaA3.innerHTML = "";
    caixaAcoes.innerHTML = "";
    // destino: filtros da Gestão de Ações; destinoA3: filtros do Formulário A3.
    const kpi = (rotulo, valor, { classe = "", detalhe = "", destino = null, destinoA3 = null } = {}) => {
      const ir = destinoA3 ? () => irParaAnalises(destinoA3) : destino ? () => irParaControle(destino) : null;
      const caixa = destinoA3 ? caixaA3 : caixaAcoes;
      caixa.appendChild(criar("div", {
        classe: `dash-kpi ${classe} ${ir ? "dash-kpi-clicavel" : ""}`,
        role: ir ? "link" : null,
        tabindex: ir ? 0 : null,
        onclick: ir,
        onkeydown: ir ? (e) => { if (e.key === "Enter") ir(); } : null,
      }, [
        criar("div", { classe: "dash-kpi-rotulo", texto: rotulo }),
        criar("div", { classe: "dash-kpi-valor", texto: valor }),
        detalhe ? criar("div", { classe: "a8-kpi-detalhe", texto: detalhe }) : null,
      ]));
    };
    const pct = (parte, todo) => (todo ? `${Math.round((100 * parte) / todo)}%` : "0%");
    kpi("Total de A3", k.a3_total, { detalhe: "sem os cancelados", destinoA3: { status: "todos" } });
    kpi("A3 abertos", k.a3_em_andamento, {
      classe: k.a3_prazo_vencido ? "dash-kpi-critico" : "",
      detalhe: k.a3_prazo_vencido ? `${k.a3_prazo_vencido} com prazo limite vencido` : `${pct(k.a3_em_andamento, k.a3_total)} do total`,
      destinoA3: { status: "Em andamento" },
    });
    kpi("A3 fechados", k.a3_concluidos, {
      classe: "dash-kpi-ok", detalhe: `${pct(k.a3_concluidos, k.a3_total)} do total · 8D aprovado`,
      destinoA3: { status: "Concluído" },
    });
    kpi("Total de ações", k.total, { detalhe: "sem as canceladas", destino: { situacao: "todas" } });
    kpi("Ações abertas", k.abertas, {
      classe: k.atrasadas ? "dash-kpi-critico" : "",
      detalhe: k.atrasadas ? `${k.atrasadas} atrasada${k.atrasadas > 1 ? "s" : ""}` : "nenhuma atrasada",
      destino: { situacao: "abertas" },
    });
    kpi("Ações fechadas", k.concluidas, {
      classe: "dash-kpi-ok",
      detalhe: `${pct(k.concluidas, k.total)} do total` + (k.pct_concluidas_no_prazo === null ? "" : ` · ${k.pct_concluidas_no_prazo}% no prazo`),
      destino: { situacao: "concluida" },
    });
  }

  function renderizarListaA3(lista) {
    const corpo = document.getElementById("a8-lista-a3");
    corpo.innerHTML = "";
    if (!lista.length) {
      corpo.appendChild(criar("tr", {}, criar("td", { colspan: 5, classe: "empty", texto: "Nenhum A3 em andamento." })));
      return;
    }
    lista.forEach((a) => corpo.appendChild(criar("tr", {
      classe: `linha-clicavel ${a.etapa_atrasada ? "a8-linha-atrasada" : ""}`,
      title: "Abrir o A3",
      onclick: () => (window.location.href = `${A8.base}/analises/${a.analise_id || a.id}`),
    }, [
      criar("td", { classe: "id-mrhb", texto: a.id_mrhb }),
      criar("td", { texto: a.pn_mrhb || "—" }),
      criar("td", { texto: a.area || "—" }),
      criar("td", { classe: "a8-texto-acao", title: a.descricao, texto: a.descricao || "—" }),
      criar("td", {}, criar("span", {
        classe: `a8-etapa-badge ${a.etapa_atrasada ? "atrasada" : ""}`,
        title: a.etapa_prazo ? `Prazo da etapa: ${fmtData(a.etapa_prazo)}${a.etapa_atrasada ? " (atrasada)" : ""}` : "",
        texto: a.etapa,
      })),
    ])));
  }

  function renderizarAtrasadas(lista) {
    const corpo = document.getElementById("a8-d-atrasadas");
    corpo.innerHTML = "";
    if (!lista.length) {
      corpo.appendChild(criar("tr", {}, criar("td", { colspan: 7, classe: "empty", texto: "Nenhuma ação atrasada." })));
      return;
    }
    lista.forEach((a) => corpo.appendChild(criar("tr", {
      classe: "linha-clicavel a8-linha-atrasada",
      onclick: () => (window.location.href = `${A8.base}/analises/${a.analise_id}#acoes`),
    }, [
      criar("td", {}, A8.badgeSituacao(a)),
      criar("td", { classe: "id-mrhb", texto: a.id_mrhb }),
      criar("td", { texto: a.grupo_rotulo }),
      criar("td", { classe: "a8-texto-acao", texto: a.descricao }),
      criar("td", { texto: a.responsavel }),
      criar("td", { texto: a.setor || "" }),
      criar("td", { classe: "etapa-atrasada", texto: fmtData(a.prazo) }),
    ])));
  }

  Object.values(filtros).forEach((campo) => campo.addEventListener("change", carregar));
  document.getElementById("a8-d-limpar").addEventListener("click", limparFiltros);
  let redimensionar;
  window.addEventListener("resize", () => {
    clearTimeout(redimensionar);
    redimensionar = setTimeout(() => ultimo && renderizar(), 150);
  });

  // --- Organizar os gráficos, salvo neste navegador ------------------------------------
  // Os gráficos podem ir para qualquer painel (A3, ações ou "mais indicadores").
  // A largura (meia/inteira) só existe no painel de baixo, que tem 2 colunas.
  const CHAVE_LAYOUT = "a8-visao-geral-layout-v3";
  const grupos = [...document.querySelectorAll(".a8-grupo-graficos")];
  const quadrosDe = (grupo) => [...grupo.children].filter((q) => q.classList.contains("dash-card"));
  const todosQuadros = () => grupos.flatMap(quadrosDe);
  const idDoQuadro = (q) => q.dataset.grafico;
  const temLargura = (grupo) => grupo.classList.contains("dash-grid");
  const padrao = {};
  grupos.forEach((grupo) => {
    quadrosDe(grupo).forEach((q) => {
      q.dataset.grafico = q.querySelector("[id]").id; // id do gráfico = identidade do quadro
      q.dataset.largoPadrao = q.classList.contains("dash-card-larga") ? "1" : "0";
      q.dataset.grupoPadrao = grupo.id;
    });
    padrao[grupo.id] = quadrosDe(grupo).map(idDoQuadro);
  });

  function lerLayout() {
    try { return JSON.parse(localStorage.getItem(CHAVE_LAYOUT)) || null; } catch { return null; }
  }
  function salvarLayout() {
    const layout = {};
    grupos.forEach((grupo) => {
      layout[grupo.id] = {
        ordem: quadrosDe(grupo).map(idDoQuadro),
        largos: quadrosDe(grupo).filter((q) => q.classList.contains("dash-card-larga")).map(idDoQuadro),
      };
    });
    try { localStorage.setItem(CHAVE_LAYOUT, JSON.stringify(layout)); } catch { /* navegador sem armazenamento */ }
  }
  function aplicarLayout(layout) {
    const porId = Object.fromEntries(todosQuadros().map((q) => [idDoQuadro(q), q]));
    const colocados = new Set();
    grupos.forEach((grupo) => {
      const ordem = layout && layout[grupo.id] ? layout[grupo.id].ordem : padrao[grupo.id];
      ordem.filter((id) => porId[id] && !colocados.has(id)).forEach((id) => { grupo.appendChild(porId[id]); colocados.add(id); });
    });
    // Gráfico novo (ainda não estava no layout salvo): vai para o painel de origem.
    Object.values(porId).filter((q) => !colocados.has(idDoQuadro(q)))
      .forEach((q) => document.getElementById(q.dataset.grupoPadrao).appendChild(q));
    const largos = layout ? new Set(grupos.flatMap((g) => (layout[g.id] && layout[g.id].largos) || [])) : null;
    todosQuadros().forEach((q) => q.classList.toggle("dash-card-larga",
      largos ? largos.has(idDoQuadro(q)) : q.dataset.largoPadrao === "1"));
  }

  let arrastado = null;
  const organizando = () => document.body.classList.contains("a8-organizando");
  function ferramentas(q) {
    q.querySelector(".a8-quadro-ferramentas")?.remove();
    if (!organizando()) return;
    q.prepend(criar("div", { classe: "a8-quadro-ferramentas" }, [
      criar("span", { classe: "a8-quadro-alca", "aria-hidden": "true", texto: "⠿" }),
      temLargura(q.parentElement) ? criar("button", {
        type: "button", classe: "a8-quadro-largura", texto: "⇔", title: "Alternar entre meia largura e largura inteira",
        "aria-label": "Alternar largura do gráfico",
        onclick: () => { q.classList.toggle("dash-card-larga"); renderizar(); },
      }) : null,
    ]));
  }
  function modoOrganizar(ligar) {
    document.body.classList.toggle("a8-organizando", ligar);
    document.getElementById("a8-aviso-organizar").hidden = !ligar;
    document.getElementById("a8-layout-padrao").hidden = !ligar;
    const botao = document.getElementById("a8-organizar");
    botao.textContent = ligar ? "Concluir" : "Organizar gráficos";
    botao.classList.toggle("btn-primary", ligar);
    botao.classList.toggle("btn-secondary", !ligar);
    botao.setAttribute("aria-pressed", String(ligar));
    todosQuadros().forEach((q) => { q.draggable = ligar; ferramentas(q); });
    if (!ligar) salvarLayout();
  }

  document.addEventListener("dragstart", (e) => {
    const q = e.target.closest && e.target.closest(".a8-grupo-graficos > .dash-card");
    if (!q || !organizando()) return;
    arrastado = q;
    q.classList.add("a8-arrastando");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", idDoQuadro(q)); } catch { /* ok */ }
  });
  grupos.forEach((grupo) => {
    grupo.addEventListener("dragover", (e) => {
      if (!arrastado) return;
      e.preventDefault();
      const alvo = e.target.closest && e.target.closest(".dash-card");
      if (alvo && alvo !== arrastado && alvo.parentElement === grupo) {
        const r = alvo.getBoundingClientRect();
        const depois = temLargura(grupo)
          ? e.clientY > r.top + r.height * 0.6 || (e.clientY > r.top + r.height * 0.25 && e.clientX > r.left + r.width / 2)
          : e.clientY > r.top + r.height / 2;
        grupo.insertBefore(arrastado, depois ? alvo.nextSibling : alvo);
      } else if (!alvo && arrastado.parentElement !== grupo) {
        grupo.appendChild(arrastado); // painel vazio ou espaço livre do painel
      }
    });
    grupo.addEventListener("drop", (e) => { if (arrastado) e.preventDefault(); });
  });
  document.addEventListener("dragend", () => {
    if (!arrastado) return;
    arrastado.classList.remove("a8-arrastando");
    if (!temLargura(arrastado.parentElement)) arrastado.classList.remove("dash-card-larga");
    ferramentas(arrastado); // o botão de largura depende do painel
    arrastado = null;
    renderizar(); // a largura do quadro pode ter mudado
  });

  document.getElementById("a8-organizar").addEventListener("click", () => modoOrganizar(!organizando()));
  document.getElementById("a8-layout-padrao").addEventListener("click", () => {
    try { localStorage.removeItem(CHAVE_LAYOUT); } catch { /* ok */ }
    aplicarLayout(null);
    todosQuadros().forEach(ferramentas);
    renderizar();
  });

  (async () => {
    aplicarLayout(lerLayout());
    modelo = await A8.modelo();
    await carregar();
  })();
})();
