"""Integra o módulo Gestão de Ações 8D no Gerenciador PDCA (Sistema-PDCA-8D).

Uso (com o servidor do Gerenciador PARADO):
    python integrar_no_gerenciador.py "C:\\caminho\\Sistema-PDCA-8D" --verificar
        -> só confere (não altera nada) e mostra o que será feito e o que precisa
           de ajuste manual. Recomendado rodar ANTES, principalmente se o
           Gerenciador tiver melhorias que não estavam na versão analisada.
    python integrar_no_gerenciador.py "C:\\caminho\\Sistema-PDCA-8D"
        -> aplica a integração.

Tudo ou nada: o script primeiro confere TODOS os pontos de alteração. Se algum
não for encontrado, ele para sem alterar nenhum arquivo e diz qual ponto fazer
à mão (INTEGRACAO_TI.md, seção 2). Pode rodar mais de uma vez: o que já foi
feito é pulado.

O que o script faz:
  1. Faz backup dos arquivos do Gerenciador que serão alterados.
  2. Copia o pacote acoes8d/ e o importar_a3_excel.py para o Gerenciador.
  3. app.py: registra o módulo e, no cadastro de reclamação, cria o A3
     automaticamente (qualquer tipo de reclamação).
  4. templates/base.html: "8D" no menu, no lugar de "Etapas 8D"
     (as etapas do 8D passam a ser reconhecidas pelo Formulário A3), tema
     Wetzel e o indicador "Online" no canto superior direito.
  5. static/historico.js: botão "A3" em cada linha do Gerenciador.
  6. static/app.js: depois de cadastrar, mostra o link "Abrir o A3".
  7. Telas do Gerenciador: o rótulo "ID MRHB" passa a ser "ID Wetzel"
     (só o texto exibido; o campo id_mrhb do banco não muda).

Para desfazer: copie de volta os arquivos da pasta de backup criada e apague
a pasta acoes8d/ do Gerenciador.
"""
import re
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ORIGEM = Path(__file__).resolve().parent
MARCA = "Gestão de Ações 8D"

ARQUIVOS_OBRIGATORIOS = ["app.py", "templates/base.html", "static/historico.js", "static/app.js"]
# Arquivos em que o rótulo exibido "ID MRHB" vira "ID Wetzel" (passo 7).
ARQUIVOS_ROTULO_ID = [
    "app.py",
    "static/app.js",
    "static/dashboard.js",
    "static/historico.js",
    "static/etapas_8d.js",
    "templates/historico.html",
    "templates/historico_alteracoes.html",
]
ROTULO_ANTIGO, ROTULO_NOVO = "ID MRHB", "ID Wetzel"

# Tabelas e colunas do Gerenciador que o módulo lê (reclamacoes) e grava (etapas_8d).
COLUNAS_NECESSARIAS = {
    "reclamacoes": [
        "id", "id_mrhb", "numero_notificacao", "data_abertura", "pn_mrhb", "pn_cliente", "descricao_defeito",
        "cliente", "area_responsavel_8d", "tipo_reclamacao", "qtd_reclamada", "responsavel_cliente",
        "mq_in", "mq_us", "criado_em",
    ],
    "etapas_8d": ["reclamacao_id", "etapa", "realizacao", "aplicavel"],
}
ETAPAS_DO_MODULO = ["Contenção", "Causa Raiz", "Ação Corretiva", "Poka Yoke", "LPA", "Validação",
                    "Trab. Padronizado", "FMEA", "Plano de Controle", "Lições Aprendidas", "8D Fechado"]

LINHA_ETAPAS = """        <a href="{{ url_for('etapas_8d_page') }}" class="{{ 'active' if active == 'etapas' else '' }}">Etapas 8D</a>\n"""
LINHA_8D = """        <a href="{{ url_for('acoes8d.dashboard') }}" class="{{ 'active' if active == 'acoes8d' else '' }}">8D</a>\n"""


# --------------------------------------------------------------------------- alterações
# Cada alteração: (descrição, função(texto) -> novo texto | None se o ponto não existe,
#                  texto que indica "já feito").
def trocar(antigo, novo):
    return lambda texto: texto.replace(antigo, novo, 1) if antigo in texto else None


def registrar_modulo(texto):
    # Logo depois da linha "app.secret_key = ..." (o valor da chave pode ser qualquer um)
    # ou, se não houver, depois de "app = Flask(__name__)".
    for padrao in (r"^app\.secret_key\s*=.*$", r"^app\s*=\s*Flask\(.*\)\s*$"):
        achou = re.search(padrao, texto, flags=re.M)
        if achou:
            fim = achou.end()
            return (texto[:fim] + f"\n\nimport acoes8d  # {MARCA}: A3 digital, Gestão de Ações e Visão Geral\n"
                    "acoes8d.init_app(app)" + texto[fim:])
    return None


def a3_automatico(texto):
    # return jsonify({"ok": True, "id_mrhb": id_mrhb}), 201  (aceita espaços diferentes)
    padrao = re.compile(r'^(\s*)return\s+jsonify\(\{\s*"ok"\s*:\s*True\s*,\s*"id_mrhb"\s*:\s*id_mrhb\s*\}\)\s*,\s*201\s*$', re.M)
    achou = padrao.search(texto)
    if not achou:
        return None
    recuo = achou.group(1)
    novo = (f"{recuo}# {MARCA}: toda reclamação nova (qualquer tipo) já ganha o seu A3.\n"
            f"{recuo}analise_a3_id = acoes8d.criar_a3_automatico(id_mrhb)\n\n"
            f'{recuo}return jsonify({{"ok": True, "id_mrhb": id_mrhb, "analise_a3_id": analise_a3_id}}), 201')
    return texto[:achou.start()] + novo + texto[achou.end():]


def etapas_redireciona(texto):
    padrao = re.compile(r'^(\s*)return\s+render_template\(\s*"etapas_8d\.html"[^\n]*$', re.M)
    achou = padrao.search(texto)
    if not achou:
        return None
    recuo = achou.group(1)
    return (texto[:achou.start()] + f"{recuo}# {MARCA}: as etapas do 8D agora vêm do Formulário A3.\n"
            f'{recuo}return redirect(url_for("acoes8d.analises"))' + texto[achou.end():])


def garantir_import_redirect(texto):
    # O redirect acima precisa de "redirect" e "url_for" importados do flask.
    achou = re.search(r"^from flask import ([^\n]+)$", texto, flags=re.M)
    if not achou:
        return None
    nomes = [n.strip() for n in achou.group(1).replace("(", "").replace(")", "").split(",")]
    faltam = [n for n in ("redirect", "url_for") if n not in nomes]
    if not faltam:
        return texto
    linha = "from flask import " + ", ".join(nomes + faltam)
    return texto[:achou.start()] + linha + texto[achou.end():]


def menu_8d(texto):
    if LINHA_ETAPAS in texto:
        return texto.replace(LINHA_ETAPAS, LINHA_8D, 1)
    # link das etapas com outro texto/estilo: reconhece pelo endereço (etapas_8d_page)
    achou = re.search(r"^[ \t]*<a [^\n]*url_for\(\s*'etapas_8d_page'\s*\)[^\n]*</a>[ \t]*\n", texto, flags=re.M)
    if achou:
        return texto[:achou.start()] + LINHA_8D + texto[achou.end():]
    # menu diferente do analisado: põe o link "8D" antes do fechamento do <nav>
    achou = re.search(r"^(\s*)</nav>", texto, flags=re.M)
    if not achou:
        return None
    return texto[:achou.start()] + LINHA_8D + texto[achou.start():]


ALTERACOES = {
    "app.py": [
        ("registro do módulo", registrar_modulo, "acoes8d.init_app(app)"),
        ("A3 automático ao cadastrar reclamação", a3_automatico, "acoes8d.criar_a3_automatico(id_mrhb)"),
        ("Etapas 8D -> Formulário A3 (redireciona o endereço antigo)", etapas_redireciona,
         'return redirect(url_for("acoes8d.analises"))'),
        ("import de redirect/url_for", garantir_import_redirect, None),
    ],
    "templates/base.html": [
        ('link "8D" no menu (no lugar de "Etapas 8D")', menu_8d, "acoes8d.dashboard"),
        ("identidade visual Wetzel (tema)", trocar(
            """<link rel="stylesheet" href="{{ url_for('static', filename='style.css') }}" />\n""",
            """<link rel="stylesheet" href="{{ url_for('static', filename='style.css') }}" />\n"""
            """  <link rel="stylesheet" href="{{ url_for('acoes8d.static', filename='tema_wetzel.css') }}" />\n"""),
         "tema_wetzel.css"),
        ('indicador "Online" no cabeçalho', trocar(
            """      </nav>\n""",
            """      </nav>\n"""
            """      <div class="a8-online" data-ping="{{ url_for('acoes8d.api_ping') }}" title="Sistema no ar" role="status" aria-live="polite">\n"""
            """        <span class="a8-online-bolinha" aria-hidden="true"></span><span class="a8-online-texto">Online</span>\n"""
            """      </div>\n"""),
         "a8-online"),
        ("script do indicador Online", trocar(
            """  {% block scripts %}{% endblock %}\n""",
            """  {% block scripts %}{% endblock %}\n"""
            """  <script src="{{ url_for('acoes8d.static', filename='status_online.js') }}"></script>\n"""),
         "status_online.js"),
    ],
    "static/historico.js": [
        ('botão "A3" em cada reclamação', trocar(
            """<td class="acoes-celula"><button type="button" class="btn-editar" data-editar="${r.id}">Editar</button>""",
            """<td class="acoes-celula"><a class="btn-editar" href="/acoes8d/a3/${encodeURIComponent(r.id_mrhb)}" title="Abrir o A3 desta reclamação">A3</a><button type="button" class="btn-editar" data-editar="${r.id}">Editar</button>"""),
         "/acoes8d/a3/"),
    ],
    "static/app.js": [
        ('link "Abrir o A3" após cadastrar', lambda texto: (lambda m: None if not m else (
            texto[:m.end()] + "\n"
            f"""    if (resposta.analise_a3_id) {{ // {MARCA}: A3 criado automaticamente\n"""
            """      const linkA3 = document.createElement("a");\n"""
            """      linkA3.href = `/acoes8d/analises/${resposta.analise_a3_id}`;\n"""
            """      linkA3.textContent = "Abrir o A3 desta reclamação →";\n"""
            """      linkA3.style.marginLeft = "10px";\n"""
            """      linkA3.style.fontWeight = "700";\n"""
            """      alertBox.appendChild(linkA3);\n"""
            """    }""" + texto[m.end():]))(
            re.search(r"^\s*mostrarAlerta\(`Reclamação cadastrada com sucesso![^\n]*$", texto, flags=re.M)),
         "analise_a3_id"),
    ],
}


def planejar(destino):
    """Aplica tudo em memória. Devolve (novos_textos, relatório, problemas)."""
    novos, relatorio, problemas = {}, [], []
    for relativo, alteracoes in ALTERACOES.items():
        caminho = destino / relativo
        texto = caminho.read_text(encoding="utf-8")
        for descricao, funcao, ja_feito in alteracoes:
            if ja_feito and ja_feito in texto:
                relatorio.append(f"   = {relativo}: {descricao} (já estava feito)")
                continue
            resultado = funcao(texto)
            if resultado is None:
                problemas.append(f"{relativo}: {descricao}")
                relatorio.append(f"   ! {relativo}: {descricao} -> PONTO NÃO ENCONTRADO (fazer à mão)")
                continue
            if resultado != texto:
                relatorio.append(f"   + {relativo}: {descricao}")
            texto = resultado
        novos[relativo] = texto
    # rótulo "ID MRHB" -> "ID Wetzel"
    for relativo in ARQUIVOS_ROTULO_ID:
        caminho = destino / relativo
        if not caminho.exists():
            relatorio.append(f"   - {relativo}: arquivo não existe (pulado)")
            continue
        texto = novos.get(relativo, caminho.read_text(encoding="utf-8"))
        vezes = texto.count(ROTULO_ANTIGO)
        if vezes:
            relatorio.append(f'   + {relativo}: rótulo "ID MRHB" -> "ID Wetzel" ({vezes}x)')
            novos[relativo] = texto.replace(ROTULO_ANTIGO, ROTULO_NOVO)
    return novos, relatorio, problemas


def conferir_banco(destino):
    """Confere se as tabelas/colunas que o módulo usa existem no banco do Gerenciador."""
    banco = destino / "data" / "app.db"
    if not banco.exists():
        return [f"banco não encontrado em {banco} (o módulo precisa dele para ler as reclamações)"], []
    problemas, avisos = [], []
    conn = sqlite3.connect(f"{banco.resolve().as_uri()}?mode=ro", uri=True)
    try:
        for tabela, colunas in COLUNAS_NECESSARIAS.items():
            existentes = {l[1] for l in conn.execute(f"PRAGMA table_info({tabela})")}
            if not existentes:
                problemas.append(f"tabela '{tabela}' não existe no banco")
                continue
            faltam = [c for c in colunas if c not in existentes]
            if faltam:
                problemas.append(f"tabela '{tabela}' sem as colunas: {', '.join(faltam)}")
        try:
            etapas = {l[0] for l in conn.execute("SELECT DISTINCT etapa FROM etapas_8d")}
            desconhecidas = sorted(etapas - set(ETAPAS_DO_MODULO))
            if desconhecidas:
                avisos.append("etapas em etapas_8d com nome diferente do módulo (não serão atualizadas): "
                              + ", ".join(desconhecidas))
        except sqlite3.OperationalError:
            pass
    finally:
        conn.close()
    return problemas, avisos


def main():
    argumentos = [a for a in sys.argv[1:] if not a.startswith("--")]
    so_verificar = "--verificar" in sys.argv
    if len(argumentos) != 1:
        print(__doc__)
        raise SystemExit(1)
    destino = Path(argumentos[0]).resolve()
    faltando = [a for a in ARQUIVOS_OBRIGATORIOS if not (destino / a).exists()]
    if faltando:
        raise SystemExit(f"ERRO: {destino} não parece ser o Gerenciador (faltam: {', '.join(faltando)}).")

    novos, relatorio, problemas = planejar(destino)
    problemas_banco, avisos_banco = conferir_banco(destino)

    print("Conferência dos arquivos do Gerenciador:")
    print("\n".join(relatorio))
    print("\nConferência do banco (data/app.db):")
    if problemas_banco:
        for p in problemas_banco:
            print(f"   ! {p}")
    else:
        print("   ok: tabelas e colunas usadas pelo módulo existem")
    for a in avisos_banco:
        print(f"   aviso: {a}")

    if problemas or problemas_banco:
        print("\nRESULTADO: há pontos que precisam de ajuste (marcados com '!'). NADA foi alterado.")
        print("Faça esses pontos à mão (INTEGRACAO_TI.md, seção 2) ou envie os arquivos para revisão.")
        raise SystemExit(2)
    if so_verificar:
        print("\nRESULTADO: tudo compatível. Para aplicar, rode o mesmo comando sem --verificar.")
        return

    # 1. Backup
    backup = destino / f"backup_antes_acoes8d_{datetime.now():%Y%m%d_%H%M%S}"
    for relativo in dict.fromkeys(ARQUIVOS_OBRIGATORIOS + ARQUIVOS_ROTULO_ID):
        if (destino / relativo).exists():
            alvo = backup / relativo
            alvo.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(destino / relativo, alvo)
    print(f"\n1. Backup salvo em: {backup}")

    # 2. Pacote do módulo
    shutil.copytree(ORIGEM / "acoes8d", destino / "acoes8d", dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    shutil.copy2(ORIGEM / "importar_a3_excel.py", destino / "importar_a3_excel.py")
    print("2. Pacote acoes8d/ e importar_a3_excel.py copiados")

    # 3 a 7. Grava as alterações já conferidas
    for relativo, texto in novos.items():
        caminho = destino / relativo
        if caminho.read_text(encoding="utf-8") != texto:
            caminho.write_text(texto, encoding="utf-8")
    print("3-7. Alterações aplicadas (ver a lista acima)")

    print(
        "\nIntegração concluída. Próximos passos:\n"
        "  - Instalar as dependências novas: pip install pymupdf openpyxl\n"
        "  - Iniciar o Gerenciador normalmente (python app.py).\n"
        "  - Fazer o teste de aceite (INTEGRACAO_TI.md, seção 0.1).\n"
        "  - (Opcional) Importar A3 antigos do Excel:\n"
        f'      python importar_a3_excel.py "C:\\pasta\\dos\\A3" --db "{destino / "data" / "app.db"}"'
    )


if __name__ == "__main__":
    main()
