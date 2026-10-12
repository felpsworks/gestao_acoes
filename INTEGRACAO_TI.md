# Integração do módulo "Gestão de Ações 8D" no Gerenciador PDCA

Guia para o TI incluir este módulo no sistema **Sistema-PDCA-8D** (Flask +
SQLite) que já está em uso. O módulo é um **Blueprint Flask independente**
(pasta `acoes8d/`) e roda no mesmo servidor e no mesmo banco (`data/app.db`)
do Gerenciador.

**Resultado da integração:**

- Item **"8D"** no menu do Gerenciador (Visão Geral, Formulário A3, Gestão de Ações, Cadastro),
  **no lugar da aba "Etapas 8D"**.
- **Etapas do 8D automáticas:** o sistema reconhece pelo Formulário A3 em que
  etapa cada reclamação está e grava na tabela `etapas_8d` do Gerenciador. O
  Dashboard do Gerenciador (8D fechados/atrasados, gargalo por etapa) continua
  funcionando, agora alimentado pelo A3. Ver a seção 3.1.
- **Toda reclamação nova**, de qualquer tipo (Formal, Informal, Informativo,
  Alerta, Disputa, Logística…), **ganha automaticamente o seu A3**, já preenchido
  com os dados da reclamação.
- Botão **"A3"** em cada linha do Gerenciador, que abre o A3 daquela reclamação.
- Depois de cadastrar uma reclamação, a mensagem de sucesso traz o link
  **"Abrir o A3 desta reclamação"**.
- O identificador passa a se chamar **"ID Wetzel"** em todas as telas (no banco
  continua `id_mrhb`).
- Identidade visual Wetzel (vermelho/branco/preto) e indicador **"Online"**
  (bolinha verde) no canto superior direito de todas as páginas.

> A integração foi testada numa cópia do Gerenciador: script aplicado duas
> vezes (sem duplicar nada), telas antigas e novas funcionando, reclamações
> Formal, Informativo e Alerta cadastradas, cada uma com o seu A3 criado
> automaticamente.

---

## 0. Roteiro de implantação (passo a passo)

| # | Quem | O quê |
|---|---|---|
| 1 | TI | Escolher um horário sem uso do Gerenciador e **parar o servidor**. |
| 2 | TI | **Copiar o banco** `Sistema-PDCA-8D/data/app.db` para um lugar seguro (o script faz backup dos arquivos de código, não do banco). |
| 3 | TI | Copiar a pasta **"Gestão de Ações 8D"** para o servidor (ou acessá-la pela rede). |
| 4 | TI | Instalar as dependências novas no mesmo Python do Gerenciador: `pip install pymupdf openpyxl` (PDF das evidências e botão "Importar A3 (Excel)"). |
| 5 | TI | **Conferir antes** (não altera nada): `python integrar_no_gerenciador.py "C:\caminho\Sistema-PDCA-8D" --verificar`. Se aparecer algum "!", ver a seção 0.2. |
| 5b | TI | Aplicar: o mesmo comando **sem** `--verificar` (seção 1). |
| 6 | TI | Iniciar o Gerenciador normalmente (`python app.py`). Na primeira execução o módulo cria as tabelas `a3_*` e sincroniza as etapas. |
| 7 | TI + Qualidade | **Teste de aceite** (seção 0.1). |
| 8 | Qualidade | Conferir o **Cadastro** (aba 8D → Cadastro): cada pessoa com o seu **setor**, nomes sem duplicidade (ex.: "Carlos Larson" × "Carlos Larsson"). O setor das ações vem daqui. |
| 9 | Qualidade | (Opcional) Importar os A3 antigos em Excel (seção 4). |
| 10 | Qualidade | Avisar os usuários: o menu "Etapas 8D" virou **"8D"**; toda reclamação nova já nasce com o A3. |

**Dados do ambiente de teste NÃO vão para o Gerenciador.** O script copia só o
código (pasta `acoes8d/`) e o `importar_a3_excel.py`. A pasta `data/` desta
entrega (banco de teste `acoes8d.db` e anexos de teste) **não é copiada**. No
Gerenciador, as tabelas `a3_*` nascem vazias dentro do `data/app.db` dele, e os
anexos passam a ficar em `Sistema-PDCA-8D/data/acoes8d_anexos/`.

**Se algo der errado:** parar o servidor, devolver os arquivos da pasta de
backup (e, se preciso, o `app.db` copiado no passo 2) e iniciar de novo.

### 0.1 Teste de aceite (5 minutos)

1. Abrir o Gerenciador: menu com **"8D"**, cores Wetzel, **"Online"** verde no canto.
2. **Nova Reclamação** (tipo Formal, de teste) → a mensagem traz **"Abrir o A3 desta reclamação"**.
3. Abrir o A3: ID Wetzel, cliente, PN, defeito, área e responsável já preenchidos.
4. Lançar uma ação na seção 3.1 → ela aparece em **8D → Gestão de Ações** e na **Visão Geral**.
5. Na **Visão Geral**, conferir os cards, os gráficos e o velocímetro "Média fechamento A3".
6. No Gerenciador, a reclamação de teste mostra o botão **"A3"** e as etapas do 8D começam a ser preenchidas.
7. Excluir a reclamação e o A3 de teste.

### 0.2 O Gerenciador em produção tem melhorias? (versão diferente da analisada)

Não tem problema. O módulo é uma pasta separada (`acoes8d/`) e o script só
encosta em poucos pontos do Gerenciador (seção 2). Para garantir:

1. Rodar primeiro com `--verificar`. O script confere **todos** os pontos de
   alteração e o **banco** (tabelas `reclamacoes` e `etapas_8d` e as colunas que o
   módulo usa) e mostra um relatório. **Nada é alterado.**
2. Se tudo vier com "+" ou "=", aplicar.
3. Se algum ponto vier com **"!"**, o script **não altera nenhum arquivo** (tudo ou
   nada). Fazer só aquele ponto à mão (seção 2) e rodar de novo, ou enviar os
   arquivos indicados para revisão.

O script já tolera diferenças comuns: chave secreta diferente em `app.py`,
espaços/formatação diferentes no `return` do cadastro, itens extras no menu e o
link "Etapas 8D" com outro texto.

## 1. Integração automática (recomendado)

Com o servidor do Gerenciador **parado**, rodar a partir desta pasta:

```bash
python integrar_no_gerenciador.py "C:\caminho\Sistema-PDCA-8D"
```

O script:

1. Faz **backup** dos arquivos que altera, em `Sistema-PDCA-8D/backup_antes_acoes8d_<data>/`.
2. Copia o pacote `acoes8d/` e o `importar_a3_excel.py` para o Gerenciador.
3. Aplica as alterações da seção 2 (abaixo).

Pode ser rodado de novo sem problema: o que já foi feito é pulado. Se algum
arquivo do Gerenciador tiver mudado e o ponto de alteração não for
encontrado, o script para e avisa. Nesse caso, faça a alteração manual da seção 2.

Depois, iniciar o Gerenciador normalmente (`python app.py`). As tabelas do
módulo (`a3_*`) são criadas sozinhas no `data/app.db` na primeira execução.

**Para desfazer:** copiar de volta os arquivos da pasta de backup e apagar a
pasta `acoes8d/` do Gerenciador. As tabelas `a3_*` podem ficar no banco, pois
não interferem no Gerenciador.

## 2. Alterações no Gerenciador (o que o script faz)

Se preferir fazer à mão, são os pontos a seguir (a até f, mais o indicador "Online" do item c).

**a) `app.py`: registrar o módulo**, logo depois de `app.secret_key = ...`:

```python
import acoes8d  # Gestão de Ações 8D: A3 digital, Controle de Ações e Dashboard
acoes8d.init_app(app)
```

**b) `app.py`: criar o A3 ao cadastrar a reclamação.** Em `api_criar_reclamacao()`,
trocar o `return` final por:

```python
    # Gestão de Ações 8D: toda reclamação nova (qualquer tipo) já ganha o seu A3.
    analise_a3_id = acoes8d.criar_a3_automatico(id_mrhb)

    return jsonify({"ok": True, "id_mrhb": id_mrhb, "analise_a3_id": analise_a3_id}), 201
```

`criar_a3_automatico` **nunca levanta exceção**. Se algo der errado, só
registra no log, e o cadastro da reclamação não é afetado.

**c) `templates/base.html`: menu.** Trocar o link "Etapas 8D" por:

```html
<a href="{{ url_for('acoes8d.dashboard') }}" class="{{ 'active' if active == 'acoes8d' else '' }}">8D</a>
```

Também em `templates/base.html`, depois do `style.css`, incluir o tema Wetzel:

```html
<link rel="stylesheet" href="{{ url_for('acoes8d.static', filename='tema_wetzel.css') }}" />
```

Ainda em `templates/base.html`, o indicador "Online" (bolinha verde piscando,
confere o servidor a cada 15 s em `/acoes8d/api/ping`): logo depois de `</nav>`:

```html
<div class="a8-online" data-ping="{{ url_for('acoes8d.api_ping') }}" title="Sistema no ar" role="status" aria-live="polite">
  <span class="a8-online-bolinha" aria-hidden="true"></span><span class="a8-online-texto">Online</span>
</div>
```

e, depois de `{% block scripts %}{% endblock %}`:

```html
<script src="{{ url_for('acoes8d.static', filename='status_online.js') }}"></script>
```

**c2) `app.py`: endereço antigo da aba Etapas 8D.** Em `etapas_8d_page()`,
trocar o `return render_template("etapas_8d.html", ...)` por:

```python
    return redirect(url_for("acoes8d.analises"))
```

**d) `static/historico.js`: botão "A3" na lista.** Na célula de ações
(`acoes-celula`), antes do botão Editar:

```html
<a class="btn-editar" href="/acoes8d/a3/${encodeURIComponent(r.id_mrhb)}" title="Abrir o A3 desta reclamação">A3</a>
```

**e) `static/app.js`: link após cadastrar.** Logo depois de
`mostrarAlerta("Reclamação cadastrada com sucesso! ...")`:

```js
if (resposta.analise_a3_id) {
  const linkA3 = document.createElement("a");
  linkA3.href = `/acoes8d/analises/${resposta.analise_a3_id}`;
  linkA3.textContent = "Abrir o A3 desta reclamação →";
  alertBox.appendChild(linkA3);
}
```

**f) Rótulo "ID MRHB" → "ID Wetzel".** O identificador da reclamação passa a
ser chamado de **ID Wetzel** em todas as telas. Só muda o texto exibido: a
coluna `id_mrhb` do banco, as rotas e as APIs continuam iguais. Trocar o texto
`ID MRHB` por `ID Wetzel` em:

| Arquivo | Onde aparece |
|---|---|
| `app.py` | `CAMPOS_ROTULOS["id_mrhb"]` e duas mensagens de erro do cadastro |
| `static/app.js` | mensagem "Reclamação cadastrada com sucesso! ID …" |
| `static/dashboard.js`, `static/historico.js`, `static/etapas_8d.js` | rótulo da coluna `id_mrhb` |
| `templates/historico.html` | rótulo do campo no formulário de edição |
| `templates/historico_alteracoes.html` | placeholder da busca e cabeçalho da tabela |

"PN MRHB" (número da peça) **não** muda.

**Dependências novas:** `pymupdf` (converte em imagem as páginas das evidências
enviadas em PDF) e `openpyxl` (lê os A3 em Excel no botão **"Importar A3
(Excel)"** do Formulário A3 e no script da seção 4).

```bash
pip install pymupdf openpyxl
```

Sem elas, todo o resto funciona normalmente: só o envio de evidência em PDF e a
importação de Excel avisam que a biblioteca não está instalada.

## 3. Como o A3 automático funciona

- **Quando:** no instante em que a reclamação é cadastrada (alteração 2b).
  Como **rede de segurança**, ao abrir qualquer tela do módulo (no máximo a
  cada 30 s), toda reclamação **nova** que ainda não tenha A3 ganha o seu.
  Isso cobre, por exemplo, reclamações gravadas por outro caminho.
- **Reclamações antigas:** as cadastradas **antes** da integração não ganham
  A3 automático, para não criar centenas de A3 vazios. O marco é a data/hora
  da primeira execução do módulo, gravada em `a3_config`. Para uma dessas,
  o botão "A3" abre a tela de criação já preenchida.
- **O A3 já nasce com:**
  - nº da notificação, cliente, PN MRHB, PN do cliente e quantidade;
  - área (Área Responsável 8D);
  - máquina (MQ US / MQ IN);
  - responsável (Responsável Cliente);
  - definição do problema (Descrição do Defeito);
  - emissão (data de abertura) e prazo limite (emissão + 31 dias);
  - tema "Resposta Rapida".

  O item do Check List **"Abrir A3 no gerenciador"** já vem marcado como OK, e
  a criação fica registrada no histórico do A3.
- **Um A3 por reclamação:** o ID Wetzel (`id_mrhb`) é `UNIQUE` em `a3_analises`. Chamadas
  repetidas devolvem o A3 que já existe.
- **Edição e exclusão no Gerenciador:** editar a reclamação não altera o A3
  (o A3 tem os próprios campos, editáveis na folha). Excluir a reclamação não
  apaga o A3. Ele continua acessível e pode ser excluído no Formulário A3, com motivo.
- **Escrita no Gerenciador:** o módulo **nunca escreve** em `reclamacoes`. A
  única tabela do Gerenciador em que ele grava é `etapas_8d` (seção 3.1).
- **Leitura do Gerenciador:** `reclamacoes` (dados para o A3, tipos, analistas
  do campo "Responsável", descrição do defeito) e `etapas_8d` (histórico de 8D
  fechados usado no velocímetro "Média fechamento A3": tipos Formal, Informal e
  Logística, meta de 30 dias corridos).
- **Atalho:** `GET /acoes8d/a3/<ID Wetzel>` abre o A3 do ID, ou a criação já
  preenchida se ele ainda não tiver.

### 3.1 Etapas do 8D reconhecidas pelo Formulário A3

A aba "Etapas 8D" deixa de existir. A cada alteração no A3 (ações, campos,
status), o módulo calcula as 11 etapas e grava `realizacao` e `aplicavel` em
`etapas_8d`. Os prazos continuam sendo os do Gerenciador.

| Etapa | Realizada quando, no A3… | Data de realização |
|---|---|---|
| Contenção | todas as ações da 3.1 (e da 3.2, se aplicável) estão concluídas (G) | conclusão da última ação |
| Causa Raiz | a "Causa Raiz" (por que aconteceu) dos 5 Porquês está preenchida | dia em que foi preenchida |
| Ação Corretiva | todas as ações corretivas da seção 5 estão G | conclusão da última ação |
| Poka Yoke, LPA, Trab. Padronizado, FMEA, Plano de Controle | a linha da seção 6 tem ação e ela está G. Sem ação ou marcada N/A = **não aplicável** | conclusão da última ação |
| Validação | **qualquer** linha da seção 7 (Análise de Eficácia) está G | primeira conclusão |
| Lições Aprendidas | o campo da seção 8 está preenchido | dia em que foi preenchido |
| 8D Fechado | o A3 está Concluído (todas as ações G, todas as etapas acima realizadas, exceto as não aplicáveis, + "8D Aprovado") | conclusão da última ação |

**Trava de fechamento:** "8D Aprovado" (seção 8) só pode ser marcado depois que todas
as etapas anteriores aplicáveis estiverem realizadas. A tela mostra o que falta e o
servidor recusa a aprovação (`PUT /acoes8d/api/analises/<id>` devolve `aviso`).

- **Reclamações sem A3** (anteriores à integração) não são tocadas: ficam com
  as etapas como estão.
- **Só Formal e Informal** contam nas métricas de 8D, como já era no Gerenciador.
- **Ao iniciar o servidor**, as etapas de todos os A3 são sincronizadas de novo.
- **Para desligar:** `ACOES8D_SINCRONIZAR_ETAPAS = False`.

### 3.2 Setores oficiais (mapa da Visão Geral)

Os setores oficiais ficam em `SETORES_PADRAO` (`acoes8d/modelo_a3.py`): Fusão,
Injeção, Usinagem, Jateamento, Ferramentaria, Tamboreamento, Logística,
Qualidade, Engenharia, Manutenção e Compras. Cada um é uma região do mapa da
Visão Geral. Nomes antigos são convertidos automaticamente (ao iniciar o
servidor e a cada gravação) conforme `SETORES_EQUIVALENTES`: Processo/Produção
US → Usinagem, Processo/Produção IN → Injeção, Metrologia → Qualidade.

### Configurações (opcionais, em `app.config`)

| Chave | Padrão | Para que serve |
|---|---|---|
| `ACOES8D_A3_AUTOMATICO` | `True` | `False` desliga a criação automática |
| `ACOES8D_A3_AUTOMATICO_DESDE` | 1ª execução do módulo | `"AAAA-MM-DD"`: reclamações cadastradas a partir dessa data ganham A3 automático |
| `ACOES8D_SINCRONIZAR_ETAPAS` | `True` | Grava as etapas do 8D (calculadas pelo A3) na tabela `etapas_8d` do Gerenciador |
| `ACOES8D_DB` | `<app>/data/app.db` | Banco das tabelas `a3_*` |
| `ACOES8D_GERENCIADOR_DB` | igual a `ACOES8D_DB` | Banco da tabela `reclamacoes` (só leitura) |
| `ACOES8D_UPLOADS` | `<app>/data/acoes8d_anexos` | Pasta dos anexos e imagens da Ilustração |
| `MAX_CONTENT_LENGTH` | 25 MB (definido pelo módulo se o Gerenciador não definir) | Limite por upload |

**Backup:** além do `data/app.db`, incluir a pasta `data/acoes8d_anexos/` na rotina de backup.

## 4. Importar os A3 antigos (planilhas Excel FM-QS-025)

**Pelo próprio sistema (recomendado):** aba **8D → Formulário A3 → "Importar A3
(Excel)"**. Dá para escolher vários arquivos de uma vez; ao final aparece uma
tabela com o resultado de cada arquivo (importado / já existia / erro) e o link
para abrir cada A3 criado. As regras são as mesmas do script abaixo.

**Pelo script (vários arquivos/pastas de uma vez, feito pelo TI):**

Script `importar_a3_excel.py`, na raiz deste projeto. Copiar o script junto
com a pasta `acoes8d/` e rodar a partir da raiz do Gerenciador:

```bash
pip install openpyxl
python importar_a3_excel.py "C:\pasta\com\os\A3" --db data/app.db
```

- Aceita um arquivo `.xlsx` ou uma pasta inteira.
- A planilha precisa estar fechada no Excel.
- Um A3 cujo ID Wetzel já existe no sistema é **ignorado**, nunca sobrescrito.
  Por isso o script pode ser rodado mais de uma vez sem duplicar nada.
- Status das ações:
  - **G** → Concluída. A data de conclusão fica igual ao prazo, porque a planilha não tem a data real.
  - **Y/R** → Em andamento.
  - **Vazio** → Aberta.

## 5. Estrutura do código

```
acoes8d/
  __init__.py      Blueprint + init_app(app) + criar_a3_automatico(id_mrhb)
  servicos.py      Criação do A3 a partir da reclamação (manual, automática e sincronização)
  db.py            Schema das tabelas a3_* e leitura (somente leitura) da tabela reclamacoes
  modelo_a3.py     O formulário FM-QS-025 em forma de dados: check list, locais de contenção,
                   6M, tipos de ação, temas, prazos. Nova revisão do formulário -> editar aqui.
  regras.py        Regras de negócio: situação/farol das ações, dias em aberto, atraso, dashboard
  rotas.py         Páginas e API JSON (/acoes8d/...)
  templates/acoes8d/  HTML (Jinja2), herda o base.html do Gerenciador
  static/          CSS (prefixo a8-) e JavaScript puro, sem bibliotecas externas
```

### Tabelas

| Tabela | Conteúdo |
|---|---|
| `a3_analises` | Um A3 por ID Wetzel (`id_mrhb`, `UNIQUE`): colunas do cabeçalho e `dados`, um JSON com as demais seções do formulário (check list, 5 porquês, Ishikawa, contenção, eficácia, validação, fechamento) |
| `a3_acoes` | Todas as ações (contenção, corretivas, preventivas, retroalimentação, eficácia), com responsável, setor, abertura, prazo, prazo original, status, conclusão |
| `a3_pessoas` | Cadastro de pessoas e setores (sugestões ao atribuir ações) |
| `a3_anexos` | Metadados dos arquivos enviados. O arquivo fica em `ACOES8D_UPLOADS` com nome aleatório |
| `a3_config` | Configurações internas (ex.: `automatico_desde`, o marco do A3 automático) |
| `a3_historico` | Auditoria: criação/edição/exclusão de A3 e ações, reprogramações de prazo (com motivo), anexos |

### Regras de negócio

- **Situação da ação** é calculada, não fica gravada no banco:
  - Concluída → farol **G**
  - Aberta com prazo vencido → **Atrasada (R)**
  - Aberta no prazo → **Y**
  - Cancelada → fica fora das métricas
- **Dias em aberto:** da data de abertura até hoje, ou até a conclusão.
- **Prazo limite do A3:** emissão + 31 dias (FM-QS-025 rev. 05).
- **Prazos sugeridos ao lançar uma ação:**
  - Contenção: emissão + 1 dia
  - Corretiva: emissão + 14 dias
  - Preventiva e retroalimentação: emissão + 35 dias
- **Reprogramar prazo exige motivo.** O prazo original fica guardado e a mudança vai para o histórico.
- **Excluir A3 ou ação exige motivo.** O motivo vai para o histórico.
- **Salvamento automático:** a folha A3 salva sozinha cerca de 1,2 s depois de cada alteração. No histórico, as edições do mesmo campo feitas em até 15 minutos ficam numa linha só, para não gerar uma linha a cada tecla.

## 6. Pontos de atenção para produção

São os mesmos já citados no README do Gerenciador:

- Rodar com `debug=False` atrás de um servidor WSGI (ex.: `waitress`).
- Não há login no sistema. Qualquer pessoa na rede pode editar. As exclusões
  pedem motivo e ficam registradas em `a3_historico`.
- Os anexos aceitam só imagens, PDF, Office, CSV e TXT. Executáveis são recusados.
