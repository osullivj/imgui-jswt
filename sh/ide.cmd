@echo off
:: pick up python312.dll at debug bin runtime
:: also pick up pyarrow DLLs
set PATH=C:\osullivj\bin\py3.12.3x64;c:\osullivj\src\h3gui\venv\lib\site-packages\pyarrow;%PATH%
:: IDE env vars
"C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
:: user: "start devenv"
