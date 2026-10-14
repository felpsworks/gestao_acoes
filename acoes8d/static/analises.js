(() => {
  const { api, criar, fmtData, hojeISO } = A8;
  const corpo = document.getElementById("a8-corpo-analises");
  const busca = document.getElementById("a8-busca-analises");
  const filtroStatus = document.getElementById("a8-filtro-status-a3");
  const filtroCliente = document.getElementById("a8-filtro-cliente-a3");
  const parametros = new URLSearchParams(location.search);
  let filtroEtapa = parametros.get("etapa") || "";
  // Prazo limite (vindo da rosca "Situação dos A3"): "vencido" ou "no_prazo".
  // Área (vinda do gráfico "A3 por área" da Visão Geral).
  let filtroArea = parametros.get("area") || "";
  // Tipos de reclamação (botões; podem vir da Visão Geral pela URL). Vazio até carregar o padrão.
  let filtroTipos = (parametros.get("tipos") || "").split(",").filter(Boolean);
  let tiposOpcoes = [];
  let tiposPadrao = [];
  function desenharTipos() {
    A8.botoesTipos(document.getElementById("a8-tipos-a3-botoes"), tiposOpcoes, filtroTipos, (novos) => {
      filtroTipos = novos;
      const p = new URLSearchParams(location.search);
      const padrao = novos.length === tiposPadrao.length && novos.every((t) => tiposPadrao.includes(t));
      if (padrao) p.delete("tipos"); else p.set("tipos", novos.join(","));
      history.replaceState(null, "", `${location.pathname}${p.toString() ? `?${p}` : ""}`);
      desenharTipos();
      renderizar();
    });
  }
  let filtroPrazo = ["vencido", "no_prazo"].includes(parametros.get("prazo")) ? parametros.get("prazo") : "";
  // Filtros vindos da Visão Geral (cards de A3).
  if (parametros.has("status")) filtroStatus.value = parametros.get("status") === "todos" ? "" : parametros.get("status");
  if (parametros.get("busca")) busca.value = parametros.get("busca");
  let clienteInicial = parametros.get("cliente") || "";
  const contador = document.getElementById("a8-contador-analises");
  // Analista / peça / período vindos da Visão Geral.
  const filtrosA3 = A8.filtrosA3DaUrl(document.getElementById("a8-filtro-a3-extras"),
    { analista: (a) => a.responsavel, peca: (a) => a.pn_mrhb, data: (a) => a.data_emissao }, () => renderizar());
  let analises = [];

  async function carregar() {
    try {
      analises = await api("/api/analises");
    } catch (erro) {
      corpo.innerHTML = "";
      corpo.appendChild(criar("tr", {}, criar("td", { colspan: 11, classe: "empty", texto: erro.message })));
      return;
    }
    const clienteAtual = filtroCliente.value || clienteInicial;
    clienteInicial = "";
    const clientes = [...new Set(analises.map((a) => a.cliente).filter(Boolean))].sort((x, y) => x.localeCompare(y, "pt-BR"));
    A8.preencherSelect(filtroCliente, clientes, { vazio: "Todos os clientes" });
    filtroCliente.value = clientes.includes(clienteAtual) ? clienteAtual : "";
    const m = await A8.modelo();
    tiposOpcoes = m.tipos_reclamacao || [];
    tiposPadrao = m.tipos_padrao || [];
    if (!filtroTipos.length) filtroTipos = [...tiposPadrao]; // padrão: Formal, Informal, Logística
    desenharTipos();
    renderizar();
  }

  function renderizar() {
    const termo = busca.value.trim().toLowerCase();
    const status = filtroStatus.value;
    const cliente = filtroCliente.value;
    const hoje = hojeISO();
    const visiveis = analises.filter((a) => {
      if (status && a.status !== status) return false;
      if (!filtrosA3.testa(a)) return false;
      if (cliente && a.cliente !== cliente) return false;
      if (filtroArea && a.area_setor !== filtroArea) return false;
      if (filtroTipos.length && !filtroTipos.includes(a.tipo)) return false;
      if (filtroPrazo) {
        const vencido = a.status === "Em andamento" && a.prazo_limite && a.prazo_limite < hoje;
        if (filtroPrazo === "vencido" ? !vencido : (a.status !== "Em andamento" || vencido)) return false;
      }
      if (filtroEtapa && !(a.status === "Em andamento" && a.etapa_atual && a.etapa_atual.etapa === filtroEtapa)) return false;
      if (!termo) return true;
      return [a.id_mrhb, a.numero_notificacao, a.cliente, a.pn_mrhb, a.definicao_problema, a.responsavel, a.tema]
        .some((v) => (v || "").toLowerCase().includes(termo));
    });
    contador.textContent = `${visiveis.length} de ${analises.length} análises`;
    const avisoArea = document.getElementById("a8-filtro-area-aviso");
    avisoArea.hidden = !filtroArea;
    avisoArea.querySelector("span").textContent = `Área: ${filtroArea}`;
    const avisoPrazo = document.getElementById("a8-filtro-prazo-aviso");
    avisoPrazo.hidden = !filtroPrazo;
    avisoPrazo.querySelector("span").textContent = filtroPrazo === "vencido" ? "Prazo limite vencido" : "Dentro do prazo limite";
    const aviso = document.getElementById("a8-filtro-etapa-aviso");
    aviso.hidden = !filtroEtapa;
    aviso.querySelector("span").textContent = `Etapa do 8D: ${filtroEtapa}`;
    corpo.innerHTML = "";
    if (!visiveis.length) {
      corpo.appendChild(criar("tr", {}, criar("td", {
        colspan: 11, classe: "empty",
        texto: analises.length ? "Nenhuma análise com esses filtros." : "Nenhuma análise A3 criada ainda. Clique em “+ Nova análise A3”.",
      })));
      return;
    }
    visiveis.forEach((a) => {
      const limiteVencido = a.status === "Em andamento" && a.prazo_limite && a.prazo_limite < hoje;
      const r = a.acoes;
      const pct = r.total ? Math.round((100 * r.concluidas) / r.total) : 0;
      const classeBarra = r.atrasadas ? "critico" : pct === 100 ? "ok" : "atencao";
      const linha = criar("tr", { classe: "linha-clicavel", onclick: () => abrir(a.id) }, [
        criar("td", { classe: "id-mrhb", texto: a.id_mrhb }),
        criar("td", { texto: a.numero_notificacao || "" }),
        criar("td", { texto: a.cliente || "" }),
        criar("td", { texto: a.pn_mrhb || "" }),
        criar("td", { classe: "descricao-truncada", title: a.definicao_problema || "", texto: a.definicao_problema || "" }),
        criar("td", { texto: a.responsavel || "" }),
        criar("td", { classe: "a8-data", texto: fmtData(a.data_emissao) }),
        criar("td", { classe: `a8-data ${limiteVencido ? "etapa-atrasada" : ""}`, texto: fmtData(a.prazo_limite) }),
        criar("td", {}, celulaEtapa(a)),
        criar("td", {}, r.total
          ? criar("div", { classe: "progresso-coluna" }, [
              criar("div", { classe: "progresso-barra" },
                criar("div", { classe: `progresso-barra-preenchida ${classeBarra}`, style: `width:${pct}%` })),
              criar("span", { classe: "progresso-texto", texto: `${r.concluidas}/${r.total}${r.atrasadas ? ` · ${r.atrasadas} atras.` : ""}` }),
            ])
          : criar("span", { classe: "progresso-texto", texto: "sem ações" })),
        criar("td", {}, criar("span", {
          classe: `badge-status ${a.status === "Concluído" ? "ok" : a.status === "Cancelado" ? "cancelada" : "atencao"}`,
          texto: a.status === "Concluído" ? "Concluído · 8D Aprovado" : a.status,
        })),
      ]);
      corpo.appendChild(linha);
    });
  }

  // Etapa do 8D reconhecida pelo A3 (a primeira ainda não realizada).
  function celulaEtapa(a) {
    if (a.status === "Concluído") return criar("span", { classe: "a8-etapa-badge feita", texto: "8D Fechado ✓" });
    if (a.status === "Cancelado") return criar("span", { classe: "a8-etapa-badge", texto: "—" });
    const e = a.etapa_atual;
    if (!e) return criar("span", { classe: "a8-etapa-badge feita", texto: "Etapas realizadas" });
    return criar("span", {
      classe: `a8-etapa-badge ${e.atrasada ? "atrasada" : "atual"}`,
      title: `Prazo da etapa: ${fmtData(e.prazo)}${e.atrasada ? " (atrasada)" : ""}`,
      texto: e.atrasada ? `${e.etapa} · atrasada` : e.etapa,
    });
  }

  function abrir(id) {
    window.location.href = `${A8.base}/analises/${id}`;
  }

  A8.descreverFiltros = () => [
    busca.value.trim() && `Busca: "${busca.value.trim()}"`,
    filtroCliente.value && `Cliente: ${filtroCliente.value}`,
    `Status: ${filtroStatus.selectedOptions[0].text}`,
  ].filter(Boolean).join(" · ");

  busca.addEventListener("input", renderizar);
  filtroStatus.addEventListener("change", renderizar);
  filtroCliente.addEventListener("change", renderizar);
  document.querySelector("#a8-filtro-area-aviso button").addEventListener("click", () => {
    filtroArea = "";
    const p = new URLSearchParams(location.search);
    p.delete("area");
    history.replaceState(null, "", `${location.pathname}${p.toString() ? `?${p}` : ""}`);
    renderizar();
  });
  document.querySelector("#a8-filtro-prazo-aviso button").addEventListener("click", () => {
    filtroPrazo = "";
    const p = new URLSearchParams(location.search);
    p.delete("prazo");
    history.replaceState(null, "", `${location.pathname}${p.toString() ? `?${p}` : ""}`);
    renderizar();
  });
  document.querySelector("#a8-filtro-etapa-aviso button").addEventListener("click", () => {
    filtroEtapa = "";
    history.replaceState(null, "", location.pathname);
    renderizar();
  });

  // --- Nova análise -------------------------------------------------------
  const modal = document.getElementById("a8-modal-nova-analise");
  const form = document.getElementById("a8-form-nova-analise");
  const campoId = document.getElementById("a8-nova-id");
  const lista = document.getElementById("a8-lista-reclamacoes");
  const confirmacao = document.getElementById("a8-nova-confirmacao");
  const alerta = document.getElementById("a8-nova-alerta");
  let reclamacaoAtual = null;

  async function abrirNovaAnalise(idInicial = "") {
    const m = await A8.modelo();
    A8.preencherSelect(form.elements.tema, m.temas);
    form.reset();
    alerta.hidden = true;
    confirmacao.hidden = true;
    reclamacaoAtual = null;
    modal.hidden = false;
    campoId.value = idInicial;
    if (idInicial) verificarId();
    campoId.focus();
  }
  document.getElementById("a8-btn-nova-analise").addEventListener("click", () => abrirNovaAnalise());

  // --- Importar A3 em Excel (FM-QS-025) -------------------------------------------------
  const campoExcel = document.getElementById("a8-arquivo-excel");
  const botaoImportar = document.getElementById("a8-btn-importar-excel");
  botaoImportar.addEventListener("click", () => campoExcel.click());
  campoExcel.addEventListener("change", async () => {
    const arquivos = [...campoExcel.files];
    campoExcel.value = "";
    if (!arquivos.length) return;
    const fd = new FormData();
    arquivos.forEach((a) => fd.append("arquivos", a));
    const textoOriginal = botaoImportar.textContent;
    botaoImportar.disabled = true;
    botaoImportar.textContent = `Importando ${arquivos.length} arquivo(s)…`;
    try {
      const { resultados } = await api("/api/analises/importar-excel", { metodo: "POST", formData: fd });
      mostrarResultadoImportacao(resultados);
      await carregar();
    } catch (erro) {
      A8.toast(erro.message, "erro");
    } finally {
      botaoImportar.disabled = false;
      botaoImportar.textContent = textoOriginal;
    }
  });

  function mostrarResultadoImportacao(resultados) {
    const rotulo = { importado: "Importado", ignorado: "Já existia", erro: "Erro" };
    const classe = { importado: "ok", ignorado: "atencao", erro: "critico" };
    const conta = (s) => resultados.filter((r) => r.situacao === s).length;
    const fundo = criar("div", { classe: "a8-importacao-fundo", onclick: (e) => { if (e.target === fundo) fundo.remove(); } });
    const fechar = () => fundo.remove();
    fundo.appendChild(criar("div", { classe: "card a8-importacao-janela", role: "dialog", "aria-label": "Resultado da importação" }, [
      criar("h2", { texto: "Importação de A3 em Excel" }),
      criar("p", { classe: "a8-importacao-resumo",
        texto: `${conta("importado")} importado(s) · ${conta("ignorado")} já existia(m) · ${conta("erro")} com erro` }),
      criar("div", { classe: "table-wrap" }, criar("table", { classe: "a8-importacao-tabela" }, [
        criar("thead", {}, criar("tr", {}, ["Arquivo", "ID Wetzel", "Resultado", ""].map((t) => criar("th", { texto: t })))),
        criar("tbody", {}, resultados.map((r) => criar("tr", {}, [
          criar("td", { classe: "a8-importacao-arquivo", texto: r.arquivo, title: r.arquivo }),
          criar("td", { classe: "id-mrhb", texto: r.id_mrhb || "—" }),
          criar("td", {}, [criar("span", { classe: `badge-status ${classe[r.situacao]}`, texto: rotulo[r.situacao] }),
            criar("div", { classe: "a8-importacao-msg", texto: r.mensagem })]),
          criar("td", {}, r.analise_id ? criar("a", { href: `${A8.base}/analises/${r.analise_id}`, texto: "Abrir A3 →" }) : null),
        ]))),
      ])),
      criar("p", { classe: "a8-importacao-dica",
        texto: "O ID Wetzel é lido do campo \"Nº\" da folha FRP - A3 (não do nome do arquivo). Um A3 que já existe nunca é sobrescrito." }),
      criar("div", { classe: "a8-importacao-botoes" }, criar("button", { type: "button", classe: "btn btn-primary", texto: "Fechar", onclick: fechar })),
    ]));
    document.body.appendChild(fundo);
    const aoTeclar = (e) => { if (e.key === "Escape") { fechar(); document.removeEventListener("keydown", aoTeclar); } };
    document.addEventListener("keydown", aoTeclar);
  }

  // Vindo do Gerenciador (/acoes8d/a3/<ID>) para um ID que ainda não tem A3.
  const idVindoDoGerenciador = new URLSearchParams(location.search).get("novo");
  if (idVindoDoGerenciador) {
    history.replaceState(null, "", location.pathname);
    abrirNovaAnalise(idVindoDoGerenciador);
  }
  modal.querySelectorAll("[data-fechar]").forEach((b) => b.addEventListener("click", () => (modal.hidden = true)));
  modal.addEventListener("mousedown", (e) => { if (e.target === modal) modal.hidden = true; });

  let tempoBusca;
  campoId.addEventListener("input", () => {
    clearTimeout(tempoBusca);
    tempoBusca = setTimeout(async () => {
      const termo = campoId.value.trim();
      if (termo.length >= 2) {
        const resultados = await api(`/api/reclamacoes?q=${encodeURIComponent(termo)}`).catch(() => []);
        lista.innerHTML = "";
        resultados.forEach((r) => lista.appendChild(criar("option", {
          value: r.id_mrhb,
          label: `${r.cliente || ""} · ${r.pn_mrhb || ""} · ${r.descricao_defeito || ""}`,
        })));
      }
      verificarId();
    }, 250);
  });
  campoId.addEventListener("change", verificarId);

  async function verificarId() {
    const id = campoId.value.trim().toUpperCase();
    reclamacaoAtual = null;
    if (!/^[A-Z]-\d{5,}$/.test(id)) {
      confirmacao.hidden = true;
      return;
    }
    let r = null;
    try {
      r = await api(`/api/reclamacoes/${encodeURIComponent(id)}`);
    } catch (_) {
      r = null;
    }
    const titulo = confirmacao.querySelector("strong");
    const detalhe = confirmacao.querySelector(".pn-confirmacao-texto span");
    confirmacao.hidden = false;
    if (r && r.encontrado) {
      reclamacaoAtual = r;
      confirmacao.className = r.analise_id ? "pn-confirmacao miss" : "pn-confirmacao ok";
      confirmacao.querySelector(".pn-confirmacao-icone").textContent = r.analise_id ? "!" : "✓";
      titulo.textContent = r.analise_id
        ? "Este ID já tem uma análise A3 — ela será aberta."
        : `${r.cliente || ""} · PN ${r.pn_mrhb || ""} · ${r.numero_notificacao || ""}`;
      detalhe.textContent = `${r.descricao_defeito || ""} — aberta em ${fmtData(r.data_abertura)}`;
      if (!form.elements.data_emissao.value) form.elements.data_emissao.value = r.data_abertura || "";
    } else {
      confirmacao.className = "pn-confirmacao miss";
      confirmacao.querySelector(".pn-confirmacao-icone").textContent = "!";
      titulo.textContent = "ID não encontrado no Gerenciador.";
      detalhe.textContent = "Todo A3 precisa estar vinculado a uma reclamação. Cadastre a reclamação no Gerenciador primeiro ou confira o ID.";
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!reclamacaoAtual) await verificarId(); // garante a conferência mesmo sem sair do campo
    if (!reclamacaoAtual) {
      alerta.textContent = "Informe um ID Wetzel de uma reclamação cadastrada no Gerenciador (obrigatório para criar o A3).";
      alerta.hidden = false;
      campoId.focus();
      return;
    }
    if (reclamacaoAtual.analise_id) {
      abrir(reclamacaoAtual.analise_id);
      return;
    }
    try {
      const resposta = await api("/api/analises", {
        metodo: "POST",
        corpo: {
          id_mrhb: campoId.value,
          tema: form.elements.tema.value,
          responsavel: form.elements.responsavel.value,
          data_emissao: form.elements.data_emissao.value,
        },
      });
      abrir(resposta.id);
    } catch (erro) {
      alerta.textContent = erro.message;
      alerta.hidden = false;
    }
  });

  A8.modelo();
  carregar();
})();
