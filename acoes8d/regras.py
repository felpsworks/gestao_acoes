"""Regras de negócio do Controle de Ações e do Dashboard.

Situação de uma ação (calculada, nunca gravada no banco):
  - concluida  -> status "Concluída"                     (farol G)
  - cancelada  -> status "Cancelada"                     (fora das métricas)
  - atrasada   -> aberta e prazo < hoje                  (farol R)
  - no_prazo   -> aberta e prazo >= hoje                 (farol Y)
O farol G/Y/R é o mesmo usado na coluna "Status" do FRP - A3 no Excel.
"""
from collections import Counter, defaultdict
from datetime import date, timedelta

from .modelo_a3 import GRUPOS_POR_CHAVE, SETORES_PADRAO, STATUS_ABERTOS, normalizar_setor

DIAS_ALERTA_VENCIMENTO = 7

# Faixas de prazo das ações abertas (da mais crítica para a mais folgada).
FAIXAS_PRAZO = [
    ("atrasada_30", "Atrasada > 30 dias"),
    ("atrasada_8_30", "Atrasada 8–30 dias"),
    ("atrasada_1_7", "Atrasada 1–7 dias"),
    ("vence_0_7", "Vence em 0–7 dias"),
    ("vence_8_30", "Vence em 8–30 dias"),
    ("vence_30", "Vence em > 30 dias"),
]

# Faixas de "dias em aberto" das ações abertas.
FAIXAS_DIAS_ABERTO = [
    ("0_7", "0–7 dias", 0, 7),
    ("8_15", "8–15 dias", 8, 15),
    ("16_30", "16–30 dias", 16, 30),
    ("31_60", "31–60 dias", 31, 60),
    ("61_90", "61–90 dias", 61, 90),
    ("90", "> 90 dias", 91, None),
]


def para_data(texto):
    if not texto:
        return None
    try:
        return date.fromisoformat(str(texto)[:10])
    except ValueError:
        return None


def somar_dias(texto_data, dias):
    d = para_data(texto_data)
    return (d + timedelta(days=dias)).isoformat() if d and dias is not None else None


def faixa_prazo(dias_para_vencer):
    if dias_para_vencer < -30:
        return "atrasada_30"
    if dias_para_vencer < -7:
        return "atrasada_8_30"
    if dias_para_vencer < 0:
        return "atrasada_1_7"
    if dias_para_vencer <= 7:
        return "vence_0_7"
    if dias_para_vencer <= 30:
        return "vence_8_30"
    return "vence_30"


def faixa_dias_aberto(dias):
    for chave, _rotulo, minimo, maximo in FAIXAS_DIAS_ABERTO:
        if dias >= minimo and (maximo is None or dias <= maximo):
            return chave
    return FAIXAS_DIAS_ABERTO[0][0]


def enriquecer_acao(acao, hoje=None):
    """Recebe uma linha de a3_acoes (dict) e acrescenta os campos calculados
    usados nas telas: situacao, farol, dias_em_aberto, dias_atraso, etc."""
    hoje = hoje or date.today()
    a = dict(acao)
    prazo = para_data(a.get("prazo"))
    abertura = para_data(a.get("data_abertura")) or hoje
    conclusao = para_data(a.get("data_conclusao"))
    aberta = a.get("status") in STATUS_ABERTOS

    if a.get("status") == "Concluída":
        a["situacao"], a["farol"] = "concluida", "G"
    elif a.get("status") == "Cancelada":
        a["situacao"], a["farol"] = "cancelada", "-"
    elif prazo and prazo < hoje:
        a["situacao"], a["farol"] = "atrasada", "R"
    else:
        a["situacao"], a["farol"] = "no_prazo", "Y"

    fim = conclusao if (not aberta and conclusao) else hoje
    a["dias_em_aberto"] = max((fim - abertura).days, 0)
    a["dias_para_vencer"] = (prazo - hoje).days if (prazo and aberta) else None
    a["dias_atraso"] = (hoje - prazo).days if a["situacao"] == "atrasada" else 0
    a["vence_em_breve"] = aberta and prazo is not None and 0 <= (prazo - hoje).days <= DIAS_ALERTA_VENCIMENTO
    a["reprogramada"] = bool(a.get("prazo_original")) and a.get("prazo_original") != a.get("prazo")
    a["concluida_no_prazo"] = (
        a["situacao"] == "concluida" and conclusao is not None and prazo is not None and conclusao <= prazo
    )
    grupo = GRUPOS_POR_CHAVE.get(a.get("grupo"))
    a["grupo_rotulo"] = grupo["rotulo"] if grupo else (a.get("grupo") or "")
    return a


def status_automatico_a3(conn, analise_id):
    """Concluído quando TODAS as ações (exceto canceladas) estão concluídas, todas
    as etapas do 8D anteriores ao fechamento estão realizadas (exceto as não
    aplicáveis) e a Validação pelo Emissor é "8D Aprovado"; senão, Em andamento.
    "Cancelado" (manual) não é alterado. Devolve (status, mudou). Sem commit."""
    analise = conn.execute(
        "SELECT id_mrhb, status, resultado_validacao, data_fechamento FROM a3_analises WHERE id = ?", (analise_id,)
    ).fetchone()
    if not analise or analise["status"] == "Cancelado":
        return (analise["status"] if analise else None), False
    situacoes = [l["status"] for l in conn.execute(
        "SELECT status FROM a3_acoes WHERE analise_id = ? AND status != 'Cancelada'", (analise_id,)
    )]
    from .etapas import etapas_da_analise, etapas_pendentes  # import local: etapas usa este módulo

    _id, resultado = etapas_da_analise(conn, analise_id)
    concluido = (
        analise["resultado_validacao"] == "8D Aprovado"
        and bool(situacoes)
        and all(s == "Concluída" for s in situacoes)
        and not etapas_pendentes(resultado)
    )
    novo = "Concluído" if concluido else "Em andamento"
    if novo == analise["status"]:
        return novo, False
    # Data de fechamento = conclusão da última ação (mesma regra da etapa "8D Fechado"); assim um
    # A3 importado do Excel ou fechado depois não "cai" no mês em que o sistema reconheceu o fechamento.
    ultima_acao = conn.execute(
        "SELECT MAX(data_conclusao) FROM a3_acoes WHERE analise_id = ? AND status = 'Concluída'", (analise_id,)
    ).fetchone()[0]
    data_fechamento = (analise["data_fechamento"] or ultima_acao or date.today().isoformat()) if concluido else None
    conn.execute(
        "UPDATE a3_analises SET status = ?, data_fechamento = ? WHERE id = ?", (novo, data_fechamento, analise_id)
    )
    conn.execute(
        """INSERT INTO a3_historico (analise_id, id_mrhb, tipo, campo, valor_anterior, valor_novo)
           VALUES (?, ?, 'Status automático', 'Status do A3', ?, ?)""",
        (analise_id, analise["id_mrhb"], analise["status"], novo),
    )
    return novo, True


def computar_dashboard(acoes, analises, hoje=None):
    """acoes: lista já enriquecida (enriquecer_acao). analises: linhas de
    a3_analises. Devolve KPIs e as séries de todos os gráficos."""
    hoje = hoje or date.today()
    abertas = [a for a in acoes if a["situacao"] in ("no_prazo", "atrasada")]
    atrasadas = [a for a in abertas if a["situacao"] == "atrasada"]
    concluidas = [a for a in acoes if a["situacao"] == "concluida"]
    concluidas_com_prazo = [a for a in concluidas if a.get("data_conclusao")]

    kpis = {
        "total": len([a for a in acoes if a["situacao"] != "cancelada"]),
        "abertas": len(abertas),
        "atrasadas": len(atrasadas),
        "vencem_7_dias": len([a for a in abertas if a["vence_em_breve"]]),
        "concluidas": len(concluidas),
        "pct_atrasadas": round(100 * len(atrasadas) / len(abertas)) if abertas else 0,
        "pct_concluidas_no_prazo": (
            round(100 * sum(1 for a in concluidas_com_prazo if a["concluida_no_prazo"]) / len(concluidas_com_prazo))
            if concluidas_com_prazo else None
        ),
        "media_dias_aberto": round(sum(a["dias_em_aberto"] for a in abertas) / len(abertas)) if abertas else 0,
        "maior_atraso": max((a["dias_atraso"] for a in atrasadas), default=0),
        "a3_total": sum(1 for x in analises if x["status"] != "Cancelado"),
        "a3_concluidos": sum(1 for x in analises if x["status"] == "Concluído"),
        "a3_em_andamento": sum(1 for x in analises if x["status"] == "Em andamento"),
        "a3_prazo_vencido": sum(
            1 for x in analises
            if x["status"] == "Em andamento" and para_data(x["prazo_limite"]) and para_data(x["prazo_limite"]) < hoje
        ),
    }

    situacoes = Counter(a["situacao"] for a in acoes)
    status_geral = [
        {"chave": "atrasada", "rotulo": "Atrasadas", "valor": situacoes.get("atrasada", 0)},
        {"chave": "no_prazo", "rotulo": "Abertas no prazo", "valor": situacoes.get("no_prazo", 0)},
        {"chave": "concluida", "rotulo": "Concluídas", "valor": situacoes.get("concluida", 0)},
    ]

    # Por responsável / setor: TODAS as ações (concluídas + no prazo + atrasadas).
    def todas_por(campo, vazio):
        contagem = defaultdict(lambda: {"concluida": 0, "no_prazo": 0, "atrasada": 0})
        for a in acoes:
            if a["situacao"] in ("concluida", "no_prazo", "atrasada"):
                contagem[(a.get(campo) or "").strip() or vazio][a["situacao"]] += 1
        return sorted(
            ({"rotulo": k, **v, "total": sum(v.values())} for k, v in contagem.items()),
            key=lambda i: (-i["total"], -i["atrasada"], i["rotulo"]),
        )

    por_responsavel = todas_por("responsavel", "(sem responsável)")

    por_grupo = defaultdict(lambda: {"no_prazo": 0, "atrasada": 0})
    for a in abertas:
        por_grupo[a["grupo_rotulo"]][a["situacao"]] += 1
    abertas_por_grupo = [
        {"rotulo": g["rotulo"], "no_prazo": por_grupo[g["rotulo"]]["no_prazo"],
         "atrasada": por_grupo[g["rotulo"]]["atrasada"],
         "total": por_grupo[g["rotulo"]]["no_prazo"] + por_grupo[g["rotulo"]]["atrasada"]}
        for g in GRUPOS_POR_CHAVE.values()
        if por_grupo[g["rotulo"]]["no_prazo"] + por_grupo[g["rotulo"]]["atrasada"] > 0
    ]

    faixas_prazo = Counter(faixa_prazo(a["dias_para_vencer"]) for a in abertas if a["dias_para_vencer"] is not None)
    faixas_aberto = Counter(faixa_dias_aberto(a["dias_em_aberto"]) for a in abertas)

    # Evolução dos últimos 12 meses: ações abertas x concluídas em cada mês.
    meses = []
    ano, mes = hoje.year, hoje.month
    for _ in range(12):
        meses.append(f"{ano:04d}-{mes:02d}")
        mes -= 1
        if mes == 0:
            ano, mes = ano - 1, 12
    meses.reverse()
    criadas_mes = Counter((a.get("data_abertura") or "")[:7] for a in acoes if a["situacao"] != "cancelada")
    concluidas_mes = Counter((a.get("data_conclusao") or "")[:7] for a in concluidas)
    evolucao = [{"mes": m, "abertas": criadas_mes.get(m, 0), "concluidas": concluidas_mes.get(m, 0)} for m in meses]
    # A3: abertos no mês (data de emissão) x concluídos no mês (data de fechamento); cancelados fora.
    a3_validos = [x for x in analises if x["status"] != "Cancelado"]
    a3_abertos_mes = Counter((x.get("data_emissao") or "")[:7] for x in a3_validos)
    a3_concluidos_mes = Counter((x.get("data_fechamento") or "")[:7] for x in a3_validos if x["status"] == "Concluído")
    evolucao_a3 = [{"mes": m, "abertas": a3_abertos_mes.get(m, 0), "concluidas": a3_concluidos_mes.get(m, 0)} for m in meses]

    mais_atrasadas = sorted(atrasadas, key=lambda a: -a["dias_atraso"])[:15]


    # Mapa dos setores: TOTAL de ações de cada setor (abertas + concluídas;
    # canceladas fora), com a lista das ações para o clique no setor.
    mapa = {s: [] for s in SETORES_PADRAO}
    fora_do_mapa = []
    for a in acoes:
        if a["situacao"] == "cancelada":
            continue
        resumo = {c: a.get(c) for c in ("id", "analise_id", "id_mrhb", "descricao", "responsavel", "setor",
                                        "prazo", "situacao", "dias_atraso", "dias_para_vencer", "vence_em_breve",
                                        "grupo_rotulo")}
        mapa.get(normalizar_setor(a.get("setor")), fora_do_mapa).append(resumo)
    mapa_setores = {
        "setores": [{"rotulo": s, "acoes": lista} for s, lista in mapa.items()],
        "fora_do_mapa": fora_do_mapa,
    }

    # A3 por área: o setor responsável pelo problema é um só (Usinagem OU Injeção).
    # Cada área separa concluídos, em andamento no prazo e atrasados (prazo limite vencido).
    a3_por_area = {nome: {"concluida": 0, "no_prazo": 0, "atrasada": 0} for nome in ("Usinagem", "Injeção")}
    for x in analises:
        area = normalizar_setor(x.get("area"))
        if area not in a3_por_area or x["status"] == "Cancelado":
            continue
        if x["status"] == "Concluído":
            a3_por_area[area]["concluida"] += 1
        else:
            limite = para_data(x["prazo_limite"])
            a3_por_area[area]["atrasada" if limite and limite < hoje else "no_prazo"] += 1

    return {
        "kpis": kpis,
        "a3_por_area": [{"rotulo": k, **v, "total": sum(v.values())} for k, v in a3_por_area.items()],
        "mapa_setores": mapa_setores,
        "status_geral": status_geral,
        "por_responsavel": por_responsavel,
        "por_setor": todas_por("setor", "(sem setor)"),
        "por_grupo": abertas_por_grupo,
        "faixas_prazo": [{"chave": k, "rotulo": r, "valor": faixas_prazo.get(k, 0)} for k, r in FAIXAS_PRAZO],
        "faixas_dias_aberto": [
            {"chave": k, "rotulo": r, "valor": faixas_aberto.get(k, 0)} for k, r, _mn, _mx in FAIXAS_DIAS_ABERTO
        ],
        "evolucao_mensal": evolucao,
        "evolucao_mensal_a3": evolucao_a3,
        "mais_atrasadas": mais_atrasadas,
    }
