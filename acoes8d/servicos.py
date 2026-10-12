"""Criação do A3 a partir de uma reclamação do Gerenciador.

Usado em três situações:
  1. Manual: botão "+ Nova análise A3" (rota POST /api/analises).
  2. Automática: o Gerenciador chama criar_a3_automatico(id_mrhb) logo
     depois de cadastrar uma reclamação (qualquer tipo).
  3. Rede de segurança: sincronizar_a3_automaticos() roda ao abrir as telas
     do módulo e cria o A3 de toda reclamação NOVA que ainda não tenha um
     (ex.: reclamação gravada por outro caminho). Reclamações cadastradas
     antes da integração não ganham A3 automático.
"""
import json
import logging
import sqlite3
import time
from datetime import date

from flask import current_app

from .db import buscar_reclamacao, conectar, conectar_gerenciador
from .modelo_a3 import DIAS_PRAZO_LIMITE_A3, dados_vazios
from .regras import somar_dias

log = logging.getLogger(__name__)

# A sincronização de segurança roda no máximo a cada N segundos.
INTERVALO_SINCRONIZACAO = 30
_ultima_sincronizacao = 0.0


def _texto(valor):
    return "" if valor is None else str(valor).strip()


def _maquina(reclamacao):
    """MQ US / MQ IN da reclamação (ignorando "N/A")."""
    maquinas = [_texto(reclamacao.get(c)) for c in ("mq_us", "mq_in")]
    return " / ".join(m for m in maquinas if m and m.upper() != "N/A") or None


def criar_analise(conn, id_mrhb, reclamacao=None, tema=None, responsavel=None, data_emissao=None, automatico=False):
    """Insere o A3 (sem commit) já preenchido com os dados da reclamação e
    devolve o id. Se o ID MRHB já tiver A3, levanta sqlite3.IntegrityError."""
    reclamacao = reclamacao or {}
    emissao = _texto(data_emissao) or reclamacao.get("data_abertura") or date.today().isoformat()
    dados = dados_vazios()
    if automatico:
        # Check list: "Abrir A3 no gerenciador" já fica cumprido.
        item = dados["checklist"]["itens"]["c03"]
        item["ok"] = True
        item["obs"] = f"A3 aberto automaticamente ao cadastrar a reclamação ({date.today():%d/%m/%Y})."
    quantidade = reclamacao.get("qtd_reclamada")
    cursor = conn.execute(
        """INSERT INTO a3_analises
               (id_mrhb, numero_notificacao, tema, responsavel, area, maquina, data_emissao, prazo_limite,
                cliente, pn_mrhb, pn_cliente, quantidade, definicao_problema, dados)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            id_mrhb,
            reclamacao.get("numero_notificacao"),
            _texto(tema) or "Resposta Rapida",
            _texto(responsavel) or None,
            reclamacao.get("area_responsavel_8d"),
            _maquina(reclamacao),
            emissao,
            somar_dias(emissao, DIAS_PRAZO_LIMITE_A3),
            reclamacao.get("cliente"),
            reclamacao.get("pn_mrhb"),
            reclamacao.get("pn_cliente"),
            None if quantidade in (None, "") else str(quantidade),
            reclamacao.get("descricao_defeito"),
            json.dumps(dados, ensure_ascii=False),
        ),
    )
    analise_id = cursor.lastrowid
    conn.execute(
        "INSERT INTO a3_historico (analise_id, id_mrhb, tipo, valor_novo) VALUES (?, ?, 'Criação do A3', ?)",
        (analise_id, id_mrhb,
         f"Automática — reclamação {reclamacao.get('tipo_reclamacao') or ''} cadastrada no Gerenciador".strip()
         if automatico else "Manual"),
    )
    return analise_id


def criar_a3_automatico(id_mrhb):
    """Chamado pelo Gerenciador logo após cadastrar uma reclamação.

    Cria o A3 (se ainda não existir) e devolve o id dele. Nunca levanta
    exceção: um problema aqui não pode impedir o cadastro da reclamação.
    """
    if not current_app.config.get("ACOES8D_A3_AUTOMATICO", True):
        return None
    id_mrhb = _texto(id_mrhb).upper()
    if not id_mrhb:
        return None
    try:
        conn = conectar()
        try:
            existente = conn.execute("SELECT id FROM a3_analises WHERE id_mrhb = ?", (id_mrhb,)).fetchone()
            if existente:
                return existente["id"]
            reclamacao = buscar_reclamacao(id_mrhb)
            if not reclamacao:
                log.warning("A3 automático: reclamação %s não encontrada no Gerenciador.", id_mrhb)
                return None
            analise_id = criar_analise(conn, id_mrhb, reclamacao,
                                       responsavel=reclamacao.get("responsavel_cliente"), automatico=True)
            conn.commit()
            log.info("A3 automático criado para %s (id %s).", id_mrhb, analise_id)
        finally:
            conn.close()
        from .etapas import sincronizar_etapas_gerenciador

        sincronizar_etapas_gerenciador(analise_id)
        return analise_id
    except sqlite3.IntegrityError:
        # Outro acesso criou o A3 ao mesmo tempo: devolve o existente.
        conn = conectar()
        try:
            linha = conn.execute("SELECT id FROM a3_analises WHERE id_mrhb = ?", (id_mrhb,)).fetchone()
            return linha["id"] if linha else None
        finally:
            conn.close()
    except Exception:  # noqa: BLE001 — registrar e seguir, sem derrubar o Gerenciador
        log.exception("Falha ao criar o A3 automático de %s.", id_mrhb)
        return None


def inicio_automatico(conn):
    """Data/hora a partir da qual reclamações ganham A3 automático: a da
    primeira execução do módulo (gravada em a3_config) ou a configurada em
    ACOES8D_A3_AUTOMATICO_DESDE ("AAAA-MM-DD" ou "AAAA-MM-DD HH:MM:SS")."""
    configurado = current_app.config.get("ACOES8D_A3_AUTOMATICO_DESDE")
    if configurado:
        return str(configurado)
    linha = conn.execute("SELECT valor FROM a3_config WHERE chave = 'automatico_desde'").fetchone()
    return linha["valor"] if linha else "9999-12-31"


def sincronizar_a3_automaticos(forcar=False):
    """Cria o A3 das reclamações novas que ainda não têm. Devolve quantos criou."""
    global _ultima_sincronizacao
    if not current_app.config.get("ACOES8D_A3_AUTOMATICO", True):
        return 0
    agora = time.monotonic()
    if not forcar and agora - _ultima_sincronizacao < INTERVALO_SINCRONIZACAO:
        return 0
    _ultima_sincronizacao = agora
    try:
        conn = conectar()
        try:
            desde = inicio_automatico(conn)
            existentes = {l["id_mrhb"] for l in conn.execute("SELECT id_mrhb FROM a3_analises")}
        finally:
            conn.close()
        gerenciador = conectar_gerenciador()
        if gerenciador is None:
            return 0
        try:
            novas = [
                l["id_mrhb"] for l in gerenciador.execute(
                    "SELECT id_mrhb FROM reclamacoes WHERE id_mrhb IS NOT NULL AND criado_em >= ? ORDER BY id",
                    (desde,),
                )
                if l["id_mrhb"] not in existentes
            ]
        except sqlite3.OperationalError:
            return 0
        finally:
            gerenciador.close()
        return sum(1 for id_mrhb in novas if criar_a3_automatico(id_mrhb))
    except Exception:  # noqa: BLE001
        log.exception("Falha na sincronização de A3 automáticos.")
        return 0
