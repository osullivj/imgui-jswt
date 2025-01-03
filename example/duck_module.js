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

// This was in index.html: by doing it here we avoid having to pass the
// DB handle across threads. NB this module must be pulled in to index.html
// like so...
// <script type="module" src="./duck_module.js" defer></script>
import * as duck from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@latest/+esm";
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
window.__nodom__ = {duck_module:self};

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
    const nd_db_request = event.data;
    switch (nd_db_request.rtype) {
        case "load_parquet":
            break;
        case "query":
            let arrow_table = await exec_duck_db_query(nd_db_request.payload);
            const cols = arrow_table.schema.fields.map((field) => field.name);
            console.log("duck_module cols:", cols);
            const rows = arrow_table.toArray();
            console.log("duck_module rows:", rows);
            // postMessage({rtype:"query_result", schema:cols, row_count:arrow_table.numRows, query:nd_db_request.payload});
            postMessage({rtype:"query_result", payload:arrow_table});
            break;
        case "query_result":
            // we do not process our own results!
            break;
        default:
            console.error("duck_module.onmessage: unexpected DB request type: ", nd_db_request.rtype);
    }
};