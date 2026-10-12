# Gestão de Ações 8D

Módulo do **Gerenciador PDCA / 8D** que transforma o formulário
**FM-QS-025 — Formulário de Resolução de Problemas A3** (antes uma planilha
Excel por reclamação) em um formulário digital. Ele também controla todas as
ações que saem dos A3.

Cada análise A3 é vinculada ao **ID Wetzel** gerado pelo Gerenciador (no banco, campo `id_mrhb`).

## O que o sistema faz

| Tela | O que tem |
|---|---|
| **Visão Geral** | Indicadores e gráficos clicáveis: ações abertas, atrasadas, que vencem em 7 dias, média de dias em aberto, % concluídas no prazo e A3 com prazo limite vencido. Os gráficos mostram situação das ações, ações abertas por prazo, por responsável, por setor, por tipo e por idade (dias em aberto), evolução mensal e as ações mais atrasadas. Os filtros são por responsável, setor, tipo e ID Wetzel. |
| **Formulário A3 (lista)** | Lista dos A3 com progresso das ações e destaque para prazo limite vencido. **Nova análise**: digita-se o ID Wetzel (com busca por cliente/PN/defeito) e o A3 já vem preenchido com os dados da reclamação. |
| **Formulário A3 (folha)** | A própria folha **FRP - A3**, no mesmo layout do Excel. Clica-se no quadro e preenche, e tudo é **salvo automaticamente**. Cada linha de ação (contenção, corretivas, preventivas, retroalimentação, eficácia) vira uma ação no Controle de Ações assim que tiver descrição, responsável e prazo. As linhas padrão do formulário aparecem como sugestão em cinza. O status de cada ação fica com o farol G/Y/R e o "⋯" abre os detalhes (setor, observação, excluir). A Ilustração aceita upload ou Ctrl+V de imagem. Abaixo da folha ficam as demais folhas do formulário, que abrem com um clique: Check List, Planilha de Contenção, Caracterização, Check de Causa Raiz, Evidências, Análise da Eficácia, Plano de Validação e Histórico. A impressão sai em A3 paisagem. |
| **Gestão de Ações** | Todas as ações de todos os A3, com farol, responsável, setor, abertura, prazo, **dias em aberto** e **dias de atraso**. Filtros rápidos: Abertas / Atrasadas / Vencem em 7 dias / Concluídas. Mostra as ações abertas **por responsável**, ordena por qualquer coluna e exporta CSV para Excel. |
| **Cadastro** | Cadastro de nomes e setores, usado como sugestão ao atribuir ações. Ao escolher a pessoa, o setor é preenchido sozinho. |

> **Implantação no Gerenciador:** siga o roteiro da seção 0 do
> [INTEGRACAO_TI.md](INTEGRACAO_TI.md).

## Rodar para testar (sozinho, fora do Gerenciador)

Requisitos: Python 3.10+.

```bash
pip install -r requirements.txt
python app_teste.py
```

Abrir <http://localhost:5001>.

O app de teste usa um banco próprio (`data/acoes8d.db`). Para buscar o ID
MRHB, ele lê **somente para consulta** o banco do Gerenciador em
`..\Sistema-PDCA-8D\data\app.db`. Outro caminho pode ser indicado pela
variável de ambiente `GERENCIADOR_DB`.

### Importar A3 antigos do Excel

```bash
python importar_a3_excel.py "C:\caminho\do\A3.xlsx"
python importar_a3_excel.py "C:\pasta\com\vários\A3"
```

## Colocar dentro do Gerenciador (TI)

Com o Gerenciador parado, um comando aplica tudo (com backup):

```bash
python integrar_no_gerenciador.py "C:\caminho\Sistema-PDCA-8D"
```

Depois disso, **toda reclamação nova, de qualquer tipo, ganha o seu A3 automaticamente**, e o Gerenciador passa a ter o menu "8D" e o botão "A3" em cada reclamação. Detalhes e alteração manual em **[INTEGRACAO_TI.md](INTEGRACAO_TI.md)**.

## Estrutura

```
acoes8d/                 O módulo (é esta pasta que vai para o Gerenciador)
app_teste.py             App Flask mínimo para testar o módulo sozinho
standalone/              base.html e style.css copiados do Gerenciador (só para o app de teste)
importar_a3_excel.py     Importa planilhas FM-QS-025 (.xlsx) para o sistema
integrar_no_gerenciador.py  Aplica a integração no Gerenciador (com backup)
INTEGRACAO_TI.md         Guia de integração para o TI
data/                    Banco e anexos do app de teste (não versionar; tem dados reais)
```
