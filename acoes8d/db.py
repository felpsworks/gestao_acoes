"""Banco de dados do módulo Gestão de Ações 8D.

Todas as tabelas do módulo têm o prefixo "a3_", para conviverem no mesmo
arquivo SQLite do Gerenciador PDCA (data/app.db) sem conflito de nomes.

O módulo só LÊ a tabela "reclamacoes" do Gerenciador (nunca escreve nela):
é de lá que vêm o ID MRHB e os dados da reclamação (cliente, PN, defeito...).
"""
import sqlite3
from pathlib import Path

from flask import current_app

SCHEMA = """
CREATE TABLE IF NOT EXISTS a3_analises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_mrhb TEXT UNIQUE NOT NULL,
    numero_notificacao TEXT,
    tema TEXT,
    responsavel TEXT,
    area TEXT,
    turno TEXT,
    maquina TEXT,
    supervisor TEXT,
    area_gestor TEXT,
    gestor TEXT,
    data_emissao TEXT NOT NULL,
    prazo_limite TEXT,
    cliente TEXT,
    produto TEXT,
    pn_mrhb TEXT,
    pn_cliente TEXT,
    quantidade TEXT,
    definicao_problema TEXT,
    status TEXT NOT NULL DEFAULT 'Em andamento',
    resultado_validacao TEXT,
    data_fechamento TEXT,
    dados TEXT NOT NULL DEFAULT '{}',
    criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS a3_acoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analise_id INTEGER NOT NULL REFERENCES a3_analises(id) ON DELETE CASCADE,
    grupo TEXT NOT NULL,
    subgrupo TEXT,
    descricao TEXT NOT NULL,
    responsavel TEXT NOT NULL,
    setor TEXT,
    data_abertura TEXT NOT NULL,
    prazo TEXT NOT NULL,
    prazo_original TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Aberta',
    data_conclusao TEXT,
    abrangencia TEXT,
    eficaz TEXT,
    observacao TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_a3_acoes_analise ON a3_acoes(analise_id);
CREATE INDEX IF NOT EXISTS idx_a3_acoes_responsavel ON a3_acoes(responsavel);

CREATE TABLE IF NOT EXISTS a3_pessoas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT UNIQUE NOT NULL COLLATE NOCASE,
    setor TEXT,
    email TEXT,
    ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS a3_anexos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analise_id INTEGER NOT NULL REFERENCES a3_analises(id) ON DELETE CASCADE,
    secao TEXT NOT NULL,
    nome_original TEXT NOT NULL,
    arquivo TEXT NOT NULL,
    legenda TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS a3_config (
    chave TEXT PRIMARY KEY,
    valor TEXT
);

CREATE TABLE IF NOT EXISTS a3_historico (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    analise_id INTEGER,
    acao_id INTEGER,
    id_mrhb TEXT,
    tipo TEXT NOT NULL,
    campo TEXT,
    valor_anterior TEXT,
    valor_novo TEXT,
    motivo TEXT,
    data_hora TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
"""


def _abrir(caminho):
    Path(caminho).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(caminho)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(caminho):
    conn = _abrir(caminho)
    conn.executescript(SCHEMA)
    # Marco da integração: reclamações cadastradas a partir daqui ganham A3
    # automático (as anteriores não, para não criar centenas de A3 vazios).
    conn.execute(
        "INSERT OR IGNORE INTO a3_config (chave, valor) VALUES ('automatico_desde', datetime('now', 'localtime'))"
    )
    # O status "Fechado" passou a se chamar "Concluído".
    conn.execute("UPDATE a3_analises SET status = 'Concluído' WHERE status = 'Fechado'")
    # Setores com nome antigo passam para o nome oficial (ex.: Metrologia -> Qualidade).
    from .modelo_a3 import normalizar_setor

    for tabela in ("a3_acoes", "a3_pessoas"):
        for (setor,) in conn.execute(f"SELECT DISTINCT setor FROM {tabela} WHERE setor IS NOT NULL").fetchall():
            oficial = normalizar_setor(setor) or None
            if oficial != setor:
                conn.execute(f"UPDATE {tabela} SET setor = ? WHERE setor = ?", (oficial, setor))
    # Ação sem setor recebe o setor (departamento) do responsável, conforme o Cadastro.
    conn.execute("""UPDATE a3_acoes SET setor = (
            SELECT p.setor FROM a3_pessoas p WHERE p.nome = a3_acoes.responsavel AND TRIM(COALESCE(p.setor, '')) != '')
        WHERE TRIM(COALESCE(setor, '')) = ''
          AND EXISTS (SELECT 1 FROM a3_pessoas p WHERE p.nome = a3_acoes.responsavel AND TRIM(COALESCE(p.setor, '')) != '')""")
    # Recalcula o status automático de todos os A3 (ex.: depois de uma atualização do sistema).
    from .regras import status_automatico_a3

    for (analise_id,) in conn.execute("SELECT id FROM a3_analises").fetchall():
        status_automatico_a3(conn, analise_id)
    conn.commit()
    conn.close()


def conectar():
    """Conexão com o banco do módulo (tabelas a3_*)."""
    return _abrir(current_app.config["ACOES8D_DB"])


def conectar_gerenciador():
    """Conexão SOMENTE LEITURA com o banco do Gerenciador PDCA (tabela
    reclamacoes). Retorna None se o arquivo não existir."""
    caminho = Path(current_app.config["ACOES8D_GERENCIADOR_DB"])
    if not caminho.exists():
        return None
    conn = sqlite3.connect(f"{caminho.resolve().as_uri()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


CAMPOS_RECLAMACAO = (
    "id_mrhb, numero_notificacao, data_abertura, pn_mrhb, pn_cliente, descricao_defeito, "
    "cliente, area_responsavel_8d, tipo_reclamacao, qtd_reclamada, responsavel_cliente, mq_in, mq_us"
)


def buscar_reclamacao(id_mrhb):
    conn = conectar_gerenciador()
    if conn is None:
        return None
    try:
        linha = conn.execute(
            f"SELECT {CAMPOS_RECLAMACAO} FROM reclamacoes WHERE id_mrhb = ?", (id_mrhb,)
        ).fetchone()
        return dict(linha) if linha else None
    except sqlite3.OperationalError:
        return None
    finally:
        conn.close()


def tipos_reclamacao():
    """{id_mrhb: tipo_reclamacao} de todas as reclamações do Gerenciador."""
    conn = conectar_gerenciador()
    if conn is None:
        return {}
    try:
        return {l["id_mrhb"]: l["tipo_reclamacao"] for l in conn.execute("SELECT id_mrhb, tipo_reclamacao FROM reclamacoes")}
    except sqlite3.OperationalError:
        return {}
    finally:
        conn.close()


def analistas_gerenciador():
    """Nomes do campo "Responsável" das reclamações do Gerenciador (os analistas)."""
    conn = conectar_gerenciador()
    if conn is None:
        return []
    try:
        return [l[0] for l in conn.execute(
            "SELECT DISTINCT TRIM(responsavel_cliente) FROM reclamacoes WHERE TRIM(COALESCE(responsavel_cliente, '')) != ''")]
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()


def defeitos_reclamacao():
    """{id_mrhb: descricao_defeito} de todas as reclamações do Gerenciador."""
    conn = conectar_gerenciador()
    if conn is None:
        return {}
    try:
        return {l["id_mrhb"]: l["descricao_defeito"] for l in conn.execute("SELECT id_mrhb, descricao_defeito FROM reclamacoes")}
    except sqlite3.OperationalError:
        return {}
    finally:
        conn.close()


def pesquisar_reclamacoes(termo, limite=30):
    conn = conectar_gerenciador()
    if conn is None:
        return []
    padrao = f"%{termo.strip()}%"
    try:
        linhas = conn.execute(
            f"""
            SELECT {CAMPOS_RECLAMACAO} FROM reclamacoes
            WHERE id_mrhb LIKE ? OR numero_notificacao LIKE ? OR cliente LIKE ?
               OR pn_mrhb LIKE ? OR descricao_defeito LIKE ?
            ORDER BY data_abertura DESC, id DESC
            LIMIT ?
            """,
            (padrao, padrao, padrao, padrao, padrao, limite),
        ).fetchall()
        return [dict(l) for l in linhas]
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()
