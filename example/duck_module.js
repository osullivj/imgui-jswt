// hduck: DuckDB handler thread implementation
// Main browser thread: running imgui
// DB thread: DuckDB wasm engine thread
// This thread
//   Submit queries to DDBW
//   Pre process query results
//   Fetch Parquet and load into DDBW

// Some worker scope vars...
let duck_db = null;
let duck_conn = null;

// This JS impl was in index.html: by doing it here we avoid having to pass the
// DB handle across threads. NB this module must be pulled in to index.html
// like so...
// <script type="module" src="./duck_module.js" defer></script>

// This import was "import * as duck" so we could scope the duck names.
// However, it looks like the duck shell stuff needs these names to be
// at the top level so that the no
import * as duck from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@latest/+esm";
import * as shell from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm-shell@latest/+esm";
// Cannot import wasm; we have to fetch
const shell_wasm = await fetch("https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm-shell/dist/shell_bg.wasm");

const JSDELIVR_BUNDLES = duck.getJsDelivrBundles();
const bundle = await duck.selectBundle(JSDELIVR_BUNDLES);
// creates storage and an address for the DB engine worker thread
const db_worker_url = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], {type: "text/javascript",}));
const db_worker = new Worker(db_worker_url);
const logger = new duck.ConsoleLogger();
duck_db = new duck.AsyncDuckDB(logger, db_worker);
// loads the web assembly module into memory and configures it
await duck_db.instantiate(bundle.mainModule, bundle.pthreadWorker);
// revoke the object url now no longer needed
URL.revokeObjectURL(db_worker_url);
console.log("duck_module.js: DuckDB instantiated ", db_worker_url);
// main.ts uses __nodom__
window.__nodom__ = {duck_module:self};

// is there a nodom_duck_shell container element in our HTML?
if (window.nodom_duck_shell) {
    while (window.nodom_duck_shell.firstChild) {
        window.nodom_duck_shell.removeChild(window.nodom_duck_shell.firstChild);
    }   
    await shell.embed({
        shellModule: shell_wasm.arrayBuffer(),
        container: window.nodom_duck_shell,
        resolveDatabase: async () => {return duck_db;}
    });
    console.log("duck_module.js: DuckDB wasm shell embedded");
}


async function exec_duck_db_query(sql) {
    if (!duck_db) {
        console.error("duck_module:DuckDB-Wasm not initialized");
        return;
    }
    if (!duck_conn) {
        console.log("duck_module:reconnecting...");
        duck_conn = await duck_db.connect();
    }
    const arrow_table = await duck_conn.query(sql);
    return arrow_table;
}

async function load_parquet(url) {
    if (!duck_db) {
        console.error("duck_module:DuckDB-Wasm not initialized");
        return;
    }
    if (!duck_conn) {
        console.log("duck_module:reconnecting...");
        duck_conn = await duck_db.connect();
    }
    const arrow_table = await duck_conn.query(sql);
    return arrow_table;
}

self.onmessage = async (event) => {
    let arrow_table = null;
    const nd_db_request = event.data;
    switch (nd_db_request.nd_type) {
        case "ParquetScan":
            arrow_table = await exec_duck_db_query(nd_db_request.sql);
            postMessage({nd_type:"ParquetScanResult", arrow_table:arrow_table});
            break;
        case "Query":
            arrow_table = await exec_duck_db_query(nd_db_request.sql);
            const cols = arrow_table.schema.fields.map((field) => field.name);
            console.log("duck_module cols:", cols);
            const rows = arrow_table.toArray();
            console.log("duck_module rows:", rows);
            // postMessage({rtype:"query_result", schema:cols, row_count:arrow_table.numRows, query:nd_db_request.payload});
            postMessage({nd_type:"QueryResult", arrow_table:arrow_table});
            break;
        case "QueryResult":
        case "ParquetScanResult":
            // we do not process our own results!
            break;
        default:
            console.error("duck_module.onmessage: unexpected request: ", event);
    }
};