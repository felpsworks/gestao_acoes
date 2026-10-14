import json
import uuid
from datetime import date
from pathlib import Path

from flask import abort, current_app, jsonify, redirect, render_template, request, send_from_directory, url_for

from . import bp
from .db import analistas_gerenciador, buscar_reclamacao, conectar, conectar_gerenciador, defeitos_reclamacao, normalizar_tipo, pesquisar_reclamacoes, tipos_reclamacao
from .etapas import (
    ETAPAS_8D,
    etapas_pendentes,
    atualizar_datas_de_campos,
    calcular_etapas,
    etapas_da_analise,
    sincronizar_etapas_gerenciador,
)
from .modelo_a3 import (
    DIAS_PRAZO_LIMITE_A3,
    ANEXO_SECOES,
    GRUPOS_POR_CHAVE,
    FAIXAS_VELOCIMETRO,
    META_DIAS_FECHAR_A3,
    SETORES_PADRAO,
    SEM_RECLAMACAO,
    TIPOS_PADRAO_VISAO,
    normalizar_setor,
    STATUS_A3,
    campos_faltando_contencao,
    STATUS_ACAO,
    mesclar_com_padrao,
    modelo_para_frontend,
)
from .regras import DIAS_ALERTA_VENCIMENTO, computar_dashboard, enriquecer_acao, para_data, status_automatico_a3
from .servicos import criar_analise, sincronizar_a3_automaticos

# Campos do cabeçalho do A3 que viram colunas (o restante do formulário fica
# no JSON "dados"). Rótulos usados no histórico de alterações.
CAMPOS_CABECALHO = {
    "numero_notificacao": "Nº Notificação",
    "tema": "Tema",
    "responsavel": "Responsável",
    "area": "Área",
    "turno": "Turno",
    "maquina": "Máquina",
    "supervisor": "Supervisor",
    "area_gestor": "Área (Gestor)",
    "gestor": "Gestor",
    "data_emissao": "Emissão",
    "prazo_limite": "Prazo limite",
    "cliente": "Cliente",
    "produto": "Produto",
    "pn_mrhb": "PN MRHB",
    "pn_cliente": "PN Cliente",
    "quantidade": "Quantidade",
    "definicao_problema": "Definição do problema",
    "status": "Status do A3",
    "resultado_validacao": "Validação pelo emissor",
    "data_fechamento": "Data de fechamento",
}

CAMPOS_ACAO = {
    "grupo": "Tipo",
    "subgrupo": "Subtipo",
    "descricao": "Descrição",
    "responsavel": "Responsável",
    "setor": "Setor",
    "data_abertura": "Abertura",
    "prazo": "Prazo",
    "status": "Status",
    "data_conclusao": "Conclusão",
    "abrangencia": "Abrangência",
    "eficaz": "Eficaz?",
    "observacao": "Observação",
}

EXTENSOES_ANEXO = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".pdf", ".xlsx", ".xls", ".docx", ".doc", ".pptx", ".csv", ".txt"}


def _texto(valor):
    return "" if valor is None else str(valor).strip()


def _erro(mensagem, codigo=400):
    return jsonify({"erro": mensagem}), codigo


def _registrar(conn, tipo, analise_id=None, acao_id=None, id_mrhb=None, campo=None,
               valor_anterior=None, valor_novo=None, motivo=None):
    conn.execute(
        """INSERT INTO a3_historico
               (analise_id, acao_id, id_mrhb, tipo, campo, valor_anterior, valor_novo, motivo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (analise_id, acao_id, id_mrhb, tipo, campo, valor_anterior, valor_novo, motivo),
    )


# O editor salva sozinho a cada alteração; para o histórico não virar uma
# linha por tecla, edições do mesmo campo em até 15 minutos são agrupadas
# numa linha só (mantém o valor "antes" original e atualiza o "depois").
JANELA_AGRUPAR_HISTORICO = "-15 minutes"


def _registrar_edicao_a3(conn, analise_id, id_mrhb, campo, anterior, novo):
    recente = conn.execute(
        """SELECT id, valor_novo FROM a3_historico
           WHERE analise_id = ? AND tipo = 'Edição do A3' AND campo = ?
             AND data_hora >= datetime('now', 'localtime', ?)
           ORDER BY id DESC LIMIT 1""",
        (analise_id, campo, JANELA_AGRUPAR_HISTORICO),
    ).fetchone()
    if campo == "Formulário":
        secoes = set(novo)
        if recente and recente["valor_novo"]:
            secoes |= set(recente["valor_novo"].removeprefix("Seções alteradas: ").split(", "))
        novo = "Seções alteradas: " + ", ".join(sorted(secoes))
    if recente:
        conn.execute(
            "UPDATE a3_historico SET valor_novo = ?, data_hora = datetime('now', 'localtime') WHERE id = ?",
            (novo, recente["id"]),
        )
    else:
        _registrar(conn, "Edição do A3", analise_id=analise_id, id_mrhb=id_mrhb, campo=campo,
                   valor_anterior=anterior, valor_novo=novo)


def _setor_do_responsavel(conn, valores):
    """Ação sem setor informado herda o setor (departamento) do responsável no Cadastro."""
    if not valores.get("setor") and valores.get("responsavel"):
        linha = conn.execute(
            "SELECT setor FROM a3_pessoas WHERE nome = ? AND TRIM(COALESCE(setor, '')) != ''", (valores["responsavel"],)
        ).fetchone()
        if linha:
            valores["setor"] = linha["setor"]


def _garantir_pessoa(conn, nome, setor):
    """Quem recebe uma ação entra automaticamente no cadastro de pessoas."""
    if nome:
        conn.execute("INSERT OR IGNORE INTO a3_pessoas (nome, setor) VALUES (?, ?)", (nome, normalizar_setor(setor) or None))


def _listar_acoes(conn, analise_id=None):
    sql = """
        SELECT ac.*, an.id_mrhb, an.cliente, an.pn_mrhb, an.status AS status_a3,
               an.responsavel AS analista, an.data_emissao, an.definicao_problema AS problema, an.produto
        FROM a3_acoes ac JOIN a3_analises an ON an.id = ac.analise_id
    """
    params = []
    if analise_id is not None:
        sql += " WHERE ac.analise_id = ?"
        params.append(analise_id)
    sql += " ORDER BY ac.prazo, ac.id"
    hoje = date.today()
    return [enriquecer_acao(dict(l), hoje) for l in conn.execute(sql, params)]


@bp.route("/api/ping")
def api_ping():
    """Usado pelo indicador "Online" do cabeçalho."""
    return jsonify({"ok": True})


@bp.before_request
def _garantir_a3_das_novas_reclamacoes():
    """Rede de segurança da criação automática (ver servicos.py)."""
    sincronizar_a3_automaticos()


# ---------------------------------------------------------------------------
# Páginas
# ---------------------------------------------------------------------------
def _pagina(template, aba, **extra):
    return render_template(f"acoes8d/{template}", active="acoes8d", aba_a8=aba, **extra)


@bp.route("/")
@bp.route("/dashboard")
def dashboard():
    return _pagina("dashboard.html", "dashboard")


@bp.route("/analises")
def analises():
    return _pagina("analises.html", "analises")


@bp.route("/analises/<int:analise_id>")
def editor_a3(analise_id):
    return _pagina("editor_a3.html", "analises", analise_id=analise_id)


@bp.route("/a3/<path:id_mrhb>")
def abrir_a3_por_id(id_mrhb):
    """Atalho para o Gerenciador: abre o A3 do ID MRHB (ou a criação dele,
    já preenchida, se ainda não existir). Ex.: /acoes8d/a3/E-70232026"""
    id_mrhb = id_mrhb.strip().upper()
    conn = conectar()
    linha = conn.execute("SELECT id FROM a3_analises WHERE id_mrhb = ?", (id_mrhb,)).fetchone()
    conn.close()
    if linha:
        return redirect(url_for("acoes8d.editor_a3", analise_id=linha["id"]))
    return redirect(url_for("acoes8d.analises", novo=id_mrhb))


@bp.route("/acoes")
def controle_acoes():
    return _pagina("acoes.html", "acoes")


@bp.route("/pessoas")
def pessoas():
    return _pagina("pessoas.html", "pessoas")


# Etapa do 8D -> (seção do A3, o que faz contar como realizada). Usado na aba Guia.
SECAO_DA_ETAPA = {
    "Contenção": ("3 · Contenção", "Todas as ações da 3.1 (e da 3.2, se \"Aplicável\") em G"),
    "Causa Raiz": ("4 · Causa raiz", "Campo \"Causa raiz\" dos 5 Porquês preenchido"),
    "Ação Corretiva": ("5 · Ações corretivas", "Todas as ações corretivas em G"),
    "Poka Yoke": ("6 · Retroalimentação", "Ação da linha em G (sem ação ou N/A = não aplicável)"),
    "LPA": ("6 · Retroalimentação", "Ação da linha em G (sem ação ou N/A = não aplicável)"),
    "Trab. Padronizado": ("6 · Retroalimentação", "Ação da linha em G (sem ação ou N/A = não aplicável)"),
    "FMEA": ("6 · Retroalimentação", "Ação da linha em G (sem ação ou N/A = não aplicável)"),
    "Plano de Controle": ("6 · Retroalimentação", "Ação da linha em G (sem ação ou N/A = não aplicável)"),
    "Validação": ("7 · Eficácia", "Qualquer ação da seção 7 em G"),
    "Lições Aprendidas": ("8 · Fechamento", "Campo \"Lições aprendidas\" preenchido"),
    "8D Fechado": ("8 · Fechamento", "A3 concluído (ações G + etapas realizadas + \"8D Aprovado\")"),
}


@bp.route("/guia")
def guia():
    """Aba Guia: as regras que o sistema aplica sozinho (valores lidos do próprio código)."""
    dias_acao = {g["chave"]: g["dias_sugeridos"] for g in GRUPOS_POR_CHAVE.values()}
    return _pagina(
        "guia.html", "guia",
        etapas=ETAPAS_8D, secao_da_etapa=SECAO_DA_ETAPA, setores=SETORES_PADRAO, tipos_padrao=TIPOS_PADRAO_VISAO,
        meta=META_DIAS_FECHAR_A3, dias_prazo_limite=DIAS_PRAZO_LIMITE_A3, dias_alerta=DIAS_ALERTA_VENCIMENTO,
        dias_acao=dias_acao,
    )


# ---------------------------------------------------------------------------
# Modelo do formulário e integração com o Gerenciador
# ---------------------------------------------------------------------------
def _analistas(dos_a3=None):
    """Analistas responsáveis: os do Gerenciador + quem já é responsável de algum A3."""
    if dos_a3 is None:
        conn = conectar()
        dos_a3 = {l[0] for l in conn.execute("SELECT DISTINCT responsavel FROM a3_analises WHERE TRIM(COALESCE(responsavel, '')) != ''")}
        conn.close()
    return sorted(set(analistas_gerenciador()) | set(dos_a3), key=str.casefold)


@bp.route("/api/modelo")
def api_modelo():
    conn = conectar()
    pessoas_ativas = [dict(l) for l in conn.execute(
        "SELECT nome, setor FROM a3_pessoas WHERE ativo = 1 ORDER BY nome"
    )]
    setores_usados = {l["setor"] for l in conn.execute(
        "SELECT setor FROM a3_pessoas WHERE setor IS NOT NULL AND TRIM(setor) != '' "
        "UNION SELECT setor FROM a3_acoes WHERE setor IS NOT NULL AND TRIM(setor) != ''"
    )}
    conn.close()
    modelo = modelo_para_frontend()
    modelo["pessoas"] = pessoas_ativas
    modelo["analistas"] = _analistas()
    modelo["setores"] = sorted(set(SETORES_PADRAO) | setores_usados, key=str.casefold)
    modelo["tipos_reclamacao"], modelo["tipos_padrao"] = _opcoes_tipos(), TIPOS_PADRAO_VISAO
    return jsonify(modelo)


def _opcoes_tipos(tipos_dos_a3=None):
    """Botões "Tipo de reclamação": padrão primeiro, depois os demais tipos do Gerenciador e,
    por último, "Sem reclamação" (só se existir A3 sem vínculo)."""
    mapa = tipos_reclamacao()
    if tipos_dos_a3 is None:
        conn = conectar()
        ids = [l[0] for l in conn.execute("SELECT id_mrhb FROM a3_analises")]
        conn.close()
        tipos_dos_a3 = {normalizar_tipo(mapa.get(i)) or SEM_RECLAMACAO for i in ids}
    existentes = {normalizar_tipo(t) for t in mapa.values() if t} | set(tipos_dos_a3)
    return (TIPOS_PADRAO_VISAO + sorted(existentes - set(TIPOS_PADRAO_VISAO) - {SEM_RECLAMACAO}, key=str.casefold)
            + ([SEM_RECLAMACAO] if SEM_RECLAMACAO in existentes else []))


@bp.route("/api/reclamacoes")
def api_pesquisar_reclamacoes():
    return jsonify(pesquisar_reclamacoes(request.args.get("q", "")))


@bp.route("/api/reclamacoes/<path:id_mrhb>")
def api_buscar_reclamacao(id_mrhb):
    reclamacao = buscar_reclamacao(id_mrhb.strip())
    if not reclamacao:
        return jsonify({"encontrado": False}), 404
    conn = conectar()
    existente = conn.execute("SELECT id FROM a3_analises WHERE id_mrhb = ?", (id_mrhb.strip(),)).fetchone()
    conn.close()
    return jsonify({"encontrado": True, "analise_id": existente["id"] if existente else None, **reclamacao})


# ---------------------------------------------------------------------------
# Análises A3
# ---------------------------------------------------------------------------
@bp.route("/api/analises")
def api_listar_analises():
    conn = conectar()
    linhas = [dict(l) for l in conn.execute(
        "SELECT id, id_mrhb, numero_notificacao, tema, responsavel, area, cliente, pn_mrhb, definicao_problema, "
        "data_emissao, prazo_limite, status, resultado_validacao, data_fechamento, atualizado_em, dados FROM a3_analises "
        "ORDER BY data_emissao DESC, id DESC"
    )]
    acoes = _listar_acoes(conn)
    conn.close()
    tipos = tipos_reclamacao()
    acoes_por_analise = {}
    for a in acoes:
        acoes_por_analise.setdefault(a["analise_id"], []).append(a)
    for linha in linhas:
        dados = mesclar_com_padrao(json.loads(linha.pop("dados") or "{}"))
        linha["etapa_atual"] = calcular_etapas(linha, dados, acoes_por_analise.get(linha["id"], []))["atual"]
        linha["tipo_reclamacao"] = tipos.get(linha["id_mrhb"])
        linha["tipo"] = normalizar_tipo(linha["tipo_reclamacao"]) or SEM_RECLAMACAO
        linha["area_setor"] = normalizar_setor(linha.get("area"))  # "US" -> "Usinagem" etc. (filtro por área)

    resumo = {}
    for a in acoes:
        r = resumo.setdefault(a["analise_id"], {"total": 0, "concluidas": 0, "abertas": 0, "atrasadas": 0})
        if a["situacao"] == "cancelada":
            continue
        r["total"] += 1
        r["concluidas"] += a["situacao"] == "concluida"
        r["abertas"] += a["situacao"] in ("no_prazo", "atrasada")
        r["atrasadas"] += a["situacao"] == "atrasada"
    for linha in linhas:
        linha["acoes"] = resumo.get(linha["id"], {"total": 0, "concluidas": 0, "abertas": 0, "atrasadas": 0})
    return jsonify(linhas)


@bp.route("/api/analises", methods=["POST"])
def api_criar_analise():
    entrada = request.get_json(force=True) or {}
    id_mrhb = _texto(entrada.get("id_mrhb")).upper()
    if not id_mrhb:
        return _erro("Informe o ID Wetzel da reclamação.")

    conn = conectar()
    try:
        if conn.execute("SELECT 1 FROM a3_analises WHERE id_mrhb = ?", (id_mrhb,)).fetchone():
            return _erro(f"Já existe uma análise A3 para o ID {id_mrhb}.", 409)

        reclamacao = buscar_reclamacao(id_mrhb)
        if not reclamacao:  # A3 sempre vinculado a uma reclamação do Gerenciador
            return _erro(f"ID Wetzel {id_mrhb} não encontrado no Gerenciador. Todo A3 precisa estar vinculado a uma reclamação: cadastre a reclamação no Gerenciador primeiro (ou confira o ID).")
        analise_id = criar_analise(
            conn, id_mrhb, reclamacao,
            tema=entrada.get("tema"),
            responsavel=_texto(entrada.get("responsavel")) or reclamacao.get("responsavel_cliente"),
            data_emissao=entrada.get("data_emissao"),
        )
        conn.commit()
    finally:
        conn.close()
    sincronizar_etapas_gerenciador(analise_id)
    return jsonify({"ok": True, "id": analise_id, "vinculado_gerenciador": True}), 201


@bp.route("/api/analises/<int:analise_id>")
def api_obter_analise(analise_id):
    conn = conectar()
    linha = conn.execute("SELECT * FROM a3_analises WHERE id = ?", (analise_id,)).fetchone()
    if not linha:
        conn.close()
        return _erro("Análise não encontrada.", 404)
    analise = dict(linha)
    analise["dados"] = mesclar_com_padrao(json.loads(analise["dados"] or "{}"))
    analise["acoes"] = _listar_acoes(conn, analise_id)
    analise["etapas_8d"] = calcular_etapas(analise, analise["dados"], analise["acoes"])
    analise["anexos"] = [dict(l) for l in conn.execute(
        "SELECT id, secao, nome_original, legenda, criado_em FROM a3_anexos WHERE analise_id = ? ORDER BY id",
        (analise_id,),
    )]
    conn.close()
    analise["reclamacao"] = buscar_reclamacao(analise["id_mrhb"])
    return jsonify(analise)


@bp.route("/api/analises/<int:analise_id>", methods=["PUT"])
def api_salvar_analise(analise_id):
    entrada = request.get_json(force=True) or {}
    conn = conectar()
    try:
        atual = conn.execute("SELECT * FROM a3_analises WHERE id = ?", (analise_id,)).fetchone()
        if not atual:
            return _erro("Análise não encontrada.", 404)

        novos = {campo: _texto(entrada.get(campo, atual[campo])) or None for campo in CAMPOS_CABECALHO}
        if not novos["data_emissao"]:
            return _erro("A data de emissão é obrigatória.")
        if novos["status"] not in STATUS_A3:
            return _erro("Status do A3 inválido.")
        # "Concluído" não é escolhido à mão: a regra automática decide (abaixo).
        if novos["status"] == "Concluído" and atual["status"] != "Concluído":
            novos["status"] = atual["status"]
        if novos["status"] != "Concluído":
            novos["data_fechamento"] = None

        aviso = None
        if novos["resultado_validacao"] == "8D Aprovado" and atual["resultado_validacao"] != "8D Aprovado":
            dados_previa = atualizar_datas_de_campos(mesclar_com_padrao(entrada.get("dados") or json.loads(atual["dados"] or "{}")))
            acoes_previa = [dict(l) for l in conn.execute(
                "SELECT grupo, subgrupo, status, data_conclusao FROM a3_acoes WHERE analise_id = ?", (analise_id,))]
            pendentes = etapas_pendentes(calcular_etapas({**dict(atual), **novos}, dados_previa, acoes_previa))
            if pendentes:
                novos["resultado_validacao"] = atual["resultado_validacao"]
                aviso = "Não é possível marcar 8D Aprovado: conclua antes as etapas " + ", ".join(pendentes) + "."

        for campo, rotulo in CAMPOS_CABECALHO.items():
            if (atual[campo] or None) != novos[campo]:
                _registrar_edicao_a3(conn, analise_id, atual["id_mrhb"], rotulo, atual[campo], novos[campo])

        dados_antigos = mesclar_com_padrao(json.loads(atual["dados"] or "{}"))
        dados_novos = atualizar_datas_de_campos(mesclar_com_padrao(entrada.get("dados") or dados_antigos))
        secoes_alteradas = [s for s in dados_novos if dados_novos.get(s) != dados_antigos.get(s)]
        if secoes_alteradas:
            _registrar_edicao_a3(conn, analise_id, atual["id_mrhb"], "Formulário", None, secoes_alteradas)

        conn.execute(
            f"""UPDATE a3_analises SET {', '.join(f'{c} = ?' for c in CAMPOS_CABECALHO)},
                    dados = ?, atualizado_em = datetime('now', 'localtime')
                WHERE id = ?""",
            [*novos.values(), json.dumps(dados_novos, ensure_ascii=False), analise_id],
        )
        for membro in dados_novos.get("equipe", []):
            _garantir_pessoa(conn, _texto(membro.get("nome")), _texto(membro.get("setor")))
        status, mudou = status_automatico_a3(conn, analise_id)
        conn.commit()
    finally:
        conn.close()
    sincronizar_etapas_gerenciador(analise_id)
    return jsonify({"ok": True, "status": status, "status_mudou": mudou, "aviso": aviso})


@bp.route("/api/analises/<int:analise_id>/status")
def api_status_analise(analise_id):
    conn = conectar()
    linha = conn.execute("SELECT status, data_fechamento FROM a3_analises WHERE id = ?", (analise_id,)).fetchone()
    _id, etapas = etapas_da_analise(conn, analise_id)
    conn.close()
    if not linha:
        return _erro("Análise não encontrada.", 404)
    return jsonify({**dict(linha), "etapas_8d": etapas})


@bp.route("/api/analises/<int:analise_id>", methods=["DELETE"])
def api_excluir_analise(analise_id):
    motivo = _texto((request.get_json(silent=True) or {}).get("motivo"))
    if not motivo:
        return _erro("Informe o motivo da exclusão.")
    conn = conectar()
    try:
        atual = conn.execute("SELECT id_mrhb FROM a3_analises WHERE id = ?", (analise_id,)).fetchone()
        if not atual:
            return _erro("Análise não encontrada.", 404)
        arquivos = [l["arquivo"] for l in conn.execute("SELECT arquivo FROM a3_anexos WHERE analise_id = ?", (analise_id,))]
        _registrar(conn, "Exclusão do A3", analise_id=analise_id, id_mrhb=atual["id_mrhb"], motivo=motivo)
        conn.execute("DELETE FROM a3_analises WHERE id = ?", (analise_id,))
        conn.commit()
    finally:
        conn.close()
    pasta = Path(current_app.config["ACOES8D_UPLOADS"])
    for arquivo in arquivos:
        (pasta / arquivo).unlink(missing_ok=True)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Ações
# ---------------------------------------------------------------------------
def _validar_acao(entrada):
    valores = {campo: _texto(entrada.get(campo)) or None for campo in CAMPOS_ACAO}
    faltando = [r for c, r in (("descricao", "Descrição"), ("responsavel", "Responsável"), ("prazo", "Prazo")) if not valores[c]]
    if faltando:
        return None, f"Preencha: {', '.join(faltando)}."
    if valores["grupo"] not in GRUPOS_POR_CHAVE:
        return None, "Tipo de ação inválido."
    valores["status"] = valores["status"] or "Aberta"
    valores["setor"] = normalizar_setor(valores["setor"]) or None
    if valores["status"] not in STATUS_ACAO:
        return None, "Status inválido."
    valores["data_abertura"] = valores["data_abertura"] or date.today().isoformat()
    if valores["status"] == "Concluída" and valores["grupo"] == "contencao" and valores["subgrupo"] == "3.1 Nacional":
        faltando = campos_faltando_contencao(valores["descricao"])
        if faltando:
            return None, f"Para concluir (G) esta ação, preencha antes: {', '.join(faltando)}."
    if valores["status"] == "Concluída":
        valores["data_conclusao"] = valores["data_conclusao"] or date.today().isoformat()
    else:
        valores["data_conclusao"] = None
    return valores, None


@bp.route("/api/acoes")
def api_listar_acoes():
    conn = conectar()
    acoes = _listar_acoes(conn, request.args.get("analise_id", type=int))
    conn.close()
    tipos = tipos_reclamacao()
    for a in acoes:
        a["tipo_reclamacao"] = normalizar_tipo(tipos.get(a["id_mrhb"])) or SEM_RECLAMACAO
    # Sem "definição do problema" no A3: usa a descrição do defeito da reclamação.
    if any(not (a.get("problema") or "").strip() for a in acoes):
        defeitos = defeitos_reclamacao()
        for a in acoes:
            if not (a.get("problema") or "").strip():
                a["problema"] = defeitos.get(a["id_mrhb"]) or ""
    return jsonify(acoes)


@bp.route("/api/acoes", methods=["POST"])
def api_criar_acao():
    entrada = request.get_json(force=True) or {}
    valores, erro = _validar_acao(entrada)
    if erro:
        return _erro(erro)
    analise_id = entrada.get("analise_id")
    conn = conectar()
    try:
        _setor_do_responsavel(conn, valores)
        analise = conn.execute("SELECT id_mrhb FROM a3_analises WHERE id = ?", (analise_id,)).fetchone()
        if not analise:
            return _erro("Selecione a análise A3 (ID Wetzel) da ação.")
        cursor = conn.execute(
            f"""INSERT INTO a3_acoes (analise_id, prazo_original, {', '.join(CAMPOS_ACAO)})
                VALUES (?, ?, {', '.join('?' for _ in CAMPOS_ACAO)})""",
            [analise_id, valores["prazo"], *valores.values()],
        )
        _registrar(conn, "Nova ação", analise_id=analise_id, acao_id=cursor.lastrowid, id_mrhb=analise["id_mrhb"],
                   valor_novo=f'{valores["descricao"]} → {valores["responsavel"]} até {valores["prazo"]}')
        _garantir_pessoa(conn, valores["responsavel"], valores["setor"])
        status, mudou = status_automatico_a3(conn, analise_id)
        conn.commit()
    finally:
        conn.close()
    sincronizar_etapas_gerenciador(analise_id)
    return jsonify({"ok": True, "id": cursor.lastrowid, "status_a3": status, "status_mudou": mudou}), 201


@bp.route("/api/acoes/<int:acao_id>", methods=["PUT"])
def api_editar_acao(acao_id):
    entrada = request.get_json(force=True) or {}
    valores, erro = _validar_acao(entrada)
    if erro:
        return _erro(erro)
    motivo = _texto(entrada.get("motivo"))
    conn = conectar()
    try:
        atual = conn.execute(
            "SELECT ac.*, an.id_mrhb FROM a3_acoes ac JOIN a3_analises an ON an.id = ac.analise_id WHERE ac.id = ?",
            (acao_id,),
        ).fetchone()
        if not atual:
            return _erro("Ação não encontrada.", 404)
        _setor_do_responsavel(conn, valores)
        if atual["prazo"] != valores["prazo"] and not motivo:
            return _erro("O prazo foi alterado: informe o motivo da reprogramação.")

        for campo, rotulo in CAMPOS_ACAO.items():
            if (atual[campo] or None) != valores[campo]:
                tipo = "Reprogramação de prazo" if campo == "prazo" else "Edição de ação"
                _registrar(conn, tipo, analise_id=atual["analise_id"], acao_id=acao_id, id_mrhb=atual["id_mrhb"],
                           campo=rotulo, valor_anterior=atual[campo], valor_novo=valores[campo],
                           motivo=motivo if campo == "prazo" else None)
        conn.execute(
            f"""UPDATE a3_acoes SET {', '.join(f'{c} = ?' for c in CAMPOS_ACAO)},
                    atualizado_em = datetime('now', 'localtime')
                WHERE id = ?""",
            [*valores.values(), acao_id],
        )
        _garantir_pessoa(conn, valores["responsavel"], valores["setor"])
        status, mudou = status_automatico_a3(conn, atual["analise_id"])
        conn.commit()
    finally:
        conn.close()
    sincronizar_etapas_gerenciador(atual["analise_id"])
    return jsonify({"ok": True, "status_a3": status, "status_mudou": mudou})


@bp.route("/api/acoes/<int:acao_id>", methods=["DELETE"])
def api_excluir_acao(acao_id):
    motivo = _texto((request.get_json(silent=True) or {}).get("motivo"))
    if not motivo:
        return _erro("Informe o motivo da exclusão.")
    conn = conectar()
    try:
        atual = conn.execute(
            "SELECT ac.*, an.id_mrhb FROM a3_acoes ac JOIN a3_analises an ON an.id = ac.analise_id WHERE ac.id = ?",
            (acao_id,),
        ).fetchone()
        if not atual:
            return _erro("Ação não encontrada.", 404)
        _registrar(conn, "Exclusão de ação", analise_id=atual["analise_id"], acao_id=acao_id, id_mrhb=atual["id_mrhb"],
                   valor_anterior=f'{atual["descricao"]} ({atual["responsavel"]})', motivo=motivo)
        conn.execute("DELETE FROM a3_acoes WHERE id = ?", (acao_id,))
        status_automatico_a3(conn, atual["analise_id"])
        conn.commit()
    finally:
        conn.close()
    sincronizar_etapas_gerenciador(atual["analise_id"])
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
# Filtro "Status" da Visão Geral e da Gestão de Ações: chave -> (rótulo, teste).
FILTROS_STATUS = {
    "aberta": ("Aberta", lambda a: a["status"] == "Aberta"),
    "em_andamento": ("Em andamento", lambda a: a["status"] == "Em andamento"),
    "atrasada": ("Atrasada", lambda a: a["situacao"] == "atrasada"),
    "concluida": ("Concluída", lambda a: a["status"] == "Concluída"),
}


@bp.route("/api/dashboard")
def api_dashboard():
    conn = conectar()
    acoes = _listar_acoes(conn)
    analises = [dict(l) for l in conn.execute(
        "SELECT id, id_mrhb, cliente, status, prazo_limite, responsavel, pn_mrhb, data_emissao, area, definicao_problema, data_fechamento FROM a3_analises")]
    conn.close()

    args = {c: _texto(request.args.get(c)) for c in
            ("analista", "cliente", "peca", "de", "ate", "id_mrhb", "responsavel", "setor", "grupo", "status")}
    # Tipo de reclamação de cada A3 (botões "Tipo de reclamação"; sem o parâmetro = tipos padrão).
    mapa_tipos = tipos_reclamacao()
    for x in analises:
        x["tipo"] = normalizar_tipo(mapa_tipos.get(x["id_mrhb"])) or SEM_RECLAMACAO
    bruto = request.args.get("tipos")
    tipos_sel = {t for t in bruto.split(",") if t.strip()} if bruto is not None else set(TIPOS_PADRAO_VISAO)
    opcoes = {
        "tipos": _opcoes_tipos({x["tipo"] for x in analises}),
        "tipos_padrao": TIPOS_PADRAO_VISAO,
        "tipos_selecionados": sorted(tipos_sel, key=str.casefold),
        "analistas": _analistas({x["responsavel"] for x in analises if x["responsavel"]}),
        "pecas": sorted({x["pn_mrhb"] for x in analises if x["pn_mrhb"]}, key=str.casefold),
        "responsaveis": sorted({a["responsavel"] for a in acoes if a["responsavel"]}, key=str.casefold),
        "setores": sorted({a["setor"] for a in acoes if a["setor"]}, key=str.casefold),
        "clientes": sorted({x["cliente"] for x in analises if x["cliente"]}, key=str.casefold),
        "ids_mrhb": sorted({x["id_mrhb"] for x in analises}),
        "status": [[k, r] for k, (r, _f) in FILTROS_STATUS.items()],
    }
    # Filtros combinados (E). Primeiro os filtros do A3 (analista, cliente, peça,
    # período pela data de emissão do A3, ID); as ações acompanham os A3 que sobraram.
    termo_id = args["id_mrhb"].upper()
    analises = [
        x for x in analises
        if (not args["analista"] or (x["responsavel"] or "") == args["analista"])
        and (not args["cliente"] or (x["cliente"] or "") == args["cliente"])
        and (not args["peca"] or (x["pn_mrhb"] or "") == args["peca"])
        and (not args["de"] or (x["data_emissao"] or "")[:10] >= args["de"])
        and (not args["ate"] or (x["data_emissao"] or "")[:10] <= args["ate"])
        and (not termo_id or termo_id in x["id_mrhb"].upper())  # pesquisa por parte do ID (ex.: "7023")
        and x["tipo"] in tipos_sel
    ]
    ids_a3 = {x["id"] for x in analises}
    acoes = [a for a in acoes if a["analise_id"] in ids_a3]
    for campo in ("responsavel", "setor", "grupo"):
        if args[campo]:
            acoes = [a for a in acoes if (a.get(campo) or "") == args[campo]]
    if args["status"] in FILTROS_STATUS:
        acoes = [a for a in acoes if FILTROS_STATUS[args["status"]][1](a)]
    if any(args[c] for c in ("responsavel", "setor", "grupo", "status")):
        # cartões de A3 acompanham: só os A3 que têm ações no recorte
        ids = {a["analise_id"] for a in acoes}
        analises = [x for x in analises if x["id"] in ids]

    resultado = computar_dashboard(acoes, analises)
    resultado["a3_status_atual"] = _a3_status_atual(analises)
    resultado["velocimetro"] = _velocimetro(analises, args, tipos_sel)
    return jsonify({**resultado, "opcoes": opcoes})


def _velocimetro(analises, args, tipos_sel):
    """Média de dias corridos para fechar um A3 (emissão -> conclusão).

    Junta os A3 concluídos no módulo com o histórico de 8D fechados do
    Gerenciador (reclamações que não têm A3 no módulo, para não contar duas
    vezes). Usa os tipos de reclamação escolhidos nos botões e os filtros da
    Visão Geral (analista, cliente, peça e período); "analises" já vem filtrada."""
    hoje = date.today()
    dias = []
    abertos_acima = 0
    for x in analises:
        emissao = para_data(x["data_emissao"])
        if x["status"] == "Concluído":
            fechamento = para_data(x.get("data_fechamento"))
            if emissao and fechamento and fechamento >= emissao:
                dias.append((fechamento - emissao).days)
        elif x["status"] == "Em andamento" and emissao and (hoje - emissao).days > META_DIAS_FECHAR_A3:
            abertos_acima += 1

    historico = 0
    conn_ger = conectar_gerenciador()
    if conn_ger is not None:
        conn = conectar()
        com_a3 = {l[0] for l in conn.execute("SELECT id_mrhb FROM a3_analises")}
        conn.close()
        sql = """SELECT r.id_mrhb, julianday(e.realizacao) - julianday(r.data_abertura) AS dias, r.tipo_reclamacao
                 FROM reclamacoes r JOIN etapas_8d e ON e.reclamacao_id = r.id
                 WHERE e.etapa = '8D Fechado' AND e.realizacao IS NOT NULL"""
        params = []
        for campo, coluna in (("analista", "r.responsavel_cliente"), ("cliente", "r.cliente"), ("peca", "r.pn_mrhb")):
            if args.get(campo):
                sql += f" AND {coluna} = ?"
                params.append(args[campo])
        if args.get("de"):
            sql += " AND r.data_abertura >= ?"
            params.append(args["de"])
        if args.get("ate"):
            sql += " AND r.data_abertura <= ?"
            params.append(args["ate"])
        try:
            for id_mrhb, d, tipo in conn_ger.execute(sql, params):
                if id_mrhb in com_a3 or d is None or d < 0:  # já contado pelo A3 / data inconsistente
                    continue
                if normalizar_tipo(tipo) not in tipos_sel:
                    continue
                dias.append(round(d))
                historico += 1
        except Exception:  # Gerenciador sem a tabela etapas_8d: só os A3 do módulo
            pass
        finally:
            conn_ger.close()

    return {
        "media": round(sum(dias) / len(dias), 1) if dias else None,
        "quantidade": len(dias),
        "do_gerenciador": historico,
        "no_prazo": sum(1 for d in dias if d <= META_DIAS_FECHAR_A3),
        "maior": max(dias) if dias else None,
        "meta": META_DIAS_FECHAR_A3,
        "faixas": [[limite, cor] for limite, cor in FAIXAS_VELOCIMETRO],
        "abertos_acima_meta": abertos_acima,
    }


def _a3_status_atual(analises):
    """A3 não concluídos (nem cancelados) com a etapa do 8D em que estão agora."""
    abertos = [x for x in analises if x["status"] == "Em andamento"]
    if not abertos:
        return []
    defeitos = defeitos_reclamacao() if any(not (x["definicao_problema"] or "").strip() for x in abertos) else {}
    lista = []
    conn = conectar()
    try:
        for x in abertos:
            _id, resultado = etapas_da_analise(conn, x["id"])
            atual = (resultado or {}).get("atual") or {}
            lista.append({
                "id": x["id"],
                "id_mrhb": x["id_mrhb"],
                "pn_mrhb": x["pn_mrhb"] or "",
                "area": normalizar_setor(x.get("area")) or "",
                "descricao": (x["definicao_problema"] or "").strip() or defeitos.get(x["id_mrhb"]) or "",
                "etapa": atual.get("etapa") or "—",
                "etapa_prazo": atual.get("prazo"),
                "etapa_atrasada": bool(atual.get("atrasada")),
            })
    finally:
        conn.close()
    lista.sort(key=lambda a: (not a["etapa_atrasada"], a["etapa_prazo"] or "9999", a["id_mrhb"]))
    return lista


# ---------------------------------------------------------------------------
# Pessoas
# ---------------------------------------------------------------------------
@bp.route("/api/analises/importar-excel", methods=["POST"])
def api_importar_excel():
    """Importa um ou mais A3 em Excel (FM-QS-025) enviados pelo botão do Formulário A3."""
    import os
    import tempfile
    import warnings

    from .importacao_excel import gravar, ler_a3

    arquivos = request.files.getlist("arquivos")
    if not arquivos:
        return _erro("Selecione ao menos um arquivo Excel (.xlsx) do A3.")
    resultados = []
    criados = []
    for arquivo in arquivos:
        nome = arquivo.filename or "arquivo"
        if not nome.lower().endswith(".xlsx"):
            resultados.append({"arquivo": nome, "situacao": "erro", "mensagem": "Não é um arquivo .xlsx."})
            continue
        temporario = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
        try:
            arquivo.save(temporario)
            temporario.close()
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")  # avisos do openpyxl sobre imagens/validações do Excel
                analise, dados, acoes = ler_a3(temporario.name)
            if not buscar_reclamacao(analise["id_mrhb"]):
                resultados.append({"arquivo": nome, "situacao": "erro", "id_mrhb": analise["id_mrhb"],
                                   "mensagem": f"ID Wetzel {analise['id_mrhb']} não encontrado no Gerenciador. Todo A3 precisa estar vinculado a uma reclamação: cadastre a reclamação no Gerenciador primeiro (ou confira o ID)."})
                continue
            conn = conectar()
            try:
                analise_id = gravar(conn, analise, dados, acoes)
                if analise_id is None:
                    resultados.append({"arquivo": nome, "situacao": "ignorado", "id_mrhb": analise["id_mrhb"],
                                       "mensagem": "Já existe um A3 com este ID no sistema (nada foi alterado)."})
                else:
                    conn.commit()
                    criados.append(analise_id)
                    resultados.append({"arquivo": nome, "situacao": "importado", "id_mrhb": analise["id_mrhb"],
                                       "analise_id": analise_id, "mensagem": f"{len(acoes)} ações importadas."})
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()
        except Exception as erro:  # um arquivo com problema não impede os outros
            resultados.append({"arquivo": nome, "situacao": "erro", "mensagem": str(erro)})
        finally:
            try:
                temporario.close()
                os.unlink(temporario.name)
            except OSError:
                pass
    for analise_id in criados:
        sincronizar_etapas_gerenciador(analise_id)
    return jsonify({"resultados": resultados})


@bp.route("/api/pessoas")
def api_listar_pessoas():
    conn = conectar()
    linhas = [dict(l) for l in conn.execute(
        """SELECT p.*,
                  (SELECT COUNT(*) FROM a3_acoes a WHERE a.responsavel = p.nome
                     AND a.status IN ('Aberta', 'Em andamento')) AS acoes_abertas
           FROM a3_pessoas p ORDER BY p.nome"""
    )]
    conn.close()
    return jsonify(linhas)


@bp.route("/api/pessoas", methods=["POST"])
def api_criar_pessoa():
    entrada = request.get_json(force=True) or {}
    nome = _texto(entrada.get("nome"))
    if not nome:
        return _erro("Informe o nome.")
    conn = conectar()
    try:
        if conn.execute("SELECT 1 FROM a3_pessoas WHERE nome = ?", (nome,)).fetchone():
            return _erro("Essa pessoa já está cadastrada.", 409)
        conn.execute(
            "INSERT INTO a3_pessoas (nome, setor, email) VALUES (?, ?, ?)",
            (nome, normalizar_setor(entrada.get("setor")) or None, _texto(entrada.get("email")) or None),
        )
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True}), 201


@bp.route("/api/pessoas/<int:pessoa_id>", methods=["PUT"])
def api_editar_pessoa(pessoa_id):
    entrada = request.get_json(force=True) or {}
    nome = _texto(entrada.get("nome"))
    if not nome:
        return _erro("Informe o nome.")
    conn = conectar()
    try:
        atual = conn.execute("SELECT * FROM a3_pessoas WHERE id = ?", (pessoa_id,)).fetchone()
        if not atual:
            return _erro("Pessoa não encontrada.", 404)
        if nome.casefold() != atual["nome"].casefold() and conn.execute(
            "SELECT 1 FROM a3_pessoas WHERE nome = ?", (nome,)
        ).fetchone():
            return _erro("Já existe outra pessoa com esse nome.", 409)
        conn.execute(
            "UPDATE a3_pessoas SET nome = ?, setor = ?, email = ?, ativo = ? WHERE id = ?",
            (nome, normalizar_setor(entrada.get("setor")) or None, _texto(entrada.get("email")) or None,
             1 if entrada.get("ativo", True) else 0, pessoa_id),
        )
        # Correção de nome (ex.: erro de digitação) vale também para as ações já atribuídas.
        if nome != atual["nome"]:
            conn.execute("UPDATE a3_acoes SET responsavel = ? WHERE responsavel = ?", (nome, atual["nome"]))
        # Ações da pessoa que estavam sem setor passam a ter o setor do Cadastro.
        conn.execute("""UPDATE a3_acoes SET setor = (
            SELECT p.setor FROM a3_pessoas p WHERE p.nome = a3_acoes.responsavel AND TRIM(COALESCE(p.setor, '')) != '')
        WHERE TRIM(COALESCE(setor, '')) = ''
          AND EXISTS (SELECT 1 FROM a3_pessoas p WHERE p.nome = a3_acoes.responsavel AND TRIM(COALESCE(p.setor, '')) != '')""")
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True})


@bp.route("/api/pessoas/<int:pessoa_id>", methods=["DELETE"])
def api_excluir_pessoa(pessoa_id):
    conn = conectar()
    conn.execute("DELETE FROM a3_pessoas WHERE id = ?", (pessoa_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Anexos (evidências, fotos, relatórios)
# ---------------------------------------------------------------------------
@bp.route("/api/analises/<int:analise_id>/anexos", methods=["POST"])
def api_enviar_anexo(analise_id):
    arquivo = request.files.get("arquivo")
    if not arquivo or not arquivo.filename:
        return _erro("Selecione um arquivo.")
    extensao = Path(arquivo.filename).suffix.lower()
    if extensao not in EXTENSOES_ANEXO:
        return _erro(f"Tipo de arquivo não permitido ({extensao}).")
    secao = request.form.get("secao", "evidencias")
    if secao not in ANEXO_SECOES:
        secao = "outros"

    conn = conectar()
    try:
        analise = conn.execute("SELECT id_mrhb FROM a3_analises WHERE id = ?", (analise_id,)).fetchone()
        if not analise:
            return _erro("Análise não encontrada.", 404)
        pasta = Path(current_app.config["ACOES8D_UPLOADS"])
        pasta.mkdir(parents=True, exist_ok=True)
        nome_salvo = f"{uuid.uuid4().hex}{extensao}"
        arquivo.save(pasta / nome_salvo)
        cursor = conn.execute(
            "INSERT INTO a3_anexos (analise_id, secao, nome_original, arquivo, legenda) VALUES (?, ?, ?, ?, ?)",
            (analise_id, secao, Path(arquivo.filename).name, nome_salvo, _texto(request.form.get("legenda")) or None),
        )
        _registrar(conn, "Anexo incluído", analise_id=analise_id, id_mrhb=analise["id_mrhb"],
                   campo=ANEXO_SECOES[secao], valor_novo=Path(arquivo.filename).name)
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True, "id": cursor.lastrowid}), 201


# Evidência em PDF: guarda o PDF original e converte cada página em imagem
# (para entrar no editor de evidência e sair legível na impressão).
MAX_PAGINAS_PDF = 30
LADO_MAXIMO_PAGINA = 1600  # px, igual ao limite das imagens do editor


@bp.route("/api/analises/<int:analise_id>/evidencia-pdf", methods=["POST"])
def api_evidencia_pdf(analise_id):
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return _erro("Conversão de PDF indisponível neste servidor (instale: pip install pymupdf).", 501)
    arquivo = request.files.get("arquivo")
    if not arquivo or Path(arquivo.filename or "").suffix.lower() != ".pdf":
        return _erro("Envie um arquivo .pdf.")
    conteudo = arquivo.read()
    try:
        documento = fitz.open(stream=conteudo, filetype="pdf")
    except Exception:  # noqa: BLE001
        return _erro("Não foi possível ler este PDF (arquivo corrompido ou protegido por senha).")
    if documento.needs_pass:
        return _erro("Este PDF é protegido por senha.")
    if documento.page_count > MAX_PAGINAS_PDF:
        return _erro(f"O PDF tem {documento.page_count} páginas; o limite é {MAX_PAGINAS_PDF}.")

    conn = conectar()
    try:
        analise = conn.execute("SELECT id_mrhb FROM a3_analises WHERE id = ?", (analise_id,)).fetchone()
        if not analise:
            return _erro("Análise não encontrada.", 404)
        pasta = Path(current_app.config["ACOES8D_UPLOADS"])
        pasta.mkdir(parents=True, exist_ok=True)
        nome_original = Path(arquivo.filename).name
        nome_base = Path(nome_original).stem

        def gravar(secao, nome, extensao, dados_arquivo):
            nome_salvo = f"{uuid.uuid4().hex}{extensao}"
            (pasta / nome_salvo).write_bytes(dados_arquivo)
            cur = conn.execute(
                "INSERT INTO a3_anexos (analise_id, secao, nome_original, arquivo) VALUES (?, ?, ?, ?)",
                (analise_id, secao, nome, nome_salvo),
            )
            return cur.lastrowid

        pdf_id = gravar("evidencia_pdf", nome_original, ".pdf", conteudo)
        paginas = []
        for numero, pagina in enumerate(documento, start=1):
            maior_lado = max(pagina.rect.width, pagina.rect.height) or 1
            escala = LADO_MAXIMO_PAGINA / maior_lado
            imagem = pagina.get_pixmap(matrix=fitz.Matrix(escala, escala), alpha=False)
            pid = gravar("evidencia_fonte", f"{nome_base}-p{numero}.jpg", ".jpg", imagem.tobytes("jpeg", jpg_quality=85))
            paginas.append({"id": pid, "largura": imagem.width, "altura": imagem.height})
        _registrar(conn, "Anexo incluído", analise_id=analise_id, id_mrhb=analise["id_mrhb"],
                   campo=ANEXO_SECOES["evidencia_pdf"], valor_novo=f"{nome_original} ({len(paginas)} página(s))")
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True, "pdf": {"id": pdf_id, "nome": nome_original}, "paginas": paginas}), 201


@bp.route("/anexos/<int:anexo_id>")
def baixar_anexo(anexo_id):
    conn = conectar()
    anexo = conn.execute("SELECT * FROM a3_anexos WHERE id = ?", (anexo_id,)).fetchone()
    conn.close()
    if not anexo:
        abort(404)
    return send_from_directory(
        current_app.config["ACOES8D_UPLOADS"], anexo["arquivo"], download_name=anexo["nome_original"]
    )


@bp.route("/api/anexos/<int:anexo_id>", methods=["DELETE"])
def api_excluir_anexo(anexo_id):
    conn = conectar()
    try:
        anexo = conn.execute(
            "SELECT ax.*, an.id_mrhb FROM a3_anexos ax JOIN a3_analises an ON an.id = ax.analise_id WHERE ax.id = ?",
            (anexo_id,),
        ).fetchone()
        if not anexo:
            return _erro("Anexo não encontrado.", 404)
        _registrar(conn, "Anexo excluído", analise_id=anexo["analise_id"], id_mrhb=anexo["id_mrhb"],
                   valor_anterior=anexo["nome_original"])
        conn.execute("DELETE FROM a3_anexos WHERE id = ?", (anexo_id,))
        conn.commit()
    finally:
        conn.close()
    (Path(current_app.config["ACOES8D_UPLOADS"]) / anexo["arquivo"]).unlink(missing_ok=True)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Histórico
# ---------------------------------------------------------------------------
@bp.route("/api/historico")
def api_historico():
    conn = conectar()
    analise_id = request.args.get("analise_id", type=int)
    if analise_id:
        linhas = conn.execute(
            "SELECT * FROM a3_historico WHERE analise_id = ? ORDER BY id DESC", (analise_id,)
        ).fetchall()
    else:
        linhas = conn.execute("SELECT * FROM a3_historico ORDER BY id DESC LIMIT 500").fetchall()
    conn.close()
    return jsonify([dict(l) for l in linhas])
