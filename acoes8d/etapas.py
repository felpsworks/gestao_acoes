"""Etapas do 8D calculadas a partir do Formulário A3.

O A3 é a fonte única: o sistema reconhece até onde o A3 foi cumprido e diz em
que etapa do 8D a reclamação está. As 11 etapas, os prazos (dias a partir da
abertura) e as "flexíveis" são as mesmas da antiga aba Etapas 8D do
Gerenciador. Com ACOES8D_SINCRONIZAR_ETAPAS ligado, o resultado é gravado na
tabela etapas_8d do Gerenciador, que continua alimentando o Dashboard dele.

Regras (definidas com o usuário):
  - Etapa com ações só é realizada quando TODAS as ações dela estão
    concluídas (G). Data de realização = conclusão da última ação.
  - Causa Raiz e Lições Aprendidas não têm ações: realizadas quando o campo
    está preenchido; data = dia em que foi preenchido (dados.etapas_datas).
  - Poka Yoke, LPA, Trab. Padronizado, FMEA e Plano de Controle só contam se
    a linha correspondente da seção 6 tiver ação lançada; sem ação ou
    marcada N/A, ficam "não aplicáveis" (igual ao padrão do Gerenciador).
  - 8D Fechado = A3 Concluído (todas as ações G + 8D Aprovado).
"""
import json
import logging
import sqlite3
from datetime import date
from pathlib import Path

from flask import current_app

from .db import conectar
from .modelo_a3 import mesclar_com_padrao
from .regras import somar_dias

log = logging.getLogger(__name__)

# (nome no Gerenciador, dias a partir da abertura) — mesma ordem e prazos.
ETAPAS_8D = [
    ("Contenção", 1),
    ("Causa Raiz", 2),
    ("Ação Corretiva", 16),
    ("Poka Yoke", 16),
    ("LPA", 17),
    ("Validação", 35),
    ("Trab. Padronizado", 36),
    ("FMEA", 37),
    ("Plano de Controle", 38),
    ("Lições Aprendidas", 43),
    ("8D Fechado", 44),
]

# Etapa flexível -> linha da seção 6 (Retroalimentação) que a representa.
ETAPAS_RETROALIMENTACAO = {
    "Poka Yoke": "Poka Yoke",
    "LPA": "Layered Process Audit (LPA)",
    "Trab. Padronizado": "Trabalho Padronizado",
    "FMEA": "PFMEA",
    "Plano de Controle": "Plano de Controle",
}

# Reclamações que exigem 8D completo (as demais ficam fora das métricas de etapa).
TIPOS_PASSIVEIS_8D = {"Formal", "Informal"}

def atualizar_datas_de_campos(dados, hoje=None):
    """Causa Raiz / Lições Aprendidas: guarda o dia em que o campo foi
    preenchido (e apaga se for esvaziado). Altera e devolve `dados`."""
    hoje = hoje or date.today().isoformat()
    datas = dados.setdefault("etapas_datas", {})
    preenchidos = {
        "Causa Raiz": bool(((dados.get("porques") or {}).get("ocorrencia") or {}).get("causa_raiz", "").strip()),
        "Lições Aprendidas": bool(((dados.get("fechamento") or {}).get("licoes_aprendidas") or "").strip()),
    }
    for etapa, ok in preenchidos.items():
        if ok and not datas.get(etapa):
            datas[etapa] = hoje
        elif not ok:
            datas.pop(etapa, None)
    return dados


def calcular_etapas(analise, dados, acoes, hoje=None):
    """analise: linha de a3_analises (dict); dados: JSON do formulário (dict);
    acoes: ações do A3 (dicts com grupo, subgrupo, status, data_conclusao).
    Devolve {"etapas": [...], "atual": {...} | None}."""
    hoje = hoje or date.today().isoformat()
    validas = [a for a in acoes if a.get("status") != "Cancelada"]
    contencao = dados.get("contencao") or {}
    retro_na = dados.get("retroalimentacao_na") or {}
    datas_campos = dict(dados.get("etapas_datas") or {})
    # A3 anteriores ao registro dessas datas: campo preenchido sem data -> última atualização do A3.
    atualizado = (analise.get("atualizado_em") or "")[:10] or analise.get("data_emissao")
    if ((dados.get("porques") or {}).get("ocorrencia") or {}).get("causa_raiz", "").strip():
        datas_campos.setdefault("Causa Raiz", atualizado)
    if ((dados.get("fechamento") or {}).get("licoes_aprendidas") or "").strip():
        datas_campos.setdefault("Lições Aprendidas", atualizado)

    def por_acoes(lista):
        if not lista or any(a.get("status") != "Concluída" for a in lista):
            return None
        return max((a.get("data_conclusao") or "" for a in lista), default="") or None

    def acoes_de(grupo, subgrupos=None):
        return [a for a in validas if a.get("grupo") == grupo and (subgrupos is None or a.get("subgrupo") in subgrupos)]

    base = analise.get("data_emissao")
    etapas = []
    for nome, dias in ETAPAS_8D:
        aplicavel, realizacao = True, None
        if nome == "Contenção":
            subs = ["3.1 Nacional"] + (["3.2 Exportação"] if contencao.get("exportacao_aplicavel") else [])
            realizacao = por_acoes(acoes_de("contencao", subs))
        elif nome == "Causa Raiz":
            realizacao = datas_campos.get("Causa Raiz")
        elif nome == "Ação Corretiva":
            realizacao = por_acoes(acoes_de("corretiva"))
        elif nome in ETAPAS_RETROALIMENTACAO:
            # Como no Gerenciador (etapas flexíveis nascem "não aplicáveis"):
            # só conta se a linha da seção 6 tiver ação lançada e não estiver N/A.
            linha = ETAPAS_RETROALIMENTACAO[nome]
            lista = acoes_de("retroalimentacao", [linha])
            if retro_na.get(linha) or not lista:
                aplicavel = False
            else:
                realizacao = por_acoes(lista)
        elif nome == "Validação":
            # Qualquer linha da seção 7 (Análise de Eficácia) concluída (G) já
            # valida; data = a primeira conclusão.
            concluidas = [a for a in acoes_de("eficacia") if a.get("status") == "Concluída"]
            realizacao = min((a.get("data_conclusao") or "" for a in concluidas), default="") or None
        elif nome == "Lições Aprendidas":
            realizacao = datas_campos.get("Lições Aprendidas")
        elif nome == "8D Fechado" and analise.get("status") == "Concluído":
            realizacao = por_acoes(validas) or analise.get("data_fechamento")
        prazo = somar_dias(base, dias) if base else None
        etapas.append({"etapa": nome, "prazo": prazo, "realizacao": realizacao, "aplicavel": aplicavel})

    atual = next((e for e in etapas if e["aplicavel"] and not e["realizacao"]), None)
    if atual:
        atual = {**atual, "atrasada": bool(atual["prazo"] and atual["prazo"] < hoje)}
    return {"etapas": etapas, "atual": atual}


def etapas_pendentes(resultado):
    """Etapas que precisam estar realizadas antes de finalizar o 8D (todas as
    aplicáveis, menos o próprio "8D Fechado")."""
    return [e["etapa"] for e in resultado["etapas"]
            if e["etapa"] != "8D Fechado" and e["aplicavel"] and not e["realizacao"]]


def etapas_da_analise(conn, analise_id):
    analise = conn.execute("SELECT * FROM a3_analises WHERE id = ?", (analise_id,)).fetchone()
    if not analise:
        return None, None
    dados = mesclar_com_padrao(json.loads(analise["dados"] or "{}"))
    acoes = [dict(l) for l in conn.execute(
        "SELECT grupo, subgrupo, status, data_conclusao FROM a3_acoes WHERE analise_id = ?", (analise_id,)
    )]
    return analise["id_mrhb"], calcular_etapas(dict(analise), dados, acoes)


def sincronizar_etapas_gerenciador(analise_id):
    """Grava as etapas calculadas na tabela etapas_8d do Gerenciador (realização
    e "aplicável"). Chamar DEPOIS de fechar a conexão do módulo. Nunca levanta
    exceção. Reclamações sem A3 não são tocadas (ficam como estavam)."""
    if not current_app.config.get("ACOES8D_SINCRONIZAR_ETAPAS", True):
        return False
    try:
        conn = conectar()
        try:
            id_mrhb, resultado = etapas_da_analise(conn, analise_id)
        finally:
            conn.close()
        if not resultado:
            return False
        caminho = Path(current_app.config["ACOES8D_GERENCIADOR_DB"])
        if not caminho.exists():
            return False
        gerenciador = sqlite3.connect(caminho, timeout=10)
        try:
            linha = gerenciador.execute("SELECT id FROM reclamacoes WHERE id_mrhb = ?", (id_mrhb,)).fetchone()
            if not linha:
                return False
            for e in resultado["etapas"]:
                gerenciador.execute(
                    "UPDATE etapas_8d SET realizacao = ?, aplicavel = ? WHERE reclamacao_id = ? AND etapa = ?",
                    (e["realizacao"], 1 if e["aplicavel"] else 0, linha[0], e["etapa"]),
                )
            gerenciador.commit()
            return True
        finally:
            gerenciador.close()
    except sqlite3.OperationalError as erro:  # ex.: tabela etapas_8d inexistente
        log.warning("Etapas do A3 %s não sincronizadas com o Gerenciador: %s", analise_id, erro)
        return False
    except Exception:  # noqa: BLE001
        log.exception("Falha ao sincronizar as etapas do A3 %s com o Gerenciador.", analise_id)
        return False


def sincronizar_todas():
    conn = conectar()
    ids = [l["id"] for l in conn.execute("SELECT id FROM a3_analises")]
    conn.close()
    return sum(1 for i in ids if sincronizar_etapas_gerenciador(i))
