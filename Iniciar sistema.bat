@echo off
title Sistema 8D - servidor de teste
cd /d "%~dp0"
echo.
echo  Iniciando o sistema 8D (teste)...
echo  Endereco: http://localhost:5001
echo  Deixe esta janela ABERTA enquanto usar o sistema. Fechar a janela desliga o sistema.
echo.
start "" "http://localhost:5001"
python app_teste.py
echo.
echo  O servidor parou. Se apareceu algum erro acima, envie para o suporte.
pause
