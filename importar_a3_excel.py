"""Importa planilhas A3 antigas (FM-QS-025, layout da rev. 12) para o módulo
Gestão de Ações 8D, para não perder o histórico dos A3 já feitos em Excel.

Uso:
    python importar_a3_excel.py "C:\\caminho\\E-70232026 - D-7228 - ....xlsx"
    python importar_a3_excel.py "C:\\pasta\\com\\varios\\A3"          (importa todos os .xlsx)
    python importar_a3_excel.py arquivo.xlsx --db "C:\\...\\data\\app.db"

--db: banco onde gravar. Padrão: data/acoes8d.db (o do app_teste.py). Na
empresa, depois da integração, apontar para o data/app.db do Gerenciador.

Regras:
  - Um A3 cujo ID MRHB já existe no sistema é IGNORADO (nunca sobrescreve
    o que já foi preenchido pelo sistema). Pode rodar de novo sem duplicar.
  - Status das ações (coluna Status do FRP - A3): G -> Concluída (data de
    conclusão = prazo, que é a melhor informação disponível na planilha),
    Y/R -> Em andamento, vazio -> Aberta. Ações sem responsável (ou "NA")
    não são importadas.
  - A planilha precisa estar FECHADA no Excel.
"""
import argparse
import sqlite3
import sys
from pathlib import Path

RAIZ = Path(__file__).parent
sys.path.insert(0, str(RAIZ))

from acoes8d.db import SCHEMA  # noqa: E402
from acoes8d.importacao_excel import gravar, ler_a3  # noqa: E402  (a leitura fica no módulo)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("caminhos", nargs="+", help="Arquivo(s) .xlsx do A3 ou pasta(s) com vários")
    parser.add_argument("--db", default=str(RAIZ / "data" / "acoes8d.db"), help="Banco SQLite de destino")
    args = parser.parse_args()

    arquivos = []
    for c in args.caminhos:
        p = Path(c)
        arquivos += sorted(x for x in p.glob("*.xlsx") if not x.name.startswith("~$")) if p.is_dir() else [p]

    Path(args.db).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row  # a regra de status do sistema lê as colunas pelo nome
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    # No banco do Gerenciador (com a tabela reclamacoes) o A3 precisa existir como reclamação.
    tem_reclamacoes = bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reclamacoes'").fetchone())
    importados = ignorados = erros = 0
    for arquivo in arquivos:
        try:
            analise, dados, acoes = ler_a3(arquivo)
            if tem_reclamacoes and not conn.execute(
                    "SELECT 1 FROM reclamacoes WHERE id_mrhb = ?", (analise["id_mrhb"],)).fetchone():
                raise ValueError(f"ID Wetzel {analise['id_mrhb']} não encontrado no Gerenciador (todo A3 precisa estar vinculado a uma reclamação)")
            if gravar(conn, analise, dados, acoes) is not None:
                conn.commit()
                importados += 1
                print(f"[OK]       {analise['id_mrhb']}: {len(acoes)} ações  ({arquivo.name})")
            else:
                ignorados += 1
                print(f"[IGNORADO] {analise['id_mrhb']} já existe no sistema  ({arquivo.name})")
        except Exception as erro:  # segue para o próximo arquivo
            conn.rollback()
            erros += 1
            print(f"[ERRO]     {arquivo.name}: {erro}")
    conn.close()
    print(f"\nImportados: {importados} · Ignorados (já existiam): {ignorados} · Com erro: {erros}")


if __name__ == "__main__":
    main()
