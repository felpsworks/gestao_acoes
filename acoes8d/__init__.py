"""Módulo Gestão de Ações 8D (A3 digital + Controle de Ações + Dashboard).

Feito como Blueprint Flask para ser plugado no Gerenciador PDCA com duas
linhas no app.py dele:

    import acoes8d
    acoes8d.init_app(app)

Veja INTEGRACAO_TI.md na raiz deste projeto.
"""
from pathlib import Path

from flask import Blueprint

bp = Blueprint(
    "acoes8d",
    __name__,
    url_prefix="/acoes8d",
    template_folder="templates",
    static_folder="static",
)


def criar_a3_automatico(id_mrhb):
    """Para o Gerenciador chamar logo após cadastrar uma reclamação:

        analise_a3_id = acoes8d.criar_a3_automatico(id_mrhb)

    Cria o A3 já preenchido com os dados da reclamação (qualquer tipo:
    Formal, Informal, Informativo, Alerta...). Devolve o id do A3 (ou None).
    Nunca levanta exceção, então não atrapalha o cadastro da reclamação."""
    from .servicos import criar_a3_automatico as _criar

    return _criar(id_mrhb)


def init_app(app):
    """Configura e registra o módulo no app Flask.

    Configurações (todas opcionais, em app.config):
      ACOES8D_DB              banco onde ficam as tabelas a3_* do módulo.
                              Padrão: <app>/data/app.db (o mesmo do Gerenciador).
      ACOES8D_GERENCIADOR_DB  banco do Gerenciador, lido para buscar a
                              reclamação pelo ID MRHB. Padrão: igual a ACOES8D_DB.
      ACOES8D_UPLOADS         pasta dos anexos (evidências).
                              Padrão: <app>/data/acoes8d_anexos.
      ACOES8D_A3_AUTOMATICO   True (padrão): toda reclamação nova ganha um A3.
      ACOES8D_SINCRONIZAR_ETAPAS  True (padrão): as etapas do 8D calculadas a
                              partir do A3 são gravadas na tabela etapas_8d do
                              Gerenciador (a aba Etapas 8D deixa de ser usada).
      ACOES8D_A3_AUTOMATICO_DESDE  opcional, "AAAA-MM-DD": a partir de quando
                              reclamações ganham A3 automático. Padrão: data
                              da primeira execução do módulo.
    """
    raiz = Path(app.root_path)
    app.config.setdefault("ACOES8D_DB", str(raiz / "data" / "app.db"))
    app.config.setdefault("ACOES8D_GERENCIADOR_DB", app.config["ACOES8D_DB"])
    app.config.setdefault("ACOES8D_UPLOADS", str(raiz / "data" / "acoes8d_anexos"))
    app.config.setdefault("ACOES8D_A3_AUTOMATICO", True)
    app.config.setdefault("ACOES8D_SINCRONIZAR_ETAPAS", True)
    if not app.config.get("MAX_CONTENT_LENGTH"):
        app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # limite de upload de anexos/imagens

    from . import db, rotas  # noqa: F401  (rotas registra as views no blueprint)

    db.init_db(app.config["ACOES8D_DB"])
    app.register_blueprint(bp)

    # Ao iniciar, garante que as etapas do Gerenciador refletem os A3 atuais.
    if app.config["ACOES8D_SINCRONIZAR_ETAPAS"]:
        from .etapas import sincronizar_todas

        with app.app_context():
            sincronizar_todas()
