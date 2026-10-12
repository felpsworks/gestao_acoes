"""Roda o módulo Gestão de Ações 8D sozinho, para testes e avaliação.

    python app_teste.py      ->  http://localhost:5001/acoes8d/

Usa um banco próprio (data/acoes8d.db) e lê as reclamações (ID MRHB) do
banco do Gerenciador PDCA em modo somente leitura. O caminho do banco do
Gerenciador pode ser trocado pela variável de ambiente GERENCIADOR_DB.

Na integração definitiva NÃO se usa este arquivo: o TI pluga o pacote
acoes8d no app.py do Gerenciador (ver INTEGRACAO_TI.md).
"""
import os
from pathlib import Path

from flask import Flask, redirect, url_for

import acoes8d

RAIZ = Path(__file__).parent
GERENCIADOR_PADRAO = RAIZ.parent / "Sistema-PDCA-8D" / "data" / "app.db"

app = Flask(__name__, template_folder="standalone/templates", static_folder="standalone/static")
app.secret_key = "acoes8d-teste-local"
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # limite de upload de anexos
app.config["ACOES8D_DB"] = os.environ.get("ACOES8D_DB", str(RAIZ / "data" / "acoes8d.db"))
app.config["ACOES8D_GERENCIADOR_DB"] = os.environ.get("GERENCIADOR_DB", str(GERENCIADOR_PADRAO))
app.config["ACOES8D_UPLOADS"] = str(RAIZ / "data" / "acoes8d_anexos")
# No teste, o banco do Gerenciador é só consultado: as etapas NÃO são gravadas
# nele (na integração, com o mesmo banco, isso fica ligado).
app.config["ACOES8D_SINCRONIZAR_ETAPAS"] = os.environ.get("SINCRONIZAR_ETAPAS") == "1"

acoes8d.init_app(app)


@app.route("/")
def inicio():
    return redirect(url_for("acoes8d.dashboard"))


if __name__ == "__main__":
    print(f"Banco do módulo: {app.config['ACOES8D_DB']}")
    print(f"Banco do Gerenciador (somente leitura): {app.config['ACOES8D_GERENCIADOR_DB']}")
    app.run(host="0.0.0.0", port=5001, debug=True)
