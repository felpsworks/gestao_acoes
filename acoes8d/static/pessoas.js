(() => {
  const { api, criar, toast } = A8;
  const corpo = document.getElementById("a8-corpo-pessoas");
  const alerta = document.getElementById("a8-pessoas-alerta");
  const form = document.getElementById("a8-form-pessoa");

  function erro(mensagem) {
    alerta.textContent = mensagem;
    alerta.hidden = !mensagem;
  }

  async function carregar() {
    const pessoas = await api("/api/pessoas").catch((e) => { erro(e.message); return []; });
    corpo.innerHTML = "";
    if (!pessoas.length) {
      corpo.appendChild(criar("tr", {}, criar("td", { colspan: 6, classe: "empty", texto: "Nenhuma pessoa cadastrada." })));
    }
    pessoas.forEach((p) => {
      const nome = criar("input", { value: p.nome, "aria-label": "Nome" });
      const setor = criar("input", { value: p.setor || "", list: "a8-lista-setores", "aria-label": "Setor" });
      const email = criar("input", { value: p.email || "", type: "email", "aria-label": "E-mail" });
      const ativo = criar("input", { type: "checkbox", "aria-label": "Ativo" });
      ativo.checked = Boolean(p.ativo);
      const salvar = async () => {
        try {
          await api(`/api/pessoas/${p.id}`, { metodo: "PUT", corpo: { nome: nome.value, setor: setor.value, email: email.value, ativo: ativo.checked } });
          erro("");
          toast("Cadastro atualizado.");
          A8.modelo(true);
        } catch (e) {
          erro(e.message);
        }
      };
      [nome, setor, email].forEach((c) => c.addEventListener("change", salvar));
      ativo.addEventListener("change", salvar);
      corpo.appendChild(criar("tr", {}, [
        criar("td", { classe: "a8-celula-input" }, nome),
        criar("td", { classe: "a8-celula-input" }, setor),
        criar("td", { classe: "a8-celula-input" }, email),
        criar("td", { classe: "a8-num" }, p.acoes_abertas
          ? criar("a", { href: `${A8.base}/acoes?situacao=abertas&responsavel=${encodeURIComponent(p.nome)}`, texto: p.acoes_abertas })
          : "0"),
        criar("td", { classe: "a8-centro" }, ativo),
        criar("td", {}, criar("button", {
          type: "button", classe: "btn-excluir", texto: "Excluir",
          onclick: async () => {
            if (!confirm(`Excluir ${p.nome} do cadastro? As ações já atribuídas não são alteradas.`)) return;
            await api(`/api/pessoas/${p.id}`, { metodo: "DELETE" });
            carregar();
          },
        })),
      ]));
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/pessoas", { metodo: "POST", corpo: { nome: form.elements.nome.value, setor: form.elements.setor.value, email: form.elements.email.value } });
      form.reset();
      erro("");
      toast("Pessoa adicionada.");
      A8.modelo(true);
      carregar();
      form.elements.nome.focus();
    } catch (err) {
      erro(err.message);
    }
  });

  A8.modelo();
  carregar();
})();
