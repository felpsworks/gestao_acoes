(() => {
  const { api, criar, fmtData } = A8;
  const parametros = new URLSearchParams(location.search);

  const SITUACOES = [
    { chave: "todas", rotulo: "Todas", testa: (a) => a.situacao !== "cancelada" }, // canceladas fora, como nos cards
    { chave: "abertas", rotulo: "Abertas", testa: (a) => a.situacao === "no_prazo" || a.situacao === "atrasada" },
    { chave: "atrasada", rotulo: "Atrasadas", testa: (a) => a.situacao === "atrasada" },
    { chave: "vence7", rotulo: "Vencem em 7 dias", testa: (a) => a.vence_em_breve },
    { chave: "concluida", rotulo: "Concluídas", testa: (a) => a.situacao === "concluida" },
  ];

  const COLUNAS = [
    // largura: % da tabela (soma 100) -> a tabela cabe na tela, sem rolagem lateral.
    { chave: "situacao", rotulo: "Situação", largura: 9, ordem: (a) => [a.situacao === "atrasada" ? 0 : a.situacao === "no_prazo" ? 1 : 2, -a.dias_atraso] },
    { chave: "id_mrhb", rotulo: "ID Wetzel", largura: 17 },
    { chave: "grupo_rotulo", rotulo: "Tipo", largura: 8 },
    { chave: "descricao", rotulo: "Ação", largura: 19 },
    { chave: "responsavel", rotulo: "Responsável", largura: 9 },
    { chave: "setor", rotulo: "Setor", largura: 7 },
    { chave: "data_abertura", rotulo: "Abertura", largura: 7 },
    { chave: "prazo", rotulo: "Prazo", largura: 7 },
    { chave: "dias_em_aberto", rotulo: "Dias em aberto", num: true, largura: 5 },
    { chave: "dias_atraso", rotulo: "Dias de atraso", num: true, largura: 5 },
    { chave: "data_conclusao", rotulo: "Conclusão", largura: 7 },
  ];

  const estado = {
    situacao: parametros.get("situacao") || "todas",
    responsavel: parametros.get("responsavel") || "",
    setor: parametros.get("setor") || "",
    grupo: parametros.get("grupo") || "",
    id_mrhb: parametros.get("id_mrhb") || "",
    cliente: parametros.get("cliente") || "",
    status: parametros.get("status") || "",
    analista: parametros.get("analista") || "",
    de: parametros.get("de") || "",
    ate: parametros.get("ate") || "",
    peca: parametros.get("peca") || "",
    tipos: (parametros.get("tipos") || "").split(",").filter(Boolean), // vazio até carregar o padrão
    ordenarPor: "situacao",
    crescente: true,
  };

  // Botões de área (filtro por setor), logo abaixo dos cards.
  const AREAS = ["Usinagem", "Injeção", "Manutenção", "Qualidade", "Engenharia"];

  let acoes = [];
  let analises = [];
  // Barra de filtros (abaixo dos botões de área). Período = data de emissão do A3.
  const campos = {
    analista: document.getElementById("a8-f-analista"),
    cliente: document.getElementById("a8-f-cliente"),
    de: document.getElementById("a8-f-de"),
    ate: document.getElementById("a8-f-ate"),
    id_mrhb: document.getElementById("a8-f-id"),
  };
  const desenharAnalistas = A8.botoesDoSelect(campos.analista, document.getElementById("a8-f-analista-botoes"));
  // Filtros que podem chegar pela URL (cliques na Visão Geral / pessoa clicada):
  // aparecem como etiquetas removíveis acima da lista.
  const ROTULOS_RECEBIDOS = { responsavel: "Responsável da ação", setor: "Setor", grupo: "Tipo", status: "Status", peca: "Peça" };
  let tiposOpcoes = [];
  let tiposPadrao = [];
  const mesmaLista = (a, b) => a.length === b.length && a.every((t) => b.includes(t));
  function desenharTipos() {
    A8.botoesTipos(document.getElementById("a8-f-tipos-botoes"), tiposOpcoes, estado.tipos, (novos) => {
      estado.tipos = novos;
      desenharTipos();
      renderizar();
    });
  }
  const ROTULOS_BARRA = { analista: "Analista", cliente: "Cliente", de: "De", ate: "Até", id_mrhb: "ID Wetzel" };
  // Mesmo filtro "Status" da Visão Geral.
  const FILTROS_STATUS = {
    aberta: ["Aberta", (a) => a.status === "Aberta"],
    em_andamento: ["Em andamento", (a) => a.status === "Em andamento"],
    atrasada: ["Atrasada", (a) => a.situacao === "atrasada"],
    concluida: ["Concluída", (a) => a.status === "Concluída"],
  };

  async function carregar() {
    try {
      [acoes, analises] = await Promise.all([api("/api/acoes"), api("/api/analises")]);
    } catch (erro) {
      const corpo = document.getElementById("a8-corpo-acoes");
      corpo.innerHTML = "";
      corpo.appendChild(criar("tr", {}, criar("td", { colspan: 11, classe: "empty", texto: erro.message })));
      return;
    }
    await preencherFiltros();
    const m = await A8.modelo();
    tiposOpcoes = m.tipos_reclamacao || [];
    tiposPadrao = m.tipos_padrao || [];
    if (!estado.tipos.length) estado.tipos = [...tiposPadrao]; // padrão: Formal, Informal, Logística
    desenharTipos();
    renderizar();
  }

  function unicos(lista, campo) {
    return [...new Set(lista.map((x) => x[campo]).filter(Boolean))].sort((x, y) => x.localeCompare(y, "pt-BR"));
  }

  async function preencherFiltros() {
    const manter = (campo, opcoes, vazio) => {
      A8.preencherSelect(campo, opcoes, { vazio });
      campo.value = opcoes.includes(estado[campo === campos.analista ? "analista" : "cliente"]) ? estado[campo === campos.analista ? "analista" : "cliente"] : "";
    };
    const doModelo = (await A8.modelo()).analistas || [];
    manter(campos.analista, [...new Set([...doModelo, ...unicos(analises, "responsavel")])].sort((x, y) => x.localeCompare(y, "pt-BR")), "Todos");
    desenharAnalistas();
    manter(campos.cliente, unicos(acoes, "cliente"), "Todos");
    campos.de.value = estado.de;
    campos.ate.value = estado.ate;
    campos.id_mrhb.value = estado.id_mrhb;
    const lista = document.getElementById("a8-f-ids");
    lista.innerHTML = "";
    unicos(acoes, "id_mrhb").forEach((id) => lista.appendChild(criar("option", { value: id })));
  }

  function textoRecebido(chave) {
    if (chave === "grupo") return (acoes.find((a) => a.grupo === estado.grupo) || {}).grupo_rotulo || estado.grupo;
    if (chave === "status") return (FILTROS_STATUS[estado.status] || [estado.status])[0];
    return estado[chave];
  }

  function filtrarSemSituacao({ ignorarSetor = false } = {}) {
    const termoId = estado.id_mrhb.toUpperCase();
    return acoes.filter((a) => {
      const emissao = (a.data_emissao || "").slice(0, 10);
      if (estado.analista && a.analista !== estado.analista) return false;
      if (estado.de && emissao < estado.de) return false;
      if (estado.ate && emissao > estado.ate) return false;
      if (estado.peca && a.pn_mrhb !== estado.peca) return false;
      if (estado.tipos.length && !estado.tipos.includes(a.tipo_reclamacao)) return false;
      if (estado.responsavel && a.responsavel !== estado.responsavel) return false;
      if (estado.cliente && a.cliente !== estado.cliente) return false;
      if (estado.grupo && a.grupo !== estado.grupo) return false;
      if (!ignorarSetor && estado.setor && a.setor !== estado.setor) return false;
      if (termoId && !(a.id_mrhb || "").toUpperCase().includes(termoId)) return false; // ID inteiro ou parte dele
      if (estado.status && !(FILTROS_STATUS[estado.status] && FILTROS_STATUS[estado.status][1](a))) return false;
      return true;
    });
  }

  function renderizarAreas() {
    const testaSituacao = SITUACOES.find((s) => s.chave === estado.situacao).testa;
    const base = filtrarSemSituacao({ ignorarSetor: true }).filter(testaSituacao);
    const caixa = document.getElementById("a8-areas");
    caixa.innerHTML = "";
    const botao = (rotulo, setor, quantidade) => caixa.appendChild(criar("button", {
      type: "button",
      classe: `a8-area ${estado.setor === setor ? "ativa" : ""}`,
      "aria-pressed": String(estado.setor === setor),
      onclick: () => { estado.setor = estado.setor === setor ? "" : setor; renderizar(); },
    }, [rotulo, criar("span", { classe: "a8-area-qtd", texto: quantidade })]));
    botao("Todas as áreas", "", base.length);
    AREAS.forEach((area) => botao(area, area, base.filter((a) => a.setor === area).length));
  }

  function renderizarRecebidos() {
    const caixa = document.getElementById("a8-f-outros");
    caixa.innerHTML = "";
    const ativos = Object.keys(ROTULOS_RECEBIDOS).filter((k) => estado[k] && !(k === "setor" && AREAS.includes(estado.setor)));
    caixa.hidden = !ativos.length;
    ativos.forEach((k) => caixa.appendChild(criar("span", { classe: "a8-etiqueta-filtro" }, [
      criar("span", { texto: `${ROTULOS_RECEBIDOS[k]}: ${textoRecebido(k)}` }),
      criar("button", {
        type: "button", classe: "a8-etiqueta-remover", title: "Remover filtro", "aria-label": `Remover filtro ${ROTULOS_RECEBIDOS[k]}`, texto: "×",
        onclick: () => { estado[k] = ""; renderizar(); },
      }),
    ])));
  }

  function renderizar() {
    document.getElementById("a8-f-limpar").disabled = ![...Object.keys(ROTULOS_BARRA), ...Object.keys(ROTULOS_RECEBIDOS)]
      .some((k) => estado[k]) && estado.situacao === "todas" && mesmaLista(estado.tipos, tiposPadrao);
    const base = filtrarSemSituacao();
    renderizarKpis(base);
    renderizarAreas();
    renderizarRecebidos();
    renderizarResumo(base);
    renderizarTabela(base.filter(SITUACOES.find((s) => s.chave === estado.situacao).testa));
    sincronizarUrl();
  }

  function renderizarKpis(base) {
    const validas = base.filter((a) => a.situacao !== "cancelada");
    const abertas = validas.filter((a) => a.situacao === "no_prazo" || a.situacao === "atrasada");
    const atrasadas = abertas.filter((a) => a.situacao === "atrasada");
    const fechadas = validas.filter((a) => a.situacao === "concluida");
    const pct = (parte, todo) => (todo ? `${Math.round((100 * parte) / todo)}%` : "0%");
    const caixa = document.getElementById("a8-kpis-acoes");
    caixa.innerHTML = "";
    // Clicar no card filtra a lista pela situação (o card ativo fica destacado).
    const kpi = (rotulo, valor, classe, situacao, detalhe) => caixa.appendChild(criar("div", {
      classe: `dash-kpi ${classe} dash-kpi-clicavel ${estado.situacao === situacao ? "a8-kpi-ativo" : ""}`,
      onclick: () => { estado.situacao = situacao; renderizar(); },
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); estado.situacao = situacao; renderizar(); } },
      role: "button", tabindex: 0, "aria-pressed": estado.situacao === situacao ? "true" : "false",
    }, [
      criar("div", { classe: "dash-kpi-rotulo", texto: rotulo }),
      criar("div", { classe: "dash-kpi-valor", texto: valor }),
      detalhe ? criar("div", { classe: "a8-kpi-detalhe", texto: detalhe }) : null,
    ]));
    kpi("Total de ações", validas.length, "", "todas", "sem as canceladas");
    kpi("Ações abertas", abertas.length, "", "abertas", `${pct(abertas.length, validas.length)} do total`);
    kpi("Ações fechadas", fechadas.length, "dash-kpi-ok", "concluida", `${pct(fechadas.length, validas.length)} do total`);
    kpi("Ações atrasadas", atrasadas.length, atrasadas.length ? "dash-kpi-critico" : "dash-kpi-ok", "atrasada",
      abertas.length ? `${pct(atrasadas.length, abertas.length)} das abertas` : "nenhuma ação aberta");
  }

  function renderizarResumo(base) {
    const porPessoa = new Map();
    base.filter((a) => a.situacao === "no_prazo" || a.situacao === "atrasada").forEach((a) => {
      const r = porPessoa.get(a.responsavel) || { abertas: 0, atrasadas: 0, maior: 0 };
      r.abertas += 1;
      if (a.situacao === "atrasada") r.atrasadas += 1;
      r.maior = Math.max(r.maior, a.dias_atraso);
      porPessoa.set(a.responsavel, r);
    });
    const linhas = [...porPessoa.entries()].sort((x, y) => y[1].atrasadas - x[1].atrasadas || y[1].abertas - x[1].abertas);
    const caixa = document.getElementById("a8-resumo-pessoas");
    caixa.innerHTML = "";
    if (!linhas.length) caixa.appendChild(criar("p", { classe: "a8-ajuda", texto: "Nenhuma ação aberta." }));
    linhas.forEach(([nome, r]) => caixa.appendChild(criar("button", {
      type: "button",
      classe: `a8-pessoa-card ${r.atrasadas ? "a8-pessoa-atrasada" : ""} ${estado.responsavel === nome ? "a8-pessoa-selecionada" : ""}`,
      "aria-pressed": String(estado.responsavel === nome),
      onclick: () => { estado.responsavel = estado.responsavel === nome ? "" : nome; renderizar(); },
    }, [
      criar("span", { classe: "a8-pessoa-nome", texto: nome }),
      criar("span", { classe: "a8-pessoa-numeros" }, [
        criar("span", { texto: `${r.abertas} aberta${r.abertas > 1 ? "s" : ""}` }),
        r.atrasadas ? criar("span", { classe: "a8-pessoa-atraso", texto: `${r.atrasadas} atrasada${r.atrasadas > 1 ? "s" : ""} · até ${r.maior} d` }) : null,
      ]),
    ])));
  }

  function valorOrdenacao(a, coluna) {
    if (coluna.ordem) return coluna.ordem(a);
    const v = a[coluna.chave];
    return v === null || v === undefined ? "" : v;
  }

  function comparar(x, y) {
    if (Array.isArray(x)) {
      for (let i = 0; i < x.length; i += 1) {
        const c = comparar(x[i], y[i]);
        if (c) return c;
      }
      return 0;
    }
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x).localeCompare(String(y), "pt-BR", { numeric: true });
  }

  function renderizarTabela(lista) {
    const coluna = COLUNAS.find((c) => c.chave === estado.ordenarPor);
    lista = [...lista].sort((a, b) => {
      const c = comparar(valorOrdenacao(a, coluna), valorOrdenacao(b, coluna)) || comparar(a.prazo || "", b.prazo || "");
      return estado.crescente ? c : -c;
    });

    const cabecalho = document.getElementById("a8-cabecalho-acoes");
    cabecalho.innerHTML = "";
    COLUNAS.forEach((c) => {
      const ativo = c.chave === estado.ordenarPor;
      cabecalho.appendChild(criar("th", {
        classe: `a8-th-ordenavel ${c.num ? "a8-num" : ""}`,
        style: `width:${c.largura}%`,
        "aria-sort": ativo ? (estado.crescente ? "ascending" : "descending") : null,
      }, criar("button", {
        type: "button", classe: "a8-btn-ordenar",
        onclick: () => {
          estado.crescente = estado.ordenarPor === c.chave ? !estado.crescente : true;
          estado.ordenarPor = c.chave;
          renderizar();
        },
      }, [c.rotulo, ativo ? (estado.crescente ? " ▲" : " ▼") : ""])));
    });

    document.getElementById("a8-contador-acoes").textContent = `${lista.length} ação(ões)`;
    const corpo = document.getElementById("a8-corpo-acoes");
    corpo.innerHTML = "";
    if (!lista.length) {
      corpo.appendChild(criar("tr", {}, criar("td", { colspan: 11, classe: "empty", texto: acoes.length ? "Nenhuma ação com esses filtros." : "Nenhuma ação lançada ainda." })));
      return;
    }
    lista.forEach((a) => corpo.appendChild(criar("tr", {
      classe: `linha-clicavel ${a.situacao === "atrasada" ? "a8-linha-atrasada" : ""}`,
      title: "Clique para editar",
      onclick: () => A8.abrirModalAcao({ acao: a, analises, aoSalvar: carregar }),
    }, [
      criar("td", {}, A8.badgeSituacao(a)),
      // ID Wetzel, PN e definição do problema (só o ID não diz qual é o defeito).
      criar("td", { classe: "a8-celula-id" }, [
        criar("div", { classe: "a8-id-linha" }, [
          criar("a", {
            classe: "id-mrhb", href: `${A8.base}/analises/${a.analise_id}#acoes`, texto: a.id_mrhb,
            onclick: (e) => e.stopPropagation(),
          }),
        ]),
        criar("div", { classe: "a8-id-linha" }, [
          a.pn_mrhb ? `${a.pn_mrhb}${a.produto ? ` · ${a.produto}` : ""}` : "—",
        ]),
        criar("div", { classe: "a8-id-linha a8-id-problema", title: a.problema || "" }, [
          a.problema || "—",
        ]),
      ]),
      criar("td", { classe: "a8-celula-tipo" }, [a.grupo_rotulo, a.subgrupo ? criar("small", { texto: a.subgrupo }) : null]),
      criar("td", { classe: "a8-texto-acao", texto: a.descricao }),
      criar("td", { texto: a.responsavel }),
      criar("td", { texto: a.setor || "" }),
      criar("td", { classe: "a8-data", texto: fmtData(a.data_abertura) }),
      criar("td", { classe: `a8-data ${a.situacao === "atrasada" ? "etapa-atrasada" : ""}`, title: a.reprogramada ? `Prazo original: ${fmtData(a.prazo_original)}` : null, texto: fmtData(a.prazo) + (a.reprogramada ? " ↻" : "") }),
      criar("td", { classe: "a8-num", texto: a.dias_em_aberto }),
      criar("td", { classe: `a8-num ${a.dias_atraso ? "etapa-atrasada" : ""}`, texto: a.dias_atraso || "—" }),
      criar("td", { classe: "a8-data", texto: fmtData(a.data_conclusao) }),
    ])));
  }

  A8.descreverFiltros = () => {
    const partes = [`Situação: ${SITUACOES.find((s) => s.chave === estado.situacao).rotulo}`];
    for (const [chave, rotulo] of Object.entries(ROTULOS_BARRA)) {
      if (estado[chave]) partes.push(`${rotulo}: ${chave === "de" || chave === "ate" ? fmtData(estado[chave]) : estado[chave]}`);
    }
    if (estado.tipos.length) partes.push(`Tipo de reclamação: ${estado.tipos.join(", ")}`);
    for (const [chave, rotulo] of Object.entries(ROTULOS_RECEBIDOS)) {
      if (estado[chave]) partes.push(`${chave === "setor" ? "Área" : rotulo}: ${textoRecebido(chave)}`);
    }
    return partes.join(" · ");
  };

  function sincronizarUrl() {
    const p = new URLSearchParams();
    if (estado.tipos.length && !mesmaLista(estado.tipos, tiposPadrao)) p.set("tipos", estado.tipos.join(","));
    for (const chave of ["situacao", "analista", "cliente", "de", "ate", "id_mrhb", "responsavel", "setor", "grupo", "status", "peca"]) {
      if (estado[chave] && !(chave === "situacao" && estado[chave] === "todas")) p.set(chave, estado[chave]);
    }
    history.replaceState(null, "", `${location.pathname}${p.toString() ? `?${p}` : ""}`);
  }

  // Exporta exatamente o que está na tela (filtros aplicados), em CSV que o Excel abre direto.
  function exportarCsv() {
    const lista = filtrarSemSituacao().filter(SITUACOES.find((s) => s.chave === estado.situacao).testa);
    const cabecalho = ["Farol", "ID Wetzel", "Peça (PN)", "Produto", "Defeito", "Cliente", "Tipo", "Subtipo", "Ação", "Responsável", "Setor", "Abertura", "Prazo",
      "Prazo original", "Dias em aberto", "Dias de atraso", "Status", "Conclusão", "Abrangência", "Eficaz?", "Observação"];
    const linhas = lista.map((a) => [a.farol, a.id_mrhb, a.pn_mrhb, a.produto, a.problema, a.cliente, a.grupo_rotulo, a.subgrupo, a.descricao, a.responsavel, a.setor,
      fmtData(a.data_abertura), fmtData(a.prazo), fmtData(a.prazo_original), a.dias_em_aberto, a.dias_atraso, a.status,
      fmtData(a.data_conclusao), a.abrangencia, a.eficaz, a.observacao]);
    const celula = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cabecalho, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const link = criar("a", { href: URL.createObjectURL(blob), download: `acoes_8d_${A8.hojeISO()}.csv` });
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  // Filtros da barra: aplicam na hora (ID: enquanto digita, ID inteiro ou parte dele).
  for (const [chave, campo] of Object.entries(campos)) {
    campo.addEventListener(chave === "id_mrhb" ? "input" : "change", () => {
      estado[chave] = campo.value.trim();
      if (estado.de && estado.ate && estado.de > estado.ate) { // início depois do fim: inverte
        [estado.de, estado.ate] = [estado.ate, estado.de];
        campos.de.value = estado.de;
        campos.ate.value = estado.ate;
      }
      renderizar();
    });
  }
  document.getElementById("a8-f-limpar").addEventListener("click", () => {
    Object.assign(estado, { analista: "", cliente: "", de: "", ate: "", id_mrhb: "", responsavel: "", setor: "", grupo: "", status: "", peca: "", tipos: [...tiposPadrao], situacao: "todas" });
    desenharTipos();
    Object.values(campos).forEach((campo) => (campo.value = ""));
    renderizar();
  });
  document.getElementById("a8-btn-exportar").addEventListener("click", exportarCsv);
  document.getElementById("a8-btn-nova-acao").addEventListener("click", () => {
    const emAndamento = analises.filter((a) => a.status === "Em andamento");
    if (!emAndamento.length) {
      A8.toast("Crie primeiro uma análise A3 (aba Análises A3).", "erro");
      return;
    }
    const idSelecionado = estado.id_mrhb && emAndamento.find((a) => a.id_mrhb === estado.id_mrhb);
    A8.abrirModalAcao({ analises: emAndamento, analiseId: idSelecionado ? idSelecionado.id : null, aoSalvar: carregar });
  });

  A8.modelo();
  carregar();
})();
