// Editor do quadro "Ilustração" do A3: monta uma figura com várias imagens,
// setas, círculos, retângulos e textos. Canvas puro (sem bibliotecas), para
// funcionar na rede da empresa sem internet.
//
// Uso: const r = await A3Ilustracao.abrir({ objetos, resolverSrc });
//   objetos     cena salva (lista de objetos, ver abaixo) — é copiada
//   resolverSrc função que transforma o "src" salvo numa URL carregável
// Retorna null (cancelado) ou { objetos, blob } — blob = imagem final (JPEG).
//
// Objetos da cena (coordenadas na área lógica LARGURA x ALTURA):
//   { tipo: "imagem", x, y, w, h, src }
//   { tipo: "retangulo" | "elipse", x, y, w, h, cor, esp }
//   { tipo: "seta", x1, y1, x2, y2, cor, esp }
//   { tipo: "texto", x, y, texto, cor, tam }
const A3Ilustracao = (() => {
  const LARGURA = 1200;
  const ALTURA = 800;
  const LADO_MAXIMO_IMAGEM = 1600; // imagens maiores são reduzidas ao entrar
  const CORES = [
    ["#e00000", "Vermelho"], ["#ff9800", "Laranja"], ["#ffd600", "Amarelo"], ["#00a000", "Verde"],
    ["#000000", "Preto"], ["#ffffff", "Branco"],
  ];
  const { criar } = A8;

  let ui = null;
  let ui_arquivo = null;
  let converterPdf = null; // função fornecida por quem abre o editor (envia o PDF e devolve as páginas)
  let estado = null;
  let resolverSrc = (src) => src;
  const imagens = new Map(); // src -> HTMLImageElement

  // --- Interface ---------------------------------------------------------------
  function botaoFerramenta(chave, rotulo, icone) {
    const b = criar("button", { type: "button", classe: "a3i-ferramenta", "data-ferramenta": chave, title: rotulo, "aria-label": rotulo });
    b.innerHTML = icone; // ícones SVG fixos do próprio código
    b.appendChild(criar("span", { texto: rotulo }));
    b.addEventListener("click", () => escolherFerramenta(chave));
    return b;
  }

  const ICONES = {
    selecionar: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M5 3l14 7-6 2-2 6z"/></svg>',
    seta: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 20L19 5"/><path d="M10 5h9v9"/></svg>',
    elipse: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><ellipse cx="12" cy="12" rx="9" ry="7"/></svg>',
    retangulo: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1"/></svg>',
    texto: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M5 4h14v4h-2V6h-4v12h2v2H9v-2h2V6H7v2H5z"/></svg>',
    imagem: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/></svg>',
  };

  function montarUI() {
    const arquivo = criar("input", { type: "file", accept: "image/*", multiple: true, hidden: true });
    ui_arquivo = arquivo;
    arquivo.addEventListener("change", () => { adicionarArquivos(arquivo.files); arquivo.value = ""; });

    const cores = criar("div", { classe: "a3i-cores", role: "group", "aria-label": "Cor" },
      CORES.map(([cor, nome]) => {
        const b = criar("button", { type: "button", classe: "a3i-cor", title: nome, "aria-label": nome, "data-cor": cor, style: `background:${cor}` });
        b.addEventListener("click", () => mudarPropriedade("cor", cor));
        return b;
      }));
    const espessura = criar("select", { classe: "a3i-select", title: "Espessura da linha", "aria-label": "Espessura da linha" });
    [[2, "Fina"], [4, "Média"], [7, "Grossa"], [11, "Extra"]].forEach(([v, r]) => espessura.appendChild(criar("option", { value: v, texto: `Linha ${r}` })));
    espessura.addEventListener("change", () => mudarPropriedade("esp", Number(espessura.value)));
    const tamanho = criar("select", { classe: "a3i-select", title: "Tamanho do texto", "aria-label": "Tamanho do texto" });
    [20, 28, 36, 48, 64].forEach((v) => tamanho.appendChild(criar("option", { value: v, texto: `Texto ${v}` })));
    tamanho.addEventListener("change", () => mudarPropriedade("tam", Number(tamanho.value)));

    const acao = (rotulo, titulo, fn, classe = "") => criar("button", { type: "button", classe: `a3i-acao ${classe}`, title: titulo, texto: rotulo, onclick: fn });

    const canvas = criar("canvas", { width: LARGURA, height: ALTURA, classe: "a3i-canvas", tabindex: 0, "aria-label": "Área de desenho da ilustração" });
    const overlay = criar("div", { classe: "a3i-overlay", hidden: true, role: "dialog", "aria-modal": "true", "aria-label": "Editor de ilustração" }, [
      criar("div", { classe: "a3i-janela" }, [
        criar("div", { classe: "a3i-barra" }, [
          criar("div", { classe: "a3i-grupo" }, [
            botaoFerramenta("selecionar", "Selecionar", ICONES.selecionar),
            botaoFerramenta("seta", "Seta", ICONES.seta),
            botaoFerramenta("elipse", "Círculo", ICONES.elipse),
            botaoFerramenta("retangulo", "Retângulo", ICONES.retangulo),
            botaoFerramenta("texto", "Texto", ICONES.texto),
            (() => {
              const b = criar("button", { type: "button", classe: "a3i-ferramenta", title: "Adicionar imagem (ou cole com Ctrl+V / arraste o arquivo)", "aria-label": "Adicionar imagem" });
              b.innerHTML = ICONES.imagem;
              b.appendChild(criar("span", { texto: "Imagem" }));
              b.addEventListener("click", () => arquivo.click());
              return b;
            })(),
          ]),
          criar("div", { classe: "a3i-grupo" }, [cores, espessura, tamanho]),
          criar("div", { classe: "a3i-grupo" }, [
            acao("Desfazer", "Desfazer (Ctrl+Z)", desfazer),
            acao("Frente", "Trazer para a frente", () => reordenar(1)),
            acao("Trás", "Enviar para trás", () => reordenar(-1)),
            acao("Excluir", "Excluir o item selecionado (Delete)", excluirSelecionado, "a3i-perigo"),
          ]),
          criar("div", { classe: "a3i-grupo a3i-grupo-fim" }, [
            acao("Cancelar", "Fechar sem salvar", cancelar),
            acao("Salvar", "Salvar a ilustração", salvar, "a3i-primario"),
          ]),
        ]),
        criar("div", { classe: "a3i-area" }, canvas),
        criar("div", { classe: "a3i-rodape" }, [
          criar("strong", { classe: "a3i-titulo", id: "a3i-titulo" }),
          criar("span", { classe: "a3i-dica", id: "a3i-dica" }),
        ]),
        arquivo,
      ]),
    ]);
    document.body.appendChild(overlay);

    canvas.addEventListener("pointerdown", aoPressionar);
    canvas.addEventListener("pointermove", aoMover);
    canvas.addEventListener("pointerup", aoSoltar);
    canvas.addEventListener("dblclick", aoDuploClique);
    canvas.addEventListener("dragover", (e) => e.preventDefault());
    canvas.addEventListener("drop", (e) => {
      e.preventDefault();
      adicionarArquivos(e.dataTransfer.files);
    });
    document.addEventListener("paste", (e) => {
      if (!estado || overlay.hidden) return;
      const arquivos = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
      if (arquivos.length) {
        e.preventDefault();
        adicionarArquivos(arquivos);
      }
    });
    document.addEventListener("keydown", aoTeclar);
    ui = { overlay, canvas, ctx: canvas.getContext("2d"), espessura, tamanho, cores };
  }

  // --- Abrir / fechar ------------------------------------------------------------
  function abrir({ objetos = [], resolverSrc: resolver, titulo = "", converterPdf: conversor = null } = {}) {
    if (!ui) montarUI();
    converterPdf = conversor;
    ui_arquivo.accept = conversor ? "image/*,application/pdf,.pdf" : "image/*";
    document.getElementById("a3i-titulo").textContent = titulo;
    resolverSrc = resolver || ((s) => s);
    estado = {
      objetos: JSON.parse(JSON.stringify(objetos)),
      sel: null,
      ferramenta: "selecionar",
      cor: "#e00000",
      esp: 4,
      tam: 36,
      historico: [],
      arraste: null,
      temp: null,
      alterado: false,
    };
    ui.overlay.hidden = false;
    document.body.classList.add("a3i-aberto");
    escolherFerramenta("selecionar");
    sincronizarControles();
    desenhar();
    ui.canvas.focus();
    return new Promise((resolve) => (estado.resolver = resolve));
  }

  function fechar(resultado) {
    ui.overlay.hidden = true;
    document.body.classList.remove("a3i-aberto");
    const resolver = estado.resolver;
    estado = null;
    resolver(resultado);
  }

  function cancelar() {
    if (estado.alterado && !confirm("Descartar as alterações da ilustração?")) return;
    fechar(null);
  }

  async function salvar() {
    const objetos = estado.objetos;
    await Promise.all(objetos.filter((o) => o.tipo === "imagem").map((o) => imagemCarregada(o.src)));
    const final = document.createElement("canvas");
    final.width = LARGURA;
    final.height = ALTURA;
    const c = final.getContext("2d");
    c.fillStyle = "#fff";
    c.fillRect(0, 0, LARGURA, ALTURA);
    objetos.forEach((o) => desenharObjeto(c, o));
    const blob = await new Promise((r) => final.toBlob(r, "image/jpeg", 0.92));
    fechar({ objetos, blob });
  }

  // --- Ferramentas e propriedades ---------------------------------------------------
  const DICAS = {
    selecionar: "Clique para selecionar; arraste para mover; puxe os quadradinhos para redimensionar. Duplo clique no texto para editar. Delete exclui.",
    seta: "Clique e arraste para desenhar a seta (a ponta fica onde você soltar).",
    elipse: "Clique e arraste para desenhar o círculo.",
    retangulo: "Clique e arraste para desenhar o retângulo.",
    texto: "Clique onde o texto deve ficar.",
  };

  function escolherFerramenta(chave) {
    estado.ferramenta = chave;
    ui.overlay.querySelectorAll("[data-ferramenta]").forEach((b) => b.classList.toggle("ativo", b.dataset.ferramenta === chave));
    ui.canvas.style.cursor = chave === "selecionar" ? "default" : "crosshair";
    document.getElementById("a3i-dica").textContent = DICAS[chave] || "";
  }

  function sincronizarControles() {
    const fonte = estado.sel || estado;
    const cor = fonte.cor || estado.cor;
    ui.cores.querySelectorAll(".a3i-cor").forEach((b) => b.classList.toggle("ativo", b.dataset.cor === cor));
    ui.espessura.value = String(fonte.esp || estado.esp);
    ui.tamanho.value = String(fonte.tam || estado.tam);
  }

  function mudarPropriedade(chave, valor) {
    estado[chave] = valor;
    const s = estado.sel;
    if (s && s.tipo !== "imagem" && (chave !== "tam" || s.tipo === "texto") && (chave !== "esp" || s.tipo !== "texto")) {
      guardarHistorico();
      s[chave] = valor;
    }
    sincronizarControles();
    desenhar();
  }

  function guardarHistorico() {
    estado.historico.push(JSON.stringify(estado.objetos));
    if (estado.historico.length > 60) estado.historico.shift();
    estado.alterado = true;
  }

  function desfazer() {
    if (!estado.historico.length) return;
    estado.objetos = JSON.parse(estado.historico.pop());
    estado.sel = null;
    desenhar();
  }

  function excluirSelecionado() {
    if (!estado.sel) return;
    guardarHistorico();
    estado.objetos = estado.objetos.filter((o) => o !== estado.sel);
    estado.sel = null;
    desenhar();
  }

  function reordenar(direcao) {
    const s = estado.sel;
    if (!s) return;
    guardarHistorico();
    const lista = estado.objetos.filter((o) => o !== s);
    if (direcao > 0) lista.push(s);
    else lista.unshift(s);
    estado.objetos = lista;
    desenhar();
  }

  function aoTeclar(e) {
    if (!estado || ui.overlay.hidden) return;
    const digitando = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if (e.key === "Escape") { e.preventDefault(); cancelar(); return; }
    if (digitando) return;
    if ((e.key === "Delete" || e.key === "Backspace") && estado.sel) { e.preventDefault(); excluirSelecionado(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); desfazer(); }
  }

  // --- Imagens ------------------------------------------------------------------------
  function imagemDe(src) {
    if (!imagens.has(src)) {
      const img = new Image();
      img.onload = () => estado && desenhar();
      img.src = resolverSrc(src);
      imagens.set(src, img);
    }
    return imagens.get(src);
  }

  function imagemCarregada(src) {
    const img = imagemDe(src);
    if (img.complete && img.naturalWidth) return Promise.resolve(img);
    return new Promise((ok) => { img.addEventListener("load", () => ok(img), { once: true }); img.addEventListener("error", () => ok(img), { once: true }); });
  }

  function lerComoDataUrl(arquivo) {
    return new Promise((ok, falha) => {
      const leitor = new FileReader();
      leitor.onload = () => ok(leitor.result);
      leitor.onerror = falha;
      leitor.readAsDataURL(arquivo);
    });
  }

  async function prepararImagem(arquivo) {
    const url = await lerComoDataUrl(arquivo);
    const img = await new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = falha; i.src = url; });
    let src = url;
    const maior = Math.max(img.naturalWidth, img.naturalHeight);
    if (maior > LADO_MAXIMO_IMAGEM) {
      const f = LADO_MAXIMO_IMAGEM / maior;
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * f);
      c.height = Math.round(img.naturalHeight * f);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      src = c.toDataURL("image/jpeg", 0.9);
    }
    return { src, largura: img.naturalWidth, altura: img.naturalHeight };
  }

  const ehPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");

  // PDF: cada página vira uma imagem na cena, organizadas em grade.
  async function adicionarPdfs(pdfs) {
    const dica = document.getElementById("a3i-dica");
    for (const pdf of pdfs) {
      dica.textContent = `Convertendo "${pdf.name}"…`;
      let paginas;
      try {
        paginas = await converterPdf(pdf);
      } catch (erro) {
        alert(`Não foi possível usar o PDF "${pdf.name}": ${erro.message}`);
        continue;
      }
      if (!paginas.length) continue;
      guardarHistorico();
      const colunas = Math.ceil(Math.sqrt(paginas.length));
      const linhas = Math.ceil(paginas.length / colunas);
      const celulaL = (LARGURA - 40) / colunas;
      const celulaA = (ALTURA - 40) / linhas;
      paginas.forEach((p, i) => {
        const f = Math.min((celulaL - 16) / p.largura, (celulaA - 16) / p.altura);
        const w = Math.round(p.largura * f);
        const h = Math.round(p.altura * f);
        const x = 20 + (i % colunas) * celulaL + (celulaL - w) / 2;
        const y = 20 + Math.floor(i / colunas) * celulaA + (celulaA - h) / 2;
        const obj = { tipo: "imagem", x: Math.round(x), y: Math.round(y), w, h, src: p.src };
        estado.objetos.push(obj);
        estado.sel = obj;
      });
    }
    escolherFerramenta("selecionar");
    desenhar();
  }

  async function adicionarArquivos(lista) {
    const todos = [...lista];
    const pdfs = todos.filter(ehPdf);
    if (pdfs.length && converterPdf) await adicionarPdfs(pdfs);
    else if (pdfs.length) alert("PDF não é aceito neste quadro. Use uma imagem.");
    const arquivos = todos.filter((f) => f.type.startsWith("image/"));
    if (!arquivos.length) return;
    guardarHistorico();
    const ja = estado.objetos.filter((o) => o.tipo === "imagem").length;
    for (const [i, arquivo] of arquivos.entries()) {
      try {
        const { src, largura, altura } = await prepararImagem(arquivo);
        const f = Math.min((LARGURA * 0.6) / largura, (ALTURA * 0.6) / altura, 1);
        const desloc = ((ja + i) % 6) * 40;
        const obj = { tipo: "imagem", x: 30 + desloc, y: 30 + desloc, w: Math.round(largura * f), h: Math.round(altura * f), src };
        estado.objetos.push(obj);
        estado.sel = obj;
      } catch (_) {
        /* arquivo de imagem inválido: ignora */
      }
    }
    escolherFerramenta("selecionar");
    desenhar();
  }

  // --- Desenho ---------------------------------------------------------------------------
  function caixa(o, c = ui.ctx) {
    if (o.tipo === "seta") {
      return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
    }
    if (o.tipo === "texto") {
      c.font = `bold ${o.tam}px Arial, Helvetica, sans-serif`;
      const linhas = String(o.texto).split("\n");
      const w = Math.max(...linhas.map((l) => c.measureText(l).width), 10);
      return { x: o.x, y: o.y, w, h: linhas.length * o.tam * 1.2 };
    }
    return { x: Math.min(o.x, o.x + o.w), y: Math.min(o.y, o.y + o.h), w: Math.abs(o.w), h: Math.abs(o.h) };
  }

  function desenharObjeto(c, o) {
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    if (o.tipo === "imagem") {
      const img = imagemDe(o.src);
      if (img.complete && img.naturalWidth) c.drawImage(img, o.x, o.y, o.w, o.h);
      else { c.fillStyle = "#eee"; c.fillRect(o.x, o.y, o.w, o.h); }
    } else if (o.tipo === "retangulo") {
      const b = caixa(o, c);
      c.strokeStyle = o.cor;
      c.lineWidth = o.esp;
      c.strokeRect(b.x, b.y, b.w, b.h);
    } else if (o.tipo === "elipse") {
      const b = caixa(o, c);
      c.strokeStyle = o.cor;
      c.lineWidth = o.esp;
      c.beginPath();
      c.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w / 2, 1), Math.max(b.h / 2, 1), 0, 0, Math.PI * 2);
      c.stroke();
    } else if (o.tipo === "seta") {
      const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
      const ponta = Math.max(16, o.esp * 4.5);
      c.strokeStyle = o.cor;
      c.fillStyle = o.cor;
      c.lineWidth = o.esp;
      c.beginPath();
      c.moveTo(o.x1, o.y1);
      c.lineTo(o.x2 - Math.cos(ang) * ponta * 0.8, o.y2 - Math.sin(ang) * ponta * 0.8);
      c.stroke();
      c.beginPath();
      c.moveTo(o.x2, o.y2);
      c.lineTo(o.x2 - ponta * Math.cos(ang - 0.45), o.y2 - ponta * Math.sin(ang - 0.45));
      c.lineTo(o.x2 - ponta * Math.cos(ang + 0.45), o.y2 - ponta * Math.sin(ang + 0.45));
      c.closePath();
      c.fill();
    } else if (o.tipo === "texto") {
      c.font = `bold ${o.tam}px Arial, Helvetica, sans-serif`;
      c.textBaseline = "top";
      c.lineWidth = Math.max(3, o.tam / 7);
      c.strokeStyle = o.cor === "#ffffff" ? "#000" : "#fff";
      c.fillStyle = o.cor;
      String(o.texto).split("\n").forEach((linha, i) => {
        c.strokeText(linha, o.x, o.y + i * o.tam * 1.2);
        c.fillText(linha, o.x, o.y + i * o.tam * 1.2);
      });
    }
    c.restore();
  }

  function tamanhoAlca() {
    const r = ui.canvas.getBoundingClientRect();
    return (10 * LARGURA) / Math.max(r.width, 1);
  }

  function alcas(o) {
    if (o.tipo === "seta") return [{ id: "p1", x: o.x1, y: o.y1 }, { id: "p2", x: o.x2, y: o.y2 }];
    if (o.tipo === "texto") return [];
    const b = caixa(o);
    return [
      { id: "nw", x: b.x, y: b.y }, { id: "ne", x: b.x + b.w, y: b.y },
      { id: "sw", x: b.x, y: b.y + b.h }, { id: "se", x: b.x + b.w, y: b.y + b.h },
    ];
  }

  function desenhar() {
    if (!estado) return;
    const c = ui.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = "#fff";
    c.fillRect(0, 0, LARGURA, ALTURA);
    estado.objetos.forEach((o) => desenharObjeto(c, o));
    if (estado.temp) desenharObjeto(c, estado.temp);
    const s = estado.sel;
    if (s) {
      const b = caixa(s);
      const t = tamanhoAlca();
      c.save();
      c.strokeStyle = "#d7261e";
      c.lineWidth = Math.max(1, t / 6);
      c.setLineDash([t / 1.5, t / 2]);
      c.strokeRect(b.x - t / 2, b.y - t / 2, b.w + t, b.h + t);
      c.setLineDash([]);
      c.fillStyle = "#fff";
      alcas(s).forEach((a) => {
        c.fillRect(a.x - t / 2, a.y - t / 2, t, t);
        c.strokeRect(a.x - t / 2, a.y - t / 2, t, t);
      });
      c.restore();
    }
    if (!estado.objetos.length && !estado.temp) {
      c.save();
      c.fillStyle = "#9aa3ad";
      c.font = "28px Arial, Helvetica, sans-serif";
      c.textAlign = "center";
      c.fillText("Adicione imagens (botão Imagem, Ctrl+V ou arraste o arquivo aqui)", LARGURA / 2, ALTURA / 2 - 16);
      c.fillText("e marque com setas, círculos e textos.", LARGURA / 2, ALTURA / 2 + 24);
      c.restore();
    }
  }

  // --- Interação com o mouse ----------------------------------------------------------------
  function posicao(e) {
    const r = ui.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * LARGURA) / r.width, y: ((e.clientY - r.top) * ALTURA) / r.height };
  }

  function distanciaSegmento(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function acertou(o, p) {
    const folga = tamanhoAlca();
    if (o.tipo === "seta") return distanciaSegmento(p, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }) <= Math.max(folga, o.esp + 4);
    const b = caixa(o);
    if (o.tipo === "elipse") {
      const rx = b.w / 2 + folga;
      const ry = b.h / 2 + folga;
      return ((p.x - b.x - b.w / 2) / rx) ** 2 + ((p.y - b.y - b.h / 2) / ry) ** 2 <= 1;
    }
    return p.x >= b.x - folga && p.x <= b.x + b.w + folga && p.y >= b.y - folga && p.y <= b.y + b.h + folga;
  }

  function alcaEm(p) {
    if (!estado.sel) return null;
    const t = tamanhoAlca();
    return alcas(estado.sel).find((a) => Math.abs(p.x - a.x) <= t && Math.abs(p.y - a.y) <= t) || null;
  }

  function aoPressionar(e) {
    if (e.button !== 0) return;
    const p = posicao(e);
    ui.canvas.setPointerCapture(e.pointerId);
    const f = estado.ferramenta;
    if (f === "selecionar") {
      const alca = alcaEm(p);
      if (alca) {
        guardarHistorico();
        estado.arraste = { modo: "redimensionar", alca: alca.id, inicio: p, original: { ...estado.sel } };
        return;
      }
      const alvo = [...estado.objetos].reverse().find((o) => acertou(o, p)) || null;
      estado.sel = alvo;
      if (alvo) {
        guardarHistorico();
        estado.arraste = { modo: "mover", inicio: p, original: { ...alvo } };
      }
      sincronizarControles();
      desenhar();
      return;
    }
    if (f === "texto") {
      const texto = prompt("Texto:");
      if (texto && texto.trim()) {
        guardarHistorico();
        const obj = { tipo: "texto", x: p.x, y: p.y, texto: texto.trim(), cor: estado.cor, tam: estado.tam };
        estado.objetos.push(obj);
        estado.sel = obj;
        escolherFerramenta("selecionar");
        sincronizarControles();
      }
      desenhar();
      return;
    }
    estado.temp = f === "seta"
      ? { tipo: "seta", x1: p.x, y1: p.y, x2: p.x, y2: p.y, cor: estado.cor, esp: estado.esp }
      : { tipo: f, x: p.x, y: p.y, w: 0, h: 0, cor: estado.cor, esp: estado.esp };
  }

  function aoMover(e) {
    const p = posicao(e);
    if (estado.temp) {
      const t = estado.temp;
      if (t.tipo === "seta") { t.x2 = p.x; t.y2 = p.y; } else { t.w = p.x - t.x; t.h = p.y - t.y; }
      desenhar();
      return;
    }
    const a = estado.arraste;
    if (!a) {
      if (estado.ferramenta === "selecionar") {
        const sobre = alcaEm(p) ? "nwse-resize" : estado.objetos.some((o) => acertou(o, p)) ? "move" : "default";
        ui.canvas.style.cursor = sobre;
      }
      return;
    }
    const s = estado.sel;
    const o = a.original;
    const dx = p.x - a.inicio.x;
    const dy = p.y - a.inicio.y;
    if (a.modo === "mover") {
      if (s.tipo === "seta") Object.assign(s, { x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy });
      else Object.assign(s, { x: o.x + dx, y: o.y + dy });
    } else if (s.tipo === "seta") {
      if (a.alca === "p1") Object.assign(s, { x1: p.x, y1: p.y });
      else Object.assign(s, { x2: p.x, y2: p.y });
    } else {
      // Caixa normalizada do original; move o canto puxado.
      const b = caixa(o);
      let x1 = b.x;
      let y1 = b.y;
      let x2 = b.x + b.w;
      let y2 = b.y + b.h;
      if (a.alca.includes("w")) x1 = p.x; else x2 = p.x;
      if (a.alca.includes("n")) y1 = p.y; else y2 = p.y;
      if (s.tipo === "imagem" && !e.shiftKey) {
        // Imagens mantêm a proporção (Shift solta a proporção).
        const proporcao = b.w / (b.h || 1);
        const largura = Math.abs(x2 - x1);
        const altura = largura / proporcao;
        if (a.alca.includes("n")) y1 = y2 - altura; else y2 = y1 + altura;
      }
      Object.assign(s, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(Math.abs(x2 - x1), 4), h: Math.max(Math.abs(y2 - y1), 4) });
    }
    desenhar();
  }

  function aoSoltar(e) {
    if (ui.canvas.hasPointerCapture(e.pointerId)) ui.canvas.releasePointerCapture(e.pointerId);
    if (estado.temp) {
      const t = estado.temp;
      estado.temp = null;
      const grande = t.tipo === "seta" ? Math.hypot(t.x2 - t.x1, t.y2 - t.y1) > 8 : Math.abs(t.w) > 6 && Math.abs(t.h) > 6;
      if (grande) {
        guardarHistorico();
        if (t.tipo !== "seta") Object.assign(t, caixa(t));
        estado.objetos.push(t);
        estado.sel = t;
        escolherFerramenta("selecionar");
        sincronizarControles();
      }
      desenhar();
      return;
    }
    estado.arraste = null;
  }

  function aoDuploClique(e) {
    const p = posicao(e);
    const alvo = [...estado.objetos].reverse().find((o) => o.tipo === "texto" && acertou(o, p));
    if (!alvo) return;
    const texto = prompt("Editar texto:", alvo.texto);
    if (texto === null) return;
    guardarHistorico();
    if (texto.trim()) alvo.texto = texto.trim();
    else estado.objetos = estado.objetos.filter((o) => o !== alvo);
    desenhar();
  }

  return { abrir, LARGURA, ALTURA };
})();
