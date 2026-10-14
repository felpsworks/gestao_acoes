"""Estrutura do formulário padrão FM-QS-025 - Formulário de Resolução de
Problemas A3 (rev. 12), transformada em dados.

Tudo que é "lista fixa" da planilha original (atividades do check list,
locais da planilha de contenção, 6M, documentos da retroalimentação, temas,
etc.) fica aqui, num lugar só. Para mudar o formulário (ex.: nova revisão do
FM-QS-025), normalmente basta editar este arquivo.
"""
import copy
import re
import unicodedata

# Aba "Plan1" do Excel -> lista "tema".
TEMAS = [
    "Resposta Rapida",
    "Auditoria Interna",
    "Auditoria Externa",
    "Auditoria Cliente",
    "MPCP",
    "Reunião de Baia",
    "Reunião de Refugo",
    "Road Map",
    "OEE",
    "Segurança do Trabalho",
    "Meio Ambiente",
    "Outros",
]

TURNOS = ["T1", "T2", "T3", "ADM"]

# Prazo limite do A3 (e de todas as etapas do 8D): 30 dias após a abertura do A3.
DIAS_PRAZO_LIMITE_A3 = 30

# Velocímetro da Visão Geral: média de dias corridos para fechar um A3.
META_DIAS_FECHAR_A3 = 30
# Faixas (limite superior em dias, cor): verde até a meta, amarelo, laranja, vermelho.
FAIXAS_VELOCIMETRO = [(30, "#4cb848"), (44, "#f9c80e"), (60, "#f06a23"), (None, "#e8292a")]
# Visão Geral: tipos de reclamação considerados por padrão (botões "Tipo de reclamação").
# "Sem reclamação" = A3 antigo sem reclamação no Gerenciador. Hoje todo A3 novo é
# obrigatoriamente vinculado a uma reclamação, então esse grupo só aparece se existir.
SEM_RECLAMACAO = "Sem reclamação"
TIPOS_PADRAO_VISAO = ["Formal", "Informal", "Logística"]

# Aba "Check Atividades Reclamação". A chave é fixa (não muda se o texto da
# atividade for corrigido), para não perder o que já foi preenchido.
CHECKLIST = [
    ("c01", "Realizar contato com cliente para entender reclamação"),
    ("c02", "Realizar pré-validação da reclamação"),
    ("c03", "Abrir A3 no gerenciador"),
    ("c04", "Enviar email de notificação"),
    ("c05", "Segregar e identificar estoque MRHB"),
    ("c06", "Analisar previsão de entrega junto a Logística"),
    ("c07", "Emitir alerta da qualidade"),
    ("c08", "Obter rastreabilidade"),
    ("c09", "Definir lote de risco"),
    ("c10", "Analisar quantidades em estoque do cliente"),
    ("c11", "Analisar quantidades em estoque WIP"),
    ("c12", "Definir contenção no cliente/MO"),
    ("c13", "Implementar EV"),
    ("c14", "Preencher portal MRH (Somente Reclamações Formais)"),
    ("c15", "Preencher contenção no site do cliente"),
    ("c16", "Definir equipe para a realização do 8D"),
    ("c17", "Convocar reunião de 8D"),
    ("c18", "Realizar pré-análise para a reunião de 8D"),
    ("c19", "Realizar reunião de 8D"),
    ("c20", "Realizar simulação da falha no processo"),
    ("c21", "Análise da detecção pela LPA"),
    ("c22", "Treinamentos necessários previstos"),
    ("c23", "O Plano de Controle e toda a documentação foi revisada conforme IT-GQ-101"),
    ("c24", "Abertura de SAE's / PPAP necessárias"),
    ("c25", "Abrangências para processos e peças similares"),
    ("c26", "Fechar A3 e ações"),
    ("c27", "Aprovação A3 SGI"),
    ("c28", "Lançar ações do A3 na planilha de gestão"),
    ("c29", "Preencher análise de causa no site do cliente"),
    ("c30", "Fazer lições aprendidas"),
    ("c31", "Preencher lições aprendidas no site do cliente"),
    ("c32", "Fechar reclamação na central MRH"),
    ("c33", "Auditoria fechamento A3 GQ - in loco - reocorrência"),
]

ASSINATURAS_FECHAMENTO = [
    ("atendimento", "Atendimento ao Cliente MRHB"),
    ("gerente_qualidade", "Gerente da Qualidade"),
    ("sistema_qualidade", "Sistema da Qualidade"),
]

# Aba "Planilha de contenção".
LOCAIS_CONTENCAO = [
    "Estoque do cliente",
    "Trânsito",
    "Estoque logístico avançado",
    "Centro logístico",
    "Fornecedor",
    "Recebimento de fornecedores",
    "Célula de injeção",
    "Célula de usinagem",
    "Etapas secundárias",
    "Estoque injeção",
    "Estoque usinagem",
    "Sala qualidade",
    "Sala engenharia",
    "Bolsão engenharia",
    "Bolsão injeção",
    "Bolsão usinagem",
    "Inspeção final",
    "Posto CARE / CS1",
    "Área de retrabalho",
]

# Diagrama de Ishikawa (FRP - A3, campo 4) e "Check de Causa Raiz".
CATEGORIAS_6M = [
    ("material", "Material"),
    ("mao_obra", "Mão de Obra"),
    ("maquina", "Máquina"),
    ("medicao", "Medição"),
    ("metodo", "Método"),
    ("meio_ambiente", "Meio Ambiente"),
]

# 5 Porquês (FRP - A3, colunas da direita do campo 1).
PORQUES = [
    ("ocorrencia", "Por que aconteceu?"),
    ("deteccao", "Por que não detectou?"),
    ("previsao", "Por que não previu?"),
]

# --- Ações -----------------------------------------------------------------
# Todas as ações do A3 (contenção, corretivas, preventivas, retroalimentação
# e eficácia) vão para a mesma tabela (a3_acoes), separadas por "grupo". É
# isso que permite o Controle de Ações e o Dashboard enxergarem tudo junto.
# dias_sugeridos = prazo sugerido a partir da emissão do A3 (vem do próprio
# formulário: "ações corretivas (14 dias)", "preventivas (35 dias)").
GRUPOS_ACAO = [
    {"chave": "contencao", "rotulo": "Contenção", "secao": "3", "dias_sugeridos": 1,
     "subgrupos": ["3.1 Nacional", "3.2 Exportação"]},
    {"chave": "corretiva", "rotulo": "Corretiva", "secao": "5", "dias_sugeridos": 10,
     "subgrupos": ["Ocorrência", "Detecção", "Sistêmico"]},
    {"chave": "preventiva", "rotulo": "Preventiva", "secao": "5", "dias_sugeridos": 25,
     "subgrupos": ["Ocorrência", "Detecção", "Sistêmico"]},
    {"chave": "retroalimentacao", "rotulo": "Retroalimentação", "secao": "6", "dias_sugeridos": 25,
     "subgrupos": [
         "Poka Yoke",
         "PFMEA",
         "Trabalho Padronizado",
         "Plano de Controle",
         "SGI (procedimentos)",
         "Folha de programação",
         "Auxílio Visual Defeitos",
         "Plano Reação / Contig. / Emerg.",
         "Revalidação do NPR",
         "Layered Process Audit (LPA)",
     ]},
    {"chave": "eficacia", "rotulo": "Eficácia", "secao": "7", "dias_sugeridos": None,
     "subgrupos": [
         "Validação das ações implementadas",
         "Análise de eficácia",
         "Auditoria Quality Foccus - SGI",
         "Outra",
     ]},
    {"chave": "outra", "rotulo": "Outra", "secao": "", "dias_sugeridos": None, "subgrupos": []},
]
GRUPOS_POR_CHAVE = {g["chave"]: g for g in GRUPOS_ACAO}

# 3.1 Contenção Nacional: procedimento padrão, com as 6 ações FIXAS (o texto
# não é editável). Só os quadros em "campos" são preenchidos (nº do alerta,
# NF e QTD); eles ficam em dados.contencao.<chave> e entram no texto da ação.
# Rótulo vazio = o valor vai logo depois do texto ("... nº E-70232026").
LINHAS_FIXAS_CONTENCAO = [
    {"texto": "Segregar Estoque MRHB e Cliente", "campos": []},
    {"texto": "Elaborar Alerta da Qualidade nº", "campos": [{"chave": "alerta_numero", "rotulo": "", "nome": "nº do alerta"}]},
    {"texto": "Realizar contenção conforme alerta da Qualidade nº", "campos": [{"chave": "alerta_numero_contencao", "rotulo": "", "nome": "nº do alerta"}]},
    {"texto": "Treinar operação para garantir a contenção adequada", "campos": []},
    {"texto": "Enviar Ponto de corte para o cliente", "campos": [
        {"chave": "ponto_corte_nf", "rotulo": "NF:", "nome": "NF"},
        {"chave": "ponto_corte_qtd", "rotulo": "QTD:", "nome": "QTD"},
    ]},
    {"texto": "Implementar Estação de Verificação: GM1927: #22", "campos": []},
]

# Regra: uma ação fixa da 3.1 só pode ficar "Concluída" (G) com os quadros
# da linha preenchidos. O texto da ação guarda os valores ("... nº E-70232026",
# "... — NF: 200735 QTD: 58"), então dá para conferir só pela descrição.
def _normalizar(texto):
    return " ".join((texto or "").lower().split())


def campos_faltando_contencao(descricao):
    """Nomes dos quadros vazios da linha fixa da 3.1 correspondente à
    descrição (lista vazia se estiver tudo preenchido ou se não for linha fixa)."""
    desc = _normalizar(descricao)
    for linha in LINHAS_FIXAS_CONTENCAO:
        texto = _normalizar(linha["texto"])
        if not linha["campos"] or not desc.startswith(texto[:20]):
            continue
        faltando = []
        resto = desc[len(texto):] if desc.startswith(texto) else ""
        for campo in linha["campos"]:
            if campo["rotulo"]:
                m = re.search(rf"{re.escape(campo['rotulo'].lower())}\s*(\S+)", resto)
                if not m or m.group(1).endswith(":"):
                    faltando.append(campo["nome"])
            elif not resto.split("—")[0].strip():
                faltando.append(campo["nome"])
        return faltando
    return []


# Linhas já impressas no formulário em branco. Na folha digital aparecem como
# sugestão (texto cinza): basta preencher Resp. e Prazo para virar ação.
# "{id}" é trocado pelo ID MRHB do A3.
LINHAS_MODELO = {
    "contencao_exportacao": [
        "Levantamento de todos embarques em trânsito e atualização portal cliente considerando todas as nº NF",
        "Suporte contenção externa",
    ],
}

# 7 Análise de Eficácia: ações padrão FIXAS (texto editável só pelo lápis,
# por A3; fica em dados.eficacia.textos).
LINHAS_FIXAS_EFICACIA = [
    {"texto": "Validação das ações implementadas - Gestão Fast Response - GM1927: #23",
     "subgrupo": "Validação das ações implementadas", "campos": []},
    {"texto": "Análise de eficácia (vide aba anexo)", "subgrupo": "Análise de eficácia", "campos": []},
    {"texto": "Auditoria Quality Foccus - SGI - FM-GQ-076", "subgrupo": "Auditoria Quality Foccus - SGI", "campos": []},
]

# Rótulo de cada linha da seção 6 (Retroalimentação), como no formulário.
ROTULOS_RETROALIMENTACAO = {
    "Poka Yoke": "Poka Yoke - GM1927: #08",
    "PFMEA": "PFMEA - GM1927: #04",
    "Trabalho Padronizado": "Trabalho Padronizado - GM1927: #16",
    "Plano de Controle": "Plano de Controle - GM1927: #11",
    "SGI (procedimentos)": "SGI (procedimentos)",
    "Folha de programação": "Folha de programação",
    "Auxílio Visual Defeitos": "Auxílio Visual Defeitos: GM1927: #07",
    "Plano Reação / Contig. / Emerg.": "Plano Reação / Contig. / Emerg.",
    "Revalidação do NPR": "Revalidação do NPR",
    "Layered Process Audit (LPA)": "Layered Process Audit (LPA)",
}

STATUS_ACAO = ["Aberta", "Em andamento", "Concluída", "Cancelada"]
STATUS_ABERTOS = {"Aberta", "Em andamento"}

# "Concluído" é AUTOMÁTICO (regras.status_automatico_a3): todas as ações
# concluídas + "8D Aprovado" na Validação pelo Emissor. "Cancelado" é manual.
STATUS_A3 = ["Em andamento", "Concluído", "Cancelado"]
RESULTADOS_VALIDACAO = ["8D Aprovado", "8D A/Condicional", "8D Reprovado"]
STATUS_VALIDACAO = ["Pendente", "Eficaz", "Não eficaz"]

# Setores oficiais da empresa (são as regiões do mapa da Visão Geral).
SETORES_PADRAO = [
    "Fusão",
    "Injeção",
    "Usinagem",
    "Jateamento",
    "Ferramentaria",
    "Tamboreamento",
    "Logística",
    "Qualidade",
    "Engenharia",
    "Manutenção",
    "Compras",
]

# Nomes antigos/variações que pertencem a um setor oficial.
SETORES_EQUIVALENTES = {
    "us": "Usinagem",
    "in": "Injeção",
    "processo us": "Usinagem",
    "processo usinagem": "Usinagem",
    "producao us": "Usinagem",
    "producao usinagem": "Usinagem",
    "processo in": "Injeção",
    "processo injecao": "Injeção",
    "producao in": "Injeção",
    "producao injecao": "Injeção",
    "metrologia": "Qualidade",
}


def _chave_setor(texto):
    sem_acento = unicodedata.normalize("NFD", texto.casefold())
    return " ".join("".join(c for c in sem_acento if unicodedata.category(c) != "Mn").split())


def normalizar_setor(texto):
    """Devolve o nome oficial do setor ("metrologia" -> "Qualidade", "usinagem" ->
    "Usinagem"). Setor desconhecido volta como foi digitado."""
    texto = (texto or "").strip()
    if not texto:
        return texto
    chave = _chave_setor(texto)
    for setor in SETORES_PADRAO:
        if _chave_setor(setor) == chave:
            return setor
    return SETORES_EQUIVALENTES.get(chave, texto)

ANEXO_SECOES = {
    "ilustracao": "Ilustração",
    "ilustracao_fonte": "Ilustração (imagem original)",
    "evidencia_acao": "Evidência de ação",
    "evidencia_fonte": "Evidência de ação (imagem original)",
    "evidencia_pdf": "Evidência de ação (PDF original)",
    "evidencias": "Evidências",
    "caracterizacao": "Caracterização do problema",
    "contencao": "Contenção",
    "eficacia": "Análise da eficácia",
    "outros": "Outros",
}


def dados_vazios():
    """Conteúdo inicial (JSON) das seções do A3 que não viram colunas."""
    return {
        "checklist": {
            "itens": {chave: {"ok": False, "na": False, "obs": ""} for chave, _ in CHECKLIST},
            "observacoes": "",
            "assinaturas": {chave: {"nome": "", "data": ""} for chave, _ in ASSINATURAS_FECHAMENTO},
        },
        "descricao": {
            "analise_fenomeno": "",
            "descricao": "",
            "rastreabilidade_injecao": "",
            "rastreabilidade_usinagem": "",
            "objetivo": "",
        },
        "equipe": [],
        "contencao": {
            "locais": {
                local: {"suspeitas": "", "aprovadas": "", "reprovadas": "", "re_executor": ""}
                for local in LOCAIS_CONTENCAO
            },
            "outros": [],
            "exportacao_aplicavel": False,  # 3.2 Exportação: desmarcado = "Não se aplica"
            "na": {},  # 3.1: linhas fixas marcadas como "Não aplicável" ({texto da linha: True})
            "textos": {},  # 3.1: texto padrão alterado neste A3 ({texto padrão: texto novo})
            "alerta_numero": "",
            "alerta_numero_contencao": "",
            "ponto_corte_nf": "",
            "ponto_corte_qtd": "",
            "estacao_verificacao": "",
        },
        "caracterizacao": {"texto": ""},
        "porques": {
            chave: {"respostas": ["", "", "", "", ""], "causa_raiz": ""} for chave, _ in PORQUES
        },
        "ishikawa": {chave: "" for chave, _ in CATEGORIAS_6M},
        "check_causa": {chave: [] for chave, _ in CATEGORIAS_6M},
        "abrangencia": {"texto": ""},
        # Quadro "Ilustração": cena editável (imagens, setas, círculos, textos) e
        # o anexo com a imagem final mostrada na folha.
        "ilustracao": {"cena": [], "anexo_id": None},
        # Evidência de cada ação: {id da ação: {"cena": [...], "anexo_id": id da imagem final}}
        "evidencias": {},
        # Dia em que Causa Raiz / Lições Aprendidas foram preenchidas (etapas do 8D).
        "etapas_datas": {},
        # Escolha de quais evidências imprimir ({id da ação: True/False}).
        # Sem escolha: imprime se a ação tiver evidência.
        "imprimir_evidencias": {},
        # 6 Retroalimentação: documentos marcados como "Não aplicável" ({subtipo: True}).
        "retroalimentacao_na": {},
        "eficacia": {"texto": "", "externo": [], "interno": [], "textos": {}},
        "validacao": {"auditor": "", "data_final": "", "itens": [], "status_final": "", "aprovacoes": ""},
        "fechamento": {"licoes_aprendidas": ""},
    }


def mesclar_com_padrao(dados):
    """Completa um JSON salvo com campos que surgiram em versões novas do
    formulário, sem perder nada do que já foi preenchido."""
    def mesclar(padrao, salvo):
        if isinstance(padrao, dict) and isinstance(salvo, dict):
            resultado = dict(salvo)
            for chave, valor in padrao.items():
                resultado[chave] = mesclar(valor, salvo[chave]) if chave in salvo else copy.deepcopy(valor)
            return resultado
        return salvo

    return mesclar(dados_vazios(), dados or {})


def modelo_para_frontend():
    """Tudo que as telas precisam saber sobre o formulário, num JSON só."""
    return {
        "temas": TEMAS,
        "turnos": TURNOS,
        "checklist": CHECKLIST,
        "assinaturas": ASSINATURAS_FECHAMENTO,
        "locais_contencao": LOCAIS_CONTENCAO,
        "categorias_6m": CATEGORIAS_6M,
        "porques": PORQUES,
        "grupos_acao": GRUPOS_ACAO,
        "linhas_modelo": LINHAS_MODELO,
        "linhas_fixas_contencao": LINHAS_FIXAS_CONTENCAO,
        "linhas_fixas_eficacia": LINHAS_FIXAS_EFICACIA,
        "rotulos_retroalimentacao": ROTULOS_RETROALIMENTACAO,
        "status_acao": STATUS_ACAO,
        "status_a3": STATUS_A3,
        "resultados_validacao": RESULTADOS_VALIDACAO,
        "status_validacao": STATUS_VALIDACAO,
        "anexo_secoes": ANEXO_SECOES,
        "dias_prazo_limite": DIAS_PRAZO_LIMITE_A3,
    }
