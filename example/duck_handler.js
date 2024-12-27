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
// <script type="module" src="./duck_handler.js" defer></script>
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
console.log("duck_handler.js: DuckDB instantiated ", db_worker_url);
window.__nodom__ = {duck_handler:self};

async function exec_duck_db_query(sql) {
    if (!duck_db) {
        console.error("duck_handler:DuckDB-Wasm not initialized");
        return;
    }
    if (!duck_conn) {
        console.log("duck_handler:reconnecting...");
        duck_conn = await duck_db.connect();
    }
    const arrow_table = await duck_conn.query(sql);
    return arrow_table;
}

self.onmessage = async (event) => {
    const msg = event.data;
    // when msg is a string will either be the duck_db handle, 
    // or a SQL query
    if (typeof msg == "string") {
        let arrow_table = await exec_duck_db_query(msg);
        const cols = arrow_table.schema.fields.map((field) => field.name);
        console.log("duck_handler cols:", cols);
        const rows = arrow_table.toArray();
        console.log("duck_handler rows:", rows);
    }
    else {
        console.error("duck_handler: unexpected msg: ", msg);
    }
};