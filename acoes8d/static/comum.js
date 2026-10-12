// Utilitários compartilhados pelas telas do módulo Gestão de Ações 8D.
const A8 = (() => {
  const base = window.A8_BASE || "/acoes8d";
  let modeloCache = null;

  async function api(caminho, { metodo = "GET", corpo, formData } = {}) {
    const opcoes = { method: metodo, headers: {} };
    if (formData) {
      opcoes.body = formData;
    } else if (corpo !== undefined) {
      opcoes.headers["Content-Type"] = "application/json";
      opcoes.body = JSON.stringify(corpo);
    }
    const resposta = await fetch(base + caminho, opcoes);
    let dados = null;
    try {
      dados = await resposta.json();
    } catch (_) {
      /* resposta sem corpo JSON */
    }
    if (!resposta.ok) {
      throw new Error((dados && dados.erro) || `Erro ${resposta.status} ao comunicar com o servidor.`);
    }
    return dados;
  }

  async function modelo(recarregar = false) {
    if (!modeloCache || recarregar) {
      modeloCache = await api("/api/modelo");
      preencherDatalists(modeloCache);
    }
    return modeloCache;
  }

  function preencherDatalists(m) {
    const pessoas = document.getElementById("a8-lista-pessoas");
    const setores = document.getElementById("a8-lista-setores");
    if (pessoas) {
      pessoas.innerHTML = "";
      m.pessoas.forEach((p) => pessoas.appendChild(criar("option", { value: p.nome, label: p.setor || "" })));
    }
    if (setores) {
      setores.innerHTML = "";
      m.setores.forEach((s) => setores.appendChild(criar("option", { value: s })));
    }
  }

  // Cria um elemento. Texto sempre via textContent (nunca innerHTML com dados).
  function criar(tag, atributos = {}, filhos = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(atributos)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "texto") node.textContent = v;
      else if (k === "classe") node.className = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    (Array.isArray(filhos) ? filhos : [filhos]).forEach((f) => {
      if (f === null || f === undefined || f === false) return;
      node.appendChild(typeof f === "string" || typeof f === "number" ? document.createTextNode(String(f)) : f);
    });
    return node;
  }

  function hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function somarDias(iso, dias) {
    if (!iso || dias === null || dias === undefined) return "";
    const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
    const data = new Date(a, m - 1, d + dias);
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
  }

  function fmtData(iso) {
    if (!iso) return "";
    const [a, m, d] = String(iso).slice(0, 10).split("-");
    return d && m && a ? `${d}/${m}/${a}` : String(iso);
  }

  function toast(mensagem, tipo = "ok") {
    const el = document.getElementById("a8-toast");
    if (!el) return;
    el.textContent = mensagem;
    el.className = `a8-toast a8-toast-${tipo}`;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.hidden = true), 3200);
  }

  // Farol G/Y/R do FRP - A3, sempre com texto (cor nunca sozinha).
  // Filtros do A3 que vêm da Visão Geral pela URL (analista, peça, período).
  // Aparecem como etiquetas removíveis nas abas Formulário A3 e Gestão de Ações.
  // campos: como ler cada informação do item da lista ({analista, peca, data}).
  function filtrosA3DaUrl(caixa, campos, aoMudar) {
    const p = new URLSearchParams(location.search);
    const ativos = { analista: p.get("analista") || "", peca: p.get("peca") || "", de: p.get("de") || "", ate: p.get("ate") || "" };
    const fmt = (iso) => iso.split("-").reverse().join("/");
    const rotulos = () => [
      ["analista", ativos.analista && `Analista: ${ativos.analista}`],
      ["peca", ativos.peca && `Peça: ${ativos.peca}`],
      ["periodo", (ativos.de || ativos.ate) && `Período: ${ativos.de ? fmt(ativos.de) : "início"} a ${ativos.ate ? fmt(ativos.ate) : "hoje"}`],
    ].filter(([, t]) => t);
    const desenhar = () => {
      if (!caixa) return;
      caixa.innerHTML = "";
      const lista = rotulos();
      caixa.hidden = !lista.length;
      lista.forEach(([chave, texto]) => caixa.appendChild(criar("span", { classe: "a8-etiqueta-filtro" }, [
        criar("span", { texto }),
        criar("button", {
          type: "button", classe: "a8-etiqueta-remover", title: "Remover filtro", "aria-label": `Remover filtro ${texto}`, texto: "×",
          onclick: () => {
            if (chave === "periodo") { ativos.de = ""; ativos.ate = ""; } else ativos[chave] = "";
            desenhar();
            aoMudar();
          },
        }),
      ])));
    };
    desenhar();
    return {
      testa: (item) => {
        const data = (campos.data(item) || "").slice(0, 10);
        return (!ativos.analista || campos.analista(item) === ativos.analista)
          && (!ativos.peca || campos.peca(item) === ativos.peca)
          && (!ativos.de || data >= ativos.de)
          && (!ativos.ate || data <= ativos.ate);
      },
      parametros: () => Object.entries(ativos).filter(([, v]) => v),
      limpar: () => { Object.keys(ativos).forEach((k) => (ativos[k] = "")); desenhar(); },
      descricao: () => rotulos().map(([, t]) => t),
    };
  }

  // Mostra as opções de um <select> como botões (o select fica escondido e continua
  // sendo a fonte do valor, então filtros, URL e etiquetas seguem funcionando).
  function botoesDoSelect(select, caixa) {
    select.hidden = true;
    const desenhar = () => {
      caixa.innerHTML = "";
      [...select.options].forEach((opcao) => caixa.appendChild(criar("button", {
        type: "button",
        classe: `a8-botao-filtro ${select.value === opcao.value ? "ativo" : ""}`,
        "aria-pressed": String(select.value === opcao.value),
        texto: opcao.text,
        onclick: () => {
          // Clicar de novo no botão ativo volta para "Todos".
          select.value = select.value === opcao.value ? "" : opcao.value;
          select.dispatchEvent(new Event("change"));
        },
      })));
    };
    select.addEventListener("change", desenhar);
    desenhar();
    return desenhar;
  }

  function badgeSituacao(acao) {
    const mapa = {
      atrasada: ["critico", `Atrasada · ${acao.dias_atraso} d`],
      no_prazo: ["atencao", acao.vence_em_breve ? `Vence em ${acao.dias_para_vencer} d` : "No prazo"],
      concluida: ["ok", "Concluída"],
      cancelada: ["cancelada", "Cancelada"],
    };
    const [classe, texto] = mapa[acao.situacao] || ["", acao.status];
    return criar("span", { classe: `badge-status ${classe} a8-badge` }, [
      criar("span", { classe: "a8-farol", "aria-hidden": "true" }),
      texto,
    ]);
  }

  function preencherSelect(select, opcoes, { vazio } = {}) {
    select.innerHTML = "";
    if (vazio !== undefined) select.appendChild(criar("option", { value: "", texto: vazio }));
    opcoes.forEach((o) => {
      const [valor, rotulo] = Array.isArray(o) ? o : typeof o === "object" ? [o.valor, o.rotulo] : [o, o];
      select.appendChild(criar("option", { value: valor, texto: rotulo }));
    });
  }

  // --- Modal de ação ------------------------------------------------------
  const modal = {
    el: null,
    contexto: null,

    iniciar() {
      this.el = document.getElementById("a8-modal-acao");
      if (!this.el || this.el.dataset.iniciado) return;
      this.el.dataset.iniciado = "1";
      this.form = document.getElementById("a8-form-acao");
      this.campos = {};
      for (const nome of ["analise_id", "grupo", "subgrupo", "descricao", "responsavel", "setor", "data_abertura",
        "prazo", "motivo", "status", "data_conclusao", "eficaz", "abrangencia", "observacao"]) {
        this.campos[nome] = this.form.elements[nome];
      }
      this.el.querySelectorAll("[data-fechar-modal]").forEach((b) => b.addEventListener("click", () => this.fechar()));
      this.el.addEventListener("mousedown", (e) => { if (e.target === this.el) this.fechar(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !this.el.hidden) this.fechar(); });

      this.campos.grupo.addEventListener("change", () => this.aoMudarGrupo(true));
      this.campos.analise_id.addEventListener("change", () => {
        if (!this.campos.prazo.value) this.aoMudarGrupo(true);
        this.atualizarDicaPrazo();
      });
      this.campos.prazo.addEventListener("input", () => this.atualizarDicaPrazo());
      this.campos.status.addEventListener("change", () => this.aoMudarStatus());
      this.campos.responsavel.addEventListener("change", () => {
        const pessoa = (modeloCache.pessoas || []).find(
          (p) => p.nome.toLowerCase() === this.campos.responsavel.value.trim().toLowerCase()
        );
        if (pessoa && pessoa.setor) this.campos.setor.value = pessoa.setor;
      });
      this.form.addEventListener("submit", (e) => { e.preventDefault(); this.salvar(); });
      document.getElementById("a8-acao-excluir").addEventListener("click", () => this.excluir());
    },

    // contexto: { acao?, analiseId?, analises?, grupo?, aoSalvar }
    async abrir(contexto) {
      const m = await modelo();
      this.iniciar();
      this.contexto = contexto;
      const acao = contexto.acao || null;
      this.form.reset();
      this.mostrarErro("");

      const analises = contexto.analises || [];
      document.getElementById("a8-campo-analise").hidden = Boolean(contexto.analiseId || acao);
      preencherSelect(
        this.campos.analise_id,
        analises.map((a) => [a.id, `${a.id_mrhb} — ${a.cliente || "sem cliente"} — ${a.definicao_problema || ""}`.slice(0, 110)]),
        { vazio: "Selecione o A3…" }
      );

      preencherSelect(this.campos.grupo, m.grupos_acao.map((g) => [g.chave, g.secao ? `${g.secao} · ${g.rotulo}` : g.rotulo]));
      preencherSelect(this.campos.status, m.status_acao);
      preencherSelect(this.campos.eficaz, m.status_validacao, { vazio: "—" });

      document.getElementById("a8-modal-acao-titulo").textContent = acao ? "Editar ação" : "Nova ação";
      document.getElementById("a8-modal-acao-subtitulo").textContent = acao
        ? `${acao.id_mrhb} · aberta em ${fmtData(acao.data_abertura)}`
        : contexto.idMrhb || "";
      document.getElementById("a8-acao-excluir").hidden = !acao;

      if (acao) {
        this.campos.analise_id.value = acao.analise_id;
        this.campos.grupo.value = acao.grupo;
        this.aoMudarGrupo(false);
        for (const [nome, campo] of Object.entries(this.campos)) {
          if (nome in acao && nome !== "analise_id" && nome !== "grupo") campo.value = acao[nome] ?? "";
        }
        // Ações fixas da 3.1 (procedimento padrão): o texto não pode ser alterado aqui.
        const normal = (t) => (t || "").toLowerCase().replace(/\s+/g, " ").trim();
        const fixa = acao.grupo === "contencao" && acao.subgrupo === "3.1 Nacional"
          && (m.linhas_fixas_contencao || []).some((l) => normal(acao.descricao).startsWith(normal(l.texto).slice(0, 20)));
        this.campos.descricao.readOnly = fixa;
        this.campos.descricao.title = fixa ? "Texto padrão da 3.1. O nº do alerta, NF e QTD são preenchidos direto na folha A3." : "";
      } else {
        this.campos.descricao.readOnly = false;
        this.campos.descricao.title = "";
        if (contexto.analiseId) this.campos.analise_id.value = contexto.analiseId;
        this.campos.grupo.value = contexto.grupo || "corretiva";
        this.campos.data_abertura.value = hojeISO();
        this.campos.status.value = "Aberta";
        this.aoMudarGrupo(true);
      }
      this.aoMudarStatus();
      this.atualizarDicaPrazo();
      this.el.hidden = false;
      (acao ? this.campos.descricao : contexto.analiseId ? this.campos.descricao : this.campos.analise_id).focus();
    },

    fechar() {
      if (this.el) this.el.hidden = true;
    },

    analiseSelecionada() {
      const id = Number(this.contexto.analiseId || this.campos.analise_id.value);
      return (this.contexto.analises || []).find((a) => a.id === id) || this.contexto.analise || null;
    },

    aoMudarGrupo(sugerirPrazo) {
      const grupo = modeloCache.grupos_acao.find((g) => g.chave === this.campos.grupo.value);
      const valorAtual = this.campos.subgrupo.value;
      preencherSelect(this.campos.subgrupo, grupo ? grupo.subgrupos : [], { vazio: "—" });
      if (grupo && grupo.subgrupos.includes(valorAtual)) this.campos.subgrupo.value = valorAtual;
      document.getElementById("a8-campo-eficaz").hidden = this.campos.grupo.value !== "eficacia";

      // Prazo sugerido pelo próprio formulário (ex.: corretivas 14 dias, preventivas 35 dias).
      const analise = this.analiseSelecionada();
      if (sugerirPrazo && !this.contexto.acao && grupo && grupo.dias_sugeridos !== null && analise) {
        const sugerido = somarDias(analise.data_emissao, grupo.dias_sugeridos);
        this.campos.prazo.value = sugerido < hojeISO() ? hojeISO() : sugerido;
        this.atualizarDicaPrazo();
      }
    },

    aoMudarStatus() {
      const concluida = this.campos.status.value === "Concluída";
      this.campos.data_conclusao.disabled = !concluida;
      if (concluida && !this.campos.data_conclusao.value) this.campos.data_conclusao.value = hojeISO();
      if (!concluida) this.campos.data_conclusao.value = "";
    },

    atualizarDicaPrazo() {
      const dica = document.getElementById("a8-acao-prazo-dica");
      const acao = this.contexto && this.contexto.acao;
      const reprogramado = Boolean(acao) && this.campos.prazo.value !== acao.prazo;
      document.getElementById("a8-campo-motivo").hidden = !reprogramado;

      const analise = this.analiseSelecionada();
      dica.className = "hint";
      dica.textContent = "";
      if (acao && acao.reprogramada) dica.textContent = `Prazo original: ${fmtData(acao.prazo_original)}`;
      if (analise && analise.prazo_limite) {
        const limite = `Prazo limite do A3: ${fmtData(analise.prazo_limite)}`;
        if (this.campos.prazo.value && this.campos.prazo.value > analise.prazo_limite) {
          dica.className = "hint miss";
          dica.textContent = `Após o prazo limite do A3 (${fmtData(analise.prazo_limite)}).`;
        } else if (!dica.textContent) {
          dica.textContent = limite;
        }
      }
    },

    mostrarErro(mensagem) {
      const alerta = document.getElementById("a8-modal-acao-alerta");
      alerta.textContent = mensagem;
      alerta.hidden = !mensagem;
    },

    async salvar() {
      const corpo = {};
      for (const [nome, campo] of Object.entries(this.campos)) corpo[nome] = campo.value;
      corpo.analise_id = Number(this.contexto.analiseId || (this.contexto.acao && this.contexto.acao.analise_id) || corpo.analise_id);
      try {
        if (this.contexto.acao) {
          await api(`/api/acoes/${this.contexto.acao.id}`, { metodo: "PUT", corpo });
        } else {
          await api("/api/acoes", { metodo: "POST", corpo });
        }
      } catch (erro) {
        this.mostrarErro(erro.message);
        return;
      }
      this.fechar();
      toast(this.contexto.acao ? "Ação atualizada." : "Ação incluída.");
      if (this.contexto.aoSalvar) this.contexto.aoSalvar();
      modelo(true); // novas pessoas/setores entram nas listas de sugestão
    },

    async excluir() {
      const motivo = window.prompt("Motivo da exclusão desta ação (obrigatório):");
      if (motivo === null) return;
      if (!motivo.trim()) {
        this.mostrarErro("Informe o motivo da exclusão.");
        return;
      }
      try {
        await api(`/api/acoes/${this.contexto.acao.id}`, { metodo: "DELETE", corpo: { motivo } });
      } catch (erro) {
        this.mostrarErro(erro.message);
        return;
      }
      this.fechar();
      toast("Ação excluída.");
      if (this.contexto.aoSalvar) this.contexto.aoSalvar();
    },
  };

  // Impressão das abas (Visão Geral, Formulário A3, Gestão de Ações) em A3 paisagem.
  // Cada tela pode definir A8.descreverFiltros = () => "texto dos filtros".
  function prepararCabecalhoImpressao() {
    const d = new Date();
    const data = document.getElementById("a8-ci-data");
    const filtros = document.getElementById("a8-ci-filtros");
    if (data) {
      data.textContent = `Emitido em ${fmtData(hojeISO())} às ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    if (filtros) {
      const texto = typeof publico.descreverFiltros === "function" ? publico.descreverFiltros() : "";
      filtros.textContent = texto ? `Filtros: ${texto}` : "Sem filtros (visão completa)";
    }
  }
  window.addEventListener("beforeprint", prepararCabecalhoImpressao);

  function imprimirPagina() {
    prepararCabecalhoImpressao();
    window.print();
  }

  const publico = {
    base,
    imprimirPagina,
    descreverFiltros: null,
    api,
    modelo,
    criar,
    hojeISO,
    somarDias,
    fmtData,
    toast,
    badgeSituacao,
    filtrosA3DaUrl,
    botoesDoSelect,
    preencherSelect,
    abrirModalAcao: (contexto) => modal.abrir(contexto),
  };
  return publico;
})();
