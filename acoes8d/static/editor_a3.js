// Folha A3 digital (FM-QS-025), no mesmo formato da planilha: cada quadro é
// um campo editável. O cabeçalho vira colunas da tabela a3_analises
// ([data-cab]); o restante vai num JSON ([data-campo] = caminho no JSON) e é
// salvo automaticamente. Cada linha de ação é gravada na hora, pela API de
// ações, e aparece no Controle de Ações e no Dashboard.
(() => {
  const { api, criar, fmtData, hojeISO, somarDias, toast } = A8;
  const raiz = document.getElementById("a8-editor");
  const analiseId = Number(raiz.dataset.analiseId);
  const alerta = document.getElementById("a8-alerta-editor");
  const estadoSalvo = document.getElementById("a8-estado-salvo");
  const ESPERA_AUTOSALVAR = 1200;

  let modelo = null;
  let analise = null; // cabeçalho + acoes + anexos
  let dados = null; // JSON do formulário
  let sujo = false;
  let salvando = false;
  let salvarDeNovo = false;
  let temporizador = null;

  // --- Utilitários ---------------------------------------------------------
  function obter(obj, caminho) {
    return caminho.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function definir(obj, caminho, valor) {
    const partes = caminho.split(".");
    const ultimo = partes.pop();
    const alvo = partes.reduce((o, k) => (o[k] = o[k] ?? {}), obj);
    alvo[ultimo] = valor;
  }
  function fmtDataHora(texto) {
    return texto ? `${fmtData(texto)} ${String(texto).slice(11, 16)}` : "";
  }
  function mostrarErro(mensagem) {
    alerta.textContent = mensagem;
    alerta.hidden = !mensagem;
    if (mensagem) alerta.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function pessoaPorNome(nome) {
    const alvo = (nome || "").trim().toLowerCase();
    return modelo.pessoas.find((p) => p.nome.toLowerCase() === alvo);
  }
  function grupoDe(chave) {
    return modelo.grupos_acao.find((g) => g.chave === chave);
  }

  // --- Salvamento automático ------------------------------------------------
  function marcarSujo() {
    sujo = true;
    estadoSalvo.textContent = "Salvando…";
    estadoSalvo.className = "a8-estado-salvo a8-estado-pendente";
    clearTimeout(temporizador);
    temporizador = setTimeout(() => salvar(), ESPERA_AUTOSALVAR);
  }
  function marcarSalvo() {
    estadoSalvo.textContent = analise.atualizado_em ? `✓ Salvo · ${fmtDataHora(analise.atualizado_em)}` : "";
    estadoSalvo.className = "a8-estado-salvo";
  }

  function corpoParaSalvar() {
    const corpo = { dados: { ...dados, equipe: dados.equipe.filter((m) => (m.nome || "").trim() || (m.setor || "").trim()) } };
    raiz.querySelectorAll("[data-cab]").forEach((el) => (corpo[el.dataset.cab] = analise[el.dataset.cab] ?? ""));
    corpo.resultado_validacao = analise.resultado_validacao ?? ""; // quadro "Validação pelo Emissor" (checkboxes)
    corpo.prazo_limite = analise.prazo_limite ?? ""; // calculado (emissão + 31 dias), mostrado na barra
    return corpo;
  }

  // Salva já, esperando um salvamento automático que esteja em andamento terminar
  // (usado depois de ações importantes, como salvar uma evidência ou a ilustração).
  async function salvarAgora() {
    while (salvando) await new Promise((r) => setTimeout(r, 100));
    await salvar();
  }

  async function salvar() {
    clearTimeout(temporizador);
    if (salvando) {
      salvarDeNovo = true;
      return;
    }
    salvando = true;
    sujo = false;
    try {
      const resposta = await api(`/api/analises/${analiseId}`, { metodo: "PUT", corpo: corpoParaSalvar() });
      if (resposta && resposta.aviso) {
        analise.resultado_validacao = "";
        renderizarValidacaoEmissor();
        toast(resposta.aviso, "erro");
      }
      const atual = await api(`/api/analises/${analiseId}`);
      analise.atualizado_em = atual.atualizado_em;
      analise.data_fechamento = atual.data_fechamento;
      aplicarStatus(atual.status);
      renderizarEtapas(atual.etapas_8d);
      atualizarTextosCabecalho();
      mostrarErro("");
      if (!sujo) marcarSalvo();
    } catch (erro) {
      sujo = true;
      estadoSalvo.textContent = "Não salvo";
      estadoSalvo.className = "a8-estado-salvo a8-estado-erro";
      mostrarErro(`Não foi possível salvar: ${erro.message}`);
    } finally {
      salvando = false;
      if (salvarDeNovo) {
        salvarDeNovo = false;
        salvar();
      }
    }
  }

  // --- Texto sempre legível dentro do quadro -----------------------------------
  // Caixas de texto (textarea) quebram linha e crescem na altura. Campos de uma
  // linha (nomes com lista de sugestão, seleções, nº do alerta/NF/QTD) reduzem
  // a fonte até o texto caber (mínimo 8px); se ainda assim não couber, o texto
  // completo aparece ao passar o mouse.
  const regua = document.createElement("canvas").getContext("2d");
  const ALTURA_AUTOMATICA = window.CSS && CSS.supports("field-sizing", "content");
  const FONTE_MINIMA = 8;

  function larguraTexto(cs, texto, tamanho) {
    regua.font = `${cs.fontStyle} ${cs.fontWeight} ${tamanho}px ${cs.fontFamily}`;
    return regua.measureText(texto).width;
  }

  function ajustarCampo(el) {
    if (el.tagName === "TEXTAREA") {
      if (!ALTURA_AUTOMATICA) {
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight + 2}px`;
      }
      return;
    }
    if (["date", "checkbox", "file", "radio"].includes(el.type) || !el.clientWidth) return;
    const cs = getComputedStyle(el);
    if (!el.dataset.fonteBase) el.dataset.fonteBase = parseFloat(cs.fontSize);
    const base = Number(el.dataset.fonteBase);
    const texto = el.tagName === "SELECT" ? (el.selectedOptions[0]?.text || "") : (el.value || el.placeholder || "");
    const seta = el.tagName === "SELECT" && cs.appearance !== "none" ? 20 : 0;
    // Margem de segurança: a régua (canvas) mede um pouco menos que o texto renderizado.
    const disponivel = (el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - seta - 4) / 1.04;
    let tamanho = base;
    while (tamanho > FONTE_MINIMA && larguraTexto(cs, texto, tamanho) > disponivel) tamanho -= 0.5;
    el.style.fontSize = tamanho === base ? "" : `${tamanho}px`;
    if (larguraTexto(cs, texto, tamanho) > disponivel) el.title = texto;
  }

  let ajustePendente = false;
  function ajustarTodos() {
    if (ajustePendente) return;
    ajustePendente = true;
    requestAnimationFrame(() => {
      ajustePendente = false;
      document.querySelectorAll("#a3-folha input, #a3-folha select, #a3-folha textarea").forEach(ajustarCampo);
    });
  }

  function ligarAjusteDeTexto() {
    const folha = document.getElementById("a3-folha");
    folha.addEventListener("input", (e) => ajustarCampo(e.target));
    folha.addEventListener("change", (e) => ajustarCampo(e.target));
    new MutationObserver(ajustarTodos).observe(folha, { childList: true, subtree: true });
    window.addEventListener("resize", ajustarTodos);
    ajustarTodos();
  }

  // --- Carga -----------------------------------------------------------------
  async function iniciar() {
    try {
      modelo = await A8.modelo();
      raiz.querySelectorAll("select[data-opcoes]").forEach((s) => {
        A8.preencherSelect(s, modelo[s.dataset.opcoes] || [], s.dataset.vazio !== undefined ? { vazio: s.dataset.vazio } : {});
      });
      raiz.querySelectorAll('select[data-cab="status"] option[value="Concluído"]').forEach((o) => {
        o.disabled = true;
        o.textContent = "Concluído (automático)";
      });
      raiz.querySelectorAll('select[data-cab="status"]').forEach((s) => (s.title =
        "Concluído é automático: todas as ações concluídas (G) + \"8D Aprovado\" no Fechamento. Cancelado é manual."));
      analise = await api(`/api/analises/${analiseId}`);
      dados = analise.dados;
    } catch (erro) {
      mostrarErro(erro.message);
      return;
    }
    preencherCampos();
    atualizarTextosCabecalho();
    renderizarVinculo();
    renderizarEtapas(analise.etapas_8d);
    renderizarEquipe();
    renderizarIlustracao();
    renderizarPorques();
    renderizarIshikawa();
    renderizarValidacaoEmissor();
    renderizarTodasAcoes();
    renderizarAnexos();
    renderizarEvidencias();
    marcarSalvo();
    ligarEventos();
    ligarAjusteDeTexto();
  }

  function preencherCampos() {
    raiz.querySelectorAll("[data-cab]").forEach((el) => (el.value = analise[el.dataset.cab] ?? ""));
    raiz.querySelectorAll("[data-campo]").forEach((el) => (el.value = obter(dados, el.dataset.campo) ?? ""));
  }

  function atualizarTextosCabecalho() {
    raiz.querySelectorAll("[data-cab-texto]").forEach((el) => {
      const valor = analise[el.dataset.cabTexto] ?? "";
      el.textContent = ["atualizado_em", "prazo_limite"].includes(el.dataset.cabTexto) ? fmtData(valor) : valor;
    });
    raiz.querySelectorAll('[data-cab="data_fechamento"]').forEach((el) => (el.value = analise.data_fechamento || ""));
    document.title = `${analise.id_mrhb} · A3 · Sistema PDCA / 8D`;
  }

  function renderizarVinculo() {
    const caixa = document.getElementById("a8-vinculo-gerenciador");
    caixa.innerHTML = "";
    const r = analise.reclamacao;
    caixa.className = `a8-vinculo pn-confirmacao ${r ? "ok" : "miss"}`;
    caixa.append(
      criar("span", { classe: "pn-confirmacao-icone", texto: r ? "✓" : "!" }),
      criar("span", { classe: "pn-confirmacao-texto" }, r
        ? [
            criar("strong", { texto: `Vinculado ao Gerenciador: ${r.id_mrhb} · ${r.numero_notificacao || ""} · ${r.tipo_reclamacao || ""}` }),
            criar("span", { texto: `${r.cliente || ""} · PN ${r.pn_mrhb || ""} / ${r.pn_cliente || ""} · ${r.descricao_defeito || ""} · aberta em ${fmtData(r.data_abertura)}` }),
          ]
        : [
            criar("strong", { texto: "ID Wetzel não encontrado no banco do Gerenciador." }),
            criar("span", { texto: "Os dados da reclamação foram preenchidos manualmente neste A3." }),
          ])
    );
  }

  // --- 2 · Equipe (pares Nome/Setor, como no formulário) ---------------------
  function renderizarEquipe() {
    const corpo = document.getElementById("a3-equipe");
    corpo.innerHTML = "";
    const linhas = Math.max(4, Math.ceil((dados.equipe.length + 1) / 2));
    for (let l = 0; l < linhas; l += 1) {
      const tr = criar("tr");
      for (let c = 0; c < 2; c += 1) {
        const i = l * 2 + c;
        const membro = dados.equipe[i] || { nome: "", setor: "" };
        const nome = criar("input", { list: "a8-lista-pessoas", "aria-label": `Equipe — nome ${i + 1}` });
        const setor = criar("input", { list: "a8-lista-setores", classe: "a3-centro", "aria-label": `Equipe — setor ${i + 1}` });
        nome.value = membro.nome || "";
        setor.value = membro.setor || "";
        const garantir = () => {
          while (dados.equipe.length <= i) dados.equipe.push({ nome: "", setor: "" });
          return dados.equipe[i];
        };
        nome.addEventListener("input", () => { garantir().nome = nome.value; marcarSujo(); });
        nome.addEventListener("change", () => {
          const pessoa = pessoaPorNome(nome.value);
          if (pessoa && pessoa.setor && !setor.value) {
            setor.value = pessoa.setor;
            garantir().setor = pessoa.setor;
            marcarSujo();
          }
          if (l === linhas - 1 && nome.value.trim()) renderizarEquipe(); // sempre sobra uma linha livre
        });
        setor.addEventListener("input", () => { garantir().setor = setor.value; marcarSujo(); });
        tr.append(criar("td", {}, nome), criar("td", {}, setor));
      }
      corpo.appendChild(tr);
    }
  }

  // --- Ilustração (imagens no quadro, com colar Ctrl+V) -----------------------
  async function enviarArquivos(arquivos, secao, legenda = "") {
    for (const f of arquivos) {
      const fd = new FormData();
      fd.append("arquivo", f, f.name || `imagem-${Date.now()}.png`);
      fd.append("secao", secao);
      fd.append("legenda", legenda);
      await api(`/api/analises/${analiseId}/anexos`, { metodo: "POST", formData: fd });
    }
    const atual = await api(`/api/analises/${analiseId}`);
    analise.anexos = atual.anexos;
    renderizarAnexos();
  }

  async function excluirAnexo(x) {
    if (!confirm(`Excluir "${x.nome_original}"?`)) return;
    try {
      await api(`/api/anexos/${x.id}`, { metodo: "DELETE" });
      analise.anexos = analise.anexos.filter((a) => a.id !== x.id);
      renderizarIlustracao();
      renderizarAnexos();
    } catch (erro) {
      mostrarErro(erro.message);
    }
  }

  // --- Ilustração: o quadro mostra a imagem final; clicar abre o editor ------------
  const urlAnexo = (id) => `${A8.base}/anexos/${id}`;

  function renderizarIlustracao() {
    const celula = document.getElementById("a3-ilustracao");
    celula.innerHTML = "";
    const ilu = dados.ilustracao || {};
    const final = ilu.anexo_id && analise.anexos.find((x) => x.id === ilu.anexo_id);
    // A3 de antes do editor: imagens soltas no quadro.
    const antigas = final ? [] : analise.anexos.filter((x) => x.secao === "ilustracao");
    if (final) {
      celula.appendChild(criar("img", { classe: "a3-ilustracao-img", src: urlAnexo(final.id), alt: "Ilustração do problema" }));
    } else if (antigas.length) {
      celula.appendChild(criar("div", { classe: "a3-ilustracao-grade" }, antigas.map((x) =>
        criar("img", { classe: "a3-ilustracao-img", src: urlAnexo(x.id), alt: x.nome_original }))));
    } else {
      celula.appendChild(criar("div", { classe: "a3-ilustracao-vazia" }, [
        criar("strong", { texto: "Clique para montar a ilustração" }),
        criar("span", { texto: "Imagens, setas, círculos e textos" }),
      ]));
    }
    celula.appendChild(criar("span", { classe: "a3-ilustracao-editar", texto: "✎ Editar" }));
  }

  async function enviarBlob(blob, secao, nome) {
    const fd = new FormData();
    fd.append("arquivo", blob, nome);
    fd.append("secao", secao);
    const r = await api(`/api/analises/${analiseId}/anexos`, { metodo: "POST", formData: fd });
    return r.id;
  }

  // Salva uma cena do editor de imagem: envia as imagens novas como anexos,
  // gera a imagem final e apaga o que deixou de ser usado.
  // secaoFinal/secaoFonte: seções dos anexos; anexoAnterior: imagem final antiga.
  async function salvarCena(resultado, { secaoFinal, secaoFonte, nomeFinal, anexoAnterior, fontesEmUso }) {
    for (const o of resultado.objetos) {
      if (o.tipo === "imagem" && o.src.startsWith("data:")) {
        const blob = await (await fetch(o.src)).blob();
        const id = await enviarBlob(blob, secaoFonte, `imagem.${blob.type === "image/png" ? "png" : "jpg"}`);
        o.src = `anexo:${id}`;
      }
    }
    const novoId = resultado.objetos.length ? await enviarBlob(resultado.blob, secaoFinal, nomeFinal) : null;
    const usados = new Set([
      ...fontesEmUso(),
      ...resultado.objetos.filter((o) => o.tipo === "imagem").map((o) => Number(o.src.slice(6))),
    ]);
    for (const x of analise.anexos) {
      const fonteSobrando = x.secao === secaoFonte && !usados.has(x.id);
      if ((fonteSobrando || x.id === anexoAnterior) && x.id !== novoId) {
        await api(`/api/anexos/${x.id}`, { metodo: "DELETE" });
      }
    }
    return { cena: resultado.objetos, anexo_id: novoId };
  }

  const fontesDaCena = (cena) => (cena || []).filter((o) => o.tipo === "imagem" && String(o.src).startsWith("anexo:")).map((o) => Number(o.src.slice(6)));
  const resolverSrcCena = (src) => (src.startsWith("anexo:") ? urlAnexo(src.slice(6)) : src);

  // --- Evidências: uma por ação ------------------------------------------------------
  const ORDEM_GRUPOS = ["contencao", "corretiva", "preventiva", "retroalimentacao", "eficacia", "outra"];

  function secaoDaAcao(a) {
    if (a.grupo === "contencao") return a.subgrupo === "3.2 Exportação" ? "3.2 Exportação" : "3.1 Contenção Nacional";
    if (a.grupo === "corretiva") return `5 · Corretiva${a.subgrupo ? ` — ${a.subgrupo}` : ""}`;
    if (a.grupo === "preventiva") return "5 · Preventiva";
    if (a.grupo === "retroalimentacao") return `6 · Retroalimentação${a.subgrupo ? ` — ${a.subgrupo}` : ""}`;
    if (a.grupo === "eficacia") return "7 · Análise de Eficácia";
    return a.grupo_rotulo || "Outra";
  }

  function acoesComEvidencia() {
    return analise.acoes
      .filter((a) => a.status !== "Cancelada")
      .sort((x, y) => ORDEM_GRUPOS.indexOf(x.grupo) - ORDEM_GRUPOS.indexOf(y.grupo) || x.id - y.id);
  }

  function evidenciaDe(acao) {
    dados.evidencias = dados.evidencias || {};
    const ev = dados.evidencias[String(acao.id)];
    const final = ev && ev.anexo_id && analise.anexos.find((x) => x.id === ev.anexo_id);
    return { ev, final };
  }

  function textoStatus(a) {
    const letra = { "Concluída": "G", "Em andamento": "Y" }[a.status];
    const base = letra ? `${letra} — ${a.status}` : a.status;
    return a.situacao === "atrasada" ? `${base} · atrasada ${a.dias_atraso} d` : base;
  }

  function renderizarEvidencias() {
    const corpo = document.getElementById("a8-evidencias-corpo");
    if (!corpo) return;
    const acoes = acoesComEvidencia();
    corpo.innerHTML = "";
    if (!acoes.length) {
      corpo.appendChild(criar("tr", {}, criar("td", { colspan: 7, classe: "empty", texto: "Nenhuma ação lançada neste A3 ainda." })));
    }
    let comEvidencia = 0;
    acoes.forEach((a) => {
      const { final } = evidenciaDe(a);
      if (final) comEvidencia += 1;
      const imprimir = criar("input", { type: "checkbox", "aria-label": `Imprimir a evidência de: ${a.descricao}` });
      imprimir.checked = vaiImprimir(a);
      imprimir.addEventListener("change", () => {
        dados.imprimir_evidencias = dados.imprimir_evidencias || {};
        dados.imprimir_evidencias[String(a.id)] = imprimir.checked;
        marcarSujo();
        atualizarResumoImpressao();
        renderizarPaginasEvidencia();
      });
      corpo.appendChild(criar("tr", { classe: a.situacao === "atrasada" ? "a8-linha-atrasada" : "" }, [
        criar("td", { classe: "a8-evid-col-imprimir" }, imprimir),
        criar("td", { classe: "a8-evid-secao", texto: secaoDaAcao(a) }),
        criar("td", { classe: "a8-texto-acao", texto: a.descricao }),
        criar("td", { texto: a.responsavel }),
        criar("td", { classe: a.situacao === "atrasada" ? "etapa-atrasada" : "", texto: fmtData(a.prazo) }),
        criar("td", {}, criar("span", { classe: `a8-evid-status ${classeStatus(a)}`, texto: textoStatus(a) })),
        criar("td", { classe: "a8-evid-celula" }, [
          final ? criar("img", { classe: "a8-evid-miniatura", src: urlAnexo(final.id), alt: `Evidência: ${a.descricao}`, onclick: () => editarEvidencia(a) }) : null,
          ...pdfsDaEvidencia(evidenciaDe(a).ev).map((p) => criar("a", {
            classe: "a8-evid-pdf", href: urlAnexo(p.anexo_id), target: "_blank", rel: "noopener",
            title: `Abrir o PDF original (${p.paginas.length} página(s))`, texto: `PDF · ${p.nome}`,
          })),
          criar("button", {
            type: "button", classe: `btn btn-small ${final ? "btn-secondary" : "btn-primary"}`,
            texto: final ? "Editar evidência" : "+ Adicionar evidência",
            onclick: () => editarEvidencia(a),
          }),
        ]),
      ]));
    });
    const pill = document.getElementById("a8-evidencias-resumo");
    pill.textContent = acoes.length ? `${comEvidencia} de ${acoes.length} com evidência` : "";
    pill.className = `a3-resumo-pill ${acoes.length && comEvidencia === acoes.length ? "a3-farol-g" : ""}`;
    atualizarResumoImpressao();
    renderizarPaginasEvidencia();
  }

  // Imprimir esta evidência? Escolha do usuário; sem escolha, só se tiver evidência.
  function vaiImprimir(acao) {
    const escolha = (dados.imprimir_evidencias || {})[String(acao.id)];
    return escolha === undefined ? Boolean(evidenciaDe(acao).final) : Boolean(escolha);
  }

  function atualizarResumoImpressao() {
    const acoes = acoesComEvidencia();
    const marcadas = acoes.filter(vaiImprimir).length;
    const todas = document.getElementById("a8-evid-imprimir-todas");
    if (todas) {
      todas.checked = acoes.length > 0 && marcadas === acoes.length;
      todas.indeterminate = marcadas > 0 && marcadas < acoes.length;
    }
    const botao = document.getElementById("a8-btn-imprimir");
    if (botao) botao.title = `Folha A3 + ${marcadas} evidência(s) selecionada(s), uma por folha A3. Para PDF, escolha "Salvar como PDF".`;
  }

  // PDFs de uma evidência que continuam valendo: os que ainda têm alguma
  // página na cena (tirar todas as páginas do PDF da cena = remover o PDF).
  const pdfsDaEvidencia = (ev) => (ev && ev.pdfs) || [];
  const paginasDosPdfs = (pdfs) => pdfs.flatMap((p) => p.paginas);

  async function editarEvidencia(acao) {
    const { ev } = evidenciaDe(acao);
    const pdfsNovos = []; // PDFs enviados nesta edição
    const resultado = await A3Ilustracao.abrir({
      objetos: (ev && ev.cena) || [],
      resolverSrc: resolverSrcCena,
      titulo: `Evidência — ${acao.descricao} · ${acao.responsavel} · prazo ${fmtData(acao.prazo)}`,
      converterPdf: async (arquivo) => {
        const fd = new FormData();
        fd.append("arquivo", arquivo, arquivo.name);
        const r = await api(`/api/analises/${analiseId}/evidencia-pdf`, { metodo: "POST", formData: fd });
        pdfsNovos.push({ anexo_id: r.pdf.id, nome: r.pdf.nome, paginas: r.paginas.map((p) => p.id) });
        return r.paginas.map((p) => ({ src: `anexo:${p.id}`, largura: p.largura, altura: p.altura }));
      },
    });
    const apagarPdfs = async (pdfs) => {
      for (const p of pdfs) {
        for (const id of [p.anexo_id, ...p.paginas]) await api(`/api/anexos/${id}`, { metodo: "DELETE" }).catch(() => {});
      }
    };
    if (!resultado) {
      await apagarPdfs(pdfsNovos); // cancelou: descarta os PDFs enviados nesta edição
      if (pdfsNovos.length) analise.anexos = (await api(`/api/analises/${analiseId}`)).anexos;
      return;
    }
    estadoSalvo.textContent = "Salvando evidência…";
    estadoSalvo.className = "a8-estado-salvo a8-estado-pendente";
    try {
      const chave = String(acao.id);
      const naCena = new Set(fontesDaCena(resultado.objetos));
      const todosPdfs = [...pdfsDaEvidencia(ev), ...pdfsNovos];
      const pdfsMantidos = todosPdfs.filter((p) => p.paginas.some((id) => naCena.has(id)));
      const pdfsRemovidos = todosPdfs.filter((p) => !pdfsMantidos.includes(p));
      const salva = await salvarCena(resultado, {
        secaoFinal: "evidencia_acao",
        secaoFonte: "evidencia_fonte",
        nomeFinal: `evidencia-${analise.id_mrhb}-acao-${acao.id}.jpg`,
        anexoAnterior: ev ? ev.anexo_id : null,
        // não apagar: imagens das evidências das OUTRAS ações e todas as páginas dos PDFs mantidos
        fontesEmUso: () => [
          ...Object.entries(dados.evidencias || {}).filter(([k]) => k !== chave)
            .flatMap(([, e]) => [...fontesDaCena(e.cena), ...paginasDosPdfs(pdfsDaEvidencia(e))]),
          ...paginasDosPdfs(pdfsMantidos),
        ],
      });
      await apagarPdfs(pdfsRemovidos.map((p) => ({ anexo_id: p.anexo_id, paginas: [] })));
      dados.evidencias = dados.evidencias || {};
      if (salva.cena.length) dados.evidencias[chave] = { ...salva, pdfs: pdfsMantidos };
      else delete dados.evidencias[chave];
      await salvarAgora();
      analise.anexos = (await api(`/api/analises/${analiseId}`)).anexos;
      renderizarEvidencias();
      toast("Evidência salva.");
    } catch (erro) {
      mostrarErro(`Não foi possível salvar a evidência: ${erro.message}`);
    }
  }

  // Páginas de impressão: uma folha A3 por ação (ficam prontas e escondidas na
  // tela, para as imagens já estarem carregadas quando o usuário imprimir).
  function renderizarPaginasEvidencia() {
    const caixa = document.getElementById("a3-impressao-evidencias");
    if (!caixa) return;
    caixa.innerHTML = "";
    const acoes = acoesComEvidencia().filter(vaiImprimir);
    acoes.forEach((a, i) => {
      const { final } = evidenciaDe(a);
      const campo = (rotulo, valor, classe = "") => criar("div", { classe: `a3-ev-campo ${classe}` }, [
        criar("span", { classe: "a3-ev-rot", texto: rotulo }), criar("span", { classe: "a3-ev-val", texto: valor || "—" }),
      ]);
      caixa.appendChild(criar("section", { classe: "a3-ev-pagina" }, [
        criar("div", { classe: "a3-ev-topo" }, [
          criar("div", { classe: "a3-ev-doc" }, [criar("img", { src: `${A8.base}/static/img/logo_wetzel.png`, alt: "Wetzel Automotiva" }), criar("span", { texto: "FM-QS-025" })]),
          criar("h2", { classe: "a3-ev-titulo", texto: "Evidência de Ação — A3" }),
          criar("div", { classe: "a3-ev-numero" }, [
            criar("strong", { texto: analise.id_mrhb }),
            criar("span", { texto: `Ação ${i + 1} de ${acoes.length}` }),
          ]),
        ]),
        criar("div", { classe: "a3-ev-dados" }, [
          campo("Seção", secaoDaAcao(a)),
          campo("Descrição da ação", a.descricao, "a3-ev-largo"),
          campo("Responsável", a.responsavel),
          campo("Setor", a.setor),
          campo("Prazo", fmtData(a.prazo)),
          campo("Status", textoStatus(a), `a3-ev-status ${classeStatus(a)}`),
          campo("Conclusão", fmtData(a.data_conclusao)),
          campo("Cliente / PN", [analise.cliente, analise.pn_mrhb].filter(Boolean).join(" · "), "a3-ev-largo"),
        ]),
        criar("div", { classe: "a3-ev-imagem" }, final
          ? criar("img", { src: urlAnexo(final.id), alt: `Evidência: ${a.descricao}` })
          : criar("p", { classe: "a3-ev-sem", texto: "Evidência não anexada." })),
      ]));
      // Cada página dos PDFs da evidência sai em tamanho cheio, numa folha própria.
      pdfsDaEvidencia(evidenciaDe(a).ev).forEach((pdf) => {
        pdf.paginas.forEach((paginaId, n) => {
          caixa.appendChild(criar("section", { classe: "a3-ev-pagina" }, [
            criar("div", { classe: "a3-ev-topo" }, [
              criar("div", { classe: "a3-ev-doc" }, [criar("img", { src: `${A8.base}/static/img/logo_wetzel.png`, alt: "Wetzel Automotiva" }), criar("span", { texto: "FM-QS-025" })]),
              criar("h2", { classe: "a3-ev-titulo a3-ev-titulo-menor", texto: `Anexo da evidência — ${pdf.nome}` }),
              criar("div", { classe: "a3-ev-numero" }, [
                criar("strong", { texto: analise.id_mrhb }),
                criar("span", { texto: `Ação ${i + 1} · página ${n + 1} de ${pdf.paginas.length}` }),
              ]),
            ]),
            criar("div", { classe: "a3-ev-dados" }, [
              campo("Descrição da ação", a.descricao, "a3-ev-largo"),
              campo("Responsável", a.responsavel),
            ]),
            criar("div", { classe: "a3-ev-imagem" }, criar("img", { src: urlAnexo(paginaId), alt: `${pdf.nome} — página ${n + 1}` })),
          ]));
        });
      });
    });
  }

  async function editarIlustracao() {
    const ilu = dados.ilustracao || { cena: [], anexo_id: null };
    let objetos = ilu.cena || [];
    if (!objetos.length) {
      // Primeira edição de um A3 que já tinha imagens soltas: entram lado a lado.
      const antigas = analise.anexos.filter((x) => x.secao === "ilustracao");
      const largura = A3Ilustracao.LARGURA / Math.max(antigas.length, 1);
      objetos = antigas.map((x, i) => ({ tipo: "imagem", x: i * largura + 10, y: 10, w: largura - 20, h: (largura - 20) * 0.75, src: `anexo:${x.id}` }));
    }
    const resultado = await A3Ilustracao.abrir({
      objetos,
      resolverSrc: (src) => (src.startsWith("anexo:") ? urlAnexo(src.slice(6)) : src),
    });
    if (!resultado) return;

    estadoSalvo.textContent = "Salvando ilustração…";
    estadoSalvo.className = "a8-estado-salvo a8-estado-pendente";
    try {
      // 1) Imagens novas viram anexos (para a ilustração continuar editável).
      for (const o of resultado.objetos) {
        if (o.tipo === "imagem" && o.src.startsWith("data:")) {
          const blob = await (await fetch(o.src)).blob();
          const id = await enviarBlob(blob, "ilustracao_fonte", `imagem.${blob.type === "image/png" ? "png" : "jpg"}`);
          o.src = `anexo:${id}`;
        }
      }
      // 2) Imagem final, como ficou no editor.
      const novoId = resultado.objetos.length
        ? await enviarBlob(resultado.blob, "ilustracao", `ilustracao-${analise.id_mrhb}.jpg`)
        : null;
      // 3) Remove o que não é mais usado (imagem final antiga, imagens tiradas da cena).
      const usados = new Set(resultado.objetos.filter((o) => o.tipo === "imagem").map((o) => Number(o.src.slice(6))));
      for (const x of analise.anexos) {
        if ((x.secao === "ilustracao" || x.secao === "ilustracao_fonte") && !usados.has(x.id) && x.id !== novoId) {
          await api(`/api/anexos/${x.id}`, { metodo: "DELETE" });
        }
      }
      dados.ilustracao = { cena: resultado.objetos, anexo_id: novoId };
      await salvarAgora();
      analise.anexos = (await api(`/api/analises/${analiseId}`)).anexos;
      renderizarIlustracao();
      toast("Ilustração salva.");
    } catch (erro) {
      mostrarErro(`Não foi possível salvar a ilustração: ${erro.message}`);
    }
  }

  // --- 5 Porquês ----------------------------------------------------------------
  function tituloPorque(i) {
    const problema = (analise.definicao_problema || "").trim() || "o problema";
    return `${modelo.porques[i][1].replace("?", "")} ${problema}?`;
  }

  function renderizarPorques() {
    const cabecalho = document.getElementById("a3-porques-cabecalho");
    cabecalho.innerHTML = "";
    cabecalho.appendChild(criar("th"));
    modelo.porques.forEach((_, i) => cabecalho.appendChild(criar("th", { classe: "a3-porque-titulo", texto: tituloPorque(i) })));
    const corpo = document.getElementById("a3-porques");
    corpo.innerHTML = "";
    for (let n = 0; n < 5; n += 1) {
      const tr = criar("tr", {}, criar("th", { classe: "a3-rot-cel a3-centro", texto: `${n + 1}º` }));
      modelo.porques.forEach(([chave]) => {
        const campo = criar("textarea", { rows: 2, classe: "a3-centro a3-texto-pequeno", "data-campo": `porques.${chave}.respostas.${n}`, "aria-label": `${chave} — ${n + 1}º por quê` });
        campo.value = dados.porques[chave].respostas[n] || "";
        tr.appendChild(criar("td", {}, campo));
      });
      corpo.appendChild(tr);
    }
    const causa = criar("tr", { classe: "a3-causa-raiz" }, criar("th", { classe: "a3-rot-cel a3-vertical" }, criar("span", { texto: "Causa Raiz" })));
    modelo.porques.forEach(([chave]) => {
      const campo = criar("textarea", { rows: 3, classe: "a3-centro", "data-campo": `porques.${chave}.causa_raiz`, "aria-label": `Causa raiz — ${chave}` });
      campo.value = dados.porques[chave].causa_raiz || "";
      causa.appendChild(criar("td", {}, campo));
    });
    corpo.appendChild(causa);
  }

  // --- 4 · Ishikawa -------------------------------------------------------------
  function renderizarIshikawa() {
    const caixa = document.getElementById("a3-ishikawa");
    caixa.innerHTML = "";
    const rotulos = { material: "MATERIAL", mao_obra: "MÃO DE OBRA", maquina: "MÁQUINA", medicao: "MEDIÇÃO", metodo: "MÉTODO", meio_ambiente: "MEIO-AMBIENTE" };
    const campo = (chave) => {
      const t = criar("textarea", { classe: "a3-centro a3-texto-pequeno", "data-campo": `ishikawa.${chave}`, "aria-label": rotulos[chave], placeholder: "Uma causa por linha" });
      t.value = dados.ishikawa[chave] || "";
      return criar("div", { classe: `a3-ish-causa a3-ish-${chave}` }, t);
    };
    const rotulo = (chave) => criar("div", { classe: `a3-ish-rotulo a3-ish-r-${chave}`, texto: rotulos[chave] });
    caixa.append(
      ...["material", "mao_obra", "maquina"].map(campo),
      ...["material", "mao_obra", "maquina"].map(rotulo),
      criar("div", { classe: "a3-ish-espinha" }),
      criar("div", { classe: "a3-ish-problema" }, [
        criar("div", { classe: "a3-ish-problema-rotulo", texto: "PROBLEMA" }),
        criar("div", { classe: "a3-ish-problema-texto", id: "a3-ish-problema", texto: analise.definicao_problema || "" }),
      ]),
      ...["medicao", "metodo", "meio_ambiente"].map(rotulo),
      ...["medicao", "metodo", "meio_ambiente"].map(campo),
    );
  }

  // --- 8 · Validação pelo emissor --------------------------------------------------
  // Etapas do 8D (anteriores ao fechamento) ainda não realizadas.
  let ultimasEtapas = null;
  function pendentesParaFechar(resultado = ultimasEtapas) {
    if (!resultado) return [];
    return resultado.etapas.filter((e) => e.etapa !== "8D Fechado" && e.aplicavel && !e.realizacao).map((e) => e.etapa);
  }

  async function tentarAprovar(caixa) {
    // Salva o que foi digitado (ex.: Lições Aprendidas) e confere as etapas no servidor.
    caixa.checked = false;
    await salvarAgora();
    await atualizarStatusDoServidor();
    const pendentes = pendentesParaFechar();
    if (pendentes.length) {
      toast(`Para marcar 8D Aprovado, conclua antes: ${pendentes.join(", ")}.`, "erro");
      renderizarValidacaoEmissor();
      document.getElementById("a3-etapas")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    analise.resultado_validacao = "8D Aprovado";
    renderizarValidacaoEmissor();
    marcarSujo();
  }

  function renderizarValidacaoEmissor() {
    const celula = document.getElementById("a3-validacao");
    celula.innerHTML = "";
    const classes = ["a3-val-aprovado", "a3-val-condicional", "a3-val-reprovado"];
    const pendentes = pendentesParaFechar();
    modelo.resultados_validacao.forEach((rotulo, i) => {
      const bloqueado = rotulo === "8D Aprovado" && pendentes.length && analise.resultado_validacao !== rotulo;
      const caixa = criar("input", { type: "checkbox", "aria-label": rotulo });
      caixa.checked = analise.resultado_validacao === rotulo;
      caixa.addEventListener("change", () => {
        if (rotulo === "8D Aprovado" && caixa.checked) { tentarAprovar(caixa); return; }
        analise.resultado_validacao = caixa.checked ? rotulo : "";
        renderizarValidacaoEmissor();
        marcarSujo();
      });
      celula.appendChild(criar("label", {
        classe: `a3-val-opcao ${classes[i]} ${bloqueado ? "a3-val-bloqueado" : ""}`,
        title: bloqueado ? `Conclua antes: ${pendentes.join(", ")}` : null,
      }, [caixa, criar("span", { texto: rotulo })]));
    });
    if (pendentes.length) {
      celula.appendChild(criar("div", { classe: "a3-val-pendencias" }, [
        criar("strong", { texto: "Para aprovar, faltam:" }),
        criar("span", { texto: pendentes.join(" · ") }),
      ]));
    }
  }

  // --- Ações dentro da folha ----------------------------------------------------------

  function colunasDoGrupo(grupo) {
    if (grupo === "contencao") return ["descricao", "responsavel", "prazo", "status"];
    if (grupo === "corretiva" || grupo === "preventiva") return ["rotulo", "descricao", "responsavel", "prazo", "status", "abrangencia"];
    if (grupo === "retroalimentacao") return ["rotulo", "descricao", "responsavel", "prazo", "status"];
    if (grupo === "eficacia") return ["descricao", "responsavel", "prazo", "status", "eficaz"];
    return ["descricao", "responsavel", "prazo", "status"];
  }

  function textoModelo(texto) {
    return texto.replaceAll("{id}", analise.id_mrhb);
  }

  function mesmoTexto(a, b) {
    const normal = (t) => (t || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 20);
    return normal(a) === normal(b);
  }

  function prazoSugerido(grupo) {
    const g = grupoDe(grupo);
    if (!g || g.dias_sugeridos === null) return "";
    const sugerido = somarDias(analise.data_emissao, g.dias_sugeridos);
    return sugerido < hojeISO() ? hojeISO() : sugerido;
  }

  function camposDaAcao(acao) {
    const corpo = {};
    for (const c of ["grupo", "subgrupo", "descricao", "responsavel", "setor", "data_abertura", "prazo", "status", "data_conclusao", "abrangencia", "eficaz", "observacao"]) {
      corpo[c] = acao[c] ?? "";
    }
    return corpo;
  }

  // Texto de uma ação fixa da 3.1, com os quadros preenchidos (nº do alerta, NF, QTD).
  // Texto base de uma linha fixa da 3.1: o padrão ou o alterado pelo lápis neste A3.
  // Linhas fixas: def.area diz onde ficam os quadros e o texto alterado
  // ("contencao" -> dados.contencao, "eficacia" -> dados.eficacia).
  const areaDe = (def) => dados[def.area || "contencao"];

  function textoBase(def) {
    return ((areaDe(def).textos || {})[def.texto] || "").trim() || def.texto;
  }

  function textoFixo(def) {
    const c = areaDe(def);
    const soltos = def.campos.filter((x) => !x.rotulo).map((x) => (c[x.chave] || "").trim()).filter(Boolean);
    const rotulados = def.campos.filter((x) => x.rotulo && (c[x.chave] || "").trim()).map((x) => `${x.rotulo} ${c[x.chave].trim()}`);
    return [textoBase(def), ...soltos].join(" ") + (rotulados.length ? ` — ${rotulados.join(" ")}` : "");
  }

  const SVG_LAPIS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

  // Lápis (fora da folha, à esquerda): edita o texto padrão da ação só neste A3.
  function editarTextoFixo(ctx, span) {
    const def = ctx.fixo;
    const campo = criar("input", { classe: "a3-desc-edicao", "aria-label": "Texto da ação (vazio = volta ao padrão)" });
    campo.value = textoBase(def);
    span.replaceWith(campo);
    campo.focus();
    campo.select();
    let concluido = false;
    const concluir = async (gravar) => {
      if (concluido) return;
      concluido = true;
      if (gravar) {
        const area = areaDe(def);
        area.textos = area.textos || {};
        const novo = campo.value.trim();
        const anterior = textoBase(def);
        if (!novo || novo === def.texto) delete area.textos[def.texto];
        else area.textos[def.texto] = novo;
        if (textoBase(def) !== anterior) {
          marcarSujo();
          if (ctx.acao) {
            try {
              await api(`/api/acoes/${ctx.acao.id}`, { metodo: "PUT", corpo: { ...camposDaAcao(ctx.acao), descricao: textoFixo(def) } });
              await recarregarAcoes();
            } catch (erro) {
              mostrarErro(erro.message);
            }
          }
          toast(novo && novo !== def.texto ? "Texto da ação alterado neste A3." : "Texto padrão restaurado.");
        }
      }
      (ctx.redesenhar || renderizarContencaoNacional)();
    };
    campo.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); concluir(true); }
      if (e.key === "Escape") { e.preventDefault(); concluir(false); }
    });
    campo.addEventListener("blur", () => concluir(true));
  }

  // Status como no formulário: G = Concluída (verde), Y = Em andamento
  // (amarelo), em branco = Aberta; atrasada fica vermelha. Ao abrir a lista,
  // as opções mostram o nome completo.
  const STATUS_CURTO = { Aberta: "", "Em andamento": "Y", "Concluída": "G", Cancelada: "C" };
  const STATUS_LONGO = { Aberta: "Aberta (em branco)", "Em andamento": "Y — Em andamento", "Concluída": "G — Concluída", Cancelada: "C — Cancelada" };

  function selectStatus() {
    const el = criar("select", { "aria-label": "Status" });
    modelo.status_acao.forEach((v) => el.appendChild(criar("option", { value: v, texto: STATUS_CURTO[v] ?? v })));
    const longo = () => [...el.options].forEach((o) => (o.textContent = STATUS_LONGO[o.value] ?? o.value));
    const curto = () => [...el.options].forEach((o) => (o.textContent = STATUS_CURTO[o.value] ?? o.value));
    el.addEventListener("mousedown", longo);
    el.addEventListener("keydown", longo);
    el.addEventListener("change", curto);
    el.addEventListener("blur", curto);
    return el;
  }

  function classeStatus(a) {
    if (!a) return "";
    if (a.situacao === "atrasada") return "a3-farol-r";
    return { "Concluída": "a3-farol-g", "Em andamento": "a3-farol-y", Cancelada: "a3-farol-x" }[a.status] || "";
  }

  const SVG_LIXEIRA = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

  function botaoLixeira(aoClicar) {
    const botao = criar("button", { type: "button", classe: "a3-btn-lixeira", title: "Excluir linha", "aria-label": "Excluir linha", onclick: aoClicar });
    botao.innerHTML = SVG_LIXEIRA; // SVG fixo do próprio código, sem dados do usuário
    return botao;
  }

  // Uma linha de ação. ctx: { acao? (existente), grupo, subgrupo, rotulo, modeloTexto, fixo? (linha fixa da 3.1) }
  function linhaAcao(ctx, aoCriar) {
    const tr = criar("tr", { classe: "a3-linha-acao" });
    const rascunho = { grupo: ctx.grupo, subgrupo: ctx.subgrupo || "", status: "Aberta" };
    const valor = (campo) => (ctx.acao ? ctx.acao[campo] : rascunho[campo]) ?? "";
    const campos = {};

    const pintar = () => {
      tr.classList.toggle("a3-linha-atrasada", Boolean(ctx.acao && ctx.acao.situacao === "atrasada"));
      if (campos.status) {
        campos.status.className = `a3-status ${classeStatus(ctx.acao)}`;
        campos.status.title = ctx.acao ? `${ctx.acao.status} · ${situacaoTexto(ctx.acao)}` : "Aberta";
      }
      if (campos.prazo) campos.prazo.classList.toggle("a3-texto-atrasado", Boolean(ctx.acao && ctx.acao.situacao === "atrasada"));
    };

    // 3.1: só pode ficar G (Concluída) com os quadros da linha preenchidos.
    function bloqueiaConclusao(campo, novo, elemento) {
      if (!ctx.fixo || campo !== "status" || novo !== "Concluída") return false;
      const vazios = ctx.fixo.campos.filter((c) => !(areaDe(ctx.fixo)[c.chave] || "").trim());
      if (!vazios.length) return false;
      elemento.value = ctx.acao ? ctx.acao.status : (rascunho.status = "Aberta");
      elemento.dispatchEvent(new Event("blur")); // volta a mostrar só a letra
      vazios.forEach((c) => {
        const q = tr.querySelector(`[data-campo="contencao.${c.chave}"]`);
        if (q) { q.classList.add("a8-invalido"); setTimeout(() => q.classList.remove("a8-invalido"), 4000); }
      });
      tr.querySelector(`[data-campo="contencao.${vazios[0].chave}"]`)?.focus();
      toast(`Para marcar G, preencha antes: ${vazios.map((c) => c.nome).join(", ")}.`, "erro");
      return true;
    }

    async function aoMudar(campo, elemento) {
      const novo = elemento.value;
      if (bloqueiaConclusao(campo, novo, elemento)) return;
      if (ctx.acao) {
        if (novo === (ctx.acao[campo] ?? "")) return;
        const corpo = { ...camposDaAcao(ctx.acao), [campo]: novo };
        if (campo === "prazo") {
          const motivo = prompt(`Reprogramar o prazo de ${fmtData(ctx.acao.prazo)} para ${fmtData(novo)}.\nMotivo (obrigatório):`);
          if (!motivo || !motivo.trim()) {
            elemento.value = ctx.acao.prazo;
            return;
          }
          corpo.motivo = motivo;
        }
        if (campo === "status") corpo.data_conclusao = "";
        if (campo === "responsavel") {
          const pessoa = pessoaPorNome(novo);
          if (pessoa && pessoa.setor) corpo.setor = pessoa.setor;
        }
        try {
          await api(`/api/acoes/${ctx.acao.id}`, { metodo: "PUT", corpo });
        } catch (erro) {
          elemento.value = ctx.acao[campo] ?? "";
          mostrarErro(erro.message);
          return;
        }
        await recarregarAcoes();
        ctx.acao = analise.acoes.find((a) => a.id === ctx.acao.id) || ctx.acao;
        pintar();
        mostrarErro("");
        estadoSalvo.textContent = "✓ Ação salva";
        return;
      }

      // Linha nova: vira ação quando tiver descrição, responsável e prazo.
      rascunho[campo] = novo;
      if ((campo === "descricao" || campo === "responsavel") && !rascunho.prazo && campos.prazo) {
        rascunho.prazo = prazoSugerido(ctx.grupo);
        campos.prazo.value = rascunho.prazo;
      }
      const descricao = ctx.fixo ? textoFixo(ctx.fixo)
        : (rascunho.descricao || "").trim() || (ctx.modeloTexto ? textoModelo(ctx.modeloTexto) : "");
      const completa = descricao && (rascunho.responsavel || "").trim() && rascunho.prazo;
      tr.classList.toggle("a3-linha-incompleta", !completa && Object.values(rascunho).some((v) => v && v !== ctx.grupo && v !== "Aberta" && v !== ctx.subgrupo));
      tr.title = completa ? "" : "Preencha descrição, responsável e prazo para lançar a ação";
      if (!completa) return;
      const pessoa = pessoaPorNome(rascunho.responsavel);
      try {
        await api("/api/acoes", {
          metodo: "POST",
          corpo: { ...rascunho, descricao, analise_id: analiseId, setor: pessoa ? pessoa.setor : "", data_abertura: hojeISO() },
        });
      } catch (erro) {
        mostrarErro(erro.message);
        return;
      }
      mostrarErro("");
      toast("Ação lançada.");
      await recarregarAcoes();
      aoCriar();
      A8.modelo(true).then((m) => (modelo = m));
    }

    colunasDoGrupo(ctx.grupo).forEach((coluna) => {
      let el;
      if (coluna === "rotulo") {
        tr.appendChild(criar("th", { classe: "a3-rot-cel a3-rot-acao", texto: ctx.rotulo || "" }));
        return;
      }
      if (coluna === "descricao" && ctx.fixo) {
        // Texto padrão fixo; só os quadros (nº do alerta, NF, QTD) são editáveis.
        const alterado = textoBase(ctx.fixo) !== ctx.fixo.texto;
        const span = criar("span", {
          classe: alterado ? "a3-texto-alterado" : null,
          title: alterado ? `Texto alterado neste A3. Padrão: "${ctx.fixo.texto}"` : null,
          // "… nº" vira a etiqueta do quadro do nº do alerta (não fica sozinho na linha).
          texto: textoBase(ctx.fixo).replace(/\s+n[º°o]\.?$/i, ""),
        });
        const etiquetaNumero = /\s+n[º°o]\.?$/i.test(textoBase(ctx.fixo)) ? "nº" : "";
        // Texto + quadros numa linha que quebra de forma organizada.
        const conteudo = criar("div", { classe: "a3-desc-linha" }, span);
        const td = criar("td", { classe: "a3-desc-fixa a3-com-lapis" }, conteudo);
        const lapis = criar("button", {
          type: "button", classe: "a3-btn-lapis", title: "Editar o texto desta ação (só neste A3)", "aria-label": `Editar texto: ${textoBase(ctx.fixo)}`,
          onclick: () => editarTextoFixo(ctx, span),
        });
        lapis.innerHTML = SVG_LAPIS; // SVG fixo do próprio código
        if (ctx.fora) ctx.lapis = lapis; // coluna da direita: junto dos botões de fora
        else td.appendChild(lapis);
        ctx.fixo.campos.forEach((c) => {
          const quadro = criar("input", {
            classe: "a3-desc-campo", "data-campo": `contencao.${c.chave}`,
            placeholder: c.nome, "aria-label": `${ctx.fixo.texto} — ${c.nome}`,
          });
          quadro.value = dados.contencao[c.chave] || "";
          let valorAnterior = quadro.value;
          quadro.addEventListener("focus", () => (valorAnterior = quadro.value));
          quadro.addEventListener("change", () => {
            if (ctx.acao && ctx.acao.status === "Concluída" && !quadro.value.trim()) {
              // Linha já está G: o quadro não pode ficar vazio.
              quadro.value = valorAnterior;
              dados.contencao[c.chave] = valorAnterior;
              marcarSujo();
              toast(`Esta ação está concluída (G): o ${c.nome} não pode ficar vazio.`, "erro");
              return;
            }
            // O nº do alerta costuma ser o mesmo nas duas linhas: copia para a de baixo se estiver vazia.
            if (c.chave === "alerta_numero" && !(dados.contencao.alerta_numero_contencao || "").trim()) {
              const outro = raiz.querySelector('[data-campo="contencao.alerta_numero_contencao"]');
              if (outro) {
                outro.value = quadro.value;
                dados.contencao.alerta_numero_contencao = quadro.value;
                outro.dispatchEvent(new Event("change"));
              }
            }
            if (ctx.acao) aoMudar("descricao", { value: textoFixo(ctx.fixo) });
          });
          conteudo.appendChild(criar("span", { classe: "a3-campo" }, [
            c.rotulo || etiquetaNumero ? criar("span", { classe: "a3-campo-rot", texto: (c.rotulo || etiquetaNumero).replace(":", "") }) : null,
            quadro,
          ]));
        });
        tr.appendChild(td);
        return;
      }
      if (coluna === "descricao") {
        el = criar("textarea", { rows: 1, classe: "a3-texto-acao", "aria-label": "Descrição da ação", placeholder: ctx.modeloTexto ? textoModelo(ctx.modeloTexto) : "" });
      } else if (coluna === "responsavel") {
        el = criar("input", { list: "a8-lista-pessoas", classe: "a3-centro", "aria-label": "Responsável" });
      } else if (coluna === "prazo") {
        el = criar("input", { type: "date", classe: "a3-centro", "aria-label": "Prazo" });
      } else if (coluna === "status") {
        el = selectStatus();
      } else if (coluna === "abrangencia") {
        el = criar("select", { classe: "a3-centro", "aria-label": "Abrangência" });
        A8.preencherSelect(el, ["Sim", "Não"], { vazio: "" });
      } else if (coluna === "eficaz") {
        el = criar("select", { classe: "a3-centro", "aria-label": "Eficaz?" });
        A8.preencherSelect(el, [["Eficaz", "Sim"], ["Não eficaz", "Não"]], { vazio: "" });
      }
      el.value = valor(coluna);
      el.addEventListener("change", () => aoMudar(coluna, el));
      campos[coluna] = el;
      tr.appendChild(criar("td", {}, el));
    });
    const ferramentas = [
      ctx.lapis || null,
      ctx.acao ? criar("button", {
        type: "button", classe: "a3-btn-detalhe", title: "Detalhes, setor, observação", "aria-label": "Detalhes da ação", texto: "⋯",
        onclick: () => A8.abrirModalAcao({
          acao: ctx.acao,
          analise: { id: analise.id, data_emissao: analise.data_emissao, prazo_limite: analise.prazo_limite },
          aoSalvar: async () => { await recarregarAcoes(); renderizarTodasAcoes(); },
        }),
      }) : null,
      ctx.aoRemover && !ctx.lixeiraEsquerda ? botaoLixeira(() => ctx.aoRemover(ctx.acao)) : null,
    ];
    if (ctx.aoRemover && ctx.lixeiraEsquerda) {
      // Coluna da esquerda da folha: a lixeira fica fora, à esquerda da linha.
      const primeira = tr.querySelector("td");
      primeira.classList.add("a3-com-lapis");
      const lixeira = botaoLixeira(() => ctx.aoRemover(ctx.acao));
      lixeira.classList.add("a3-fora-esquerda");
      primeira.appendChild(lixeira);
    }
    if (ctx.fora) {
      // Coluna da direita: os botões ficam do lado de fora da folha, à direita da linha.
      const ultima = tr.lastElementChild;
      ultima.classList.add("a3-com-ferramentas");
      ultima.appendChild(criar("div", { classe: "a3-ferramentas-fora" }, ferramentas));
    } else {
      tr.appendChild(criar("td", { classe: "a3-col-detalhe" }, ferramentas));
    }
    pintar();
    return tr;
  }

  function situacaoTexto(a) {
    if (a.situacao === "atrasada") return `Atrasada há ${a.dias_atraso} dia(s)`;
    if (a.situacao === "concluida") return `Concluída em ${fmtData(a.data_conclusao)}`;
    if (a.situacao === "cancelada") return "Cancelada";
    return a.vence_em_breve ? `Vence em ${a.dias_para_vencer} dia(s)` : "No prazo";
  }

  // 3.2 Exportação só vale quando há itens exportados (caixinha "Aplicável").
  function acoesExportacaoAtivas() {
    return analise.acoes.filter((a) => a.grupo === "contencao" && a.subgrupo === "3.2 Exportação" && a.status !== "Cancelada");
  }

  function renderizarExportacaoNaoAplicavel(tbody) {
    tbody.innerHTML = "";
    const textos = (modelo.linhas_modelo.contencao_exportacao || []).map(textoModelo);
    textos.forEach((texto) => {
      const na = () => criar("td", { classe: "a3-nao-aplica", texto: "Não se aplica" });
      tbody.appendChild(criar("tr", { classe: "a3-linha-na" }, [
        criar("td", { classe: "a3-desc-na", texto }), na(), na(), na(), criar("td"),
      ]));
    });
  }

  async function alternarExportacao(caixa) {
    if (!caixa.checked) {
      const ativas = acoesExportacaoAtivas();
      if (ativas.length) {
        if (!confirm(`Marcar a 3.2 como "Não se aplica"? As ${ativas.length} ação(ões) lançadas nela serão canceladas.`)) {
          caixa.checked = true;
          return;
        }
        try {
          for (const a of ativas) {
            await api(`/api/acoes/${a.id}`, { metodo: "PUT", corpo: { ...camposDaAcao(a), status: "Cancelada", data_conclusao: "" } });
          }
          await recarregarAcoes();
        } catch (erro) {
          mostrarErro(erro.message);
          caixa.checked = true;
          return;
        }
      }
    }
    dados.contencao.exportacao_aplicavel = caixa.checked;
    marcarSujo();
    renderizarGrupoAcoes(document.getElementById("a3-contencao-exportacao"));
  }

  function renderizarGrupoAcoes(tbody) {
    if (tbody.id === "a3-contencao-exportacao") {
      // A3 antigo com ações de exportação lançadas: já considera aplicável.
      if (!dados.contencao.exportacao_aplicavel && acoesExportacaoAtivas().length) {
        dados.contencao.exportacao_aplicavel = true;
        marcarSujo();
      }
      document.getElementById("a3-exportacao-aplicavel").checked = Boolean(dados.contencao.exportacao_aplicavel);
      if (!dados.contencao.exportacao_aplicavel) return renderizarExportacaoNaoAplicavel(tbody);
    }
    const grupo = tbody.dataset.acoes;
    const subgrupo = tbody.dataset.subgrupo || "";
    const subgrupoNovas = subgrupo === "*" ? "" : subgrupo;
    const rotulo = tbody.dataset.rotulo || "";
    const minimo = Number(tbody.dataset.linhas || 1);
    const modelos = tbody.dataset.modelo ? modelo.linhas_modelo[tbody.dataset.modelo] || [] : [];
    // data-subgrupo="*": a seção mostra todas as ações do grupo, qualquer subtipo.
    const acoes = analise.acoes.filter((a) => a.grupo === grupo && (subgrupo === "*" || (a.subgrupo || "") === subgrupo));
    tbody.innerHTML = "";
    if (tbody.hasAttribute("data-linhas-editaveis")) return renderizarGrupoEditavel(tbody, acoes, { grupo, subgrupoNovas, rotulo, minimo });
    const redesenhar = () => renderizarGrupoAcoes(tbody);
    const fora = Boolean(tbody.closest(".a3-coluna-dir"));
    acoes.forEach((acao) => tbody.appendChild(linhaAcao({ acao, grupo, subgrupo: acao.subgrupo || "", rotulo, fora }, redesenhar)));
    const pendentes = modelos.filter((m) => !acoes.some((a) => mesmoTexto(a.descricao, textoModelo(m))));
    pendentes.forEach((m) => tbody.appendChild(linhaAcao({ grupo, subgrupo: subgrupoNovas, rotulo, modeloTexto: m, fora }, redesenhar)));
    const livres = Math.max(1, minimo - acoes.length - pendentes.length);
    for (let i = 0; i < livres; i += 1) tbody.appendChild(linhaAcao({ grupo, subgrupo: subgrupoNovas, rotulo, fora }, redesenhar));
  }

  // Seção 5 (corretivas/preventivas): o usuário inclui e exclui linhas.
  // Quantidade de linhas em branco de cada bloco (mantida entre redesenhos).
  const linhasLivres = new WeakMap();

  function renderizarGrupoEditavel(tbody, acoes, { grupo, subgrupoNovas, rotulo, minimo }) {
    if (!linhasLivres.has(tbody)) linhasLivres.set(tbody, Math.max(1, minimo - acoes.length));
    const redesenhar = () => renderizarGrupoAcoes(tbody);
    const aoCriar = () => { linhasLivres.set(tbody, Math.max(0, linhasLivres.get(tbody) - 1)); redesenhar(); };

    const aoRemover = async (acao, linha) => {
      if (!acao) {
        linhasLivres.set(tbody, Math.max(0, linhasLivres.get(tbody) - 1));
        linha.remove();
        return;
      }
      const motivo = prompt(`Excluir a ação "${acao.descricao}"?\nInforme o motivo (obrigatório):`);
      if (motivo === null) return;
      if (!motivo.trim()) { mostrarErro("Informe o motivo da exclusão."); return; }
      try {
        await api(`/api/acoes/${acao.id}`, { metodo: "DELETE", corpo: { motivo } });
      } catch (erro) {
        mostrarErro(erro.message);
        return;
      }
      toast("Ação excluída.");
      await recarregarAcoes();
      redesenhar();
    };

    const novaLinha = (acao) => {
      let tr = null;
      tr = linhaAcao({ acao, grupo, subgrupo: acao ? acao.subgrupo || "" : subgrupoNovas, rotulo, fora: true, aoRemover: (a) => aoRemover(a, tr) }, aoCriar);
      return tr;
    };
    acoes.forEach((acao) => tbody.appendChild(novaLinha(acao)));
    for (let i = 0; i < linhasLivres.get(tbody); i += 1) tbody.appendChild(novaLinha(null));

    const rotuloBloco = (rotulo || "Preventiva").replace(":", "");
    const adicionar = criar("tr", { classe: "a3-linha-adicionar" }, criar("td", { colspan: 6 }, criar("button", {
      type: "button", classe: "a3-btn-adicionar", texto: `+ Incluir linha (${rotuloBloco})`,
      onclick: () => {
        linhasLivres.set(tbody, linhasLivres.get(tbody) + 1);
        const tr = novaLinha(null);
        tbody.insertBefore(tr, adicionar);
        tr.querySelector("textarea")?.focus();
      },
    })));
    tbody.appendChild(adicionar);
  }

  // 6 · Retroalimentação: cada documento tem a caixinha N/A ("Não aplicável").
  // A linha "Outra:" usa a chave OUTRA_RETRO.
  const OUTRA_RETRO = "Outra";

  function ehDaLinhaRetro(acao, sub) {
    const subgrupos = grupoDe("retroalimentacao").subgrupos;
    return sub === OUTRA_RETRO ? !subgrupos.includes(acao.subgrupo) : acao.subgrupo === sub;
  }

  function celulaNA(tr, sub) {
    const td = criar("td", { classe: "a3-col-na" });
    if (sub) {
      const caixa = criar("input", { type: "checkbox", title: "Não aplicável", "aria-label": `${sub}: não aplicável` });
      caixa.checked = Boolean(dados.retroalimentacao_na[sub]);
      if (sub === OUTRA_RETRO) caixa.setAttribute("aria-label", "Outra: não aplicável");
      caixa.addEventListener("change", () => alternarRetroNA(sub, caixa));
      td.appendChild(caixa);
    }
    // Os botões que ficam fora da folha passam para a última coluna (N/A).
    const fora = tr.querySelector(".a3-ferramentas-fora");
    if (fora) {
      fora.parentElement.classList.remove("a3-com-ferramentas");
      td.classList.add("a3-com-ferramentas");
      td.appendChild(fora);
    }
    tr.appendChild(td);
    return tr;
  }

  async function alternarRetroNA(sub, caixa) {
    if (caixa.checked) {
      const ativas = analise.acoes.filter((a) => a.grupo === "retroalimentacao" && ehDaLinhaRetro(a, sub) && a.status !== "Cancelada");
      if (ativas.length) {
        if (!confirm(`Marcar "${sub === OUTRA_RETRO ? "Outra" : sub}" como não aplicável? A(s) ${ativas.length} ação(ões) lançada(s) nessa linha serão canceladas.`)) {
          caixa.checked = false;
          return;
        }
        try {
          for (const a of ativas) {
            await api(`/api/acoes/${a.id}`, { metodo: "PUT", corpo: { ...camposDaAcao(a), status: "Cancelada", data_conclusao: "" } });
          }
          await recarregarAcoes();
        } catch (erro) {
          mostrarErro(erro.message);
          caixa.checked = false;
          return;
        }
      }
      dados.retroalimentacao_na[sub] = true;
    } else {
      delete dados.retroalimentacao_na[sub];
    }
    marcarSujo();
    renderizarRetroalimentacao();
  }

  function renderizarRetroalimentacao() {
    const tbody = document.getElementById("a3-retro");
    tbody.innerHTML = "";
    dados.retroalimentacao_na = dados.retroalimentacao_na || {};
    const subgrupos = grupoDe("retroalimentacao").subgrupos;
    const redesenhar = () => renderizarRetroalimentacao();
    const ativas = (filtro) => analise.acoes.filter((a) => a.grupo === "retroalimentacao" && a.status !== "Cancelada" && filtro(a));
    [...subgrupos, OUTRA_RETRO].forEach((sub) => {
      const rotulo = sub === OUTRA_RETRO ? "Outra:" : modelo.rotulos_retroalimentacao[sub] || sub;
      if (dados.retroalimentacao_na[sub]) {
        const tr = criar("tr", { classe: "a3-linha-na" }, [
          criar("th", { classe: "a3-rot-cel a3-rot-acao", texto: rotulo }),
          criar("td", { classe: "a3-desc-na", texto: "Não aplicável" }),
          criar("td"), criar("td"), criar("td"),
        ]);
        tbody.appendChild(celulaNA(tr, sub));
        return;
      }
      if (sub === OUTRA_RETRO) {
        // "Outra:": ações extras já lançadas + uma linha livre; o N/A fica na primeira linha.
        const outras = ativas((a) => ehDaLinhaRetro(a, OUTRA_RETRO));
        outras.forEach((acao, i) => tbody.appendChild(celulaNA(
          linhaAcao({ acao, grupo: "retroalimentacao", subgrupo: acao.subgrupo || "", rotulo, fora: true }, redesenhar), i ? null : sub)));
        tbody.appendChild(celulaNA(linhaAcao({ grupo: "retroalimentacao", subgrupo: "", rotulo, fora: true }, redesenhar), outras.length ? null : sub));
        return;
      }
      const acoes = ativas((a) => a.subgrupo === sub);
      acoes.forEach((acao, i) => tbody.appendChild(celulaNA(
        linhaAcao({ acao, grupo: "retroalimentacao", subgrupo: sub, rotulo: i ? "" : rotulo, fora: true }, redesenhar), i ? null : sub)));
      if (!acoes.length) tbody.appendChild(celulaNA(linhaAcao({ grupo: "retroalimentacao", subgrupo: sub, rotulo, fora: true }, redesenhar), sub));
    });
  }

  // 3.1 Contenção Nacional: as 6 ações fixas do procedimento padrão.
  // Coluna N/A da 3.1 (mesma ideia da seção 6): linha marcada = "Não aplicável".
  function celulaNA31(def) {
    const td = criar("td", { classe: "a3-col-na" });
    if (!def) return td;
    const caixa = criar("input", { type: "checkbox", title: "Não aplicável", "aria-label": `${def.texto}: não aplicável` });
    caixa.checked = Boolean(dados.contencao.na[def.texto]);
    caixa.addEventListener("change", () => alternarNA31(def, caixa));
    td.appendChild(caixa);
    return td;
  }

  async function alternarNA31(def, caixa) {
    if (caixa.checked) {
      const ativas = analise.acoes.filter((a) => a.grupo === "contencao" && a.subgrupo === "3.1 Nacional"
        && a.status !== "Cancelada" && mesmoTexto(a.descricao, textoBase(def)));
      if (ativas.length) {
        if (!confirm(`Marcar "${def.texto}" como não aplicável? A ação lançada nessa linha será cancelada.`)) {
          caixa.checked = false;
          return;
        }
        try {
          for (const a of ativas) {
            await api(`/api/acoes/${a.id}`, { metodo: "PUT", corpo: { ...camposDaAcao(a), status: "Cancelada", data_conclusao: "" } });
          }
          await recarregarAcoes();
        } catch (erro) {
          mostrarErro(erro.message);
          caixa.checked = false;
          return;
        }
      }
      dados.contencao.na[def.texto] = true;
    } else {
      delete dados.contencao.na[def.texto];
    }
    marcarSujo();
    renderizarContencaoNacional();
  }

  function renderizarContencaoNacional() {
    const tbody = document.getElementById("a3-contencao-nacional");
    tbody.innerHTML = "";
    dados.contencao.na = dados.contencao.na || {};
    const acoes = analise.acoes.filter((a) => a.grupo === "contencao" && (a.subgrupo || "") === "3.1 Nacional" && a.status !== "Cancelada");
    const usadas = new Set();
    modelo.linhas_fixas_contencao.forEach((def) => {
      if (dados.contencao.na[def.texto]) {
        const na = () => criar("td", { classe: "a3-nao-aplica", texto: "Não aplicável" });
        tbody.appendChild(criar("tr", { classe: "a3-linha-na" }, [
          criar("td", { classe: "a3-desc-na", texto: textoBase(def) }), na(), na(), na(), celulaNA31(def), criar("td"),
        ]));
        return;
      }
      const acao = acoes.find((a) => !usadas.has(a.id) && mesmoTexto(a.descricao, textoBase(def)));
      if (acao) {
        usadas.add(acao.id);
        // A3 antigo: recupera o nº do alerta que estava no texto da ação ("... nº E-70232026").
        def.campos.filter((c) => !c.rotulo && !(dados.contencao[c.chave] || "").trim()).forEach((c) => {
          const m = acao.descricao.match(/n[º°o]\s*(\S.*)$/i);
          if (m) dados.contencao[c.chave] = m[1].trim();
        });
        // Quadros preenchidos mas texto da ação desatualizado (ex.: A3 importado):
        // atualiza o texto para o Controle de Ações mostrar o nº / NF / QTD.
        const completo = def.campos.every((c) => (dados.contencao[c.chave] || "").trim());
        if (def.campos.length && completo && acao.descricao !== textoFixo(def)) {
          api(`/api/acoes/${acao.id}`, { metodo: "PUT", corpo: { ...camposDaAcao(acao), descricao: textoFixo(def) } })
            .then(() => { acao.descricao = textoFixo(def); })
            .catch(() => { /* fica para a próxima abertura */ });
        }
      }
      const tr = linhaAcao({ acao, grupo: "contencao", subgrupo: "3.1 Nacional", fixo: def }, renderizarContencaoNacional);
      tr.insertBefore(celulaNA31(def), tr.lastElementChild); // antes da coluna do "⋯"
      tbody.appendChild(tr);
    });
    // Ações extras da 3.1 (incluídas com "+ Incluir linha" ou pelo Controle de Ações).
    const novaLinha = (acao) => {
      let tr = null;
      tr = linhaAcao({
        acao, grupo: "contencao", subgrupo: "3.1 Nacional", lixeiraEsquerda: true,
        aoRemover: (a) => removerLinha31(a, tr),
      }, () => { linhasLivres31 = Math.max(0, linhasLivres31 - 1); renderizarContencaoNacional(); });
      tr.insertBefore(celulaNA31(null), tr.lastElementChild);
      return tr;
    };
    acoes.filter((a) => !usadas.has(a.id)).forEach((acao) => tbody.appendChild(novaLinha(acao)));
    for (let i = 0; i < linhasLivres31; i += 1) tbody.appendChild(novaLinha(null));
    const adicionar = criar("tr", { classe: "a3-linha-adicionar" }, criar("td", { colspan: 6 }, criar("button", {
      type: "button", classe: "a3-btn-adicionar", texto: "+ Incluir linha (Contenção Nacional)",
      onclick: () => {
        linhasLivres31 += 1;
        const tr = novaLinha(null);
        tbody.insertBefore(tr, adicionar);
        tr.querySelector("textarea")?.focus();
      },
    })));
    tbody.appendChild(adicionar);
  }

  let linhasLivres31 = 0;

  async function removerLinha31(acao, linha) {
    if (!acao) {
      linhasLivres31 = Math.max(0, linhasLivres31 - 1);
      linha.remove();
      return;
    }
    const motivo = prompt(`Excluir a ação "${acao.descricao}"?\nInforme o motivo (obrigatório):`);
    if (motivo === null) return;
    if (!motivo.trim()) { mostrarErro("Informe o motivo da exclusão."); return; }
    try {
      await api(`/api/acoes/${acao.id}`, { metodo: "DELETE", corpo: { motivo } });
    } catch (erro) {
      mostrarErro(erro.message);
      return;
    }
    toast("Ação excluída.");
    await recarregarAcoes();
    renderizarContencaoNacional();
  }

  // 7 · Análise de Eficácia: ações padrão fixas + linhas incluídas.
  let linhasLivresEficacia = 0;

  async function excluirAcaoComMotivo(acao) {
    const motivo = prompt(`Excluir a ação "${acao.descricao}"?\nInforme o motivo (obrigatório):`);
    if (motivo === null) return false;
    if (!motivo.trim()) { mostrarErro("Informe o motivo da exclusão."); return false; }
    try {
      await api(`/api/acoes/${acao.id}`, { metodo: "DELETE", corpo: { motivo } });
    } catch (erro) {
      mostrarErro(erro.message);
      return false;
    }
    toast("Ação excluída.");
    await recarregarAcoes();
    return true;
  }

  function renderizarEficaciaFixa() {
    const tbody = document.getElementById("a3-eficacia");
    tbody.innerHTML = "";
    dados.eficacia.textos = dados.eficacia.textos || {};
    const redesenhar = renderizarEficaciaFixa;
    const acoes = analise.acoes.filter((a) => a.grupo === "eficacia" && a.status !== "Cancelada");
    const usadas = new Set();
    modelo.linhas_fixas_eficacia.forEach((base) => {
      const def = { ...base, area: "eficacia" };
      const acao = acoes.find((a) => !usadas.has(a.id) && mesmoTexto(a.descricao, textoBase(def)));
      if (acao) usadas.add(acao.id);
      tbody.appendChild(linhaAcao({ acao, grupo: "eficacia", subgrupo: def.subgrupo, fixo: def, fora: true, redesenhar }, redesenhar));
    });
    const novaLinha = (acao) => {
      let tr = null;
      tr = linhaAcao({
        acao, grupo: "eficacia", subgrupo: acao ? acao.subgrupo || "" : "Outra", fora: true,
        aoRemover: async (a) => {
          if (!a) { linhasLivresEficacia = Math.max(0, linhasLivresEficacia - 1); tr.remove(); return; }
          if (await excluirAcaoComMotivo(a)) redesenhar();
        },
      }, () => { linhasLivresEficacia = Math.max(0, linhasLivresEficacia - 1); redesenhar(); });
      return tr;
    };
    acoes.filter((a) => !usadas.has(a.id)).forEach((acao) => tbody.appendChild(novaLinha(acao)));
    for (let i = 0; i < linhasLivresEficacia; i += 1) tbody.appendChild(novaLinha(null));
    const adicionar = criar("tr", { classe: "a3-linha-adicionar" }, criar("td", { colspan: 5 }, criar("button", {
      type: "button", classe: "a3-btn-adicionar", texto: "+ Incluir linha (Análise de Eficácia)",
      onclick: () => {
        linhasLivresEficacia += 1;
        const tr = novaLinha(null);
        tbody.insertBefore(tr, adicionar);
        tr.querySelector("textarea")?.focus();
      },
    })));
    tbody.appendChild(adicionar);
  }

  function renderizarTodasAcoes() {
    renderizarContencaoNacional();
    renderizarEficaciaFixa();
    raiz.querySelectorAll("tbody[data-acoes]").forEach(renderizarGrupoAcoes);
    renderizarRetroalimentacao();
    renderizarResumoAcoes();
  }

  // Status do A3 é automático: Concluído = todas as ações concluídas + "8D Aprovado".
  function aplicarStatus(novo) {
    if (!novo || novo === analise.status) return;
    const anterior = analise.status;
    analise.status = novo;
    raiz.querySelectorAll('[data-cab="status"]').forEach((el) => (el.value = novo));
    if (novo === "Concluído") toast("Todas as ações concluídas e 8D Aprovado: A3 concluído.");
    else if (anterior === "Concluído") toast("A3 voltou para Em andamento (ação reaberta ou 8D não aprovado).", "erro");
  }

  async function atualizarStatusDoServidor() {
    const r = await api(`/api/analises/${analiseId}/status`).catch(() => null);
    if (r) {
      analise.data_fechamento = r.data_fechamento;
      aplicarStatus(r.status);
      renderizarEtapas(r.etapas_8d);
    }
  }

  // Etapas do 8D reconhecidas pelo próprio A3 (substituem a aba Etapas 8D do Gerenciador).
  // Etapa do 8D -> seção do A3 onde ela é feita e o que faz a etapa contar como realizada.
  const SECAO_DA_ETAPA = {
    "Contenção": [3, "Ações de contenção (3.1 e 3.2)", "Todas as ações de contenção em G"],
    "Causa Raiz": [4, "Análise de Causa Raiz", "Campo \"Causa raiz\" dos 5 Porquês preenchido"],
    "Ação Corretiva": [5, "Ações corretivas e de abrangência", "Todas as ações corretivas em G"],
    "Poka Yoke": [6, "Retroalimentação — linha Poka Yoke", "Ação da linha em G (ou N/A = não aplicável)"],
    "LPA": [6, "Retroalimentação — linha LPA", "Ação da linha em G (ou N/A = não aplicável)"],
    "Trab. Padronizado": [6, "Retroalimentação — linha Trabalho Padronizado", "Ação da linha em G (ou N/A = não aplicável)"],
    "FMEA": [6, "Retroalimentação — linha FMEA", "Ação da linha em G (ou N/A = não aplicável)"],
    "Plano de Controle": [6, "Retroalimentação — linha Plano de Controle", "Ação da linha em G (ou N/A = não aplicável)"],
    "Validação": [7, "Análise de Eficácia", "Qualquer ação da seção 7 em G"],
    "Lições Aprendidas": [8, "Fechamento — Lições aprendidas", "Campo preenchido"],
    "8D Fechado": [8, "Fechamento — Validação pelo Emissor", "\"8D Aprovado\" com todas as etapas e ações concluídas"],
  };

  // Leva até a seção do A3 e dá um destaque rápido nela.
  function irParaSecao(numero) {
    const secao = [...document.querySelectorAll(".a3-secao")].find((s) => s.textContent.trim().startsWith(`${numero} -`));
    if (!secao) return;
    secao.scrollIntoView({ behavior: "smooth", block: "center" });
    secao.classList.remove("a3-secao-destaque");
    void secao.offsetWidth; // reinicia a animação
    secao.classList.add("a3-secao-destaque");
  }

  let legendaEtapasAberta = false;

  function renderizarEtapas(resultado) {
    const caixa = document.getElementById("a3-etapas");
    if (!caixa || !resultado) return;
    const mudou = JSON.stringify(pendentesParaFechar(resultado)) !== JSON.stringify(pendentesParaFechar());
    ultimasEtapas = resultado;
    if (mudou && document.getElementById("a3-validacao")) renderizarValidacaoEmissor();
    caixa.innerHTML = "";
    const atual = resultado.atual;
    caixa.appendChild(criar("div", { classe: "a3-etapas-titulo" }, [
      criar("strong", { texto: "Etapas do 8D" }),
      criar("span", {
        classe: `a3-etapas-resumo ${atual && atual.atrasada ? "atrasada" : ""}`,
        texto: atual ? `Etapa atual: ${atual.etapa} · prazo ${fmtData(atual.prazo)}${atual.atrasada ? " (atrasada)" : ""}` : "Todas as etapas realizadas",
      }),
      criar("button", {
        type: "button", classe: "a3-etapas-legenda-botao", "aria-expanded": String(legendaEtapasAberta),
        texto: legendaEtapasAberta ? "Ocultar legenda" : "Legenda: etapa × seção do A3",
        onclick: () => { legendaEtapasAberta = !legendaEtapasAberta; renderizarEtapas(ultimasEtapas); },
      }),
    ]));
    const lista = criar("ol", { classe: "a3-etapas-lista" });
    resultado.etapas.forEach((e) => {
      let classe = "pendente";
      let detalhe = `prazo ${fmtData(e.prazo)}`;
      if (!e.aplicavel) { classe = "na"; detalhe = "não aplicável"; }
      else if (e.realizacao) { classe = "feita"; detalhe = `realizada ${fmtData(e.realizacao)}`; }
      else if (atual && e.etapa === atual.etapa) { classe = atual.atrasada ? "atual atrasada" : "atual"; }
      else if (e.prazo && e.prazo < hojeISO()) { classe = "pendente vencida"; }
      const [numero, ondeFica] = SECAO_DA_ETAPA[e.etapa] || [];
      lista.appendChild(criar("li", {
        classe: `a3-etapa ${classe} ${numero ? "a3-etapa-clicavel" : ""}`,
        title: `${e.etapa}: ${detalhe}${numero ? `\nSeção ${numero} — ${ondeFica} (clique para ir)` : ""}`,
        role: numero ? "button" : null, tabindex: numero ? 0 : null,
        onclick: numero ? () => irParaSecao(numero) : null,
        onkeydown: numero ? (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); irParaSecao(numero); } } : null,
      }, [
        criar("span", { classe: "a3-etapa-marca", "aria-hidden": "true", texto: classe === "feita" ? "✓" : classe === "na" ? "–" : "" }),
        criar("span", { classe: "a3-etapa-nome", texto: e.etapa }),
        numero ? criar("span", { classe: "a3-etapa-secao", texto: `Seção ${numero}` }) : null,
        criar("span", { classe: "a3-etapa-data", texto: detalhe }),
      ]));
    });
    caixa.appendChild(lista);

    if (legendaEtapasAberta) {
      const corpo = criar("tbody");
      resultado.etapas.forEach((e) => {
        const [numero, ondeFica, regra] = SECAO_DA_ETAPA[e.etapa] || ["—", "—", "—"];
        corpo.appendChild(criar("tr", {}, [
          criar("td", { classe: "a3-legenda-etapa", texto: e.etapa }),
          criar("td", {}, criar("button", {
            type: "button", classe: "a3-legenda-secao", texto: `Seção ${numero}`, title: "Ir para a seção",
            onclick: () => irParaSecao(numero),
          })),
          criar("td", { texto: ondeFica }),
          criar("td", { classe: "a3-legenda-regra", texto: regra }),
        ]));
      });
      caixa.appendChild(criar("table", { classe: "a3-etapas-legenda" }, [
        criar("thead", {}, criar("tr", {}, ["Etapa do 8D", "Seção", "Onde fica no A3", "Conta como realizada quando"].map((t) => criar("th", { texto: t })))),
        corpo,
      ]));
    }
  }

  async function recarregarAcoes() {
    atualizarStatusDoServidor();
    analise.acoes = await api(`/api/acoes?analise_id=${analiseId}`);
    renderizarResumoAcoes();
    renderizarEvidencias();
  }

  function renderizarResumoAcoes() {
    const validas = analise.acoes.filter((a) => a.situacao !== "cancelada");
    const abertas = validas.filter((a) => a.situacao === "no_prazo" || a.situacao === "atrasada").length;
    const atrasadas = validas.filter((a) => a.situacao === "atrasada").length;
    const caixa = document.getElementById("a3-resumo-acoes");
    caixa.innerHTML = "";
    caixa.append(
      criar("span", { texto: `Ações: ${validas.length}` }),
      criar("span", { classe: "a3-pill a3-farol-g", texto: `${validas.length - abertas} concluídas` }),
      criar("span", { classe: "a3-pill a3-farol-y", texto: `${abertas - atrasadas} no prazo` }),
      criar("span", { classe: `a3-pill ${atrasadas ? "a3-farol-r" : ""}`, texto: `${atrasadas} atrasadas` }),
    );
  }

  // --- Anexos das folhas complementares -----------------------------------------------------
  function renderizarAnexos() {
    raiz.querySelectorAll("[data-anexos]").forEach((caixa) => {
      const secao = caixa.dataset.anexos;
      const anexos = analise.anexos.filter((x) => x.secao === secao);
      caixa.innerHTML = "";
      caixa.className = "a8-anexos";
      caixa.appendChild(criar("h3", { classe: "a8-sub-titulo", texto: `Anexos — ${modelo.anexo_secoes[secao]}` }));
      const galeria = criar("div", { classe: "a8-galeria" });
      if (!anexos.length) galeria.appendChild(criar("p", { classe: "a8-ajuda", texto: "Nenhum arquivo anexado." }));
      anexos.forEach((x) => {
        const url = `${A8.base}/anexos/${x.id}`;
        const ehImagem = /\.(png|jpe?g|gif|webp|bmp)$/i.test(x.nome_original);
        galeria.appendChild(criar("figure", { classe: "a8-anexo" }, [
          criar("a", { href: url, target: "_blank", rel: "noopener" },
            ehImagem ? criar("img", { src: url, alt: x.legenda || x.nome_original, loading: "lazy" })
              : criar("span", { classe: "a8-anexo-arquivo", texto: x.nome_original.split(".").pop().toUpperCase() })),
          criar("figcaption", {}, [
            criar("span", { texto: x.legenda || x.nome_original }),
            criar("button", { type: "button", classe: "a8-btn-remover", texto: "×", title: "Excluir anexo", "aria-label": `Excluir ${x.nome_original}`, onclick: () => excluirAnexo(x) }),
          ]),
        ]));
      });
      caixa.appendChild(galeria);
      const arquivo = criar("input", { type: "file", multiple: true, "aria-label": "Arquivos" });
      const legenda = criar("input", { type: "text", placeholder: "Legenda (opcional)", "aria-label": "Legenda" });
      const enviar = criar("button", {
        type: "button", classe: "btn btn-secondary btn-small", texto: "Enviar arquivo(s)",
        onclick: async () => {
          if (!arquivo.files.length) { arquivo.click(); return; }
          enviar.disabled = true;
          try {
            await enviarArquivos(arquivo.files, secao, legenda.value);
            toast("Anexo(s) enviado(s).");
          } catch (erro) {
            mostrarErro(erro.message);
          } finally {
            enviar.disabled = false;
          }
        },
      });
      caixa.appendChild(criar("div", { classe: "a8-upload" }, [arquivo, legenda, enviar]));
    });
  }

  // --- Impressão / PDF: sempre UMA folha A3 paisagem ------------------------------------
  // Antes de imprimir, a folha é montada numa largura fixa, medida, e reduzida
  // (zoom) exatamente o necessário para caber na área útil da página A3.
  const AREA_UTIL_A3 = { largura: 1542, altura: 1077 }; // px a 96 dpi: 420 x 297 mm − margens de 6 mm

  function prepararImpressao() {
    const folha = document.getElementById("a3-folha");
    document.body.classList.add("a3-imprimindo");
    // Datas vazias não imprimem o "dd/mm/aaaa".
    folha.querySelectorAll('input[type="date"]').forEach((d) => d.classList.toggle("a3-data-vazia", !d.value));
    folha.style.zoom = "";
    // Testa larguras e fica com a que deixa a folha maior na página
    // (mais larga = menos quebras de linha = menos altura).
    let melhor = { largura: 1500, escala: 0 };
    for (let largura = 1500; largura <= 2700; largura += 100) {
      folha.style.width = `${largura}px`;
      folha.style.minWidth = `${largura}px`;
      const altura = folha.getBoundingClientRect().height;
      const escala = Math.min(AREA_UTIL_A3.largura / largura, AREA_UTIL_A3.altura / altura);
      if (escala > melhor.escala) melhor = { largura, escala };
    }
    // Se a altura é que limita, sobra espaço na lateral: alarga a folha para
    // preencher a largura da página. Como alguns quadros crescem junto com a
    // largura (ex.: imagem da Ilustração), repete o ajuste até estabilizar.
    const escalaDe = (largura) => {
      folha.style.width = `${largura}px`;
      folha.style.minWidth = `${largura}px`;
      return Math.min(AREA_UTIL_A3.largura / largura, AREA_UTIL_A3.altura / folha.getBoundingClientRect().height);
    };
    let largura = melhor.largura;
    let escala = melhor.escala;
    for (let i = 0; i < 8; i += 1) {
      const proxima = Math.floor(AREA_UTIL_A3.largura / escala);
      if (Math.abs(proxima - largura) < 4) break;
      const escalaProxima = escalaDe(proxima);
      // Aceita a nova largura se a folha ficar mais larga no papel.
      if (proxima * escalaProxima < largura * escala) break;
      largura = proxima;
      escala = escalaProxima;
    }
    escala = escalaDe(largura);
    // Folga de 5%: na geração da página impressa o navegador pode precisar de
    // alguns pixels a mais do que o medido na tela (com 1,5% a folha estourava).
    folha.style.zoom = String(escala * 0.95);
  }

  function encerrarImpressao() {
    const folha = document.getElementById("a3-folha");
    document.body.classList.remove("a3-imprimindo");
    folha.style.zoom = "";
    folha.style.width = "";
    folha.style.minWidth = "";
  }

  window.addEventListener("beforeprint", prepararImpressao);
  window.addEventListener("afterprint", encerrarImpressao);

  // --- Excluir A3 --------------------------------------------------------------------------------
  async function excluir() {
    const motivo = prompt(`Excluir o A3 ${analise.id_mrhb} com todas as ações e anexos?\nInforme o motivo (obrigatório):`);
    if (motivo === null) return;
    if (!motivo.trim()) { mostrarErro("Informe o motivo da exclusão."); return; }
    try {
      await api(`/api/analises/${analiseId}`, { metodo: "DELETE", corpo: { motivo } });
    } catch (erro) {
      mostrarErro(erro.message);
      return;
    }
    sujo = false;
    window.location.href = `${A8.base}/analises`;
  }

  // --- Eventos -------------------------------------------------------------------------------------
  function ligarEventos() {
    raiz.addEventListener("input", (e) => {
      const el = e.target;
      if (el.dataset.cab) {
        const campo = el.dataset.cab;
        analise[campo] = el.value;
        raiz.querySelectorAll(`[data-cab="${campo}"]`).forEach((o) => { if (o !== el) o.value = el.value; });
        if (campo === "data_emissao" && el.value) {
          analise.prazo_limite = somarDias(el.value, modelo.dias_prazo_limite);
          atualizarTextosCabecalho();
        }
        if (campo === "definicao_problema") {
          document.getElementById("a3-ish-problema").textContent = el.value;
          document.querySelectorAll(".a3-porque-titulo").forEach((h, i) => (h.textContent = tituloPorque(i)));
        }
        marcarSujo();
      } else if (el.dataset.campo) {
        definir(dados, el.dataset.campo, el.value);
        marcarSujo();
      }
    });

    // Quadro Ilustração: clicar (ou Enter) abre o editor.
    const ilustracao = document.getElementById("a3-ilustracao");
    ilustracao.tabIndex = 0;
    ilustracao.setAttribute("role", "button");
    ilustracao.setAttribute("aria-label", "Editar ilustração");
    ilustracao.addEventListener("click", editarIlustracao);
    ilustracao.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); editarIlustracao(); } });

    document.getElementById("a8-evid-imprimir-todas").addEventListener("change", (e) => {
      dados.imprimir_evidencias = dados.imprimir_evidencias || {};
      acoesComEvidencia().forEach((a) => (dados.imprimir_evidencias[String(a.id)] = e.target.checked));
      marcarSujo();
      renderizarEvidencias();
    });

    const caixaExportacao = document.getElementById("a3-exportacao-aplicavel");
    caixaExportacao.addEventListener("change", () => alternarExportacao(caixaExportacao));

    document.getElementById("a8-btn-salvar").addEventListener("click", () => salvar().then(() => toast("A3 salvo.")));
    document.getElementById("a8-btn-excluir-a3").addEventListener("click", excluir);
    document.getElementById("a8-btn-imprimir").addEventListener("click", () => window.print());
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        salvar().then(() => toast("A3 salvo."));
      }
    });
    window.addEventListener("beforeunload", (e) => {
      if (sujo || salvando) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  iniciar();
})();
