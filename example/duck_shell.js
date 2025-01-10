// duck_shell: proto duckdb-shell-wasm loader
// Why separate from duck_handler.js?DuckDB handler thread implementation
// Because the shell impl seems to assume bootstrap and possibly React
// Both MS and non MS React TS flavours. Given a div elem as a parent
// it creates this (2025-01-10)...
//      <div dir="ltr" class="terminal xterm">
//          <div class="xterm-viewport" style="background-color: rgb(51, 51, 51);">
//              <div class="xterm-scroll-area" style="height: 1900px;"></div>
//          </div>
//          <div class="xterm-screen" style="width: 1248px; height: 1900px;"><div class="xterm-helpers">
//              <textarea class="xterm-helper-textarea" aria-label="Terminal input" aria-multiline="false" autocorrect="off" autocapitalize="off" spellcheck="false" tabindex="0" style="left: 64px; top: 133px; width: 8px; height: 19px; line-height: 19px; z-index: -5;"></textarea>
//              <span class="xterm-char-measure-element" aria-hidden="true" style="white-space: pre; font-kerning: none; font-family: &quot;Roboto Mono&quot;; font-size: 14px;">WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW</span>
//              <div class="composition-view"></div>
//          </div>
//          <div class="xterm-decoration-container"></div>
//          <canvas class="xterm-link-layer" width="1248" height="1900" style="z-index: 2; width: 1248px; height: 1900px;"></canvas>
//          <canvas width="1248" height="1900" style="width: 1248px; height: 1900px;"></canvas>
//      </div>
// Getting layout to work with two shell canvases and xterm non canvas stuff
// proved impossible, so I tried isolating the shell in an iframe, which necessitates
// a separate JS module. Even then the canvas does not align with the xterm divs as
// it does on an SPA.
// 
// Ergo decision is to log DB ops and make them available for replay inside
// a standalone shell for diagnostics. There will also be a small SQL window
// in NoDOM so results from standalone shell troubleshooting can be checked
// in a live app.

// This import was "import * as duck" so we could scope the duck names.
// However, it looks like the duck shell stuff needs these names to be
// at the top level 
import * as duck from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@latest/+esm";
import * as shell from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm-shell@latest/+esm";
// Cannot import wasm; we have to fetch
const shell_wasm = await fetch("https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm-shell/dist/shell_bg.wasm");

// NB console.log does not work in an iframe
async function load_shell() {
    // is there a nodom_duck_shell container element in our parent HTML?
    if (window.nodom_ds_div) {
        while (window.nodom_ds_div.firstChild) {
            window.nodom_ds_div.removeChild(window.nodom_ds_div.firstChild);
        }   
        await shell.embed({
            shellModule: shell_wasm.arrayBuffer(),
            container: window.nodom_ds_div,
            resolveDatabase: async () => {return window.parent.__nodom__.duck_db;}
        });
        window.nodom_ds_div.firstChild.id = "nodom_duck_shell_canvas";
    }
}


self.onmessage = async (event) => {
    let arrow_table = null;
    const nd_db_request = event.data;
    switch (nd_db_request.nd_type) {
        case "DuckInstance":
            await load_shell();
            break;
        case "ParquetScan":
        case "Query":
        case "QueryResult":
        case "ParquetScanResult":
            // we do not process our own results!
            break;
        default:
            console.error("duck_shell.onmessage: unexpected request: ", event);
    }
};