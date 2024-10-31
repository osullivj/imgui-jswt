pushd \osullivj\bld\emsdk
call emsdk install latest
call emsdk activate latest
popd
:: https://emscripten.org/docs/getting_started/FAQ.html
:: It can be useful to compile with EMCC_DEBUG=1 set for the environment
:: (EMCC_DEBUG=1 emcc ... on Linux, set EMCC_DEBUG=1 on Windows).
:: This splits up the compilation steps and saves them in /tmp/emscripten_temp.
:: You can then see at what stage the code vanishes (you will need to do llvm-dis
:: on the bitcode stages to read them, or llvm-nm, etc.).
:: NB 1 did not work. The %TEMP%\emscripten_temp dir was not
:: deleted, but contents were. 2 fixed that...
set EMCC_DEBUG=2
:: WASM bin tools, gnu mkdir and cd
set PATH=C:\osullivj\bld\wabt\bin;c:\osullivj\bin;%PATH%